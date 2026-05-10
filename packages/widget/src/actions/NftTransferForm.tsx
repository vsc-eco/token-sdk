import { useMemo, useState } from 'react';
import { isValidHiveUsername, normalizeHiveAccount, type NftItem } from '@vsc.eco/nft-core';
import type { NftClient } from '@vsc.eco/nft-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';

export interface NftTransferFormProps {
	client: NftClient;
	username: string;
	item: NftItem;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/** Single-NFT transfer form. Mirrors okinoko-terminal's NftSendPopup. */
export function NftTransferForm({
	client,
	username,
	item,
	onSuccess,
	onClose
}: NftTransferFormProps) {
	const [to, setTo] = useState('hive:');
	const [amountStr, setAmountStr] = useState('1');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const parsedAmount = useMemo(() => {
		if (item.isUnique) return 1;
		const n = parseInt(amountStr, 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}, [amountStr, item.isUnique]);

	const validation = useMemo(() => {
		if (!isValidHiveUsername(to)) return { ok: false, err: to.replace(/^hive:/, '').length === 0 ? null : 'Invalid Hive username' };
		if (!item.isUnique) {
			if (parsedAmount === null) return { ok: false, err: amountStr ? 'Amount must be > 0' : null };
			if (parsedAmount > item.balance)
				return { ok: false, err: `Amount exceeds balance (${item.balance})` };
		}
		return { ok: true, err: null as string | null };
	}, [to, parsedAmount, amountStr, item]);

	async function handleSubmit() {
		if (!validation.ok || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const res = await client.nft.transfer(item.contractId, username, {
				from: username,
				to,
				tokenId: item.tokenId,
				amount: item.isUnique ? 1 : (parsedAmount as number)
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
			title="Transfer NFT"
			subtitle={`${item.collection.symbol || '???'} #${item.tokenId}${
				item.isUnique ? ' - Unique' : ` - Balance: ${item.balance}`
			}`}
			onClose={onClose}
		>
			<Field label="Recipient" hint="The Hive username to receive the NFT.">
				<TextInput
					value={to}
					onChange={(v) => setTo(normalizeHiveAccount(v))}
					placeholder="hive:username"
					disabled={submitting}
				/>
			</Field>

			{!item.isUnique && (
				<Field label="Amount" hint={`Number of tokens to send (max ${item.balance}).`}>
					<TextInput
						type="number"
						min={1}
						max={item.balance}
						value={amountStr}
						onChange={setAmountStr}
						disabled={submitting}
						inputMode="numeric"
					/>
				</Field>
			)}

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
					{submitting ? 'Sending…' : 'Send NFT'}
				</button>
			)}
		</Modal>
	);
}
