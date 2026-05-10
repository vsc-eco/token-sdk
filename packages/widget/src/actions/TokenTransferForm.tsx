import { useMemo, useState } from 'react';
import {
	TokenAmount,
	isValidHiveUsername,
	normalizeHiveAccount,
	type TokenInfo
} from '@vsc.eco/nft-core';
import type { NftClient } from '@vsc.eco/nft-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';

export interface TokenTransferFormProps {
	client: NftClient;
	username: string;
	info: TokenInfo;
	balance: bigint;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

export function TokenTransferForm({
	client,
	username,
	info,
	balance,
	onSuccess,
	onClose
}: TokenTransferFormProps) {
	const balanceAmt = new TokenAmount(balance, info.decimals);
	const balanceDisplay = balanceAmt.toDecimalStringTrimmed();

	const [to, setTo] = useState('hive:');
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
		if (!isValidHiveUsername(to))
			return { ok: false, err: to.replace(/^hive:/, '').length === 0 ? null : 'Invalid Hive username' };
		if (parsedRaw === null)
			return { ok: false, err: amountStr ? 'Amount must be > 0' : null };
		if (parsedRaw > balance)
			return { ok: false, err: `Amount exceeds balance (${balanceDisplay} ${info.symbol})` };
		return { ok: true, err: null as string | null };
	}, [to, parsedRaw, amountStr, balance, balanceDisplay, info.symbol]);

	async function handleSubmit() {
		if (!validation.ok || submitting || parsedRaw === null) return;
		setSubmitting(true);
		setError(null);
		try {
			const res = await client.token.transfer(info.contractId, username, {
				to,
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
			title={`Send ${info.symbol}`}
			subtitle={`${info.name} - Balance: ${balanceDisplay} ${info.symbol}`}
			onClose={onClose}
		>
			<Field label="Recipient" hint="The Hive username to receive tokens.">
				<TextInput
					value={to}
					onChange={(v) => setTo(normalizeHiveAccount(v))}
					placeholder="hive:username"
					disabled={submitting}
				/>
			</Field>
			<Field label="Amount" hint={`Max ${balanceDisplay} ${info.symbol}`}>
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
					{submitting ? 'Sending…' : `Send ${info.symbol}`}
				</button>
			)}
		</Modal>
	);
}
