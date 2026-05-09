import { useMemo, useState } from 'react';
import { MagiNftPanel, type MagiNftPanelProps } from './NftPanel.js';
import { MagiTokenPanel } from './TokenPanel.js';
import { UserSearch } from './components/UserSearch.js';

/**
 * Combined NFTs + Tokens panel with a top tab strip. For hosts that want
 * a single drop-in component covering both views.
 *
 * The built-in user search lives at this level (not on each inner panel)
 * so a single lookup applies to both the NFT and Token tab simultaneously.
 * Inner panels are mounted with `enableUserSearch={false}` to suppress
 * their own search inputs.
 */
export function MagiAssets(props: MagiNftPanelProps) {
	const [tab, setTab] = useState<'nfts' | 'tokens'>('nfts');
	const enableUserSearch = props.enableUserSearch !== false;

	const [searchInput, setSearchInput] = useState('');
	const [internalView, setInternalView] = useState<string | undefined>(undefined);

	const { effectiveView, readOnly, displayBare } = useMemo(() => {
		const bareName = (s?: string) => s?.replace(/^(@|hive:)+/, '').toLowerCase() ?? null;
		const internalBare = bareName(internalView);
		const propBare = bareName(props.viewAccount);
		const userBare = bareName(props.username);
		const effective = internalBare ?? propBare;
		const display = effective ?? userBare;
		return {
			effectiveView: effective ?? undefined,
			readOnly: effective != null && effective !== userBare,
			displayBare: display ?? null
		};
	}, [internalView, props.viewAccount, props.username]);

	function commitSearch() {
		const cleaned = searchInput.trim().replace(/^(@|hive:)+/i, '').toLowerCase();
		setInternalView(cleaned || undefined);
	}
	function clearSearch() {
		setSearchInput('');
		setInternalView(undefined);
	}

	const innerProps = {
		...props,
		// Pass the resolved view (internal or prop) to both inner panels.
		// We keep `viewAccount` rather than letting each panel re-resolve
		// it - that way the read-only badges below show the same state.
		viewAccount: effectiveView,
		enableUserSearch: false
	};

	return (
		<div className={`magi-nft ${props.className ?? ''}`}>
			<div className="magi-nft-header">
				<div className="magi-nft-badge">
					<span className="magi-nft-dot" />
					<span className="magi-nft-badge-text">
						{readOnly ? 'ASSETS - read only' : 'MAGI ASSETS'}
					</span>
				</div>
				<p className="magi-nft-subtitle">
					{readOnly && displayBare
						? `Viewing @${displayBare} - actions disabled`
						: 'Your NFTs and tokens on Magi'}
				</p>
			</div>

			{enableUserSearch && (
				<UserSearch
					searchInput={searchInput}
					onChange={setSearchInput}
					onSubmit={commitSearch}
					onClear={clearSearch}
					readOnly={readOnly}
					connected={!!props.username}
					viewing={readOnly ? displayBare : null}
				/>
			)}

			<div className="magi-nft-tabs">
				<button
					type="button"
					className={`magi-nft-tab ${tab === 'nfts' ? 'active' : ''}`}
					onClick={() => setTab('nfts')}
				>
					NFTs
				</button>
				<button
					type="button"
					className={`magi-nft-tab ${tab === 'tokens' ? 'active' : ''}`}
					onClick={() => setTab('tokens')}
				>
					Tokens
				</button>
			</div>
			{tab === 'nfts' ? (
				<MagiNftPanel {...innerProps} hideHeader bare className="" />
			) : (
				<MagiTokenPanel {...innerProps} hideHeader bare className="" />
			)}
		</div>
	);
}
