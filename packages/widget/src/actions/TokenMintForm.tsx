import { useMemo, useState } from 'react';
import { TokenAmount, type TokenInfo } from '@vsc.eco/nft-core';
import type { NftClient } from '@vsc.eco/nft-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';

export interface TokenMintFormProps {
	client: NftClient;
	username: string;
	info: TokenInfo;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Owner-only "issue tokens" form. The contract's `mint(amount)` call adds
 * the supplied amount of smallest units to the owner's balance. Surfaced
 * from the token row when the connected user is the contract owner.
 *
 * The user types a human decimal (e.g. "12.345"); this form converts to
 * the smallest-unit string the contract expects.
 */
export function TokenMintForm({
	client,
	username,
	info,
	onSuccess,
	onClose
}: TokenMintFormProps) {
	const [amountStr, setAmountStr] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const parsedRaw = useMemo(() => {
		if (!amountStr) return null;
		try {
			const a = TokenAmount.fromDecimal(amountStr, info.decimals);
			return a.raw <= 0n ? null : a.raw;
		} catch {
			return null;
		}
	}, [amountStr, info.decimals]);

	const validation = useMemo(() => {
		if (parsedRaw === null) return { ok: false, err: amountStr ? 'Amount must be > 0' : null };
		// Respect maxSupply if the contract sets one; this is a UX guard
		// only - the contract enforces the same rule on broadcast.
		if (info.maxSupply !== undefined) {
			const after = (info.totalSupply ?? 0n) + parsedRaw;
			if (after > info.maxSupply)
				return {
					ok: false,
					err: `Mint would exceed max supply (${formatBig(info.maxSupply)} ${info.symbol})`
				};
		}
		return { ok: true, err: null as string | null };
	}, [parsedRaw, amountStr, info]);

	async function handleSubmit() {
		if (!validation.ok || submitting || parsedRaw === null) return;
		setSubmitting(true);
		setError(null);
		try {
			const bundle = client.token.mintOp(info.contractId, username, {
				amount: parsedRaw.toString()
			});
			const res = await client.broadcast(bundle);
			setTxId(res.txId);
			onSuccess?.(res.txId);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	const supplyLine = `Current supply: ${formatTokenAmount(info.totalSupply ?? 0n, info.decimals)} ${info.symbol}`;
	const capLine =
		info.maxSupply !== undefined
			? ` · Cap: ${formatTokenAmount(info.maxSupply, info.decimals)} ${info.symbol}`
			: '';

	return (
		<Modal
			title={`Issue ${info.symbol}`}
			subtitle={`${supplyLine}${capLine}`}
			onClose={onClose}
		>
			<Field
				label={`Amount to mint (${info.symbol})`}
				hint="Added to the owner's balance. Decimals match the token's settings."
			>
				<TextInput
					inputMode="decimal"
					value={amountStr}
					onChange={setAmountStr}
					placeholder="0"
					disabled={submitting}
				/>
			</Field>

			{(error || validation.err) && (
				<p className="magi-nft-status error">{error ?? validation.err}</p>
			)}

			{txId ? (
				<>
					<BroadcastResult txId={txId} />
					<button type="button" className="magi-nft-submit ghost" onClick={onClose}>
						Done
					</button>
				</>
			) : (
				<button
					type="button"
					className="magi-nft-submit"
					disabled={!validation.ok || submitting}
					onClick={handleSubmit}
				>
					{submitting ? 'Minting…' : `Mint ${info.symbol}`}
				</button>
			)}
		</Modal>
	);
}

function formatBig(v: bigint): string {
	return v.toString();
}
function formatTokenAmount(raw: bigint, decimals: number): string {
	return new TokenAmount(raw, decimals).toDecimalStringTrimmed();
}
