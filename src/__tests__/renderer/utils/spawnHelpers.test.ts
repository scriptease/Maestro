import { describe, it, expect, afterEach } from 'vitest';
import { getStdinFlags } from '../../../renderer/utils/spawnHelpers';

describe('getStdinFlags', () => {
	afterEach(() => {
		(window as any).maestro = { platform: 'darwin' };
	});

	it('returns both undefined on non-Windows platforms (so agent defaults take effect)', () => {
		(window as any).maestro = { platform: 'darwin' };
		const result = getStdinFlags({
			isSshSession: false,
			supportsStreamJsonInput: true,
			hasImages: false,
		});
		expect(result).toEqual({ sendPromptViaStdin: undefined, sendPromptViaStdinRaw: undefined });
	});

	it('returns sendPromptViaStdin when Windows + stream-json + images', () => {
		(window as any).maestro = { platform: 'win32' };
		const result = getStdinFlags({
			isSshSession: false,
			supportsStreamJsonInput: true,
			hasImages: true,
		});
		expect(result).toEqual({ sendPromptViaStdin: true, sendPromptViaStdinRaw: false });
	});

	it('returns sendPromptViaStdinRaw when Windows + stream-json + no images', () => {
		(window as any).maestro = { platform: 'win32' };
		const result = getStdinFlags({
			isSshSession: false,
			supportsStreamJsonInput: true,
			hasImages: false,
		});
		expect(result).toEqual({ sendPromptViaStdin: false, sendPromptViaStdinRaw: true });
	});

	it('returns sendPromptViaStdinRaw when Windows + stream-json unsupported', () => {
		(window as any).maestro = { platform: 'win32' };
		const result = getStdinFlags({
			isSshSession: false,
			supportsStreamJsonInput: false,
			hasImages: false,
		});
		expect(result).toEqual({ sendPromptViaStdin: false, sendPromptViaStdinRaw: true });
	});

	it('returns both undefined for SSH sessions on Windows (SSH uses its own stdin script)', () => {
		(window as any).maestro = { platform: 'win32' };
		const result = getStdinFlags({
			isSshSession: true,
			supportsStreamJsonInput: true,
			hasImages: true,
		});
		expect(result).toEqual({ sendPromptViaStdin: undefined, sendPromptViaStdinRaw: undefined });
	});

	it('returns both undefined for SSH sessions on Windows without stream-json', () => {
		(window as any).maestro = { platform: 'win32' };
		const result = getStdinFlags({
			isSshSession: true,
			supportsStreamJsonInput: false,
			hasImages: false,
		});
		expect(result).toEqual({ sendPromptViaStdin: undefined, sendPromptViaStdinRaw: undefined });
	});
});
