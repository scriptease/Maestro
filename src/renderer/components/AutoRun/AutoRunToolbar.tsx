import { memo } from 'react';
import { Play, Square, HelpCircle, Loader2, LayoutGrid, Wand2 } from 'lucide-react';
import type { Theme } from '../../types';

export interface AutoRunToolbarProps {
	theme: Theme;
	isAutoRunActive: boolean;
	isStopping: boolean;
	isAgentBusy: boolean;
	isDirty: boolean;
	sessionId: string;
	// Callbacks
	onOpenBatchRunner?: () => void;
	onStopBatchRun?: (sessionId?: string) => void;
	onOpenMarketplace?: () => void;
	onLaunchWizard?: () => void;
	onOpenHelp: () => void;
	onSave: () => Promise<void>;
	// File input
	fileInputRef: React.RefObject<HTMLInputElement>;
	onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const AutoRunToolbar = memo(function AutoRunToolbar({
	theme,
	isAutoRunActive,
	isStopping,
	isAgentBusy,
	isDirty,
	sessionId,
	onOpenBatchRunner,
	onStopBatchRun,
	onOpenMarketplace,
	onLaunchWizard,
	onOpenHelp,
	onSave,
	fileInputRef,
	onFileSelect,
}: AutoRunToolbarProps) {
	return (
		<div className="flex gap-2 mb-3 justify-center pt-2">
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				onChange={onFileSelect}
				className="hidden"
			/>
			{/* Run / Stop button */}
			{isAutoRunActive ? (
				<button
					onClick={() => !isStopping && onStopBatchRun?.(sessionId)}
					disabled={isStopping}
					className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors font-semibold ${isStopping ? 'cursor-not-allowed' : ''}`}
					style={{
						backgroundColor: isStopping ? theme.colors.warning : theme.colors.error,
						color: isStopping ? theme.colors.bgMain : 'white',
						border: `1px solid ${isStopping ? theme.colors.warning : theme.colors.error}`,
						pointerEvents: isStopping ? 'none' : 'auto',
					}}
					title={isStopping ? 'Stopping after current task...' : 'Stop auto-run'}
				>
					{isStopping ? (
						<Loader2 className="w-3.5 h-3.5 animate-spin" />
					) : (
						<Square className="w-3.5 h-3.5" />
					)}
					{isStopping ? 'Stopping...' : 'Stop'}
				</button>
			) : (
				<button
					onClick={async () => {
						// Save before opening batch runner if dirty
						if (isDirty) {
							try {
								await onSave();
							} catch {
								return; // Don't open runner if save failed
							}
						}
						onOpenBatchRunner?.();
					}}
					disabled={isAgentBusy}
					className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors ${isAgentBusy ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
					style={{
						backgroundColor: theme.colors.accent,
						color: theme.colors.accentForeground,
						border: `1px solid ${theme.colors.accent}`,
					}}
					title={isAgentBusy ? 'Cannot run while agent is thinking' : 'Run auto-run on tasks'}
				>
					<Play className="w-3.5 h-3.5" />
					Run
				</button>
			)}
			{/* Playbook Exchange button */}
			{onOpenMarketplace && (
				<button
					onClick={onOpenMarketplace}
					className="flex items-center gap-1.5 px-2 h-8 rounded transition-colors hover:opacity-90"
					style={{
						color: theme.colors.accent,
						border: `1px solid ${theme.colors.accent}40`,
						backgroundColor: `${theme.colors.accent}15`,
					}}
					title="Browse Playbook Exchange - discover and share community playbooks"
				>
					<LayoutGrid className="w-3.5 h-3.5" />
					<span className="text-xs font-medium">Exchange</span>
				</button>
			)}
			{/* Launch Wizard button */}
			{onLaunchWizard && (
				<button
					onClick={onLaunchWizard}
					className="flex items-center gap-1.5 px-2 h-8 rounded transition-colors hover:bg-white/10"
					style={{
						color: theme.colors.accent,
						border: `1px solid ${theme.colors.border}`,
					}}
					title="Launch In-Tab Wizard"
				>
					<Wand2 className="w-3.5 h-3.5" />
					<span className="text-xs font-medium">Wizard</span>
				</button>
			)}
			{/* Help button */}
			<button
				onClick={onOpenHelp}
				className="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-white/10"
				style={{
					color: theme.colors.textDim,
					border: `1px solid ${theme.colors.border}`,
				}}
				title="Learn about Auto Runner"
			>
				<HelpCircle className="w-3.5 h-3.5" />
			</button>
		</div>
	);
});
