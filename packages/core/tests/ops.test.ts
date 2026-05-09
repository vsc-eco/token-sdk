import { describe, expect, it } from 'vitest';
import {
	buildNftBatchTransfer,
	buildNftBurn,
	buildNftTransfer,
	buildTokenTransfer,
	isValidHiveUsername,
	normalizeHiveAccount,
	TokenAmount
} from '../src/index.js';

const CTX = {
	contractId: 'vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45',
	username: 'alice',
	network: 'vsc-mainnet' as const
};

describe('normalizeHiveAccount', () => {
	it('strips @, prefixes hive:', () => {
		expect(normalizeHiveAccount('alice')).toBe('hive:alice');
		expect(normalizeHiveAccount('@alice')).toBe('hive:alice');
		expect(normalizeHiveAccount('hive:alice')).toBe('hive:alice');
		expect(normalizeHiveAccount('  alice  ')).toBe('hive:alice');
	});
});

describe('isValidHiveUsername', () => {
	it('accepts valid usernames', () => {
		expect(isValidHiveUsername('alice')).toBe(true);
		expect(isValidHiveUsername('hive:alice')).toBe(true);
		expect(isValidHiveUsername('@alice.bob')).toBe(true);
		expect(isValidHiveUsername('a-medium-name1')).toBe(true);
	});
	it('rejects garbage', () => {
		expect(isValidHiveUsername('')).toBe(false);
		expect(isValidHiveUsername('Alice')).toBe(false); // uppercase
		expect(isValidHiveUsername('1alice')).toBe(false); // leading digit
		expect(isValidHiveUsername('a')).toBe(false); // too short
	});
});

describe('buildNftTransfer', () => {
	it('produces a vsc.call custom_json with the inner shape okinoko-terminal broadcasts', () => {
		const { op, call } = buildNftTransfer(CTX, {
			from: 'alice',
			to: 'bob',
			tokenId: 'card-001',
			amount: 1
		});
		expect(op[0]).toBe('custom_json');
		expect(op[1].id).toBe('vsc.call');
		expect(op[1].required_auths).toEqual(['alice']);
		expect(op[1].required_posting_auths).toEqual([]);
		const inner = JSON.parse(op[1].json);
		expect(inner.contract_id).toBe(CTX.contractId);
		expect(inner.action).toBe('safeTransferFrom');
		expect(inner.caller).toBe('hive:alice');
		expect(inner.net_id).toBe('vsc-mainnet');
		expect(inner.rc_limit).toBe(10000);
		const payload = JSON.parse(inner.payload);
		expect(payload).toEqual({
			from: 'hive:alice',
			to: 'hive:bob',
			id: 'card-001',
			amount: 1,
			data: ''
		});
		// `call` mirrors what aioha.vscCallContract takes:
		expect(call.contractId).toBe(CTX.contractId);
		expect(call.action).toBe('safeTransferFrom');
		expect(call.rcLimit).toBe(10000);
	});
});

describe('buildNftBatchTransfer', () => {
	it('aligns ids[] and amounts[]', () => {
		const { op } = buildNftBatchTransfer(CTX, {
			from: 'alice',
			to: 'bob',
			ids: ['card-001', 'card-002'],
			amounts: [1, 3]
		});
		const payload = JSON.parse(JSON.parse(op[1].json).payload);
		expect(payload.ids).toEqual(['card-001', 'card-002']);
		expect(payload.amounts).toEqual([1, 3]);
	});
	it('throws on length mismatch', () => {
		expect(() =>
			buildNftBatchTransfer(CTX, { from: 'a', to: 'b', ids: ['x'], amounts: [1, 2] })
		).toThrow();
	});
});

describe('buildNftBurn', () => {
	it('emits the burn action shape', () => {
		const { op } = buildNftBurn(CTX, { from: 'alice', tokenId: 'card-001', amount: 2 });
		const inner = JSON.parse(op[1].json);
		expect(inner.action).toBe('burn');
		const payload = JSON.parse(inner.payload);
		expect(payload).toEqual({ from: 'hive:alice', id: 'card-001', amount: 2 });
	});
});

describe('buildTokenTransfer', () => {
	it('emits an ERC-20 transfer with smallest-unit amount as a string', () => {
		const { op } = buildTokenTransfer(CTX, { to: 'bob', amount: '12345' });
		const inner = JSON.parse(op[1].json);
		expect(inner.action).toBe('transfer');
		const payload = JSON.parse(inner.payload);
		expect(payload).toEqual({ to: 'hive:bob', amount: '12345' });
	});
});

describe('TokenAmount', () => {
	it('converts decimal strings to smallest units at the given decimals', () => {
		expect(TokenAmount.fromDecimal('12.345', 3).raw).toBe(12345n);
		expect(TokenAmount.fromDecimal('0.001', 3).raw).toBe(1n);
		expect(TokenAmount.fromDecimal('100', 0).raw).toBe(100n);
		expect(TokenAmount.fromDecimal('', 3).raw).toBe(0n);
	});
	it('renders smallest units back to decimal', () => {
		expect(new TokenAmount(12345n, 3).toDecimalString()).toBe('12.345');
		expect(new TokenAmount(1n, 3).toDecimalString()).toBe('0.001');
		expect(new TokenAmount(0n, 3).toDecimalString()).toBe('0.000');
		expect(new TokenAmount(100n, 0).toDecimalString()).toBe('100');
	});
	it('trims trailing zeros for display', () => {
		expect(new TokenAmount(12300n, 3).toDecimalStringTrimmed()).toBe('12.3');
		expect(new TokenAmount(12000n, 3).toDecimalStringTrimmed()).toBe('12');
	});
});
