/** Magi network identifier — matches the `net_id` baked into vsc.call ops. */
export type MagiNetwork = 'vsc-mainnet' | 'vsc-testnet';

/** Configuration for SDK clients. The contract IDs come from the deployer. */
export interface MagiConfig {
	network: MagiNetwork;
	/**
	 * Indexer Hasura HTTP endpoint — used for read queries (balances, supply, etc.).
	 * Single-URL form, kept for back-compat; prefer `indexerHasuraUrls` for failover.
	 * When both are set, `indexerHasuraUrls` wins and this is ignored.
	 */
	indexerHasuraUrl?: string;
	/**
	 * Ordered list of indexer Hasura endpoints. The first entry is tried first;
	 * on any network/parse/GraphQL error the next entry is tried. Mirrors
	 * `gqlUrls` in @vsc.eco/crosschain-core.
	 */
	indexerHasuraUrls?: string[];
	/**
	 * GraphQL HTTP endpoint for the VSC node — used for `getStateByKeys`,
	 * `findContract`. Single-URL form. Prefer `gqlUrls` for failover.
	 */
	gqlUrl?: string;
	/**
	 * Ordered list of VSC node GraphQL endpoints. Same failover semantics as
	 * `indexerHasuraUrls`.
	 */
	gqlUrls?: string[];
	/** Optional deployer URL — used when listing all deployed NFT/token contracts (e.g. for discovery). */
	deployerUrl?: string;
}

/**
 * Resolve a `MagiConfig` field to an ordered URL list. Callers feed this
 * into `gqlFetchFailover` which tries each entry in turn until one
 * succeeds.
 */
export function resolveIndexerUrls(config: MagiConfig): string[] {
	if (config.indexerHasuraUrls && config.indexerHasuraUrls.length > 0) {
		return config.indexerHasuraUrls;
	}
	if (config.indexerHasuraUrl) return [config.indexerHasuraUrl];
	throw new Error(
		'MagiConfig: neither `indexerHasuraUrls` nor `indexerHasuraUrl` is set'
	);
}

export function resolveGqlUrls(config: MagiConfig): string[] {
	if (config.gqlUrls && config.gqlUrls.length > 0) return config.gqlUrls;
	if (config.gqlUrl) return [config.gqlUrl];
	throw new Error('MagiConfig: neither `gqlUrls` nor `gqlUrl` is set');
}

export const MAINNET_CONFIG: MagiConfig = {
	network: 'vsc-mainnet',
	indexerHasuraUrls: [
		'https://indexer.magi.milohpr.com/v1/graphql',
		'https://api.okinoko.io/hasura/v1/graphql'
	],
	gqlUrls: [
		'https://api.vsc.eco/api/v1/graphql',
		'https://vsc.techcoderx.com/api/v1/graphql',
		'https://api.okinoko.io/api/v1/graphql',
		'https://magi.milohpr.com/api/v1/graphql'
	],
	deployerUrl: 'https://deploy.okinoko.io'
};

export const TESTNET_CONFIG: MagiConfig = {
	network: 'vsc-testnet',
	// okinoko first: it carries the full magi_* schema, and the milohpr
	// indexer is a generic-VSC fallback.
	indexerHasuraUrls: [
		'https://api-testnet.okinoko.io/hasura/v1/graphql',
		'https://indexer.testnet.magi.milohpr.com/v1/graphql'
	],
	// api.testnet.vsc.eco does not answer (verified 2026-08-24, connection
	// fails outright). Image resolution reads token properties through
	// getStateByKeys on this endpoint, so pointing it at a dead host made
	// every NFT in every consumer fall back to the Magi logo.
	gqlUrls: ['https://magi-test.techcoderx.com/api/v1/graphql'],
	deployerUrl: 'https://deploy-testnet.okinoko.io'
};

/** A contract callable via vsc.call. */
export interface VscCall {
	/** vsc1... contract address. */
	contractId: string;
	/** Function name on the contract. */
	action: string;
	/** JSON-encoded payload as a string OR a structured object. SDK stringifies. */
	payload: string | Record<string, unknown>;
	/** RC limit (HBD millis budgeted). Defaults vary per call. */
	rcLimit?: number;
	/** transfer.allow intents for native asset pulls. */
	intents?: VscIntent[];
}

export interface VscIntent {
	type: 'transfer.allow' | string;
	args: Record<string, string>;
}

/** Custom JSON op shape, structurally compatible with @hiveio/dhive's CustomJsonOperation. */
export type CustomJsonOp = [
	'custom_json',
	{
		required_auths: string[];
		required_posting_auths: string[];
		id: string;
		json: string;
	}
];

/** ============== NFT (ERC-1155) types ============== */

export interface NftCollection {
	contractId: string;
	name: string;
	symbol: string;
	owner: string;
	baseUri?: string;
	paused?: boolean;
	tokenCount?: number;
	totalMinted?: number;
	totalBurned?: number;
	initTs?: string;
}

export interface NftBalance {
	contractId: string;
	tokenId: string;
	balance: number;
}

export interface NftTokenInfo {
	contractId: string;
	tokenId: string;
	maxSupply: number;
	soulbound: boolean;
	hasProperties: boolean;
	createdTs?: string;
	currentSupply?: number;
}

/** Combined view used by widgets — collection + token info + per-account balance. */
export interface NftItem {
	contractId: string;
	tokenId: string;
	balance: number;
	maxSupply: number;
	isUnique: boolean;
	soulbound: boolean;
	currentSupply?: number;
	collection: NftCollection;
	/**
	 * Template token id this NFT inherits properties from (mintSeries-minted
	 * tokens point at the series root). Read from `magi_nft_template_tokens`.
	 * `null` / `undefined` when the token has no template (own props only).
	 */
	templateId?: string | null;
	/** Token metadata (image, name, properties) — populated when SDK loads it. */
	metadata?: NftMetadata | null;
}

/** Row from the `magi_nft_template_tokens` indexer table. */
export interface NftTemplateLink {
	contractId: string;
	tokenId: string;
	templateId: string;
}

export interface NftMetadata {
	name?: string;
	description?: string;
	image?: string;
	[k: string]: unknown;
}

/** ============== Token (ERC-20) types ============== */

export interface TokenInfo {
	contractId: string;
	name: string;
	symbol: string;
	decimals: number;
	owner: string;
	totalSupply?: bigint;
	maxSupply?: bigint;
	paused?: boolean;
}

export interface TokenBalance {
	contractId: string;
	account: string;
	balance: bigint;
}
