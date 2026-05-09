import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenProvider } from '../src/tokenProvider.js';

const realFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
	mockFetch = vi.fn();
	globalThis.fetch = mockFetch as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const CONFIG = {
	network: 'vsc-mainnet' as const,
	indexerHasuraUrls: ['https://idx/v1/graphql']
};

function gqlOk(data: unknown): Response {
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('TokenProvider', () => {
	it('queries `current_supply` (the real indexer column) — not `total_supply`', async () => {
		const provider = createTokenProvider(CONFIG);
		mockFetch.mockResolvedValueOnce(
			gqlOk({
				rows: [
					{
						contract_id: 'vsc1...',
						name: 'Diy Token',
						symbol: 'DIY',
						decimals: 0,
						owner: 'hive:alice',
						current_supply: 1112,
						max_supply: 1000000000,
						paused: false,
						init_ts: '2026-01-01T00:00:00Z'
					}
				]
			})
		);
		const infos = await provider.getInfos(['vsc1...']);
		// The query body sent to the server must reference current_supply, not total_supply.
		const sentBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
		expect(sentBody.query).toContain('current_supply');
		expect(sentBody.query).not.toContain('total_supply');
		// And our public field name stays totalSupply (ERC-20 convention).
		expect(infos[0].totalSupply).toBe(1112n);
		expect(infos[0].maxSupply).toBe(1000000000n);
	});

	it('parses numeric values whether the indexer returns string or number', async () => {
		const provider = createTokenProvider(CONFIG);
		mockFetch.mockResolvedValueOnce(
			gqlOk({
				rows: [
					{
						contract_id: 'vsc1A',
						name: 'A',
						symbol: 'A',
						decimals: 3,
						owner: 'x',
						current_supply: '12345', // string — older indexer
						max_supply: 100000, // number — newer indexer
						paused: null,
						init_ts: null
					}
				]
			})
		);
		const infos = await provider.getInfos(['vsc1A']);
		expect(infos[0].totalSupply).toBe(12345n);
		expect(infos[0].maxSupply).toBe(100000n);
	});

	it('does NOT send a server-side balance filter (matches okinoko-terminal)', async () => {
		const provider = createTokenProvider(CONFIG);
		mockFetch.mockResolvedValueOnce(gqlOk({ rows: [] }));
		await provider.getBalances('hive:alice');
		const sentBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
		// No _gt clause in the where filter — only account equality.
		expect(sentBody.query).not.toMatch(/_gt/);
		expect(sentBody.query).toMatch(/account: \{ _eq: \$acc \}/);
	});

	it('client-side filters zero balances out', async () => {
		const provider = createTokenProvider(CONFIG);
		mockFetch.mockResolvedValueOnce(
			gqlOk({
				rows: [
					{ contract_id: 'a', account: 'hive:alice', balance: '100' },
					{ contract_id: 'b', account: 'hive:alice', balance: '0' },
					{ contract_id: 'c', account: 'hive:alice', balance: 250 }
				]
			})
		);
		const out = await provider.getBalances('hive:alice');
		expect(out.map((b) => b.contractId)).toEqual(['a', 'c']);
		expect(out[0].balance).toBe(100n);
		expect(out[1].balance).toBe(250n);
	});

	it('joins balances with infos in getUserTokens', async () => {
		const provider = createTokenProvider(CONFIG);
		mockFetch
			.mockResolvedValueOnce(
				gqlOk({ rows: [{ contract_id: 'a', account: 'hive:alice', balance: '5' }] })
			)
			.mockResolvedValueOnce(
				gqlOk({
					rows: [
						{
							contract_id: 'a',
							name: 'A',
							symbol: 'A',
							decimals: 0,
							owner: 'x',
							current_supply: 10,
							max_supply: null,
							paused: null,
							init_ts: null
						}
					]
				})
			);
		const out = await provider.getUserTokens('hive:alice');
		expect(out).toHaveLength(1);
		expect(out[0].balance).toBe(5n);
		expect(out[0].info.symbol).toBe('A');
	});
});
