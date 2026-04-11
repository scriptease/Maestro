/**
 * Centralized prompt initialization for renderer process
 *
 * Loads all prompts via IPC once at app startup. Call this early in App.tsx
 * before any components that need prompts are rendered.
 *
 * Also provides refreshRendererPrompts() for the Settings UI to call
 * after save/reset, so edits take effect immediately without restart.
 */

// Stores
import { loadSettingsStorePrompts } from '../stores/settingsStore';
import { loadAgentStorePrompts } from '../stores/agentStore';

// Hooks
import { loadInputProcessingPrompts } from '../hooks/input/useInputProcessing';
import { loadWizardHandlersPrompts } from '../hooks/wizard/useWizardHandlers';
import { loadAgentListenersPrompts } from '../hooks/agent/useAgentListeners';
import { loadMergeTransferPrompts } from '../hooks/agent/useMergeTransferHandlers';
import { loadBatchUtilsPrompts } from '../hooks/batch/batchUtils';

// Services
import { loadContextGroomerPrompts } from './contextGroomer';
import { loadContextSummarizerPrompts } from './contextSummarizer';
import { loadInlineWizardConversationPrompts } from './inlineWizardConversation';
import { loadInlineWizardDocGenPrompts } from './inlineWizardDocumentGeneration';
import { loadWizardPrompts } from '../components/Wizard/services/wizardPrompts';
import { loadPhaseGeneratorPrompts } from '../components/Wizard/services/phaseGenerator';

let initialized = false;
let initPromise: Promise<void> | null = null;

async function loadAll(force = false): Promise<void> {
	await Promise.all([
		// Stores
		loadSettingsStorePrompts(force),
		loadAgentStorePrompts(force),
		// Hooks
		loadInputProcessingPrompts(force),
		loadWizardHandlersPrompts(force),
		loadAgentListenersPrompts(force),
		loadMergeTransferPrompts(force),
		loadBatchUtilsPrompts(force),
		// Services
		loadContextGroomerPrompts(force),
		loadContextSummarizerPrompts(force),
		loadInlineWizardConversationPrompts(force),
		loadInlineWizardDocGenPrompts(force),
		loadWizardPrompts(force),
		loadPhaseGeneratorPrompts(force),
	]);
}

/**
 * Initialize all renderer prompts. Safe to call multiple times (idempotent).
 * Must complete before the app renders components that use prompts.
 */
export async function initializeRendererPrompts(): Promise<void> {
	// If already initialized, return immediately
	if (initialized) return;

	// If initialization is in progress, wait for it
	if (initPromise) return initPromise;

	// Start initialization
	initPromise = (async () => {
		console.log('[PromptInit] Loading renderer prompts...');

		try {
			await loadAll();
			initialized = true;
			console.log('[PromptInit] Renderer prompts loaded successfully');
		} catch (error) {
			console.error('[PromptInit] Failed to load renderer prompts:', error);
			throw error;
		}
	})();

	return initPromise;
}

/**
 * Refresh all renderer prompt caches. Call after saving or resetting
 * a prompt via the Settings UI so the new content takes effect
 * immediately in all renderer consumers.
 */
export async function refreshRendererPrompts(): Promise<void> {
	console.log('[PromptInit] Refreshing renderer prompts...');
	await loadAll(true);
	console.log('[PromptInit] Renderer prompts refreshed');
}

/**
 * Check if renderer prompts have been initialized.
 */
export function areRendererPromptsInitialized(): boolean {
	return initialized;
}
