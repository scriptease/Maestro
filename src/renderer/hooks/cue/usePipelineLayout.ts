/**
 * usePipelineLayout — Layout persistence and restoration for the pipeline editor.
 *
 * Handles debounced layout saving (node positions + viewport) and one-time
 * layout restoration on mount by merging saved positions with live graph data.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { ReactFlowInstance } from 'reactflow';
import type {
	CuePipelineState,
	CueGraphSession,
	PipelineLayoutState,
} from '../../../shared/cue-pipeline-types';
import { graphSessionsToPipelines } from '../../components/CuePipelineEditor/utils/yamlToPipeline';
import { mergePipelinesWithSavedLayout } from '../../components/CuePipelineEditor/utils/pipelineLayout';

export interface SessionInfo {
	id: string;
	groupId?: string;
	name: string;
	toolType: string;
	projectRoot?: string;
}

export interface UsePipelineLayoutParams {
	reactFlowInstance: ReactFlowInstance;
	graphSessions: CueGraphSession[];
	sessions: SessionInfo[];
	pipelineState: CuePipelineState;
	setPipelineState: React.Dispatch<React.SetStateAction<CuePipelineState>>;
	savedStateRef: React.MutableRefObject<string>;
	setIsDirty: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface UsePipelineLayoutReturn {
	persistLayout: () => void;
}

export function usePipelineLayout({
	reactFlowInstance,
	graphSessions,
	sessions,
	pipelineState,
	setPipelineState,
	savedStateRef,
	setIsDirty,
}: UsePipelineLayoutParams): UsePipelineLayoutReturn {
	const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const hasRestoredLayoutRef = useRef(false);

	// Keep a ref to current pipeline state for layout persistence (avoids unstable callback)
	const pipelineStateRef = useRef(pipelineState);
	pipelineStateRef.current = pipelineState;

	// Debounced layout persistence (positions + viewport)
	const persistLayout = useCallback(() => {
		if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
		layoutSaveTimerRef.current = setTimeout(() => {
			const viewport = reactFlowInstance.getViewport();
			const state = pipelineStateRef.current;
			const layout: PipelineLayoutState = {
				pipelines: state.pipelines,
				selectedPipelineId: state.selectedPipelineId,
				viewport,
			};
			window.maestro.cue
				.savePipelineLayout(layout as unknown as Record<string, unknown>)
				.catch(() => {});
		}, 500);
	}, [reactFlowInstance]);

	// Clean up debounce timer on unmount
	useEffect(() => {
		return () => {
			if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
		};
	}, []);

	// Load pipelines once on mount from saved layout merged with live graph data.
	// The pipeline editor is the primary editor — we don't re-sync from disk
	// while the user is working. Save writes back to disk.
	useEffect(() => {
		if (hasRestoredLayoutRef.current) return;
		if (!graphSessions || graphSessions.length === 0) return;

		const loadLayout = async () => {
			const livePipelines = graphSessionsToPipelines(graphSessions, sessions);
			if (livePipelines.length === 0) return;

			let savedLayout: PipelineLayoutState | null = null;
			try {
				savedLayout = (await window.maestro.cue.loadPipelineLayout()) as PipelineLayoutState | null;
			} catch {
				// No saved layout
			}

			if (savedLayout && savedLayout.pipelines) {
				const merged = mergePipelinesWithSavedLayout(livePipelines, savedLayout);

				setPipelineState(merged);
				savedStateRef.current = JSON.stringify(merged.pipelines);

				// Restore viewport if available
				if (savedLayout.viewport) {
					setTimeout(() => {
						reactFlowInstance.setViewport(savedLayout!.viewport!);
					}, 100);
				}
			} else {
				setPipelineState({ pipelines: livePipelines, selectedPipelineId: livePipelines[0].id });
				savedStateRef.current = JSON.stringify(livePipelines);
			}

			hasRestoredLayoutRef.current = true;
			setIsDirty(false);
		};

		loadLayout();
	}, [graphSessions, sessions]);

	return { persistLayout };
}
