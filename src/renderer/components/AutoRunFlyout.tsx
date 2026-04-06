/**
 * AutoRunFlyout — Compact popover shown when clicking the AUTO badge in the sidebar.
 * Displays real-time Auto Run progress: elapsed time, current document, progress bar,
 * task count, and a "Follow active task" toggle.
 */

import { useState, useEffect, useRef } from 'react';
import { Loader2, GitBranch } from 'lucide-react';
import type { Theme, BatchRunState } from '../types';
import { useUIStore } from '../stores/uiStore';

interface AutoRunFlyoutProps {
	batchState: BatchRunState;
	theme: Theme;
	onClose: () => void;
	/** Anchor element rect for positioning */
	anchorRect: DOMRect;
}

function formatElapsed(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	} else if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	} else {
		return `${seconds}s`;
	}
}

export function AutoRunFlyout({ batchState, theme, onClose, anchorRect }: AutoRunFlyoutProps) {
	const [elapsedTime, setElapsedTime] = useState('');
	const flyoutRef = useRef<HTMLDivElement>(null);

	const autoFollowEnabled = useUIStore((s) => s.autoFollowEnabled);
	const setAutoFollowEnabled = useUIStore((s) => s.setAutoFollowEnabled);
	const setActiveRightTab = useUIStore((s) => s.setActiveRightTab);

	// Update elapsed time every second
	useEffect(() => {
		if (!batchState.isRunning || !batchState.startTime) {
			setElapsedTime('');
			return;
		}

		const updateElapsed = () => {
			setElapsedTime(formatElapsed(Date.now() - batchState.startTime!));
		};

		updateElapsed();
		const interval = setInterval(updateElapsed, 1000);
		return () => clearInterval(interval);
	}, [batchState.isRunning, batchState.startTime]);

	// Close on click outside
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		// Delay to avoid the opening click from immediately closing
		const timer = setTimeout(() => {
			document.addEventListener('mousedown', handleClickOutside);
		}, 0);
		return () => {
			clearTimeout(timer);
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [onClose]);

	// Close on Escape
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [onClose]);

	// Progress calculations
	const totalTasks =
		batchState.totalTasksAcrossAllDocs > 0
			? batchState.totalTasksAcrossAllDocs
			: batchState.totalTasks;
	const completedTasks =
		batchState.totalTasksAcrossAllDocs > 0
			? batchState.completedTasksAcrossAllDocs
			: batchState.completedTasks;
	const progressPercent = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

	// Current document name
	const currentDoc =
		batchState.documents?.length === 1
			? batchState.documents[0]
			: batchState.documents?.[batchState.currentDocumentIndex];
	const docProgressPercent =
		batchState.currentDocTasksTotal > 0
			? (batchState.currentDocTasksCompleted / batchState.currentDocTasksTotal) * 100
			: 0;

	// Position: to the right of the anchor badge, vertically centered
	const top = anchorRect.top + anchorRect.height / 2;
	const left = anchorRect.right + 8;

	return (
		<div
			ref={flyoutRef}
			className="fixed z-[9999] rounded-lg border shadow-xl"
			style={{
				top: `${top}px`,
				left: `${left}px`,
				transform: 'translateY(-50%)',
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.warning,
				width: '320px',
				maxWidth: 'calc(100vw - 40px)',
			}}
		>
			<div className="px-4 py-3">
				{/* Header: status + elapsed time */}
				<div className="flex items-center justify-between mb-2">
					<div className="flex items-center gap-2">
						<Loader2 className="w-4 h-4 animate-spin" style={{ color: theme.colors.warning }} />
						<span className="text-xs font-bold uppercase" style={{ color: theme.colors.textMain }}>
							{batchState.isStopping ? 'Stopping...' : 'Auto Run Active'}
						</span>
						{batchState.worktreeActive && (
							<span title={`Worktree: ${batchState.worktreeBranch || 'active'}`}>
								<GitBranch className="w-3.5 h-3.5" style={{ color: theme.colors.warning }} />
							</span>
						)}
					</div>
					{elapsedTime && (
						<span className="text-xs font-mono" style={{ color: theme.colors.textDim }}>
							{elapsedTime}
						</span>
					)}
				</div>

				{/* Current document name */}
				{currentDoc && (
					<div className="mb-2 flex items-center gap-2 min-w-0">
						<span
							className="text-xs overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1"
							style={{
								color: theme.colors.textDim,
								direction: 'rtl',
								textAlign: 'left',
							}}
							title={`${currentDoc}.md`}
						>
							<bdi>{batchState.documents?.length > 1 ? `…${currentDoc}` : `${currentDoc}.md`}</bdi>
						</span>
						{/* Per-doc inline progress bar for multi-doc runs */}
						{batchState.documents?.length > 1 && (
							<div
								className="h-1 rounded-full overflow-hidden shrink-0"
								style={{
									backgroundColor: theme.colors.border,
									width: '60px',
								}}
							>
								<div
									className="h-full transition-all duration-300 ease-out"
									style={{
										width: `${docProgressPercent}%`,
										backgroundColor: theme.colors.accent,
									}}
								/>
							</div>
						)}
					</div>
				)}

				{/* Overall progress bar */}
				<div
					className="h-1.5 rounded-full overflow-hidden"
					style={{ backgroundColor: theme.colors.border }}
				>
					<div
						className="h-full transition-all duration-500 ease-out"
						style={{
							width: `${progressPercent}%`,
							backgroundColor: batchState.isStopping ? theme.colors.error : theme.colors.warning,
						}}
					/>
				</div>

				{/* Task count + View history */}
				<div className="mt-2 flex items-center justify-between">
					<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
						{completedTasks} of {totalTasks} tasks completed
					</span>
					<div className="flex items-center gap-2">
						{batchState.loopEnabled && (
							<span
								className="text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap"
								style={{
									backgroundColor: theme.colors.accent + '20',
									color: theme.colors.accent,
								}}
							>
								Loop {batchState.loopIteration + 1} of {batchState.maxLoops ?? '∞'}
							</span>
						)}
						<button
							className="text-[10px] whitespace-nowrap bg-transparent border-none p-0 cursor-pointer"
							style={{
								color: theme.colors.textDim,
								textDecoration: 'underline',
							}}
							onClick={() => {
								setActiveRightTab('history');
								onClose();
							}}
						>
							View history
						</button>
					</div>
				</div>

				{/* Follow active task */}
				<div className="mt-2 flex items-center gap-2">
					<label className="flex items-center gap-1.5 cursor-pointer">
						<input
							type="checkbox"
							checked={autoFollowEnabled}
							onChange={(e) => setAutoFollowEnabled(e.target.checked)}
							className="w-3 h-3 rounded cursor-pointer accent-current"
							style={{ accentColor: theme.colors.accent }}
						/>
						<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
							Follow active task
						</span>
					</label>
				</div>
			</div>
		</div>
	);
}
