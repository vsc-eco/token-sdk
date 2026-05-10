import { useEffect, useMemo, useState } from 'react';
import {
	createNftClient,
	extractImageUrl,
	MAINNET_CONFIG,
	type AiohaLike,
	type BroadcastHook,
	type MagiConfig,
	type NftClient,
	type NftCollection,
	type NftItem,
	type NftMetadata
} from '@vsc.eco/nft-sdk';
import { Modal } from './components/Modal.js';
import { NftTransferForm } from './actions/NftTransferForm.js';
import { NftBurnForm } from './actions/NftBurnForm.js';
import { NftBatchTransferForm } from './actions/NftBatchTransferForm.js';
import { NftEditCollectionForm } from './actions/NftEditCollectionForm.js';
import { NftMintForm } from './actions/NftMintForm.js';
import { MagiContractDeploy } from './MagiContractDeploy.js';
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
	/**
	 * Render a "Deploy collection" button in the panel header that opens
	 * `<MagiContractDeploy>` (locked to NFT). Default `true`. Hidden in
	 * read-only / cross-account view mode (deploy needs a signer for the
	 * connected user, not for a wallet they're spectating).
	 */
	enableDeploy?: boolean;
	/** Override the deployer service URL. Defaults to `config.deployerUrl`. */
	deployerUrl?: string;
	/**
	 * Render a small circular refresh button in the panel's top-right
	 * corner. Default `true`. Clicking it re-runs every read (items,
	 * images, template metadata, collection icons) without unmounting
	 * the panel - so expanded-group state, scroll position, etc. survive
	 * the refresh.
	 */
	enableRefresh?: boolean;
	/**
	 * External refresh trigger - bump this from a parent to force a
	 * reload as if the user had clicked the refresh button. Internal use
	 * mainly (MagiAssets uses it to drive both inner panels off a single
	 * top-level button); hosts can use it too if they want a refresh
	 * affordance outside the widget.
	 */
	refreshSeq?: number;
}

type ActionState =
	| { kind: 'transfer'; item: NftItem }
	| { kind: 'burn'; item: NftItem }
	| { kind: 'batch'; contractId: string; items: NftItem[] }
	| { kind: 'mint'; collection: NftItem['collection'] }
	| { kind: 'edit'; collection: NftItem['collection'] }
	| null;

interface CollectionGroup {
	contractId: string;
	name: string;
	symbol: string;
	items: NftItem[];
	/**
	 * Collection metadata - present on every group. For held groups it's
	 * the same `NftCollection` joined into each NftItem; for empty-owned
	 * groups (no held items) it comes from `getCollectionsByOwner`.
	 * Used by the Mint button's owner check + the empty-state header.
	 */
	collection: NftCollection;
}

/**
 * Tile-row entry. NFTs minted via mintSeries share a templateId; when 2+
 * items in a collection share the same templateId we collapse them into
 * a single template tile that the user can click to expand into a list
 * of the underlying tokens. Single-item templates and tokens with no
 * templateId render as regular `item` tiles.
 */
type TileEntry =
	| { kind: 'item'; item: NftItem }
	| { kind: 'template'; contractId: string; templateId: string; items: NftItem[] };

/**
 * Group items into tile entries: collapse 2+ tokens that share a
 * templateId into one template tile, render anything else as an
 * individual tile.
 */
function groupTilesByTemplate(items: NftItem[]): TileEntry[] {
	const byTemplate = new Map<string, NftItem[]>();
	const standalones: NftItem[] = [];
	for (const it of items) {
		if (it.templateId && it.templateId !== it.tokenId) {
			const list = byTemplate.get(it.templateId) ?? [];
			list.push(it);
			byTemplate.set(it.templateId, list);
		} else {
			standalones.push(it);
		}
	}
	const out: TileEntry[] = [];
	// Standalones first - keeps the header of each collection visually
	// stable; templates surface as a group below (always more than one).
	for (const it of standalones) out.push({ kind: 'item', item: it });
	for (const [templateId, items] of byTemplate.entries()) {
		if (items.length === 1) {
			// 1 token from a series - no point hiding it behind a clickthrough.
			out.push({ kind: 'item', item: items[0] });
		} else {
			out.push({
				kind: 'template',
				contractId: items[0].contractId,
				templateId,
				items
			});
		}
	}
	return out;
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
		enableUserSearch = true,
		enableDeploy = true,
		deployerUrl,
		enableRefresh = true,
		refreshSeq
	} = props;
	const [deployOpen, setDeployOpen] = useState(false);
	const [refreshing, setRefreshing] = useState(false);

	const client = useMemo<NftClient>(() => {
		return providedClient ?? createNftClient({ config, aioha, onBroadcast, keyType });
	}, [providedClient, config, aioha, onBroadcast, keyType]);

	const [items, setItems] = useState<NftItem[] | null>(null);
	/**
	 * Collections owned by the viewed account that aren't represented in
	 * `items`. Surfaces a freshly-deployed-but-empty collection (or one
	 * whose tokens have all been burned/transferred away) so the panel
	 * can still show its group header + Mint button. Held collections
	 * are deduplicated by contractId; this only contains the *empty*
	 * residual.
	 */
	const [emptyOwnedCollections, setEmptyOwnedCollections] = useState<NftCollection[]>([]);
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
	/**
	 * Template props (image, name) keyed `${contractId}:${templateId}`.
	 * Populated by a separate effect that fetches the props|<templateId>
	 * state value for each unique template referenced by the user's items.
	 * Used to render the template tile's name + image (image falls back to
	 * the per-template imageUrl resolver if the template has no own image).
	 */
	const [templateMeta, setTemplateMeta] = useState<Record<string, NftMetadata>>({});
	// When a template tile is clicked, store the chosen template here;
	// rendering the expansion modal is controlled by this ref.
	const [expandedTemplate, setExpandedTemplate] = useState<{
		contractId: string;
		templateId: string;
		items: NftItem[];
	} | null>(null);

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
			setEmptyOwnedCollections([]);
			return;
		}
		let cancelled = false;
		setError(null);
		// Fire both reads in parallel: held items (balance-driven) and
		// the list of collections this account owns. The owned list lets
		// us surface zero-balance collections (freshly-deployed, or all
		// tokens transferred away) so their group header + Mint button
		// stay reachable. Same pattern the token panel uses to expose
		// empty-balance contracts the user owns.
		Promise.all([
			client.nft.provider.getUserNfts(account),
			client.nft.provider.getCollectionsByOwner(account).catch(() => [])
		])
			.then(([rows, owned]) => {
				if (cancelled) return;
				setItems(rows);
				const heldContractIds = new Set(rows.map((r) => r.contractId));
				const empty = owned.filter((c) => !heldContractIds.has(c.contractId));
				setEmptyOwnedCollections(empty);
				setExpanded((prev) => {
					const next = { ...prev };
					// First-load default: expand only when the user is in a
					// single collection (held + owned-empty combined).
					const distinct = new Set([
						...rows.map((r) => r.contractId),
						...empty.map((c) => c.contractId)
					]).size;
					const expandByDefault = distinct <= 1;
					for (const r of rows) {
						if (next[r.contractId] === undefined) next[r.contractId] = expandByDefault;
					}
					for (const c of empty) {
						if (next[c.contractId] === undefined) next[c.contractId] = expandByDefault;
					}
					return next;
				});
				setRefreshing(false);
			})
			.catch((err) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
					setRefreshing(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [account, client, reloadTick]);

	// External-trigger watcher: when MagiAssets (or any host) bumps
	// `refreshSeq`, treat it as a click of our own refresh button.
	useEffect(() => {
		if (refreshSeq === undefined) return;
		setRefreshing(true);
		// Also clear cached image / icon / template-meta state so a stale
		// blob doesn't survive a refresh just because its key was already
		// in the cache map.
		setImageUrls({});
		setCollectionIcons({});
		setTemplateMeta({});
		setReloadTick((n) => n + 1);
		// Intentionally only watching refreshSeq - we explicitly don't
		// want to fire on first mount when refreshSeq is undefined.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [refreshSeq]);

	function handleRefresh() {
		setRefreshing(true);
		setImageUrls({});
		setCollectionIcons({});
		setTemplateMeta({});
		setReloadTick((n) => n + 1);
	}

	// Fetch collection-level icons (from the `collection_metadata` state
	// blob) once we know which collections the panel renders. One
	// getStateByKeys call per contract, fired in parallel and applied as
	// each returns. Iterates BOTH held items AND empty-owned collections -
	// without the latter, an owned-but-no-mints collection had its group
	// header but no icon because the fetch effect skipped it.
	useEffect(() => {
		if (!items?.length && emptyOwnedCollections.length === 0) return;
		const seen = new Set<string>();
		const missing: string[] = [];
		const considerContract = (cid: string) => {
			if (seen.has(cid)) return;
			seen.add(cid);
			if (collectionIcons[cid] === undefined) missing.push(cid);
		};
		for (const it of items ?? []) considerContract(it.contractId);
		for (const c of emptyOwnedCollections) considerContract(c.contractId);
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
	}, [items, emptyOwnedCollections, client, collectionIcons]);

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

	// Fetch the props blob for each unique templateId so we can render the
	// template tile with the template's actual name (not just the raw
	// templateId) and its image. Reuses `getTokenProperties` which is
	// already a public part of the provider.
	useEffect(() => {
		if (!items?.length) return;
		const byContract = new Map<string, Set<string>>();
		for (const it of items) {
			if (!it.templateId || it.templateId === it.tokenId) continue;
			const set = byContract.get(it.contractId) ?? new Set<string>();
			set.add(it.templateId);
			byContract.set(it.contractId, set);
		}
		if (!byContract.size) return;

		let cancelled = false;
		for (const [cid, ids] of byContract) {
			const missing = Array.from(ids).filter(
				(id) => templateMeta[`${cid}:${id}`] === undefined
			);
			if (!missing.length) continue;
			client.nft.provider
				.getTokenProperties(cid, missing)
				.then((map) => {
					if (cancelled) return;
					const updates: Record<string, NftMetadata> = {};
					for (const [k, v] of map.entries()) updates[k] = v;
					setTemplateMeta((prev) => ({ ...prev, ...updates }));
				})
				.catch(() => {
					/* skip - fall back to templateId as the displayed name */
				});
		}
		return () => {
			cancelled = true;
		};
	}, [items, client, templateMeta]);

	const groups = useMemo<CollectionGroup[]>(() => {
		if (!items) return [];
		const byContract = new Map<string, CollectionGroup>();
		// Held collections first - their NftCollection comes from the
		// item's joined `collection` field.
		for (const it of items) {
			let g = byContract.get(it.contractId);
			if (!g) {
				g = {
					contractId: it.contractId,
					name: it.collection.name || 'Unnamed collection',
					symbol: it.collection.symbol || '',
					items: [],
					collection: it.collection
				};
				byContract.set(it.contractId, g);
			}
			g.items.push(it);
		}
		// Then empty-owned collections - groups with `items: []`. The
		// header still renders with the collection name + Mint button;
		// the tile grid swaps to a one-line "no tokens minted yet"
		// affordance to make the empty state legible.
		for (const c of emptyOwnedCollections) {
			if (byContract.has(c.contractId)) continue;
			byContract.set(c.contractId, {
				contractId: c.contractId,
				name: c.name || 'Unnamed collection',
				symbol: c.symbol || '',
				items: [],
				collection: c
			});
		}
		return Array.from(byContract.values()).sort((a, b) => a.name.localeCompare(b.name));
	}, [items, emptyOwnedCollections]);

	function handleSuccess(txId: string) {
		setReloadTick((n) => n + 1);
		onSuccess?.(txId);
	}

	const rootClass = bare
		? `magi-nft-bare ${className ?? ''}`.trim()
		: `magi-nft ${className ?? ''}`.trim();

	return (
		<div className={rootClass}>
			{enableRefresh && account && (
				<RefreshButton refreshing={refreshing} onClick={handleRefresh} />
			)}
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

			{(enableUserSearch || (enableDeploy && !readOnly && username)) && (
				<div className="magi-nft-toolbar">
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
					{enableDeploy && !readOnly && username && (
						<button
							type="button"
							className="magi-nft-toolbar-action"
							title="Deploy a new NFT collection"
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
								{g.items.length === 0
									? 'empty'
									: `${g.items.length} token${g.items.length !== 1 ? 's' : ''}`}
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
							{!readOnly && isOwnedCollection(g, username) && (
								<>
									<button
										type="button"
										className="magi-nft-icon-btn"
										title="Edit collection (baseUri, description, icon, owner)"
										onClick={(e) => {
											e.stopPropagation();
											setAction({ kind: 'edit', collection: g.collection });
										}}
									>
										<EditIcon />
									</button>
									<button
										type="button"
										className="magi-nft-icon-btn"
										title="Mint into this collection"
										onClick={(e) => {
											e.stopPropagation();
											setAction({ kind: 'mint', collection: g.collection });
										}}
									>
										<MintIcon />
									</button>
								</>
							)}
						</div>

						{isExpanded && g.items.length === 0 && (
							<div className="magi-nft-state">
								No tokens minted yet.
								{!readOnly && isOwnedCollection(g, username) ? ' Use the + button above to mint the first one.' : ''}
							</div>
						)}
						{isExpanded && g.items.length > 0 && (
							<div className="magi-nft-grid">
								{groupTilesByTemplate(g.items).map((entry) => {
									if (entry.kind === 'item') {
										const it = entry.item;
										return (
											<NftTile
												key={`${it.contractId}:${it.tokenId}`}
												item={it}
												imageUrl={
													imageUrls[`${it.contractId}:${it.tokenId}`] ?? null
												}
												readOnly={readOnly}
												onTransfer={() => setAction({ kind: 'transfer', item: it })}
												onBurn={() => setAction({ kind: 'burn', item: it })}
											/>
										);
									}
									const meta = templateMeta[`${entry.contractId}:${entry.templateId}`];
									// The template's image: use the template's own props.image if
									// we've resolved it, otherwise fall back to the first item's
									// resolved image (which itself falls back to baseUri+tokenId).
									const templateImage =
										extractImageUrl(meta) ??
										imageUrls[`${entry.contractId}:${entry.items[0].tokenId}`] ??
										null;
									return (
										<TemplateTile
											key={`tpl:${entry.contractId}:${entry.templateId}`}
											templateId={entry.templateId}
											name={
												(meta?.name as string | undefined) ?? entry.templateId
											}
											imageUrl={templateImage}
											itemCount={entry.items.length}
											onClick={() =>
												setExpandedTemplate({
													contractId: entry.contractId,
													templateId: entry.templateId,
													items: entry.items
												})
											}
										/>
									);
								})}
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
			{deployOpen && username && (
				<MagiContractDeploy
					aioha={aioha}
					username={username}
					onBroadcast={onBroadcast}
					keyType={keyType}
					config={config}
					client={client}
					serviceUrl={deployerUrl}
					lockType="nft"
					onClose={() => setDeployOpen(false)}
					onSuccess={(r) => {
						setDeployOpen(false);
						handleSuccess(r.initTxId);
					}}
				/>
			)}
			{!readOnly && action?.kind === 'mint' && username && (
				<NftMintForm
					client={client}
					username={username}
					collection={action.collection}
					onSuccess={handleSuccess}
					onClose={() => setAction(null)}
				/>
			)}
			{!readOnly && action?.kind === 'edit' && username && (
				<NftEditCollectionForm
					client={client}
					username={username}
					collection={action.collection}
					onSuccess={(ids) => {
						// Refresh on the last successful tx so the panel
						// picks up the new icon / baseUri / owner without
						// the user having to click refresh.
						if (ids.length > 0) handleSuccess(ids[ids.length - 1]);
					}}
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
			{expandedTemplate && (
				<TemplateExpansionModal
					contractId={expandedTemplate.contractId}
					templateId={expandedTemplate.templateId}
					items={expandedTemplate.items}
					templateName={
						(templateMeta[
							`${expandedTemplate.contractId}:${expandedTemplate.templateId}`
						]?.name as string | undefined) ?? expandedTemplate.templateId
					}
					imageUrls={imageUrls}
					readOnly={readOnly}
					hasSigner={!!username}
					onTransfer={(item) => {
						setExpandedTemplate(null);
						setAction({ kind: 'transfer', item });
					}}
					onBurn={(item) => {
						setExpandedTemplate(null);
						setAction({ kind: 'burn', item });
					}}
					onBatchTransfer={() => {
						const cid = expandedTemplate.contractId;
						const items = expandedTemplate.items;
						setExpandedTemplate(null);
						setAction({ kind: 'batch', contractId: cid, items });
					}}
					onClose={() => setExpandedTemplate(null)}
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
function MintIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</svg>
	);
}
function EditIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
			<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
		</svg>
	);
}

/**
 * Small circular refresh button positioned in the panel's top-right
 * corner. Spins for the duration of the in-flight refresh; disabled
 * while spinning so a user smashing it doesn't queue ten refetches.
 * Re-used by every panel via the same `<RefreshButton>` import.
 */
export function RefreshButton({
	refreshing,
	onClick
}: {
	refreshing: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="magi-nft-refresh-btn"
			title={refreshing ? 'Refreshing…' : 'Refresh'}
			aria-label="Refresh"
			onClick={onClick}
			disabled={refreshing}
		>
			<svg
				className={refreshing ? 'spinning' : undefined}
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<polyline points="23 4 23 10 17 10" />
				<polyline points="1 20 1 14 7 14" />
				<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
				<path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
			</svg>
		</button>
	);
}

/**
 * Bare-name match between the collection's `owner` field and the
 * connected user. Both `hive:alice` and `alice` flow through the
 * okinoko/Magi codebase; treat them as equivalent. Reads `owner`
 * directly off the group's `collection` (always populated, whether
 * the group was synthesised from held items or from
 * `getCollectionsByOwner` for the empty-owned case).
 */
function isOwnedCollection(group: CollectionGroup, username: string | undefined): boolean {
	if (!username) return false;
	const owner = group.collection.owner;
	if (!owner) return false;
	const ownerBare = owner.replace(/^(@|hive:)+/, '').toLowerCase();
	const userBare = username.replace(/^(@|hive:)+/, '').toLowerCase();
	return ownerBare === userBare;
}

interface TemplateTileProps {
	templateId: string;
	name: string;
	imageUrl: string | null;
	itemCount: number;
	onClick: () => void;
}

/**
 * Tile representing a mintSeries template - one click expands into a list
 * of the underlying tokens. Visually it's a regular NFT tile with a
 * "stack" badge and a count instead of per-tile actions; the row of
 * action buttons is intentionally absent because actions belong to the
 * individual tokens behind it.
 */
function TemplateTile({ templateId, name, imageUrl, itemCount, onClick }: TemplateTileProps) {
	const [imgFailed, setImgFailed] = useState(false);
	const useFallback = !imageUrl || imgFailed;
	return (
		<div
			className="magi-nft-tile magi-nft-template-tile"
			onClick={onClick}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onClick();
				}
			}}
		>
			<div className={`magi-nft-tile-image ${useFallback ? 'fallback' : ''}`}>
				{useFallback ? (
					<img
						src={magiFallbackSvg}
						alt={name}
						className="magi-nft-tile-fallback-img"
					/>
				) : (
					<img src={imageUrl as string} alt={name} onError={() => setImgFailed(true)} />
				)}
				{/* Stacked-card affordance to telegraph "this opens a list" */}
				<span className="magi-nft-template-stack" aria-hidden="true" />
			</div>
			<div className="magi-nft-tile-id" title={templateId}>
				{name}
			</div>
			<div className="magi-nft-tile-row">
				<span className="magi-nft-tile-balance">{itemCount} items</span>
				<span className="magi-nft-tile-tag">Series</span>
			</div>
		</div>
	);
}

interface TemplateExpansionModalProps {
	contractId: string;
	templateId: string;
	templateName: string;
	items: NftItem[];
	imageUrls: Record<string, string | null>;
	readOnly: boolean;
	hasSigner: boolean;
	onTransfer: (item: NftItem) => void;
	onBurn: (item: NftItem) => void;
	onBatchTransfer: () => void;
	onClose: () => void;
}

/**
 * Modal listing every individual token belonging to a template. Each row
 * shows the token's image, tokenId, balance, and per-token transfer/burn
 * affordances (suppressed in read-only mode). A header-level "Batch
 * transfer all" routes to the existing NftBatchTransferForm pre-seeded
 * with this template's items.
 */
function TemplateExpansionModal({
	contractId,
	templateName,
	items,
	imageUrls,
	readOnly,
	hasSigner,
	onTransfer,
	onBurn,
	onBatchTransfer,
	onClose
}: TemplateExpansionModalProps) {
	return (
		<Modal
			title={templateName}
			subtitle={`${items.length} token${items.length === 1 ? '' : 's'} in this series`}
			onClose={onClose}
		>
			{!readOnly && hasSigner && items.length > 1 && (
				<button
					type="button"
					className="magi-nft-submit ghost"
					onClick={onBatchTransfer}
				>
					Batch transfer all in series
				</button>
			)}
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: '0.4rem',
					maxHeight: '50vh',
					overflowY: 'auto'
				}}
			>
				{items.map((it) => (
					<TemplateItemRow
						key={`${it.contractId}:${it.tokenId}`}
						item={it}
						imageUrl={imageUrls[`${contractId}:${it.tokenId}`] ?? null}
						readOnly={readOnly}
						onTransfer={() => onTransfer(it)}
						onBurn={() => onBurn(it)}
					/>
				))}
			</div>
		</Modal>
	);
}

function TemplateItemRow({
	item,
	imageUrl,
	readOnly,
	onTransfer,
	onBurn
}: {
	item: NftItem;
	imageUrl: string | null;
	readOnly: boolean;
	onTransfer: () => void;
	onBurn: () => void;
}) {
	const [imgFailed, setImgFailed] = useState(false);
	const useFallback = !imageUrl || imgFailed;
	return (
		<div className="magi-nft-template-item">
			<div className={`magi-nft-template-item-img ${useFallback ? 'fallback' : ''}`}>
				{useFallback ? (
					<img src={magiFallbackSvg} alt={item.tokenId} />
				) : (
					<img
						src={imageUrl as string}
						alt={item.tokenId}
						onError={() => setImgFailed(true)}
					/>
				)}
			</div>
			<div className="magi-nft-template-item-info">
				<span className="magi-nft-template-item-id">{item.tokenId}</span>
				<span className="magi-nft-template-item-meta">
					{item.isUnique
						? 'Unique'
						: `×${item.balance}${item.maxSupply > 1 ? ` of ${item.maxSupply}` : ''}`}
					{item.soulbound ? ' · Soulbound' : ''}
				</span>
			</div>
			{!readOnly && (
				<div className="magi-nft-template-item-actions">
					<button
						type="button"
						className="magi-nft-icon-btn"
						title="Transfer"
						disabled={item.soulbound}
						onClick={onTransfer}
					>
						<SendIcon />
					</button>
					<button
						type="button"
						className="magi-nft-icon-btn danger"
						title="Burn"
						onClick={onBurn}
					>
						<BurnIcon />
					</button>
				</div>
			)}
		</div>
	);
}
