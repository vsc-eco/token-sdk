import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gqlFetchFailover, gqlFetchOne } from '../src/graphql.js';
import { resolveIndexerUrls, MAINNET_CONFIG } from '@vsc.eco/token-core';

const realFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
	mockFetch = vi.fn();
	globalThis.fetch = mockFetch as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

function ok(data: unknown): Response {
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}
function http500(): Response {
	return new Response('upstream broken', { status: 500, statusText: 'Server Error' });
}
function gqlError(msg: string): Response {
	return new Response(JSON.stringify({ errors: [{ message: msg }] }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('gqlFetchOne', () => {
	it('returns data on success', async () => {
		mockFetch.mockResolvedValueOnce(ok({ x: 1 }));
		const out = await gqlFetchOne('https://a/graphql', '{}');
		expect(out).toEqual({ x: 1 });
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
	it('throws on non-200', async () => {
		mockFetch.mockResolvedValueOnce(http500());
		await expect(gqlFetchOne('https://a/graphql', '{}')).rejects.toThrow(/HTTP 500/);
	});
	it('throws on GraphQL errors[]', async () => {
		mockFetch.mockResolvedValueOnce(gqlError('oh no'));
		await expect(gqlFetchOne('https://a/graphql', '{}')).rejects.toThrow(/oh no/);
	});
});

describe('gqlFetchFailover', () => {
	it('returns first endpoint that succeeds', async () => {
		mockFetch.mockResolvedValueOnce(ok({ x: 1 }));
		const out = await gqlFetchFailover(['https://a', 'https://b'], '{}');
		expect(out).toEqual({ x: 1 });
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockFetch.mock.calls[0][0]).toBe('https://a');
	});
	it('moves on to next URL after HTTP 5xx', async () => {
		mockFetch.mockResolvedValueOnce(http500()).mockResolvedValueOnce(ok({ x: 2 }));
		const out = await gqlFetchFailover(['https://a', 'https://b'], '{}');
		expect(out).toEqual({ x: 2 });
		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockFetch.mock.calls[1][0]).toBe('https://b');
	});
	it('moves on to next URL after a network error', async () => {
		mockFetch
			.mockRejectedValueOnce(new Error('ECONNRESET'))
			.mockResolvedValueOnce(ok({ x: 3 }));
		const out = await gqlFetchFailover(['https://a', 'https://b'], '{}');
		expect(out).toEqual({ x: 3 });
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});
	it('moves on to next URL after a GraphQL errors[] response', async () => {
		mockFetch
			.mockResolvedValueOnce(gqlError('schema mismatch'))
			.mockResolvedValueOnce(ok({ x: 4 }));
		const out = await gqlFetchFailover(['https://a', 'https://b'], '{}');
		expect(out).toEqual({ x: 4 });
	});
	it('throws after all endpoints fail, summarising each', async () => {
		mockFetch
			.mockResolvedValueOnce(http500())
			.mockRejectedValueOnce(new Error('timeout'));
		await expect(
			gqlFetchFailover(['https://a', 'https://b'], '{}')
		).rejects.toThrow(/all 2 endpoints failed/);
		await expect(
			gqlFetchFailover(['https://a', 'https://b'], '{}').catch((e: Error) => e.message)
		).resolves.toMatch(/https:\/\/a/);
	});
	it('fires onAttempt + onError hooks', async () => {
		mockFetch
			.mockResolvedValueOnce(http500())
			.mockResolvedValueOnce(ok({ x: 5 }));
		const onAttempt = vi.fn();
		const onError = vi.fn();
		const out = await gqlFetchFailover(['https://a', 'https://b'], '{}', {}, { onAttempt, onError });
		expect(out).toEqual({ x: 5 });
		expect(onAttempt).toHaveBeenCalledTimes(2);
		expect(onAttempt.mock.calls[0]).toEqual(['https://a', 0]);
		expect(onAttempt.mock.calls[1]).toEqual(['https://b', 1]);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0][0]).toBe('https://a');
	});
	it('does NOT fail over on AbortError — surfaces immediately', async () => {
		const ac = new AbortController();
		ac.abort();
		await expect(
			gqlFetchFailover(['https://a', 'https://b'], '{}', {}, { signal: ac.signal })
		).rejects.toThrow();
		expect(mockFetch).not.toHaveBeenCalled();
	});
	it('throws when given an empty URL list', async () => {
		await expect(gqlFetchFailover([], '{}')).rejects.toThrow(/no URLs/);
	});
});

describe('resolveIndexerUrls / config back-compat', () => {
	it('uses indexerHasuraUrls when provided', () => {
		expect(resolveIndexerUrls(MAINNET_CONFIG).length).toBeGreaterThanOrEqual(1);
	});
	it('falls back to indexerHasuraUrl when indexerHasuraUrls is unset', () => {
		expect(
			resolveIndexerUrls({
				network: 'vsc-mainnet',
				indexerHasuraUrl: 'https://a/graphql'
			})
		).toEqual(['https://a/graphql']);
	});
	it('throws when neither field is set', () => {
		expect(() =>
			resolveIndexerUrls({ network: 'vsc-mainnet' })
		).toThrow(/neither/);
	});
});
