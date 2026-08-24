import {
	resolveGqlUrls,
	resolveIndexerUrls,
	type MagiConfig,
	type NftBalance,
	type NftCollection,
	type NftItem,
	type NftMetadata,
	type NftTemplateLink,
	type NftTokenInfo
} from '@vsc.eco/token-core';
import { gqlFetchFailover, type GqlFetchOptions } from './graphql.js';

/**
 * Read-side provider: queries the Magi indexer (Hasura) and the VSC node
 * (`getStateByKeys`) to build the `NftItem` views the widget renders.
 *
 * The schema names mirror the indexer tables that okinoko-terminal's NFT
 * panel queries today (`magi_nft_overview`, `magi_nft_balances`,
 * `magi_nft_token_info`, `magi_nft_token_supply`).
 */
export interface NftProvider {
	getCollection(contractId: string): Promise<NftCollection | null>;
	getCollectionsByOwner(owner: string): Promise<NftCollection[]>;
	getCollections(contractIds: string[]): Promise<NftCollection[]>;
	getBalances(account: string): Promise<NftBalance[]>;
	getTokenInfos(contractIds: string[]): Promise<NftTokenInfo[]>;
	/** Fetch on-chain `getCollectionMetadata` blob via getStateByKeys. */
	getCollectionMetadata(contractId: string): Promise<NftMetadata | null>;
	/**
	 * Fetch (contract, token) → templateId rows from `magi_nft_template_tokens`.
	 * Tokens minted via `mintSeries` inherit properties from the template root.
	 */
	getTemplateLinks(contractIds: string[]): Promise<NftTemplateLink[]>;
	/**
	 * Fetch raw per-token properties via `getStateByKeys(props|<tokenId>)`.
	 * Returns a map keyed by `${contractId}:${tokenId}`. Missing entries
	 * (no props set, parse error) are absent from the map rather than null.
	 */
	getTokenProperties(
		contractId: string,
		tokenIds: string[]
	): Promise<Map<string, NftMetadata>>;
	/**
	 * Resolve the display image for one or many NFTs. Mirrors the priority
	 * okinoko-terminal uses today:
	 *   1. own properties[image|imageurl|...] (from `props|<tokenId>`)
	 *   2. template properties[image|...] when own props lack one
	 *   3. `${baseUri}${tokenId}` concatenation as a final fallback
	 * Returns `null` for an item only when every source is empty.
	 */
	resolveNftImage(item: NftItem): Promise<string | null>;
	resolveNftImages(items: NftItem[]): Promise<Map<string, string | null>>;
	/** Fetch the joined `NftItem` view for one user across all collections they hold. */
	getUserNfts(account: string): Promise<NftItem[]>;
}

interface OverviewRow {
	contract_id: string;
	name: string;
	symbol: string;
	owner: string;
	base_uri: string | null;
	paused: boolean | null;
	token_count: number | null;
	total_minted: number | null;
	total_burned: number | null;
	init_ts: string | null;
}

interface BalanceRow {
	contract_id: string;
	token_id: string;
	balance: number;
}

interface TokenInfoRow {
	contract_id: string;
	token_id: string;
	max_supply: number;
	soulbound: boolean;
	has_properties: boolean;
	created_ts: string | null;
}

interface SupplyRow {
	contract_id: string;
	token_id: string;
	current_supply: number;
}

interface TemplateRow {
	contract_id: string;
	token_id: string;
	template_id: string;
}

/** Build the storage key the contract uses for per-token props. */
export function tokenPropsKey(tokenId: string): string {
	return `props|${tokenId}`;
}

/**
 * Compose `${baseUri}${tokenId}` when both are present. Returns `null`
 * when `baseUri` is empty or unset. The contract behaviour is verbatim
 * concatenation — no slash auto-insertion — so callers controlling
 * baseUri are responsible for trailing-slash semantics.
 */
export function buildBaseUriImage(
	baseUri: string | null | undefined,
	tokenId: string
): string | null {
	if (!baseUri) return null;
	return `${baseUri}${tokenId}`;
}

/** Try to JSON-parse a state value the contract may have stringified twice. */
function parseDoubleStringified(raw: unknown): NftMetadata | null {
	if (typeof raw !== 'string' || !raw) return null;
	try {
		let parsed: unknown = JSON.parse(raw);
		if (typeof parsed === 'string') parsed = JSON.parse(parsed);
		return typeof parsed === 'object' && parsed !== null ? (parsed as NftMetadata) : null;
	} catch {
		return null;
	}
}

function rowToCollection(r: OverviewRow): NftCollection {
	return {
		contractId: r.contract_id,
		name: r.name,
		symbol: r.symbol,
		owner: r.owner,
		baseUri: r.base_uri ?? undefined,
		paused: r.paused ?? undefined,
		tokenCount: r.token_count ?? undefined,
		totalMinted: r.total_minted ?? undefined,
		totalBurned: r.total_burned ?? undefined,
		initTs: r.init_ts ?? undefined
	};
}

const OVERVIEW_FRAGMENT = `
	contract_id
	name
	symbol
	owner
	base_uri
	paused
	token_count
	total_minted
	total_burned
	init_ts
`;

const IMAGE_KEYS = new Set(['image', 'imageurl', 'imageuri', 'icon', 'iconurl', 'thumbnail', 'thumbnailurl']);

/** Pull the first image-like field out of a metadata blob. */
export function extractImageUrl(meta: NftMetadata | null | undefined): string | null {
	if (!meta || typeof meta !== 'object') return null;
	for (const k of Object.keys(meta)) {
		if (IMAGE_KEYS.has(k.toLowerCase())) {
			const v = meta[k];
			if (typeof v === 'string' && v.trim()) return v.trim();
		}
	}
	return null;
}

export interface CreateNftProviderOptions {
	/**
	 * Per-request fetch options forwarded to every Hasura/VSC call. Useful
	 * for plumbing through `onAttempt`/`onError` logging or a shared
	 * AbortSignal. The `signal` here is not honoured if a per-call signal
	 * is also passed.
	 */
	fetchOptions?: GqlFetchOptions;
}

export function createNftProvider(
	config: MagiConfig,
	opts: CreateNftProviderOptions = {}
): NftProvider {
	const indexerUrls = resolveIndexerUrls(config);
	const gqlUrls = resolveGqlUrls(config);
	const fetchOpts = opts.fetchOptions;

	/**
	 * Read every row, not the first hundred.
	 *
	 * The indexer's Hasura role caps EVERY response at 100 rows and silently
	 * ignores a larger `limit` — so an unpaged query does not fail, it just
	 * stops. A wallet holding 1053 NFTs was showing an arbitrary alphabetical
	 * first 100 of them, with nothing to say the rest existed.
	 *
	 * Ordered paging, because `offset` without `order_by` is not guaranteed to
	 * be a stable window: the same row could appear twice, or never.
	 */
	async function pagedRows<T>(
		query: (limit: number, offset: number) => string,
		variables: Record<string, unknown>,
		hardCap = 5000
	): Promise<T[]> {
		const PAGE = 100;
		const out: T[] = [];
		for (let offset = 0; offset < hardCap; offset += PAGE) {
			const data = await gqlFetchFailover<{ rows: T[] }>(
				indexerUrls,
				query(PAGE, offset),
				variables,
				fetchOpts
			);
			const rows = data.rows ?? [];
			out.push(...rows);
			// A short page is the last page. An exactly-full one is ambiguous,
			// so it costs one more request to find out.
			if (rows.length < PAGE) break;
		}
		return out;
	}

	async function getCollections(contractIds: string[]): Promise<NftCollection[]> {
		if (!contractIds.length) return [];
		const rows = await pagedRows<OverviewRow>(
			(limit, offset) => `query($ids: [String!]!) {
				rows: magi_nft_overview(
					where: { contract_id: { _in: $ids } }
					order_by: { contract_id: asc }
					limit: ${limit} offset: ${offset}
				) { ${OVERVIEW_FRAGMENT} }
			}`,
			{ ids: contractIds }
		);
		return rows.map(rowToCollection);
	}

	async function getCollection(contractId: string): Promise<NftCollection | null> {
		const list = await getCollections([contractId]);
		return list[0] ?? null;
	}

	async function getCollectionsByOwner(owner: string): Promise<NftCollection[]> {
		const rows = await pagedRows<OverviewRow>(
			(limit, offset) => `query($owner: String!) {
				rows: magi_nft_overview(
					where: { owner: { _eq: $owner } }
					order_by: { contract_id: asc }
					limit: ${limit} offset: ${offset}
				) { ${OVERVIEW_FRAGMENT} }
			}`,
			{ owner }
		);
		return rows.map(rowToCollection);
	}

	async function getBalances(account: string): Promise<NftBalance[]> {
		if (!account) return [];
		// Filter zero balances on the client — matches okinoko-terminal's
		// approach and dodges any column-type quirks across indexer mirrors.
		const rows = await pagedRows<BalanceRow>(
			(limit, offset) => `query($acc: String!) {
				rows: magi_nft_balances(
					where: { account: { _eq: $acc } }
					order_by: [{ contract_id: asc }, { token_id: asc }]
					limit: ${limit} offset: ${offset}
				) {
					contract_id token_id balance
				}
			}`,
			{ acc: account }
		);
		return rows
			.map((r) => ({
				contractId: r.contract_id,
				tokenId: r.token_id,
				balance: Number(r.balance)
			}))
			.filter((b) => b.balance > 0);
	}

	async function getTokenInfos(contractIds: string[]): Promise<NftTokenInfo[]> {
		if (!contractIds.length) return [];
		// One row PER TOKEN, not per collection: a single collection with more
		// than a hundred tokens overflows the cap on its own, which shows up
		// as NFTs rendering without their supply or soulbound flag.
		const [infoRows, supplyRows] = await Promise.all([
			pagedRows<TokenInfoRow>(
				(limit, offset) => `query($ids: [String!]!) {
					rows: magi_nft_token_info(
						where: { contract_id: { _in: $ids } }
						order_by: [{ contract_id: asc }, { token_id: asc }]
						limit: ${limit} offset: ${offset}
					) {
						contract_id token_id max_supply soulbound has_properties created_ts
					}
				}`,
				{ ids: contractIds }
			),
			pagedRows<SupplyRow>(
				(limit, offset) => `query($ids: [String!]!) {
					rows: magi_nft_token_supply(
						where: { contract_id: { _in: $ids } }
						order_by: [{ contract_id: asc }, { token_id: asc }]
						limit: ${limit} offset: ${offset}
					) {
						contract_id token_id current_supply
					}
				}`,
				{ ids: contractIds }
			)
		]);
		const supplyByKey = new Map<string, number>();
		for (const s of supplyRows) {
			supplyByKey.set(`${s.contract_id}:${s.token_id}`, Number(s.current_supply));
		}
		return infoRows.map((r) => ({
			contractId: r.contract_id,
			tokenId: r.token_id,
			maxSupply: Number(r.max_supply),
			soulbound: !!r.soulbound,
			hasProperties: !!r.has_properties,
			createdTs: r.created_ts ?? undefined,
			currentSupply: supplyByKey.get(`${r.contract_id}:${r.token_id}`)
		}));
	}

	async function getCollectionMetadata(contractId: string): Promise<NftMetadata | null> {
		try {
			const data = await gqlFetchFailover<{
				getStateByKeys: Record<string, string | null> | null;
			}>(
				gqlUrls,
				`query($id: String!, $keys: [String!]!) {
					getStateByKeys(contractId: $id, keys: $keys)
				}`,
				{ id: contractId, keys: ['collection_metadata'] },
				fetchOpts
			);
			const raw = data.getStateByKeys?.collection_metadata;
			return parseDoubleStringified(raw);
		} catch {
			return null;
		}
	}

	async function getTemplateLinks(contractIds: string[]): Promise<NftTemplateLink[]> {
		if (!contractIds.length) return [];
		const data = await gqlFetchFailover<{ rows: TemplateRow[] }>(
			indexerUrls,
			`query($ids: [String!]!) {
				rows: magi_nft_template_tokens(where: { contract_id: { _in: $ids } }) {
					contract_id token_id template_id
				}
			}`,
			{ ids: contractIds },
			fetchOpts
		);
		return data.rows.map((r) => ({
			contractId: r.contract_id,
			tokenId: r.token_id,
			templateId: r.template_id
		}));
	}

	async function getTokenProperties(
		contractId: string,
		tokenIds: string[]
	): Promise<Map<string, NftMetadata>> {
		const out = new Map<string, NftMetadata>();
		if (!tokenIds.length) return out;
		// De-dupe to avoid wasting bytes on the wire when the same id (e.g.
		// a templateId shared by many tokens) is requested multiple times.
		const uniq = Array.from(new Set(tokenIds));
		const keys = uniq.map(tokenPropsKey);
		try {
			const data = await gqlFetchFailover<{
				getStateByKeys: Record<string, string | null> | null;
			}>(
				gqlUrls,
				`query($id: String!, $keys: [String!]!) {
					getStateByKeys(contractId: $id, keys: $keys)
				}`,
				{ id: contractId, keys },
				fetchOpts
			);
			const state = data.getStateByKeys ?? {};
			for (const id of uniq) {
				const meta = parseDoubleStringified(state[tokenPropsKey(id)]);
				if (meta) out.set(`${contractId}:${id}`, meta);
			}
		} catch {
			// Swallow errors here — image resolution should always degrade
			// gracefully to the baseUri+tokenId fallback rather than throw.
		}
		return out;
	}

	async function resolveNftImages(
		items: NftItem[]
	): Promise<Map<string, string | null>> {
		const out = new Map<string, string | null>();
		if (!items.length) return out;

		// Group token + template ids per contract so we run one
		// `getStateByKeys` call per contract for the whole batch.
		const tokenIdsByContract = new Map<string, Set<string>>();
		for (const it of items) {
			const set = tokenIdsByContract.get(it.contractId) ?? new Set<string>();
			set.add(it.tokenId);
			if (it.templateId && it.templateId !== it.tokenId) set.add(it.templateId);
			tokenIdsByContract.set(it.contractId, set);
		}

		// Fetch every property blob in parallel — one Promise per contract.
		const propsByContract = new Map<string, Map<string, NftMetadata>>();
		await Promise.all(
			Array.from(tokenIdsByContract.entries()).map(async ([cid, ids]) => {
				const map = await getTokenProperties(cid, Array.from(ids));
				propsByContract.set(cid, map);
			})
		);

		for (const it of items) {
			const key = `${it.contractId}:${it.tokenId}`;
			const propsMap = propsByContract.get(it.contractId);
			const ownProps = propsMap?.get(`${it.contractId}:${it.tokenId}`);
			let url = extractImageUrl(ownProps);
			if (!url && it.templateId && it.templateId !== it.tokenId) {
				const tplProps = propsMap?.get(`${it.contractId}:${it.templateId}`);
				url = extractImageUrl(tplProps);
			}
			if (!url) {
				url = buildBaseUriImage(it.collection.baseUri, it.tokenId);
			}
			out.set(key, url ?? null);
		}
		return out;
	}

	async function resolveNftImage(item: NftItem): Promise<string | null> {
		const map = await resolveNftImages([item]);
		return map.get(`${item.contractId}:${item.tokenId}`) ?? null;
	}

	async function getUserNfts(account: string): Promise<NftItem[]> {
		if (!account) return [];
		const balances = await getBalances(account);
		if (!balances.length) return [];

		const contractIds = Array.from(new Set(balances.map((b) => b.contractId)));
		const [collections, tokenInfos, templates] = await Promise.all([
			getCollections(contractIds),
			getTokenInfos(contractIds),
			getTemplateLinks(contractIds)
		]);

		const collectionByContract = new Map(collections.map((c) => [c.contractId, c]));
		const infoByKey = new Map<string, NftTokenInfo>();
		for (const t of tokenInfos) infoByKey.set(`${t.contractId}:${t.tokenId}`, t);
		const templateByKey = new Map<string, string>();
		for (const tl of templates) {
			templateByKey.set(`${tl.contractId}:${tl.tokenId}`, tl.templateId);
		}

		const items: NftItem[] = [];
		for (const b of balances) {
			const collection = collectionByContract.get(b.contractId);
			if (!collection) continue;
			const info = infoByKey.get(`${b.contractId}:${b.tokenId}`);
			const maxSupply = info?.maxSupply ?? 0;
			items.push({
				contractId: b.contractId,
				tokenId: b.tokenId,
				balance: b.balance,
				maxSupply,
				isUnique: maxSupply === 1,
				soulbound: info?.soulbound ?? false,
				currentSupply: info?.currentSupply,
				collection,
				templateId: templateByKey.get(`${b.contractId}:${b.tokenId}`) ?? null
			});
		}
		return items;
	}

	return {
		getCollection,
		getCollections,
		getCollectionsByOwner,
		getBalances,
		getTokenInfos,
		getCollectionMetadata,
		getTemplateLinks,
		getTokenProperties,
		resolveNftImage,
		resolveNftImages,
		getUserNfts
	};
}
