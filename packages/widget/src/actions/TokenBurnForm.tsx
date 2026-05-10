import { useMemo, useState } from 'react';
import { TokenAmount, type TokenInfo } from '@vsc.eco/nft-core';
import type { NftClient } from '@vsc.eco/token-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';

export interface TokenBurnFormProps {
	client: NftClient;
	username: string;
	info: TokenInfo;
	balance: bigint;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

export function TokenBurnForm({
	client,
	username,
	info,
	balance,
	onSuccess,
	onClose
}: TokenBurnFormProps) {
	const balanceAmt = new TokenAmount(balance, info.decimals);
	const balanceDisplay = balanceAmt.toDecimalStringTrimmed();

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
		if (parsedRaw > balance)
			return { ok: false, err: `Amount exceeds balance (${balanceDisplay} ${info.symbol})` };
		return { ok: true, err: null as string | null };
	}, [parsedRaw, amountStr, balance, balanceDisplay, info.symbol]);

	async function handleSubmit() {
		if (!validation.ok || submitting || parsedRaw === null) return;
		setSubmitting(true);
		setError(null);
		try {
			const res = await client.token.burn(info.contractId, username, {
				amount: parsedRaw.toString()
			});
			setTxId(res.txId);
			onSuccess?.(res.txId);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Modal
			title={`Burn ${info.symbol}`}
			subtitle={`Balance: ${balanceDisplay} ${info.symbol}. Burning is permanent.`}
			onClose={onClose}
		>
			<Field label="Amount to burn">
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
					className="magi-nft-submit danger"
					disabled={!validation.ok || submitting}
					onClick={handleSubmit}
				>
					{submitting ? 'Burning…' : `Burn ${info.symbol}`}
				</button>
			)}
		</Modal>
	);
}
