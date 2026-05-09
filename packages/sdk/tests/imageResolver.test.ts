import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildBaseUriImage,
	createNftProvider,
	extractImageUrl,
	tokenPropsKey
} from '../src/nftProvider.js';
import type { NftItem } from '@vsc.eco/nft-core';

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
	indexerHasuraUrls: ['https://idx/v1/graphql'],
	gqlUrls: ['https://gql/api/v1/graphql']
};

function gqlOk(data: unknown): Response {
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

function makeItem(overrides: Partial<NftItem> = {}): NftItem {
	return {
		contractId: 'vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45',
		tokenId: 'card-007',
		balance: 1,
		maxSupply: 1,
		isUnique: true,
		soulbound: false,
		collection: {
			contractId: 'vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45',
			name: 'Cards',
			symbol: 'CARD',
			owner: 'hive:alice',
			baseUri: 'https://cdn.example.com/cards/'
		},
		templateId: null,
		...overrides
	};
}

describe('extractImageUrl', () => {
	it('returns null for empty / non-object', () => {
		expect(extractImageUrl(null)).toBe(null);
		expect(extractImageUrl({})).toBe(null);
	});
	it('finds image-like keys (case-insensitive)', () => {
		expect(extractImageUrl({ image: 'a' })).toBe('a');
		expect(extractImageUrl({ Image: 'b' })).toBe('b');
		expect(extractImageUrl({ THUMBNAIL: 'c' })).toBe('c');
		expect(extractImageUrl({ icon: 'd' })).toBe('d');
	});
	it('skips non-string values and trims whitespace', () => {
		expect(extractImageUrl({ image: '   ' })).toBe(null);
		expect(extractImageUrl({ image: 42 as unknown as string })).toBe(null);
		expect(extractImageUrl({ image: '  https://x  ' })).toBe('https://x');
	});
});

describe('buildBaseUriImage', () => {
	it('returns null when baseUri is empty', () => {
		expect(buildBaseUriImage('', 'card-1')).toBe(null);
		expect(buildBaseUriImage(null, 'card-1')).toBe(null);
		expect(buildBaseUriImage(undefined, 'card-1')).toBe(null);
	});
	it('concatenates without inserting separators (matches contract semantics)', () => {
		expect(buildBaseUriImage('https://x/', 'a')).toBe('https://x/a');
		expect(buildBaseUriImage('ipfs://QmHash/', 'card-1')).toBe('ipfs://QmHash/card-1');
		// caller controls the trailing slash:
		expect(buildBaseUriImage('https://x', 'a')).toBe('https://xa');
	});
});

describe('tokenPropsKey', () => {
	it('matches the contract storage convention', () => {
		expect(tokenPropsKey('card-1')).toBe('props|card-1');
	});
});

describe('NftProvider.resolveNftImages — priority', () => {
	const provider = createNftProvider(CONFIG);

	it('uses own props.image when set', async () => {
		mockFetch.mockResolvedValueOnce(
			gqlOk({
				getStateByKeys: {
					'props|card-007': JSON.stringify({ image: 'https://own.example/img.png' })
				}
			})
		);
		const map = await provider.resolveNftImages([makeItem()]);
		expect(map.get('vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45:card-007')).toBe(
			'https://own.example/img.png'
		);
		// Single getStateByKeys call total
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it('falls back to template props.image when own props lack one', async () => {
		mockFetch.mockResolvedValueOnce(
			gqlOk({
				getStateByKeys: {
					'props|card-007': JSON.stringify({ name: 'edition #7' }), // no image
					'props|series-cards': JSON.stringify({ image: 'https://tpl.example/cover.jpg' })
				}
			})
		);
		const map = await provider.resolveNftImages([
			makeItem({ templateId: 'series-cards' })
		]);
		expect(map.get('vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45:card-007')).toBe(
			'https://tpl.example/cover.jpg'
		);
	});

	it('still picks own props image even when a template is set (own takes priority)', async () => {
		mockFetch.mockResolvedValueOnce(
			gqlOk({
				getStateByKeys: {
					'props|card-007': JSON.stringify({ image: 'OWN' }),
					'props|series-cards': JSON.stringify({ image: 'TPL' })
				}
			})
		);
		const map = await provider.resolveNftImages([
			makeItem({ templateId: 'series-cards' })
		]);
		expect(map.get('vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45:card-007')).toBe('OWN');
	});

	it('falls back to baseUri+tokenId when neither own nor template have an image', async () => {
		mockFetch.mockResolvedValueOnce(
			gqlOk({
				getStateByKeys: {
					'props|card-007': null,
					'props|series-cards': JSON.stringify({ name: 'series' })
				}
			})
		);
		const map = await provider.resolveNftImages([
			makeItem({ templateId: 'series-cards' })
		]);
		expect(map.get('vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45:card-007')).toBe(
			'https://cdn.example.com/cards/card-007'
		);
	});

	it('returns null when every source is empty (no props, no baseUri)', async () => {
		mockFetch.mockResolvedValueOnce(gqlOk({ getStateByKeys: {} }));
		const item = makeItem({
			collection: { ...makeItem().collection, baseUri: undefined }
		});
		const map = await provider.resolveNftImages([item]);
		expect(map.get('vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45:card-007')).toBe(null);
	});

	it('handles double-stringified JSON from older contract writes', async () => {
		// Contract may have stored JSON.stringify(JSON.stringify({...}))
		mockFetch.mockResolvedValueOnce(
			gqlOk({
				getStateByKeys: {
					'props|card-007': JSON.stringify(
						JSON.stringify({ image: 'https://wrapped.example/i.png' })
					)
				}
			})
		);
		const map = await provider.resolveNftImages([makeItem()]);
		expect(map.get('vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45:card-007')).toBe(
			'https://wrapped.example/i.png'
		);
	});

	it('batches by contract — one getStateByKeys call per contract regardless of token count', async () => {
		mockFetch.mockResolvedValueOnce(
			gqlOk({
				getStateByKeys: {
					'props|a': JSON.stringify({ image: 'A' }),
					'props|b': JSON.stringify({ image: 'B' }),
					'props|c': JSON.stringify({ image: 'C' })
				}
			})
		);
		const map = await provider.resolveNftImages([
			makeItem({ tokenId: 'a' }),
			makeItem({ tokenId: 'b' }),
			makeItem({ tokenId: 'c' })
		]);
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(map.size).toBe(3);
	});

	it('falls back gracefully when getStateByKeys throws — uses baseUri+tokenId', async () => {
		mockFetch.mockRejectedValueOnce(new Error('node down'));
		const map = await provider.resolveNftImages([makeItem()]);
		expect(map.get('vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45:card-007')).toBe(
			'https://cdn.example.com/cards/card-007'
		);
	});
});

describe('NftProvider.resolveNftImage — single-item convenience', () => {
	it('returns the same value resolveNftImages would', async () => {
		const provider = createNftProvider(CONFIG);
		mockFetch.mockResolvedValueOnce(
			gqlOk({
				getStateByKeys: {
					'props|card-007': JSON.stringify({ image: 'X' })
				}
			})
		);
		expect(await provider.resolveNftImage(makeItem())).toBe('X');
	});
});
