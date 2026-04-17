/**
 * Tests for cue-cli-executor.
 *
 * Verifies that subscriptions with `action: command` + `command.mode: 'cli'`
 * shell out to `node maestro-cli.js send <target> <message> --live`, with
 * template substitution applied to both target and (optional) message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CueEvent, CueSubscription } from '../../../main/cue/cue-types';
import type { SessionInfo } from '../../../shared/types';
import type { TemplateContext } from '../../../shared/templateVariables';

const mockExecFileNoThrow = vi.fn();
mockExecFileNoThrow.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

vi.mock('../../../main/utils/execFile', () => ({
	execFileNoThrow: (...args: unknown[]) => mockExecFileNoThrow(...args),
}));

const mockCaptureException = vi.fn();
vi.mock('../../../main/utils/sentry', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import { executeCueCli } from '../../../main/cue/cue-cli-executor';

function createSession(): SessionInfo {
	return {
		id: 'session-1',
		name: 'Test Session',
		toolType: 'claude-code',
		cwd: '/projects/test',
		projectRoot: '/projects/test',
	};
}

function createEvent(payloadOverrides: Record<string, unknown> = {}): CueEvent {
	return {
		id: 'evt-1',
		type: 'agent.completed',
		timestamp: '2026-04-16T10:00:00.000Z',
		triggerName: 'cli-test',
		payload: {
			sourceSession: 'researcher',
			sourceSessionId: 'session-research',
			sourceOutput: 'computed answer = 42',
			...payloadOverrides,
		},
	};
}

function createSubscription(): CueSubscription {
	return {
		name: 'cli-test',
		event: 'agent.completed',
		enabled: true,
		prompt: '{{CUE_FROM_AGENT}}',
		action: 'command',
		command: { mode: 'cli', cli: { command: 'send', target: '{{CUE_FROM_AGENT}}' } },
	};
}

function createConfig(overrides: Record<string, unknown> = {}) {
	const templateContext: TemplateContext = {
		session: {
			id: 'session-1',
			name: 'Test Session',
			toolType: 'claude-code',
			cwd: '/projects/test',
			projectRoot: '/projects/test',
		},
	};
	return {
		runId: 'run-1',
		session: createSession(),
		subscription: createSubscription(),
		event: createEvent(),
		cli: { command: 'send' as const, target: '{{CUE_FROM_AGENT}}' },
		templateContext,
		timeoutMs: 30000,
		onLog: vi.fn(),
		...overrides,
	};
}

describe('cue-cli-executor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecFileNoThrow.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
	});

	it('substitutes {{CUE_FROM_AGENT}} in target before invoking maestro-cli send', async () => {
		const config = createConfig();
		const result = await executeCueCli(config as any);

		expect(mockExecFileNoThrow).toHaveBeenCalledTimes(1);
		const args = mockExecFileNoThrow.mock.calls[0][1] as string[];
		expect(args[0]).toContain('maestro-cli.js');
		expect(args[1]).toBe('send');
		expect(args[2]).toBe('session-research'); // CUE_FROM_AGENT resolved from sourceSessionId
		// args[3] is the message — defaults to {{CUE_SOURCE_OUTPUT}} which expands to the agent's stdout
		expect(args[3]).toBe('computed answer = 42');
		expect(args[4]).toBe('--live');
		expect(result.status).toBe('completed');
	});

	it('uses an explicit message override when provided', async () => {
		const config = createConfig({
			cli: {
				command: 'send' as const,
				target: 'session-A',
				message: 'Hello from {{CUE_TRIGGER_NAME}}: {{CUE_SOURCE_OUTPUT}}',
			},
		});
		await executeCueCli(config as any);

		const args = mockExecFileNoThrow.mock.calls[0][1] as string[];
		expect(args[2]).toBe('session-A');
		expect(args[3]).toBe('Hello from cli-test: computed answer = 42');
	});

	it('reports failed status when target resolves to empty string', async () => {
		const config = createConfig({
			event: createEvent({ sourceSessionId: '', sourceAgentId: '' }),
			cli: { command: 'send' as const, target: '{{CUE_FROM_AGENT}}' },
		});
		const result = await executeCueCli(config as any);

		expect(mockExecFileNoThrow).not.toHaveBeenCalled();
		expect(result.status).toBe('failed');
		expect(result.stderr).toMatch(/empty string/i);
	});

	it('reports failed status when maestro-cli exits non-zero', async () => {
		mockExecFileNoThrow.mockResolvedValueOnce({
			stdout: '',
			stderr: 'session not found',
			exitCode: 2,
		});
		const config = createConfig({
			cli: { command: 'send' as const, target: 'literal-session-id' },
		});
		const result = await executeCueCli(config as any);

		expect(result.status).toBe('failed');
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain('session not found');
	});

	it('reports failed with null exitCode on spawn-failure string codes (e.g. ENOENT)', async () => {
		mockExecFileNoThrow.mockResolvedValueOnce({
			stdout: '',
			stderr: 'spawn ENOENT',
			exitCode: 'ENOENT',
		});
		const config = createConfig({
			cli: { command: 'send' as const, target: 'x' },
		});
		const result = await executeCueCli(config as any);

		expect(result.status).toBe('failed');
		expect(result.exitCode).toBeNull();
	});

	it('reports failed status and captures the exception if execFile throws', async () => {
		mockExecFileNoThrow.mockRejectedValueOnce(new Error('boom'));
		const config = createConfig({
			cli: { command: 'send' as const, target: 'x' },
		});
		const result = await executeCueCli(config as any);

		expect(result.status).toBe('failed');
		expect(result.stderr).toContain('boom');
		expect(mockCaptureException).toHaveBeenCalled();
	});
});
