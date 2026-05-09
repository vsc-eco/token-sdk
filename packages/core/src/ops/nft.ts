import type { CustomJsonOp, MagiNetwork, VscCall } from '../types/index.js';
import { buildVscCallOp, normalizeHiveAccount } from './vsc.js';

/**
 * Operation builders for the Magi NFT (ERC-1155) contract.
 *
 * Each function returns a tuple: `{ op, call }`.
 *  - `op`: the ready-to-broadcast Hive `custom_json` operation.
 *  - `call`: the inner `vsc.call` payload — useful when broadcasting via
 *    `aioha.vscCallContract(contractId, action, payload, rcLimit, intents, keyType)`
 *    instead of `signAndBroadcastTx(ops, keyType)`.
 *
 * The split lets headless integrators pick whichever signing path they prefer.
 */

export interface NftOpBundle {
	op: CustomJsonOp;
	call: VscCall;
}

export interface NftOpContext {
	contractId: string;
	username: string;
	network: MagiNetwork;
}

function bundle(ctx: NftOpContext, action: string, payload: Record<string, unknown>, rcLimit?: number): NftOpBundle {
	const call: VscCall = {
		contractId: ctx.contractId,
		action,
		payload,
		rcLimit: rcLimit ?? 10000,
		intents: []
	};
	return {
		call,
		op: buildVscCallOp({ username: ctx.username, network: ctx.network, call })
	};
}

/** Initialize a new NFT contract (called once after deploy). Owner-only. */
export interface NftInitParams {
	name: string;
	symbol: string;
	baseUri?: string;
	trackMinted?: boolean;
}
export function buildNftInit(ctx: NftOpContext, p: NftInitParams): NftOpBundle {
	return bundle(ctx, 'init', {
		name: p.name,
		symbol: p.symbol,
		baseUri: p.baseUri ?? '',
		trackMinted: p.trackMinted ?? false
	});
}

/** Mint a single token id (in `amount` copies). Contract owner only. */
export interface NftMintParams {
	to: string;
	id: string;
	amount: number;
	maxSupply?: number;
	soulbound?: boolean;
	properties?: string;
	propertiesTemplate?: string;
	data?: string;
}
export function buildNftMint(ctx: NftOpContext, p: NftMintParams): NftOpBundle {
	const payload: Record<string, unknown> = {
		to: normalizeHiveAccount(p.to),
		id: p.id,
		amount: p.amount,
		data: p.data ?? ''
	};
	if (p.maxSupply !== undefined) payload.maxSupply = p.maxSupply;
	if (p.soulbound !== undefined) payload.soulbound = p.soulbound;
	if (p.properties !== undefined) payload.properties = p.properties;
	if (p.propertiesTemplate !== undefined) payload.propertiesTemplate = p.propertiesTemplate;
	return bundle(ctx, 'mint', payload);
}

/**
 * Transfer an existing token id from `from` to `to`. The caller must equal
 * `from` OR be approved for all of `from`'s tokens (setApprovalForAll).
 */
export interface NftTransferParams {
	from: string;
	to: string;
	tokenId: string;
	amount: number;
	data?: string;
}
export function buildNftTransfer(ctx: NftOpContext, p: NftTransferParams): NftOpBundle {
	return bundle(ctx, 'safeTransferFrom', {
		from: normalizeHiveAccount(p.from),
		to: normalizeHiveAccount(p.to),
		id: p.tokenId,
		amount: p.amount,
		data: p.data ?? ''
	});
}

/** Batch transfer multiple token ids in one tx. `ids` and `amounts` align by index. */
export interface NftBatchTransferParams {
	from: string;
	to: string;
	ids: string[];
	amounts: number[];
	data?: string;
}
export function buildNftBatchTransfer(ctx: NftOpContext, p: NftBatchTransferParams): NftOpBundle {
	if (p.ids.length !== p.amounts.length) {
		throw new Error('buildNftBatchTransfer: ids.length must equal amounts.length');
	}
	return bundle(ctx, 'safeBatchTransferFrom', {
		from: normalizeHiveAccount(p.from),
		to: normalizeHiveAccount(p.to),
		ids: p.ids,
		amounts: p.amounts,
		data: p.data ?? ''
	});
}

/** Burn `amount` of `tokenId` from `from`'s balance. Caller must equal `from`. */
export interface NftBurnParams {
	from: string;
	tokenId: string;
	amount: number;
}
export function buildNftBurn(ctx: NftOpContext, p: NftBurnParams): NftOpBundle {
	return bundle(ctx, 'burn', {
		from: normalizeHiveAccount(p.from),
		id: p.tokenId,
		amount: p.amount
	});
}

/** Burn multiple token ids in one tx. */
export interface NftBurnBatchParams {
	from: string;
	ids: string[];
	amounts: number[];
}
export function buildNftBurnBatch(ctx: NftOpContext, p: NftBurnBatchParams): NftOpBundle {
	if (p.ids.length !== p.amounts.length) {
		throw new Error('buildNftBurnBatch: ids.length must equal amounts.length');
	}
	return bundle(ctx, 'burnBatch', {
		from: normalizeHiveAccount(p.from),
		ids: p.ids,
		amounts: p.amounts
	});
}

/** Approve / revoke an operator for ALL of caller's tokens. */
export interface NftSetApprovalForAllParams {
	operator: string;
	approved: boolean;
}
export function buildNftSetApprovalForAll(ctx: NftOpContext, p: NftSetApprovalForAllParams): NftOpBundle {
	return bundle(ctx, 'setApprovalForAll', {
		operator: normalizeHiveAccount(p.operator),
		approved: p.approved
	});
}

/** Approve a spender for a specific token id, up to `amount` units. */
export interface NftApproveParams {
	spender: string;
	tokenId: string;
	amount: number;
}
export function buildNftApprove(ctx: NftOpContext, p: NftApproveParams): NftOpBundle {
	return bundle(ctx, 'approve', {
		spender: normalizeHiveAccount(p.spender),
		id: p.tokenId,
		amount: p.amount
	});
}

/** Owner-only: set token-specific URI. */
export function buildNftSetUri(ctx: NftOpContext, p: { tokenId: string; uri: string }): NftOpBundle {
	return bundle(ctx, 'setURI', { id: p.tokenId, uri: p.uri });
}

/** Owner-only: set the contract-wide base URI. */
export function buildNftSetBaseUri(ctx: NftOpContext, p: { baseUri: string }): NftOpBundle {
	return bundle(ctx, 'setBaseURI', { baseUri: p.baseUri });
}

/** Owner-only: set per-token properties JSON. */
export function buildNftSetProperties(
	ctx: NftOpContext,
	p: { tokenId: string; properties: string }
): NftOpBundle {
	return bundle(ctx, 'setProperties', { id: p.tokenId, properties: p.properties });
}

/** Owner-only: set the JSON metadata blob describing the whole collection. */
export function buildNftSetCollectionMetadata(
	ctx: NftOpContext,
	p: { metadata: string }
): NftOpBundle {
	return bundle(ctx, 'setCollectionMetadata', { metadata: p.metadata });
}

/** Owner-only: hand the contract over to `newOwner`. */
export function buildNftChangeOwner(ctx: NftOpContext, p: { newOwner: string }): NftOpBundle {
	return bundle(ctx, 'changeOwner', { newOwner: normalizeHiveAccount(p.newOwner) });
}

/** Owner-only: pause / unpause all transfers. */
export function buildNftPause(ctx: NftOpContext): NftOpBundle {
	return bundle(ctx, 'pause', {});
}
export function buildNftUnpause(ctx: NftOpContext): NftOpBundle {
	return bundle(ctx, 'unpause', {});
}
