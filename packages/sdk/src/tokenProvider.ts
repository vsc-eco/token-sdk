import {
	resolveIndexerUrls,
	type MagiConfig,
	type TokenBalance,
	type TokenInfo
} from '@vsc.eco/nft-core';
import { gqlFetchFailover, type GqlFetchOptions } from './graphql.js';

/**
 * Token (ERC-20) read provider. Mirrors `NftProvider` shape but for the
 * fungible-token contract. Powered by the same indexer that serves the
 * NFT views (tables `magi_token_overview`, `magi_token_balances`).
 */
export interface TokenProvider {
	getInfo(contractId: string): Promise<TokenInfo | null>;
	getInfos(contractIds: string[]): Promise<TokenInfo[]>;
	getBalances(account: string): Promise<TokenBalance[]>;
	/** Convenience: balances joined with the matching token info. */
	getUserTokens(account: string): Promise<Array<TokenBalance & { info: TokenInfo }>>;
}

interface OverviewRow {
	contract_id: string;
	name: string;
	symbol: string;
	decimals: number;
	owner: string;
	/** Currently outstanding supply — decreases on burn. The indexer column
	 * name is `current_supply`; this is what ERC-20's `totalSupply()` returns. */
	current_supply: string | number | null;
	max_supply: string | number | null;
	paused: boolean | null;
	init_ts: string | null;
}

interface BalanceRow {
	contract_id: string;
	account: string;
	balance: string | number;
}

const OVERVIEW_FRAGMENT = `
	contract_id
	name
	symbol
	decimals
	owner
	current_supply
	max_supply
	paused
	init_ts
`;

/** BigInt() doesn't accept fractional or undefined inputs; convert via String. */
function toBigIntOrUndef(v: string | number | null | undefined): bigint | undefined {
	if (v === null || v === undefined) return undefined;
	try {
		return BigInt(String(v));
	} catch {
		return undefined;
	}
}

function rowToInfo(r: OverviewRow): TokenInfo {
	return {
		contractId: r.contract_id,
		name: r.name,
		symbol: r.symbol,
		decimals: Number(r.decimals),
		owner: r.owner,
		// Public field name follows ERC-20 convention; column is current_supply.
		totalSupply: toBigIntOrUndef(r.current_supply),
		maxSupply: toBigIntOrUndef(r.max_supply),
		paused: r.paused ?? undefined
	};
}

export interface CreateTokenProviderOptions {
	fetchOptions?: GqlFetchOptions;
}

export function createTokenProvider(
	config: MagiConfig,
	opts: CreateTokenProviderOptions = {}
): TokenProvider {
	const indexerUrls = resolveIndexerUrls(config);
	const fetchOpts = opts.fetchOptions;

	async function getInfos(contractIds: string[]): Promise<TokenInfo[]> {
		if (!contractIds.length) return [];
		const data = await gqlFetchFailover<{ rows: OverviewRow[] }>(
			indexerUrls,
			`query($ids: [String!]!) {
				rows: magi_token_overview(where: { contract_id: { _in: $ids } }) { ${OVERVIEW_FRAGMENT} }
			}`,
			{ ids: contractIds },
			fetchOpts
		);
		return data.rows.map(rowToInfo);
	}

	async function getInfo(contractId: string): Promise<TokenInfo | null> {
		const list = await getInfos([contractId]);
		return list[0] ?? null;
	}

	async function getBalances(account: string): Promise<TokenBalance[]> {
		if (!account) return [];
		// No server-side balance filter — okinoko-terminal's TokenPanel does
		// the zero-filter on the client because Hasura's `_gt` comparators
		// for the bigint-as-text balance column are unreliable across mirrors.
		const data = await gqlFetchFailover<{ rows: BalanceRow[] }>(
			indexerUrls,
			`query($acc: String!) {
				rows: magi_token_balances(where: { account: { _eq: $acc } }) {
					contract_id account balance
				}
			}`,
			{ acc: account },
			fetchOpts
		);
		return data.rows
			.map((r) => ({
				contractId: r.contract_id,
				account: r.account,
				balance: toBigIntOrUndef(r.balance) ?? 0n
			}))
			.filter((b) => b.balance > 0n);
	}

	async function getUserTokens(
		account: string
	): Promise<Array<TokenBalance & { info: TokenInfo }>> {
		const balances = await getBalances(account);
		if (!balances.length) return [];
		const ids = Array.from(new Set(balances.map((b) => b.contractId)));
		const infos = await getInfos(ids);
		const infoByContract = new Map(infos.map((i) => [i.contractId, i]));
		const out: Array<TokenBalance & { info: TokenInfo }> = [];
		for (const b of balances) {
			const info = infoByContract.get(b.contractId);
			if (info) out.push({ ...b, info });
		}
		return out;
	}

	return { getInfo, getInfos, getBalances, getUserTokens };
}
