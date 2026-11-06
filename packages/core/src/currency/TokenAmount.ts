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

	/**
	 * Parse a human "12.345" string at the given decimals into smallest units.
	 *
	 * Strict, because this is the boundary where user input becomes a token
	 * amount (matches MarketAmount in @vsc.eco/market-core):
	 * - empty input, "-" and "." are rejected, not read as zero -- a blank
	 *   field is not an amount, and treating it as 0 hides the mistake;
	 * - negative amounts are rejected: every token amount on the wire is
	 *   unsigned;
	 * - more fractional digits than the token has are rejected rather than
	 *   silently truncated, which would drop value the caller did not mean to.
	 */
	static fromDecimal(value: string | number, decimals: number): TokenAmount {
		const s = String(value).trim();
		if (s === '' || s === '-' || s === '.' || s === '-.') {
			throw new Error(`TokenAmount.fromDecimal: an amount is required, got "${s}"`);
		}
		if (!/^-?\d*\.?\d*$/.test(s)) {
			throw new Error(`TokenAmount.fromDecimal: invalid number "${s}"`);
		}
		if (s.startsWith('-')) {
			throw new Error(`TokenAmount.fromDecimal: negative amounts are not supported, got "${s}"`);
		}
		const [intPart = '0', fracPart = ''] = s.split('.');
		if (fracPart.length > decimals) {
			throw new Error(
				`TokenAmount.fromDecimal: "${s}" has ${fracPart.length} fractional digits but the token only supports ${decimals} — round the value before passing it in`
			);
		}
		const fracPadded = fracPart + '0'.repeat(decimals - fracPart.length);
		const combined = `${intPart}${fracPadded}`.replace(/^0+(?=\d)/, '');
		return new TokenAmount(BigInt(combined === '' ? '0' : combined), decimals);
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
