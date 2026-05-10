import {
	MAINNET_CONFIG,
	TESTNET_CONFIG,
	buildNftApprove,
	buildNftBatchTransfer,
	buildNftBurn,
	buildNftBurnBatch,
	buildNftChangeOwner,
	buildNftInit,
	buildNftMint,
	buildNftPause,
	buildNftSetApprovalForAll,
	buildNftSetBaseUri,
	buildNftSetCollectionMetadata,
	buildNftSetProperties,
	buildNftSetUri,
	buildNftTransfer,
	buildNftUnpause,
	buildTokenApprove,
	buildTokenBurn,
	buildTokenChangeOwner,
	buildTokenDecreaseAllowance,
	buildTokenIncreaseAllowance,
	buildTokenInit,
	buildTokenMint,
	buildTokenPause,
	buildTokenTransfer,
	buildTokenTransferFrom,
	buildTokenUnpause,
	type MagiConfig,
	type NftApproveParams,
	type NftBatchTransferParams,
	type NftBurnBatchParams,
	type NftBurnParams,
	type NftInitParams,
	type NftMintParams,
	type NftOpBundle,
	type NftSetApprovalForAllParams,
	type NftTransferParams,
	type TokenApproveParams,
	type TokenInitParams,
	type TokenOpBundle,
	type TokenTransferParams,
	type VscCall,
	type VscIntent
} from '@vsc.eco/nft-core';
import { createNftProvider, type NftProvider } from './nftProvider.js';
import { createTokenProvider, type TokenProvider } from './tokenProvider.js';
import {
	gqlFetchFailover,
	gqlFetchOne,
	type GqlFetchOptions
} from './graphql.js';

export {
	MAINNET_CONFIG,
	TESTNET_CONFIG,
	resolveIndexerUrls,
	resolveGqlUrls
} from '@vsc.eco/nft-core';
export { TokenAmount } from '@vsc.eco/nft-core';
export { gqlFetchFailover, gqlFetchOne };
export type { GqlFetchOptions };
export type {
	MagiConfig,
	MagiNetwork,
	NftCollection,
	NftBalance,
	NftTokenInfo,
	NftItem,
	NftMetadata,
	TokenInfo,
	TokenBalance,
	CustomJsonOp,
	NftOpBundle,
	TokenOpBundle
} from '@vsc.eco/nft-core';
export {
	extractImageUrl,
	tokenPropsKey,
	buildBaseUriImage
} from './nftProvider.js';
export {
	createDeployerClient,
	substituteDeployerOps
} from './deployer.js';
export type {
	DeployerClient,
	DeployedCode,
	DeployerOp,
	DeployLogEntry,
	DeployResult,
	DeployTag,
	PrepareDeployParams,
	PrepareDeployResponse,
	CreateDeployerClientOptions
} from './deployer.js';
export type { NftProvider } from './nftProvider.js';
export type { TokenProvider } from './tokenProvider.js';

/**
 * Aioha-shaped signer. The SDK uses `vscCallContract` when present (lowest-
 * friction path — same as okinoko-terminal) and falls back to
 * `signAndBroadcastTx` otherwise. Callers can also bypass the client and
 * sign manually with the `op` returned by any `build*` function.
 */
export interface AiohaLike {
	vscCallContract?(
		contractId: string,
		action: string,
		payload: string | Record<string, unknown>,
		rcLimit: number,
		intents: VscIntent[],
		keyType: unknown
	): Promise<{ success: boolean; result?: string; error?: string }>;
	signAndBroadcastTx?(
		operations: unknown[],
		keyType: unknown
	): Promise<{ success: boolean; result?: string; error?: string }>;
}

/**
 * Generic broadcast hook for hosts that don't use Aioha. Receives the
 * already-built `custom_json` operation and returns a tx id. Errors should
 * be thrown.
 */
export type BroadcastHook = (
	op: unknown[],
	keyType: unknown
) => Promise<{ txId: string }>;

export interface CreateNftClientOptions {
	config?: MagiConfig;
	aioha?: AiohaLike;
	onBroadcast?: BroadcastHook;
	/** Override the default key type. Most NFT/token actions need active. */
	keyType?: unknown;
	nftProvider?: NftProvider;
	tokenProvider?: TokenProvider;
	/**
	 * Forwarded to the default providers' GraphQL calls. Lets hosts hook
	 * `onAttempt`/`onError` for telemetry, set a `timeoutMs`, or share an
	 * AbortSignal across all reads. Ignored when `nftProvider` /
	 * `tokenProvider` are also passed (those are already constructed).
	 */
	fetchOptions?: GqlFetchOptions;
}

export interface BroadcastResult {
	txId: string;
	/** The bundle that was broadcast — useful for tracking via `addTransaction`. */
	bundle: NftOpBundle | TokenOpBundle;
}

/**
 * High-level client. Combines:
 *   - read providers (collections, balances, token info, user view)
 *   - write builders (every action from the okinoko NFT + token contracts)
 *   - a signer adapter (`call.broadcast(bundle)`) so the host doesn't have
 *     to know whether Aioha or a custom hook is in play
 *
 * For headless integrators who want NO signing logic at all: skip `aioha`
 * and `onBroadcast`, use `client.nft.transferOp(...)` to get the
 * `{ op, call }` bundle, and broadcast it however you like.
 */
export interface NftClient {
	config: MagiConfig;
	nft: {
		provider: NftProvider;
		// Write builders return { op, call } — never broadcast on their own.
		initOp(contractId: string, username: string, p: NftInitParams): NftOpBundle;
		mintOp(contractId: string, username: string, p: NftMintParams): NftOpBundle;
		transferOp(contractId: string, username: string, p: NftTransferParams): NftOpBundle;
		batchTransferOp(
			contractId: string,
			username: string,
			p: NftBatchTransferParams
		): NftOpBundle;
		burnOp(contractId: string, username: string, p: NftBurnParams): NftOpBundle;
		burnBatchOp(contractId: string, username: string, p: NftBurnBatchParams): NftOpBundle;
		setApprovalForAllOp(
			contractId: string,
			username: string,
			p: NftSetApprovalForAllParams
		): NftOpBundle;
		approveOp(contractId: string, username: string, p: NftApproveParams): NftOpBundle;
		setUriOp(contractId: string, username: string, p: { tokenId: string; uri: string }): NftOpBundle;
		setBaseUriOp(contractId: string, username: string, p: { baseUri: string }): NftOpBundle;
		setPropertiesOp(
			contractId: string,
			username: string,
			p: { tokenId: string; properties: string }
		): NftOpBundle;
		setCollectionMetadataOp(
			contractId: string,
			username: string,
			p: { metadata: string }
		): NftOpBundle;
		changeOwnerOp(contractId: string, username: string, p: { newOwner: string }): NftOpBundle;
		pauseOp(contractId: string, username: string): NftOpBundle;
		unpauseOp(contractId: string, username: string): NftOpBundle;
		// Convenience: build + broadcast in one shot. Requires aioha or onBroadcast.
		transfer(contractId: string, username: string, p: NftTransferParams): Promise<BroadcastResult>;
		batchTransfer(
			contractId: string,
			username: string,
			p: NftBatchTransferParams
		): Promise<BroadcastResult>;
		burn(contractId: string, username: string, p: NftBurnParams): Promise<BroadcastResult>;
		burnBatch(
			contractId: string,
			username: string,
			p: NftBurnBatchParams
		): Promise<BroadcastResult>;
	};
	token: {
		provider: TokenProvider;
		initOp(contractId: string, username: string, p: TokenInitParams): TokenOpBundle;
		mintOp(contractId: string, username: string, p: { amount: string }): TokenOpBundle;
		burnOp(contractId: string, username: string, p: { amount: string }): TokenOpBundle;
		transferOp(
			contractId: string,
			username: string,
			p: TokenTransferParams
		): TokenOpBundle;
		transferFromOp(
			contractId: string,
			username: string,
			p: { from: string; to: string; amount: string }
		): TokenOpBundle;
		approveOp(
			contractId: string,
			username: string,
			p: TokenApproveParams
		): TokenOpBundle;
		increaseAllowanceOp(
			contractId: string,
			username: string,
			p: { spender: string; amount: string }
		): TokenOpBundle;
		decreaseAllowanceOp(
			contractId: string,
			username: string,
			p: { spender: string; amount: string }
		): TokenOpBundle;
		changeOwnerOp(contractId: string, username: string, p: { newOwner: string }): TokenOpBundle;
		pauseOp(contractId: string, username: string): TokenOpBundle;
		unpauseOp(contractId: string, username: string): TokenOpBundle;
		transfer(
			contractId: string,
			username: string,
			p: TokenTransferParams
		): Promise<BroadcastResult>;
		burn(contractId: string, username: string, p: { amount: string }): Promise<BroadcastResult>;
	};
	/** Direct broadcast of any NFT or token bundle. */
	broadcast(bundle: NftOpBundle | TokenOpBundle): Promise<BroadcastResult>;
	/**
	 * Broadcast multiple bundles. When the host's signer supports
	 * `signAndBroadcastTx` (Aioha does), bundles are grouped into
	 * `chunkSize`-sized Hive transactions so the user signs
	 * `ceil(N / chunkSize)` times - Keychain / HiveSigner and the L1
	 * node itself cap the ops per tx, so dumping 50+ ops into a single
	 * transaction will be rejected. When the signer can't bundle (only
	 * an `onBroadcast` hook), each bundle is broadcast individually.
	 *
	 * Returns one txId per chunk (or per bundle in sequential mode),
	 * plus a per-chunk progress callback so callers can render
	 * "Signing 2/4…".
	 */
	broadcastBatch(
		bundles: Array<NftOpBundle | TokenOpBundle>,
		opts?: {
			/**
			 * Forces per-bundle broadcasts (one signature per bundle) even
			 * when the signer supports `signAndBroadcastTx`. Useful when
			 * the caller wants a separate txid per recipient.
			 */
			sequential?: boolean;
			/**
			 * Number of ops to bundle into a single Hive transaction.
			 * Default 10 - well below the Keychain / Aioha provider caps
			 * but high enough that a typical 50-recipient airdrop becomes
			 * 5 signatures rather than 50.
			 */
			chunkSize?: number;
			/** Called once per chunk (or per bundle in sequential mode). */
			onProgress?: (i: number, total: number, txId: string) => void;
		}
	): Promise<{
		/** One txId per signed chunk (or per bundle when sequential). */
		txIds: string[];
		bundles: Array<NftOpBundle | TokenOpBundle>;
	}>;
}

export function createNftClient(opts: CreateNftClientOptions = {}): NftClient {
	const config = opts.config ?? MAINNET_CONFIG;
	const aioha = opts.aioha;
	const onBroadcast = opts.onBroadcast;
	const keyType = opts.keyType;
	const fetchOptions = opts.fetchOptions;
	const nftProvider =
		opts.nftProvider ?? createNftProvider(config, { fetchOptions });
	const tokenProvider =
		opts.tokenProvider ?? createTokenProvider(config, { fetchOptions });

	async function broadcast(
		bundle: NftOpBundle | TokenOpBundle
	): Promise<BroadcastResult> {
		if (onBroadcast) {
			const { txId } = await onBroadcast(bundle.op, keyType);
			return { txId, bundle };
		}
		if (!aioha) {
			throw new Error(
				'No signer configured: pass `aioha` or `onBroadcast` to createNftClient(), ' +
					'or use the `*Op` methods to build operations and broadcast them yourself.'
			);
		}
		// Prefer aioha.vscCallContract — it's the lowest-friction path Aioha
		// itself optimizes for VSC calls. Fall back to signAndBroadcastTx
		// (which works for any custom_json op) if it's missing.
		const call: VscCall = bundle.call;
		if (typeof aioha.vscCallContract === 'function') {
			const res = await aioha.vscCallContract(
				call.contractId,
				call.action,
				call.payload,
				call.rcLimit ?? 10000,
				call.intents ?? [],
				keyType
			);
			if (!res.success || typeof res.result !== 'string') {
				throw new Error(`vscCallContract failed: ${res.error ?? 'unknown'}`);
			}
			return { txId: res.result, bundle };
		}
		if (typeof aioha.signAndBroadcastTx === 'function') {
			const res = await aioha.signAndBroadcastTx([bundle.op], keyType);
			if (!res.success || typeof res.result !== 'string') {
				throw new Error(`signAndBroadcastTx failed: ${res.error ?? 'unknown'}`);
			}
			return { txId: res.result, bundle };
		}
		throw new Error('Aioha instance has neither vscCallContract nor signAndBroadcastTx');
	}

	async function broadcastBatch(
		bundles: Array<NftOpBundle | TokenOpBundle>,
		opts: {
			sequential?: boolean;
			chunkSize?: number;
			onProgress?: (i: number, total: number, txId: string) => void;
		} = {}
	): Promise<{
		txIds: string[];
		bundles: Array<NftOpBundle | TokenOpBundle>;
	}> {
		if (bundles.length === 0) {
			return { txIds: [], bundles };
		}
		const chunkSize = Math.max(1, Math.floor(opts.chunkSize ?? 10));
		// Bundled path: group ops into chunks small enough to clear the
		// Keychain / Aioha-provider caps and the L1 node's per-tx
		// op-count limit, then sign each chunk separately. We use this
		// path whenever (a) the caller didn't force sequential AND (b)
		// the signer surfaces signAndBroadcastTx (Aioha does, custom
		// onBroadcast hooks don't).
		const canBundle =
			!opts.sequential &&
			!onBroadcast &&
			!!aioha &&
			typeof aioha.signAndBroadcastTx === 'function';
		if (canBundle) {
			const txIds: string[] = [];
			const totalChunks = Math.ceil(bundles.length / chunkSize);
			for (let i = 0; i < bundles.length; i += chunkSize) {
				const chunk = bundles.slice(i, i + chunkSize);
				const ops = chunk.map((b) => b.op as unknown);
				const res = await aioha!.signAndBroadcastTx!(ops, keyType);
				if (!res.success || typeof res.result !== 'string') {
					// Stop on first failure - the caller surfaces the
					// txIds we did get and lets the user retry the rest.
					throw new Error(
						`signAndBroadcastTx failed on chunk ${Math.floor(i / chunkSize) + 1}/${totalChunks}: ${res.error ?? 'unknown'}`
					);
				}
				txIds.push(res.result);
				opts.onProgress?.(txIds.length - 1, totalChunks, res.result);
			}
			return { txIds, bundles };
		}
		// Sequential fallback - one tx per bundle. Same partial-success
		// semantics: stop on first error, surface what we have.
		const txIds: string[] = [];
		for (let i = 0; i < bundles.length; i++) {
			const r = await broadcast(bundles[i]);
			txIds.push(r.txId);
			opts.onProgress?.(i, bundles.length, r.txId);
		}
		return { txIds, bundles };
	}

	const ctx = (contractId: string, username: string) => ({
		contractId,
		username,
		network: config.network
	});

	return {
		config,
		nft: {
			provider: nftProvider,
			initOp: (cid, u, p) => buildNftInit(ctx(cid, u), p),
			mintOp: (cid, u, p) => buildNftMint(ctx(cid, u), p),
			transferOp: (cid, u, p) => buildNftTransfer(ctx(cid, u), p),
			batchTransferOp: (cid, u, p) => buildNftBatchTransfer(ctx(cid, u), p),
			burnOp: (cid, u, p) => buildNftBurn(ctx(cid, u), p),
			burnBatchOp: (cid, u, p) => buildNftBurnBatch(ctx(cid, u), p),
			setApprovalForAllOp: (cid, u, p) => buildNftSetApprovalForAll(ctx(cid, u), p),
			approveOp: (cid, u, p) => buildNftApprove(ctx(cid, u), p),
			setUriOp: (cid, u, p) => buildNftSetUri(ctx(cid, u), p),
			setBaseUriOp: (cid, u, p) => buildNftSetBaseUri(ctx(cid, u), p),
			setPropertiesOp: (cid, u, p) => buildNftSetProperties(ctx(cid, u), p),
			setCollectionMetadataOp: (cid, u, p) => buildNftSetCollectionMetadata(ctx(cid, u), p),
			changeOwnerOp: (cid, u, p) => buildNftChangeOwner(ctx(cid, u), p),
			pauseOp: (cid, u) => buildNftPause(ctx(cid, u)),
			unpauseOp: (cid, u) => buildNftUnpause(ctx(cid, u)),
			transfer: (cid, u, p) => broadcast(buildNftTransfer(ctx(cid, u), p)),
			batchTransfer: (cid, u, p) => broadcast(buildNftBatchTransfer(ctx(cid, u), p)),
			burn: (cid, u, p) => broadcast(buildNftBurn(ctx(cid, u), p)),
			burnBatch: (cid, u, p) => broadcast(buildNftBurnBatch(ctx(cid, u), p))
		},
		token: {
			provider: tokenProvider,
			initOp: (cid, u, p) => buildTokenInit(ctx(cid, u), p),
			mintOp: (cid, u, p) => buildTokenMint(ctx(cid, u), p),
			burnOp: (cid, u, p) => buildTokenBurn(ctx(cid, u), p),
			transferOp: (cid, u, p) => buildTokenTransfer(ctx(cid, u), p),
			transferFromOp: (cid, u, p) => buildTokenTransferFrom(ctx(cid, u), p),
			approveOp: (cid, u, p) => buildTokenApprove(ctx(cid, u), p),
			increaseAllowanceOp: (cid, u, p) => buildTokenIncreaseAllowance(ctx(cid, u), p),
			decreaseAllowanceOp: (cid, u, p) => buildTokenDecreaseAllowance(ctx(cid, u), p),
			changeOwnerOp: (cid, u, p) => buildTokenChangeOwner(ctx(cid, u), p),
			pauseOp: (cid, u) => buildTokenPause(ctx(cid, u)),
			unpauseOp: (cid, u) => buildTokenUnpause(ctx(cid, u)),
			transfer: (cid, u, p) => broadcast(buildTokenTransfer(ctx(cid, u), p)),
			burn: (cid, u, p) => broadcast(buildTokenBurn(ctx(cid, u), p))
		},
		broadcast,
		broadcastBatch
	};
}
