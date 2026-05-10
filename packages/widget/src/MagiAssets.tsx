import { useMemo, useState } from 'react';
import { MagiNftPanel, RefreshButton, type MagiNftPanelProps } from './NftPanel.js';
import { MagiTokenPanel } from './TokenPanel.js';
import { MagiContractDeploy } from './MagiContractDeploy.js';
import { UserSearch } from './components/UserSearch.js';

/**
 * Combined NFTs + Tokens panel with a top tab strip. For hosts that want
 * a single drop-in component covering both views.
 *
 * The built-in user search lives at this level (not on each inner panel)
 * so a single lookup applies to both the NFT and Token tab simultaneously.
 * Inner panels are mounted with `enableUserSearch={false}` to suppress
 * their own search inputs. Same goes for the deploy button - this
 * component renders one (with both NFT + Token tabs) and tells the inner
 * panels to skip their own.
 */
export function MagiAssets(props: MagiNftPanelProps) {
	const [tab, setTab] = useState<'nfts' | 'tokens'>('nfts');
	const enableUserSearch = props.enableUserSearch !== false;
	const enableDeploy = props.enableDeploy !== false;
	const enableRefresh = props.enableRefresh !== false;

	const [searchInput, setSearchInput] = useState('');
	const [internalView, setInternalView] = useState<string | undefined>(undefined);
	const [deployOpen, setDeployOpen] = useState(false);
	// Refresh sequence we forward to both inner panels - bumping it
	// causes their `refreshSeq` watchers to fire a refetch. We also flip
	// `refreshing` for ~900ms of icon spin so the button gives haptic-
	// equivalent feedback even though we don't track per-panel completion.
	const [refreshSeq, setRefreshSeq] = useState(0);
	const [refreshing, setRefreshing] = useState(false);

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
		enableUserSearch: false,
		// MagiAssets owns the deploy affordance for both tabs; suppress
		// the inner panels' duplicates.
		enableDeploy: false,
		// Same story for the refresh button - top-level only.
		enableRefresh: false,
		refreshSeq
	};

	function handleRefresh() {
		setRefreshing(true);
		setRefreshSeq((n) => n + 1);
		// We don't track per-panel fetch completion here, so just spin
		// for a short fixed window and re-enable. Both inner panels run
		// their refreshes in parallel so by the time this clears the
		// data has typically arrived.
		setTimeout(() => setRefreshing(false), 900);
	}

	const showDeployButton = enableDeploy && !readOnly && !!props.username;

	return (
		<div className={`magi-nft ${props.className ?? ''}`}>
			{enableRefresh && (
				<RefreshButton refreshing={refreshing} onClick={handleRefresh} />
			)}
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

			{(enableUserSearch || showDeployButton) && (
				<div className="magi-nft-toolbar">
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
					{showDeployButton && (
						<button
							type="button"
							className="magi-nft-toolbar-action"
							title="Deploy a new collection or token"
							onClick={() => setDeployOpen(true)}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<line x1="12" y1="5" x2="12" y2="19" />
								<line x1="5" y1="12" x2="19" y2="12" />
							</svg>
							<span>Deploy</span>
						</button>
					)}
				</div>
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

			{deployOpen && props.username && (
				<MagiContractDeploy
					aioha={props.aioha}
					username={props.username}
					onBroadcast={props.onBroadcast}
					keyType={props.keyType}
					config={props.config}
					client={props.client}
					serviceUrl={props.deployerUrl}
					defaultType={tab === 'tokens' ? 'token' : 'nft'}
					onClose={() => setDeployOpen(false)}
					onSuccess={() => setDeployOpen(false)}
				/>
			)}
		</div>
	);
}
