import { useEffect, useMemo, useState } from 'react';
import {
	createNftClient,
	extractImageUrl,
	MAINNET_CONFIG,
	type AiohaLike,
	type BroadcastHook,
	type MagiConfig,
	type NftClient,
	type NftItem
} from '@vsc.eco/nft-sdk';
import { NftTransferForm } from './actions/NftTransferForm.js';
import { NftBurnForm } from './actions/NftBurnForm.js';
import { NftBatchTransferForm } from './actions/NftBatchTransferForm.js';
import { UserSearch } from './components/UserSearch.js';
import magiFallbackSvg from './assets/magi.svg';

export interface MagiNftPanelProps {
	/** The connected user's signing identity. Used for write ops. */
	username?: string;
	aioha?: AiohaLike;
	onBroadcast?: BroadcastHook;
	keyType?: unknown;
	config?: MagiConfig;
	/** Pre-built client. When provided overrides aioha/onBroadcast/config. */
	client?: NftClient;
	/** Called after a successful broadcast in any action form. */
	onSuccess?: (txId: string) => void;
	className?: string;
	/** Hide the badge + subtitle if you'd rather draw the chrome yourself. */
	hideHeader?: boolean;
	/** Skip the outer `.magi-nft` card wrapper - use when nesting inside another magi-nft host. */
	bare?: boolean;
	/**
	 * Account whose NFTs to display. Defaults to `username`. When set to a
	 * different account (e.g. for "view someone else's wallet" flows), the
	 * panel goes read-only: transfer / burn / batch-transfer affordances
	 * are hidden because the connected user can't sign for those tokens.
	 *
	 * If the panel's built-in search input is also active, the user-typed
	 * value takes precedence. Set `enableUserSearch={false}` to suppress
	 * the input entirely and drive viewing programmatically.
	 */
	viewAccount?: string;
	/**
	 * Render a built-in "look up another wallet" input above the panel
	 * content. Default `true` - set to `false` if the host already provides
	 * its own search UI driving `viewAccount` from outside.
	 */
	enableUserSearch?: boolean;
}

type ActionState =
	| { kind: 'transfer'; item: NftItem }
	| { kind: 'burn'; item: NftItem }
	| { kind: 'batch'; contractId: string; items: NftItem[] }
	| null;

interface CollectionGroup {
	contractId: string;
	name: string;
	symbol: string;
	items: NftItem[];
}

/**
 * The "your NFTs" view. Lists every NFT the connected user holds,
 * grouped by collection, with per-tile transfer/burn actions and a
 * collection-level batch-transfer.
 *
 * For headless integrators: don't use this - call `client.nft.provider.getUserNfts(account)`
 * directly and render however you want.
 */
export function MagiNftPanel(props: MagiNftPanelProps) {
	const {
		username,
		aioha,
		onBroadcast,
		keyType,
		config = MAINNET_CONFIG,
		client: providedClient,
		onSuccess,
		className,
		hideHeader,
		bare,
		viewAccount,
		enableUserSearch = true
	} = props;

	const client = useMemo<NftClient>(() => {
		return providedClient ?? createNftClient({ config, aioha, onBroadcast, keyType });
	}, [providedClient, config, aioha, onBroadcast, keyType]);

	const [items, setItems] = useState<NftItem[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reloadTick, setReloadTick] = useState(0);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [action, setAction] = useState<ActionState>(null);
	/**
	 * Per-token image URLs, keyed `${contractId}:${tokenId}`. Resolved via
	 * `client.nft.provider.resolveNftImages(items)` which honours the
	 * own-props → template-props → baseUri+tokenId priority that
	 * okinoko-terminal uses today.
	 */
	const [imageUrls, setImageUrls] = useState<Record<string, string | null>>({});
	/**
	 * Collection-level icons, keyed by contractId. Pulled from the
	 * `collection_metadata` blob the contract owner sets via
	 * setCollectionMetadata. `null` means resolved-without-icon - distinct
	 * from `undefined` (not yet fetched) so we don't repeatedly retry empty
	 * collections.
	 */
	const [collectionIcons, setCollectionIcons] = useState<Record<string, string | null>>({});

	// User-typed search value (input contents) and the committed value
	// driving the lookup. Internal state takes precedence over the
	// `viewAccount` prop - until the user clears the search, then we fall
	// back to whatever the host passed in.
	const [searchInput, setSearchInput] = useState('');
	const [internalView, setInternalView] = useState<string | undefined>(undefined);

	/**
	 * Display account - internal search wins, then `viewAccount` prop, then
	 * the connected user. Read-only mode kicks in when the resulting account
	 * differs from `username`: transfer / burn / batch buttons disappear
	 * because the user can't sign for someone else's tokens. We compare
	 * bare names so `alice`, `@alice`, and `hive:alice` all match.
	 */
	const { account, readOnly } = useMemo(() => {
		const bare = (s?: string) => s?.replace(/^(@|hive:)+/, '').toLowerCase() ?? null;
		const internalBare = bare(internalView);
		const viewBare = bare(viewAccount);
		const effective = internalBare ?? viewBare;
		const userBare = bare(username);
		const target = effective ?? userBare;
		if (!target) return { account: null as string | null, readOnly: false };
		return {
			account: `hive:${target}`,
			readOnly: effective != null && effective !== userBare
		};
	}, [username, viewAccount, internalView]);

	function commitSearch() {
		const cleaned = searchInput.trim().replace(/^(@|hive:)+/i, '').toLowerCase();
		setInternalView(cleaned || undefined);
	}
	function clearSearch() {
		setSearchInput('');
		setInternalView(undefined);
	}

	useEffect(() => {
		if (!account) {
			setItems(null);
			return;
		}
		let cancelled = false;
		setError(null);
		client.nft.provider
			.getUserNfts(account)
			.then((rows) => {
				if (!cancelled) {
					setItems(rows);
					setExpanded((prev) => {
						const next = { ...prev };
						// First-load default: expand only when the user owns NFTs in
						// a single collection - otherwise show every collection
						// collapsed so the panel doesn't dump dozens of tiles at once.
						const distinctCollections = new Set(rows.map((r) => r.contractId)).size;
						const expandByDefault = distinctCollections <= 1;
						for (const r of rows) {
							if (next[r.contractId] === undefined) next[r.contractId] = expandByDefault;
						}
						return next;
					});
				}
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [account, client, reloadTick]);

	// Fetch collection-level icons (from the `collection_metadata` state
	// blob) once we know which collections the user holds. One getStateByKeys
	// call per contract, fired in parallel and applied as each returns.
	useEffect(() => {
		if (!items?.length) return;
		const seen = new Set<string>();
		const missing: string[] = [];
		for (const it of items) {
			if (seen.has(it.contractId)) continue;
			seen.add(it.contractId);
			if (collectionIcons[it.contractId] === undefined) {
				missing.push(it.contractId);
			}
		}
		if (!missing.length) return;
		let cancelled = false;
		for (const cid of missing) {
			client.nft.provider
				.getCollectionMetadata(cid)
				.then((meta) => {
					if (cancelled) return;
					setCollectionIcons((prev) => ({
						...prev,
						[cid]: extractImageUrl(meta)
					}));
				})
				.catch(() => {
					if (cancelled) return;
					// Mark as resolved-with-null so we don't refetch on
					// every re-render of the collectionIcons-deps closure.
					setCollectionIcons((prev) => ({ ...prev, [cid]: null }));
				});
		}
		return () => {
			cancelled = true;
		};
	}, [items, client, collectionIcons]);

	// Resolve per-token images once items are loaded. Priority (matches
	// okinoko-terminal): own props.image → template props.image → baseUri+tokenId.
	//
	// Resolution is fanned out *per contract* and state is updated as each
	// one returns - a slow getStateByKeys for one collection no longer
	// blocks tiles in other collections from showing their images. Tiles
	// render the magi fallback for the duration of their own collection's
	// round-trip; we deliberately do NOT paint a baseUri+tokenId URL
	// optimistically because for collections that use props.image (mint-time
	// or template-inherited) that URL is just wrong and would briefly flash
	// the wrong image before snapping to the correct one.
	useEffect(() => {
		if (!items?.length) return;
		const missing = items.filter(
			(it) => imageUrls[`${it.contractId}:${it.tokenId}`] === undefined
		);
		if (!missing.length) return;

		// Group missing items by contract so we can issue one query per
		// collection and apply each result independently.
		const byContract = new Map<string, NftItem[]>();
		for (const it of missing) {
			const list = byContract.get(it.contractId) ?? [];
			list.push(it);
			byContract.set(it.contractId, list);
		}

		let cancelled = false;
		for (const [, contractItems] of byContract) {
			client.nft.provider
				.resolveNftImages(contractItems)
				.then((map) => {
					if (cancelled) return;
					const updates: Record<string, string | null> = {};
					for (const [k, v] of map.entries()) updates[k] = v;
					setImageUrls((prev) => ({ ...prev, ...updates }));
				})
				.catch(() => {
					// On total failure, mark these items as resolved-with-null
					// so they stop sitting in "loading" forever and the panel
					// shows the fallback definitively.
					if (cancelled) return;
					const updates: Record<string, string | null> = {};
					for (const it of contractItems) {
						updates[`${it.contractId}:${it.tokenId}`] = null;
					}
					setImageUrls((prev) => ({ ...prev, ...updates }));
				});
		}
		return () => {
			cancelled = true;
		};
	}, [items, client, imageUrls]);

	const groups = useMemo<CollectionGroup[]>(() => {
		if (!items) return [];
		const byContract = new Map<string, CollectionGroup>();
		for (const it of items) {
			let g = byContract.get(it.contractId);
			if (!g) {
				g = {
					contractId: it.contractId,
					name: it.collection.name || 'Unnamed collection',
					symbol: it.collection.symbol || '',
					items: []
				};
				byContract.set(it.contractId, g);
			}
			g.items.push(it);
		}
		return Array.from(byContract.values()).sort((a, b) => a.name.localeCompare(b.name));
	}, [items]);

	function handleSuccess(txId: string) {
		setReloadTick((n) => n + 1);
		onSuccess?.(txId);
	}

	const rootClass = bare
		? `magi-nft-bare ${className ?? ''}`.trim()
		: `magi-nft ${className ?? ''}`.trim();

	return (
		<div className={rootClass}>
			{!hideHeader && (
				<div className="magi-nft-header">
					<div className="magi-nft-badge">
						<span className="magi-nft-dot" />
						<span className="magi-nft-badge-text">
							{readOnly ? 'NFTs - read only' : 'MAGI NFTs'}
						</span>
					</div>
					<p className="magi-nft-subtitle">
						{readOnly
							? `Viewing @${account?.replace(/^hive:/, '')} - actions disabled`
							: 'Your collections on the Magi network'}
					</p>
				</div>
			)}

			{enableUserSearch && (
				<UserSearch
					searchInput={searchInput}
					onChange={setSearchInput}
					onSubmit={commitSearch}
					onClear={clearSearch}
					readOnly={readOnly}
					connected={!!username}
					viewing={readOnly ? account?.replace(/^hive:/, '') ?? null : null}
				/>
			)}

			{!account && <div className="magi-nft-state">Connect your Hive wallet to load NFTs.</div>}
			{account && items === null && !error && (
				<div className="magi-nft-state">Loading…</div>
			)}
			{error && <div className="magi-nft-state magi-nft-status error">{error}</div>}
			{account && items && items.length === 0 && (
				<div className="magi-nft-state">No NFTs found for @{account.replace(/^hive:/, '')}.</div>
			)}

			{groups.map((g) => {
				const isExpanded = expanded[g.contractId] !== false;
				return (
					<div className="magi-nft-group" key={g.contractId}>
						<div
							className="magi-nft-group-header"
							onClick={() => setExpanded((prev) => ({ ...prev, [g.contractId]: !isExpanded }))}
						>
							<svg
								className={`magi-nft-group-chevron ${isExpanded ? 'expanded' : ''}`}
								width="10"
								height="10"
								viewBox="0 0 10 10"
								fill="none"
							>
								<path
									d="M3.75 2.5L6.25 5L3.75 7.5"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							{collectionIcons[g.contractId] && (
								<img
									className="magi-nft-group-icon"
									src={collectionIcons[g.contractId] as string}
									alt=""
									onError={(e) => {
										// If the icon URL fails, hide the element rather
										// than triggering a noisy fallback - the group
										// name still labels the row.
										(e.currentTarget as HTMLImageElement).style.display = 'none';
									}}
								/>
							)}
							<span className="magi-nft-group-name">{g.name}</span>
							{g.symbol && <span className="magi-nft-group-symbol">{g.symbol}</span>}
							<span className="magi-nft-group-count">
								{g.items.length} token{g.items.length !== 1 ? 's' : ''}
							</span>
							{!readOnly && isExpanded && g.items.length > 1 && (
								<button
									type="button"
									className="magi-nft-icon-btn"
									title="Batch transfer"
									onClick={(e) => {
										e.stopPropagation();
										setAction({ kind: 'batch', contractId: g.contractId, items: g.items });
									}}
								>
									<BatchIcon />
								</button>
							)}
						</div>

						{isExpanded && (
							<div className="magi-nft-grid">
								{g.items.map((it) => (
									<NftTile
										key={`${it.contractId}:${it.tokenId}`}
										item={it}
										imageUrl={imageUrls[`${it.contractId}:${it.tokenId}`] ?? null}
										readOnly={readOnly}
										onTransfer={() => setAction({ kind: 'transfer', item: it })}
										onBurn={() => setAction({ kind: 'burn', item: it })}
									/>
								))}
							</div>
						)}
					</div>
				);
			})}

			{!readOnly && action?.kind === 'transfer' && username && (
				<NftTransferForm
					client={client}
					username={username}
					item={action.item}
					onSuccess={handleSuccess}
					onClose={() => setAction(null)}
				/>
			)}
			{!readOnly && action?.kind === 'burn' && username && (
				<NftBurnForm
					client={client}
					username={username}
					item={action.item}
					onSuccess={handleSuccess}
					onClose={() => setAction(null)}
				/>
			)}
			{!readOnly && action?.kind === 'batch' && username && (
				<NftBatchTransferForm
					client={client}
					username={username}
					contractId={action.contractId}
					collectionSymbol={
						groups.find((g) => g.contractId === action.contractId)?.symbol
					}
					items={action.items}
					onSuccess={handleSuccess}
					onClose={() => setAction(null)}
				/>
			)}
		</div>
	);
}

interface TileProps {
	item: NftItem;
	imageUrl: string | null;
	readOnly: boolean;
	onTransfer: () => void;
	onBurn: () => void;
}

function NftTile({ item, imageUrl, readOnly, onTransfer, onBurn }: TileProps) {
	const tag = item.isUnique ? 'Unique' : item.soulbound ? 'SBT' : 'Editioned';
	const [imgFailed, setImgFailed] = useState(false);
	const useFallback = !imageUrl || imgFailed;
	return (
		<div className="magi-nft-tile">
			<div className={`magi-nft-tile-image ${useFallback ? 'fallback' : ''}`}>
				{useFallback ? (
					<img
						src={magiFallbackSvg}
						alt={`${item.collection.symbol} #${item.tokenId}`}
						className="magi-nft-tile-fallback-img"
					/>
				) : (
					<img
						src={imageUrl as string}
						alt={`${item.collection.symbol} #${item.tokenId}`}
						onError={() => setImgFailed(true)}
					/>
				)}
			</div>
			<div className="magi-nft-tile-id" title={item.tokenId}>
				#{item.tokenId}
			</div>
			<div className="magi-nft-tile-row">
				{!item.isUnique && (
					<span className="magi-nft-tile-balance">×{item.balance}</span>
				)}
				<span className="magi-nft-tile-tag">{tag}</span>
			</div>
			{!readOnly && (
				<div
					style={{
						display: 'flex',
						gap: '0.3rem',
						marginTop: '0.4rem'
					}}
				>
					<button
						type="button"
						className="magi-nft-icon-btn"
						title="Transfer"
						onClick={(e) => {
							e.stopPropagation();
							onTransfer();
						}}
						disabled={item.soulbound}
					>
						<SendIcon />
					</button>
					<button
						type="button"
						className="magi-nft-icon-btn danger"
						title="Burn"
						onClick={(e) => {
							e.stopPropagation();
							onBurn();
						}}
					>
						<BurnIcon />
					</button>
				</div>
			)}
		</div>
	);
}

function SendIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<line x1="22" y1="2" x2="11" y2="13" />
			<polygon points="22 2 15 22 11 13 2 9 22 2" />
		</svg>
	);
}
function BurnIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
		</svg>
	);
}
function BatchIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
		</svg>
	);
}
