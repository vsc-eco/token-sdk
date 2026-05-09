import type { CustomJsonOp, MagiNetwork, VscCall } from '../types/index.js';
import { buildVscCallOp, normalizeHiveAccount } from './vsc.js';

/**
 * Operation builders for the Magi Token (ERC-20) contract. Same shape as the
 * NFT builders — each function returns `{ op, call }` so callers can pick
 * either signing path.
 */

export interface TokenOpBundle {
	op: CustomJsonOp;
	call: VscCall;
}

export interface TokenOpContext {
	contractId: string;
	username: string;
	network: MagiNetwork;
}

function bundle(
	ctx: TokenOpContext,
	action: string,
	payload: Record<string, unknown>,
	rcLimit?: number
): TokenOpBundle {
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

/**
 * On-chain amount inputs are strings of smallest units. Callers convert
 * decimals → smallest units via TokenAmount before passing in.
 */

export interface TokenInitParams {
	name: string;
	symbol: string;
	decimals?: number;
	maxSupply?: string;
}
export function buildTokenInit(ctx: TokenOpContext, p: TokenInitParams): TokenOpBundle {
	const payload: Record<string, unknown> = {
		name: p.name,
		symbol: p.symbol,
		decimals: p.decimals ?? 0
	};
	if (p.maxSupply !== undefined) payload.maxSupply = p.maxSupply;
	return bundle(ctx, 'init', payload);
}

/** Owner-only: mint `amount` (smallest units) into the owner's balance. */
export function buildTokenMint(ctx: TokenOpContext, p: { amount: string }): TokenOpBundle {
	return bundle(ctx, 'mint', { amount: p.amount });
}

/** Burn `amount` (smallest units) from caller's balance. */
export function buildTokenBurn(ctx: TokenOpContext, p: { amount: string }): TokenOpBundle {
	return bundle(ctx, 'burn', { amount: p.amount });
}

/** Send `amount` (smallest units) from caller to `to`. */
export interface TokenTransferParams {
	to: string;
	amount: string;
}
export function buildTokenTransfer(ctx: TokenOpContext, p: TokenTransferParams): TokenOpBundle {
	return bundle(ctx, 'transfer', { to: normalizeHiveAccount(p.to), amount: p.amount });
}

/** Pull `amount` (smallest units) from `from` to `to` using a prior allowance. */
export interface TokenTransferFromParams {
	from: string;
	to: string;
	amount: string;
}
export function buildTokenTransferFrom(
	ctx: TokenOpContext,
	p: TokenTransferFromParams
): TokenOpBundle {
	return bundle(ctx, 'transferFrom', {
		from: normalizeHiveAccount(p.from),
		to: normalizeHiveAccount(p.to),
		amount: p.amount
	});
}

/** Set spender's allowance to exactly `amount` (smallest units). */
export interface TokenApproveParams {
	spender: string;
	amount: string;
}
export function buildTokenApprove(ctx: TokenOpContext, p: TokenApproveParams): TokenOpBundle {
	return bundle(ctx, 'approve', { spender: normalizeHiveAccount(p.spender), amount: p.amount });
}

/** Bump spender's allowance by `amount` (smallest units). */
export function buildTokenIncreaseAllowance(
	ctx: TokenOpContext,
	p: { spender: string; amount: string }
): TokenOpBundle {
	return bundle(ctx, 'increaseAllowance', {
		spender: normalizeHiveAccount(p.spender),
		amount: p.amount
	});
}

/** Drop spender's allowance by `amount` (smallest units). */
export function buildTokenDecreaseAllowance(
	ctx: TokenOpContext,
	p: { spender: string; amount: string }
): TokenOpBundle {
	return bundle(ctx, 'decreaseAllowance', {
		spender: normalizeHiveAccount(p.spender),
		amount: p.amount
	});
}

/** Owner-only: hand the contract over to `newOwner`. */
export function buildTokenChangeOwner(
	ctx: TokenOpContext,
	p: { newOwner: string }
): TokenOpBundle {
	return bundle(ctx, 'changeOwner', { newOwner: normalizeHiveAccount(p.newOwner) });
}

/** Owner-only: pause / unpause all transfers. */
export function buildTokenPause(ctx: TokenOpContext): TokenOpBundle {
	return bundle(ctx, 'pause', {});
}
export function buildTokenUnpause(ctx: TokenOpContext): TokenOpBundle {
	return bundle(ctx, 'unpause', {});
}
