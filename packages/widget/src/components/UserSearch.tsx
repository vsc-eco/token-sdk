interface UserSearchProps {
	searchInput: string;
	onChange: (next: string) => void;
	onSubmit: () => void;
	onClear: () => void;
	/** Whether the panel is currently in read-only / cross-account view mode. */
	readOnly: boolean;
	/** Whether the host has a connected wallet (drives label of the clear button). */
	connected: boolean;
	/** Bare username currently being viewed, when in read-only mode. */
	viewing: string | null;
}

/**
 * Compact "look up another wallet" input. Rendered inside the panel chrome,
 * styled with the same `--magi-*` variables so theming carries through.
 * Submitting via the button or `Enter` flips the panel into read-only mode
 * for that account; the clear/back button drops back to the connected
 * user's own assets (or to whatever `viewAccount` the host passed).
 */
export function UserSearch({
	searchInput,
	onChange,
	onSubmit,
	onClear,
	readOnly,
	connected,
	viewing
}: UserSearchProps) {
	return (
		<div className="magi-nft-search">
			<svg
				className="magi-nft-search-icon"
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<circle cx="11" cy="11" r="7" />
				<line x1="20" y1="20" x2="16.65" y2="16.65" />
			</svg>
			<input
				type="text"
				placeholder="Look up another wallet (e.g. tibfox)"
				value={searchInput}
				onChange={(e) => onChange((e.target as HTMLInputElement).value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') onSubmit();
					if (e.key === 'Escape') onClear();
				}}
				autoComplete="off"
				spellCheck={false}
			/>
			{searchInput.trim() && !readOnly && (
				<button type="button" onClick={onSubmit} className="primary">
					View
				</button>
			)}
			{readOnly && (
				<>
					{viewing && (
						<span className="magi-nft-search-status">
							@{viewing}
						</span>
					)}
					<button type="button" onClick={onClear} className="ghost">
						{connected ? 'Back' : 'Clear'}
					</button>
				</>
			)}
		</div>
	);
}
