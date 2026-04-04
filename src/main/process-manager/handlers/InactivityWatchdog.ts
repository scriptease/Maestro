// src/main/process-manager/handlers/InactivityWatchdog.ts

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import type { ManagedProcess, AgentError } from '../types';

/**
 * Default inactivity timeout: 30 minutes in milliseconds.
 * If a child process produces no stdout or stderr output for this duration,
 * the watchdog considers it hung and kills it.
 */
const DEFAULT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Default interval between inactivity checks: 30 seconds.
 * The watchdog sweeps all tracked sessions at this frequency.
 */
const DEFAULT_CHECK_INTERVAL_MS = 30 * 1000;

/**
 * Configuration for the InactivityWatchdog.
 */
export interface InactivityWatchdogConfig {
	/** Map of session IDs to managed processes (shared with ProcessManager) */
	processes: Map<string, ManagedProcess>;
	/** Event emitter for agent-error events (shared with ProcessManager) */
	emitter: EventEmitter;
	/** Function to kill a process by session ID (delegates to ProcessManager.kill) */
	killProcess: (sessionId: string) => boolean;
	/** Inactivity threshold in milliseconds before killing a process (default: 30 min) */
	inactivityTimeoutMs?: number;
	/** Interval between inactivity checks in milliseconds (default: 30 sec) */
	checkIntervalMs?: number;
}

/**
 * Per-session tracking state.
 * Immutable - new objects are created on each activity update.
 */
interface SessionTracker {
	readonly lastActivityTime: number;
}

/**
 * Monitors child processes for prolonged inactivity and kills hung ones.
 *
 * This solves the Windows Auto Run hang (Issue #721) where child processes
 * can hang indefinitely (e.g., PowerShell interactive mode), causing the
 * renderer Promise in useAgentExecution.ts to never resolve.
 *
 * The watchdog does NOT use a hard timeout. It only kills processes that
 * have produced no output (stdout or stderr) for a configurable duration.
 * Actively working agents that continue producing output live indefinitely.
 *
 * Architecture:
 * - Lives in the main process alongside ProcessManager
 * - Uses a periodic sweep (setInterval) to check all tracked sessions
 * - StdoutHandler and StderrHandler call recordActivity() on every output
 * - On timeout, emits agent-error with type 'inactivity_timeout' before killing
 * - The renderer sees the error via the existing IPC error channel
 */
export class InactivityWatchdog {
	private readonly processes: Map<string, ManagedProcess>;
	private readonly emitter: EventEmitter;
	private readonly killProcess: (sessionId: string) => boolean;
	private readonly inactivityTimeoutMs: number;
	private readonly checkIntervalMs: number;

	/** Tracked sessions and their last activity timestamps */
	private trackedSessions: Map<string, SessionTracker> = new Map();

	/** Handle for the periodic check interval */
	private checkInterval: ReturnType<typeof setInterval> | null = null;

	constructor(config: InactivityWatchdogConfig) {
		this.processes = config.processes;
		this.emitter = config.emitter;
		this.killProcess = config.killProcess;
		this.inactivityTimeoutMs = config.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
		this.checkIntervalMs = config.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;

		this.startChecking();
	}

	/**
	 * Returns the configured inactivity timeout in milliseconds.
	 */
	getTimeoutMs(): number {
		return this.inactivityTimeoutMs;
	}

	/**
	 * Begin tracking a session for inactivity.
	 * The current time is used as the initial "last activity" timestamp.
	 */
	trackSession(sessionId: string): void {
		if (this.trackedSessions.has(sessionId)) {
			return;
		}

		this.trackedSessions.set(sessionId, {
			lastActivityTime: Date.now(),
		});

		logger.debug('[InactivityWatchdog] Now tracking session', 'InactivityWatchdog', {
			sessionId,
			timeoutMs: this.inactivityTimeoutMs,
		});
	}

	/**
	 * Record output activity for a session, resetting its inactivity timer.
	 * Called by StdoutHandler and StderrHandler on every data chunk.
	 */
	recordActivity(sessionId: string): void {
		if (!this.trackedSessions.has(sessionId)) {
			return;
		}

		// Create a new tracker object (immutable update)
		this.trackedSessions.set(sessionId, {
			lastActivityTime: Date.now(),
		});
	}

	/**
	 * Stop tracking a session (e.g., on normal process exit).
	 */
	untrackSession(sessionId: string): void {
		this.trackedSessions.delete(sessionId);
	}

	/**
	 * Check if a session is currently being tracked.
	 */
	isTracking(sessionId: string): boolean {
		return this.trackedSessions.has(sessionId);
	}

	/**
	 * Stop all monitoring and release resources.
	 */
	dispose(): void {
		if (this.checkInterval !== null) {
			clearInterval(this.checkInterval);
			this.checkInterval = null;
		}
		this.trackedSessions.clear();
	}

	/**
	 * Start the periodic inactivity check sweep.
	 */
	private startChecking(): void {
		this.checkInterval = setInterval(() => {
			this.sweep();
		}, this.checkIntervalMs);
	}

	/**
	 * Sweep all tracked sessions and kill any that have exceeded
	 * the inactivity timeout.
	 */
	private sweep(): void {
		const now = Date.now();
		// Collect session IDs to process (avoid mutating map during iteration)
		const sessionsToCheck = Array.from(this.trackedSessions.entries());

		for (const [sessionId, tracker] of sessionsToCheck) {
			const managedProcess = this.processes.get(sessionId);

			// If the process is already gone, clean up tracking
			if (!managedProcess) {
				this.trackedSessions.delete(sessionId);
				continue;
			}

			// Skip terminal processes - they are interactive and should not be killed
			if (managedProcess.isTerminal) {
				continue;
			}

			const inactiveDuration = now - tracker.lastActivityTime;

			if (inactiveDuration >= this.inactivityTimeoutMs) {
				this.handleInactivityTimeout(sessionId, managedProcess, inactiveDuration);
			}
		}
	}

	/**
	 * Handle a session that has exceeded the inactivity timeout.
	 * Emits an agent-error event and then kills the process.
	 */
	private handleInactivityTimeout(
		sessionId: string,
		managedProcess: ManagedProcess,
		inactiveDurationMs: number
	): void {
		const inactiveMinutes = Math.round(inactiveDurationMs / 60_000);

		logger.warn('[InactivityWatchdog] Killing process due to inactivity', 'InactivityWatchdog', {
			sessionId,
			toolType: managedProcess.toolType,
			pid: managedProcess.pid,
			inactiveMinutes,
			timeoutMinutes: Math.round(this.inactivityTimeoutMs / 60_000),
		});

		// Emit the error before killing so listeners can capture the reason
		const agentError: AgentError = {
			type: 'inactivity_timeout',
			message: `Agent killed after ${inactiveMinutes} minutes of inactivity. The process produced no output and appeared to be hung.`,
			recoverable: true,
			agentId: managedProcess.toolType,
			sessionId,
			timestamp: Date.now(),
			raw: {
				exitCode: -1,
			},
		};

		this.emitter.emit('agent-error', sessionId, agentError);

		// Stop tracking before killing to avoid re-processing
		this.trackedSessions.delete(sessionId);

		// Kill the process
		this.killProcess(sessionId);
	}
}
