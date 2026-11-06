import { describe, expect, it } from 'vitest';
import { TokenAmount } from './TokenAmount';

describe('TokenAmount.fromDecimal', () => {
	it('parses whole and fractional amounts into smallest units', () => {
		expect(TokenAmount.fromDecimal('12.345', 3).raw).toBe(12345n);
		expect(TokenAmount.fromDecimal('1', 8).raw).toBe(100000000n);
		expect(TokenAmount.fromDecimal('0.5', 2).raw).toBe(50n);
		expect(TokenAmount.fromDecimal('.5', 2).raw).toBe(50n);
		expect(TokenAmount.fromDecimal('7.', 2).raw).toBe(700n);
		expect(TokenAmount.fromDecimal(' 3 ', 0).raw).toBe(3n);
		expect(TokenAmount.fromDecimal(2.25, 2).raw).toBe(225n);
		expect(TokenAmount.fromDecimal('0', 3).raw).toBe(0n);
	});

	it('rejects empty input instead of reading it as zero', () => {
		for (const v of ['', '   ', '-', '.', '-.']) {
			expect(() => TokenAmount.fromDecimal(v, 3)).toThrow(/amount is required/);
		}
	});

	it('rejects negative amounts', () => {
		expect(() => TokenAmount.fromDecimal('-1', 3)).toThrow(/negative/);
		expect(() => TokenAmount.fromDecimal('-0.5', 3)).toThrow(/negative/);
		expect(() => TokenAmount.fromDecimal(-2, 3)).toThrow(/negative/);
	});

	it('rejects more fractional digits than the token has, instead of truncating', () => {
		expect(() => TokenAmount.fromDecimal('1.2345', 3)).toThrow(/fractional digits/);
		expect(() => TokenAmount.fromDecimal('1.5', 0)).toThrow(/fractional digits/);
	});

	it('rejects garbage', () => {
		for (const v of ['abc', '1.2.3', '1e5', '0x10', '1,5', '--1']) {
			expect(() => TokenAmount.fromDecimal(v, 3)).toThrow();
		}
	});

	it('round-trips through toDecimalString', () => {
		expect(TokenAmount.fromDecimal('12.340', 3).toDecimalString()).toBe('12.340');
		expect(TokenAmount.fromDecimal('12.340', 3).toDecimalStringTrimmed()).toBe('12.34');
	});
});
