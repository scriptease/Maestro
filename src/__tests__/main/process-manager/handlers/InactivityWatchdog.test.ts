/**
 * Tests for src/main/process-manager/handlers/InactivityWatchdog.ts
 *
 * The InactivityWatchdog monitors child processes for output inactivity
 * and kills them if no stdout/stderr activity occurs within a configurable
 * threshold. This prevents hung processes from blocking Auto Run indefinitely
 * on Windows (and other platforms).
 *
 * Key behaviors:
 * - Tracks last activity timestamp per session
 * - Resets timer on any stdout or stderr output
 * - Kills process and emits agent-error after inactivity threshold
 * - Uses graceful shutdown (SIGTERM first, SIGKILL after grace period)
 * - Configurable timeout (default 30 minutes)
 * - Only monitors batch-mode (non-terminal) processes
 * - Cleans up when processes exit normally
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { InactivityWatchdog } from '../../../../main/process-manager/handlers/InactivityWatchdog';
import type { ManagedProcess } from '../../../../main/process-manager/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockProcess(overrides: Partial<ManagedProcess> = {}): ManagedProcess {
	return {
		sessionId: 'test-session',
		toolType: 'claude-code',
		cwd: '/tmp',
		pid: 1234,
		isTerminal: false,
		startTime: Date.now(),
		isBatchMode: true,
		isStreamJsonMode: false,
		jsonBuffer: '',
		stdoutBuffer: '',
		contextWindow: 200000,
		...overrides,
	} as ManagedProcess;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('InactivityWatchdog', () => {
	let processes: Map<string, ManagedProcess>;
	let emitter: EventEmitter;
	let watchdog: InactivityWatchdog;
	let killFn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		processes = new Map();
		emitter = new EventEmitter();
		killFn = vi.fn().mockReturnValue(true);
	});

	afterEach(() => {
		watchdog?.dispose();
		vi.useRealTimers();
	});

	describe('constructor', () => {
		it('should create with default timeout of 30 minutes', () => {
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
			});

			expect(watchdog.getTimeoutMs()).toBe(30 * 60 * 1000);
		});

		it('should accept a custom timeout', () => {
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: 5 * 60 * 1000,
			});

			expect(watchdog.getTimeoutMs()).toBe(5 * 60 * 1000);
		});
	});

	describe('trackSession', () => {
		it('should start tracking a session', () => {
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
			});

			watchdog.trackSession('session-1');

			expect(watchdog.isTracking('session-1')).toBe(true);
		});

		it('should not double-track the same session', () => {
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
			});

			watchdog.trackSession('session-1');
			watchdog.trackSession('session-1');

			expect(watchdog.isTracking('session-1')).toBe(true);
		});
	});

	describe('recordActivity', () => {
		it('should reset the inactivity timer for a tracked session', () => {
			const timeoutMs = 10_000; // 10 seconds for test
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: timeoutMs,
			});

			const proc = createMockProcess({ sessionId: 'session-1' });
			processes.set('session-1', proc);
			watchdog.trackSession('session-1');

			// Advance 8 seconds (within timeout)
			vi.advanceTimersByTime(8_000);

			// Record activity - should reset the timer
			watchdog.recordActivity('session-1');

			// Advance another 8 seconds (16s total, but only 8s since last activity)
			vi.advanceTimersByTime(8_000);

			// Should NOT have been killed yet (only 8s since last activity)
			expect(killFn).not.toHaveBeenCalled();
		});

		it('should be a no-op for untracked sessions', () => {
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
			});

			// Should not throw
			watchdog.recordActivity('unknown-session');

			expect(watchdog.isTracking('unknown-session')).toBe(false);
		});
	});

	describe('inactivity timeout', () => {
		it('should kill a process after inactivity timeout expires', () => {
			const timeoutMs = 10_000;
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: timeoutMs,
				checkIntervalMs: 1_000,
			});

			const proc = createMockProcess({ sessionId: 'session-1' });
			processes.set('session-1', proc);
			watchdog.trackSession('session-1');

			// Advance past the timeout
			vi.advanceTimersByTime(11_000);

			expect(killFn).toHaveBeenCalledWith('session-1');
		});

		it('should emit agent-error with inactivity_timeout type when killing', () => {
			const timeoutMs = 10_000;
			const errorHandler = vi.fn();
			emitter.on('agent-error', errorHandler);

			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: timeoutMs,
				checkIntervalMs: 1_000,
			});

			const proc = createMockProcess({ sessionId: 'session-1', toolType: 'claude-code' });
			processes.set('session-1', proc);
			watchdog.trackSession('session-1');

			vi.advanceTimersByTime(11_000);

			expect(errorHandler).toHaveBeenCalledWith(
				'session-1',
				expect.objectContaining({
					type: 'inactivity_timeout',
					recoverable: true,
					agentId: 'claude-code',
					sessionId: 'session-1',
				})
			);
		});

		it('should include a user-friendly message in the error', () => {
			const timeoutMs = 10_000;
			const errorHandler = vi.fn();
			emitter.on('agent-error', errorHandler);

			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: timeoutMs,
				checkIntervalMs: 1_000,
			});

			const proc = createMockProcess({ sessionId: 'session-1' });
			processes.set('session-1', proc);
			watchdog.trackSession('session-1');

			vi.advanceTimersByTime(11_000);

			const emittedError = errorHandler.mock.calls[0][1];
			expect(emittedError.message).toContain('inactivity');
		});

		it('should NOT kill a process that has recent activity', () => {
			const timeoutMs = 10_000;
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: timeoutMs,
				checkIntervalMs: 1_000,
			});

			const proc = createMockProcess({ sessionId: 'session-1' });
			processes.set('session-1', proc);
			watchdog.trackSession('session-1');

			// Keep producing activity every 5 seconds
			for (let i = 0; i < 10; i++) {
				vi.advanceTimersByTime(5_000);
				watchdog.recordActivity('session-1');
			}

			// 50 seconds total, but never 10 seconds without activity
			expect(killFn).not.toHaveBeenCalled();
		});

		it('should handle multiple sessions independently', () => {
			const timeoutMs = 10_000;
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: timeoutMs,
				checkIntervalMs: 1_000,
			});

			const proc1 = createMockProcess({ sessionId: 'session-1' });
			const proc2 = createMockProcess({ sessionId: 'session-2' });
			processes.set('session-1', proc1);
			processes.set('session-2', proc2);
			watchdog.trackSession('session-1');
			watchdog.trackSession('session-2');

			// Keep session-1 alive, let session-2 time out
			vi.advanceTimersByTime(5_000);
			watchdog.recordActivity('session-1');

			vi.advanceTimersByTime(6_000);

			// session-2 should be killed (11s without activity)
			// session-1 should not (only 6s since last activity)
			expect(killFn).toHaveBeenCalledWith('session-2');
			expect(killFn).not.toHaveBeenCalledWith('session-1');
		});
	});

	describe('untrackSession', () => {
		it('should stop tracking a session', () => {
			const timeoutMs = 10_000;
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: timeoutMs,
				checkIntervalMs: 1_000,
			});

			const proc = createMockProcess({ sessionId: 'session-1' });
			processes.set('session-1', proc);
			watchdog.trackSession('session-1');

			// Untrack before timeout
			watchdog.untrackSession('session-1');

			// Advance past timeout
			vi.advanceTimersByTime(11_000);

			// Should NOT have been killed
			expect(killFn).not.toHaveBeenCalled();
			expect(watchdog.isTracking('session-1')).toBe(false);
		});

		it('should be a no-op for untracked sessions', () => {
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
			});

			// Should not throw
			watchdog.untrackSession('unknown-session');
		});
	});

	describe('dispose', () => {
		it('should stop all monitoring and clear tracked sessions', () => {
			const timeoutMs = 10_000;
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: timeoutMs,
				checkIntervalMs: 1_000,
			});

			const proc = createMockProcess({ sessionId: 'session-1' });
			processes.set('session-1', proc);
			watchdog.trackSession('session-1');

			watchdog.dispose();

			// Advance past timeout
			vi.advanceTimersByTime(11_000);

			// Should NOT have been killed after disposal
			expect(killFn).not.toHaveBeenCalled();
			expect(watchdog.isTracking('session-1')).toBe(false);
		});
	});

	describe('process no longer in map', () => {
		it('should auto-untrack sessions whose processes have already been removed', () => {
			const timeoutMs = 10_000;
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: timeoutMs,
				checkIntervalMs: 1_000,
			});

			const proc = createMockProcess({ sessionId: 'session-1' });
			processes.set('session-1', proc);
			watchdog.trackSession('session-1');

			// Remove the process from the map (simulates normal exit cleanup)
			processes.delete('session-1');

			// Advance past timeout
			vi.advanceTimersByTime(11_000);

			// Should NOT attempt to kill (process already gone), and should auto-untrack
			expect(killFn).not.toHaveBeenCalled();
			expect(watchdog.isTracking('session-1')).toBe(false);
		});
	});

	describe('terminal processes', () => {
		it('should skip terminal processes during inactivity check', () => {
			const timeoutMs = 10_000;
			watchdog = new InactivityWatchdog({
				processes,
				emitter,
				killProcess: killFn,
				inactivityTimeoutMs: timeoutMs,
				checkIntervalMs: 1_000,
			});

			const terminalProc = createMockProcess({
				sessionId: 'terminal-session',
				isTerminal: true,
				isBatchMode: false,
			});
			processes.set('terminal-session', terminalProc);
			watchdog.trackSession('terminal-session');

			vi.advanceTimersByTime(11_000);

			// Terminal processes should never be killed by the watchdog
			expect(killFn).not.toHaveBeenCalled();
		});
	});
});
