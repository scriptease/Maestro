import { isWindowsPlatform } from './platformUtils';

/**
 * Compute stdin transport flags for spawning agents on Windows.
 *
 * On Windows the cmd.exe command line is limited to ~8 KB and special
 * characters cause escaping issues.  Sending the prompt via stdin
 * side-steps both problems.
 *
 * SSH sessions must NOT use these flags - they have a dedicated
 * stdin-script path handled by ChildProcessSpawner.
 *
 * Stream-json stdin is only used when images are present AND the agent
 * supports it. Text-only messages use raw stdin for efficiency (avoids
 * wrapping in API format JSON).
 */
export function getStdinFlags(opts: {
	isSshSession: boolean;
	supportsStreamJsonInput: boolean;
	hasImages: boolean;
}): {
	sendPromptViaStdin: boolean | undefined;
	sendPromptViaStdinRaw: boolean | undefined;
} {
	const isWindows = isWindowsPlatform();
	const useStdin = isWindows && !opts.isSshSession;

	if (!useStdin) {
		// Return undefined (not false) so the agent-level default from definitions.ts
		// is not overridden by the ?? operator in the IPC handler
		return { sendPromptViaStdin: undefined, sendPromptViaStdinRaw: undefined };
	}

	return {
		// Only use stream-json stdin when there are images AND agent supports it
		sendPromptViaStdin: opts.supportsStreamJsonInput && !!opts.hasImages,
		// Use raw stdin for text-only messages (or for agents that don't support stream-json)
		sendPromptViaStdinRaw: !opts.supportsStreamJsonInput || !opts.hasImages,
	};
}
