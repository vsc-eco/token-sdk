/**
 * Whole-vs-smallest-unit conversion for ERC-20 style tokens. Mirrors
 * `CoinAmount` in @vsc.eco/crosschain-core but parameterised by `decimals`
 * since fungible tokens carry their own decimal count.
 */
export class TokenAmount {
	readonly raw: bigint;
	readonly decimals: number;

	constructor(raw: bigint | number | string, decimals: number) {
		if (decimals < 0 || !Number.isInteger(decimals)) {
			throw new Error(`TokenAmount: decimals must be a non-negative integer, got ${decimals}`);
		}
		this.raw = typeof raw === 'bigint' ? raw : BigInt(raw);
		this.decimals = decimals;
	}

	/** Parse a human "12.345" string at the given decimals into smallest units. */
	static fromDecimal(value: string | number, decimals: number): TokenAmount {
		const s = String(value).trim();
		if (s === '' || s === '-') return new TokenAmount(0n, decimals);
		if (!/^-?\d*\.?\d*$/.test(s)) {
			throw new Error(`TokenAmount.fromDecimal: invalid number "${s}"`);
		}
		const negative = s.startsWith('-');
		const abs = negative ? s.slice(1) : s;
		const [intPart = '0', fracPart = ''] = abs.split('.');
		const fracPadded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
		const combined = `${intPart}${fracPadded}`.replace(/^0+(?=\d)/, '');
		const raw = BigInt(combined === '' ? '0' : combined);
		return new TokenAmount(negative ? -raw : raw, decimals);
	}

	/** Render as a decimal string. Trailing zeros are kept (no implicit trim). */
	toDecimalString(): string {
		const negative = this.raw < 0n;
		const abs = negative ? -this.raw : this.raw;
		if (this.decimals === 0) return (negative ? '-' : '') + abs.toString();
		const s = abs.toString().padStart(this.decimals + 1, '0');
		const intPart = s.slice(0, -this.decimals);
		const fracPart = s.slice(-this.decimals);
		return (negative ? '-' : '') + `${intPart}.${fracPart}`;
	}

	/** Trim trailing zeros from the decimal portion for display. */
	toDecimalStringTrimmed(): string {
		return this.toDecimalString().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
	}
}
