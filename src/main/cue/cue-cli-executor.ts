/**
 * Cue CLI Executor — runs an `action: command` subscription whose
 * `command.mode` is `'cli'`.
 *
 * Currently supports one maestro-cli sub-command, `send`, which delivers a
 * message to a target session via `maestro-cli send <target> <message> --live`.
 * Both `target` and `message` (default: `{{CUE_SOURCE_OUTPUT}}`) go through
 * Cue template substitution before spawning. The same low-level
 * {@link runMaestroCliSend} helper backs the legacy `cli_output` Phase 3
 * post-completion side effect in `cue-run-manager.ts` so both paths share
 * one implementation.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CueCommandCliCall, CueEvent, CueRunResult, CueSubscription } from './cue-types';
import type { SessionInfo } from '../../shared/types';
import { substituteTemplateVariables, type TemplateContext } from '../../shared/templateVariables';
import { buildCueTemplateContext } from './cue-template-context-builder';
import { execFileNoThrow } from '../utils/execFile';
import { captureException } from '../utils/sentry';

/** Timeout for a single maestro-cli send invocation. */
const CLI_SEND_TIMEOUT_MS = 30_000;
/** Cap on how much of the source output we forward — protects the CLI argv. */
const CLI_SEND_OUTPUT_MAX_CHARS = 100_000;
/** Default message body when the user didn't override it. */
const DEFAULT_CLI_MESSAGE_TEMPLATE = '{{CUE_SOURCE_OUTPUT}}';

export interface CueCliExecutionConfig {
	runId: string;
	session: SessionInfo;
	subscription: CueSubscription;
	event: CueEvent;
	/** The structured cli call (target, optional message override). */
	cli: CueCommandCliCall;
	templateContext: TemplateContext;
	timeoutMs: number;
	onLog: (level: string, message: string) => void;
}

export interface CliSendResult {
	ok: boolean;
	/** Exit code from execFileNoThrow — number when the process ran, string error code (e.g. 'ENOENT') when spawn failed. */
	exitCode: number | string;
	stdout: string;
	stderr: string;
	resolvedTarget: string;
}

/**
 * Resolve the bundled `maestro-cli.js` script path. Mirrors the candidate list
 * in `maestro-cli-manager.ts` so dev/test environments (where
 * `process.resourcesPath` is undefined or points at electron's built-in
 * resources) still find the compiled script at `dist/cli/maestro-cli.js`.
 */
function resolveMaestroCliScriptPath(): string {
	const candidates: string[] = [];
	if (process.resourcesPath) {
		candidates.push(path.join(process.resourcesPath, 'maestro-cli.js'));
	}
	// Compiled dev layout: main/cue/cue-cli-executor.js lives next to cli/.
	candidates.push(path.resolve(__dirname, '..', 'cli', 'maestro-cli.js'));

	for (const candidate of candidates) {
		try {
			fs.accessSync(candidate, fs.constants.R_OK);
			return candidate;
		} catch {
			continue;
		}
	}
	// Fall back to the first candidate so execFile surfaces a clear ENOENT
	// with the attempted path rather than a bare filename.
	return candidates[0] ?? path.resolve(__dirname, '..', 'cli', 'maestro-cli.js');
}

/**
 * Spawn `node maestro-cli.js send <target> <message> --live`. Used by both the
 * primary cli executor and the legacy cli_output Phase 3 path.
 */
export async function runMaestroCliSend(
	target: string,
	message: string,
	timeoutMs: number = CLI_SEND_TIMEOUT_MS
): Promise<CliSendResult> {
	const cliScriptPath = resolveMaestroCliScriptPath();
	const truncated = message.substring(0, CLI_SEND_OUTPUT_MAX_CHARS);
	const cliResult = await execFileNoThrow(
		process.execPath,
		[cliScriptPath, 'send', target, truncated, '--live'],
		undefined,
		{ timeout: timeoutMs }
	);
	return {
		ok: cliResult.exitCode === 0,
		exitCode: cliResult.exitCode,
		stdout: cliResult.stdout,
		stderr: cliResult.stderr,
		resolvedTarget: target,
	};
}

/**
 * Execute a Cue-triggered cli command (currently always `send`). Substitutes
 * `target` + `message` with template variables then invokes maestro-cli.
 */
export async function executeCueCli(config: CueCliExecutionConfig): Promise<CueRunResult> {
	const { runId, session, subscription, event, cli, templateContext, timeoutMs, onLog } = config;

	const startedAt = new Date().toISOString();
	const startTime = Date.now();

	const failedResult = (message: string): CueRunResult => ({
		runId,
		sessionId: session.id,
		sessionName: session.name,
		subscriptionName: subscription.name,
		event,
		status: 'failed',
		stdout: '',
		stderr: message,
		exitCode: null,
		durationMs: Date.now() - startTime,
		startedAt,
		endedAt: new Date().toISOString(),
	});

	templateContext.cue = buildCueTemplateContext(event, subscription, runId);

	const resolvedTarget = substituteTemplateVariables(cli.target, templateContext).trim();
	if (!resolvedTarget) {
		const message = `Cue subscription "${subscription.name}" cli target resolved to empty string (raw="${cli.target}")`;
		onLog('warn', message);
		return failedResult(message);
	}

	const messageTemplate = cli.message ?? DEFAULT_CLI_MESSAGE_TEMPLATE;
	const resolvedMessage = substituteTemplateVariables(messageTemplate, templateContext);

	onLog(
		'cue',
		`[CUE] Executing cli run ${runId}: "${subscription.name}" → maestro-cli send ${resolvedTarget} (message length=${resolvedMessage.length})`
	);

	try {
		// Treat <=0 as "no explicit cap — use default" rather than clamping to
		// 1ms (which would kill the process almost immediately).
		const clampedTimeout =
			timeoutMs > 0 ? Math.min(timeoutMs, CLI_SEND_TIMEOUT_MS) : CLI_SEND_TIMEOUT_MS;
		const result = await runMaestroCliSend(resolvedTarget, resolvedMessage, clampedTimeout);
		const status = result.ok ? 'completed' : 'failed';
		if (!result.ok) {
			onLog(
				'warn',
				`[CUE] "${subscription.name}" cli send failed: exit=${result.exitCode} stderr=${result.stderr.slice(0, 500)}`
			);
		} else {
			onLog('cue', `[CUE] "${subscription.name}" cli send delivered to ${resolvedTarget}`);
		}
		// CueRunResult only carries numeric exit codes; spawn-failure string codes
		// (ENOENT etc.) are reported in stderr and surface as exitCode=null.
		const numericExit = typeof result.exitCode === 'number' ? result.exitCode : null;
		return {
			runId,
			sessionId: session.id,
			sessionName: session.name,
			subscriptionName: subscription.name,
			event,
			status,
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: numericExit,
			durationMs: Date.now() - startTime,
			startedAt,
			endedAt: new Date().toISOString(),
		};
	} catch (err) {
		captureException(err, {
			operation: 'cue:cliExecutor',
			subscription: subscription.name,
			target: resolvedTarget,
		});
		const message = `cli send threw: ${err instanceof Error ? err.message : String(err)}`;
		onLog('warn', `[CUE] "${subscription.name}" ${message}`);
		return failedResult(message);
	}
}
