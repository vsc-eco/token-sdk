import { useMemo, useState } from 'react';
import type { NftItem } from '@vsc.eco/token-core';
import type { NftClient } from '@vsc.eco/token-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';

export interface NftBurnFormProps {
	client: NftClient;
	username: string;
	item: NftItem;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

export function NftBurnForm({ client, username, item, onSuccess, onClose }: NftBurnFormProps) {
	const [amountStr, setAmountStr] = useState('1');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const parsed = useMemo(() => {
		if (item.isUnique) return 1;
		const n = parseInt(amountStr, 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}, [amountStr, item.isUnique]);

	const validation = useMemo(() => {
		if (item.isUnique) return { ok: true, err: null as string | null };
		if (parsed === null) return { ok: false, err: amountStr ? 'Amount must be > 0' : null };
		if (parsed > item.balance) return { ok: false, err: `Amount exceeds balance (${item.balance})` };
		return { ok: true, err: null as string | null };
	}, [parsed, amountStr, item]);

	async function handleSubmit() {
		if (!validation.ok || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const res = await client.nft.burn(item.contractId, username, {
				from: username,
				tokenId: item.tokenId,
				amount: item.isUnique ? 1 : (parsed as number)
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
			title="Burn NFT"
			subtitle={`${item.collection.symbol || '???'} #${item.tokenId}${
				item.isUnique ? ' - Unique' : ` - Balance: ${item.balance}`
			}`}
			onClose={onClose}
		>
			{!item.isUnique && (
				<Field
					label="Amount to burn"
					hint={`Burning is permanent. Max ${item.balance}.`}
				>
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
					className="magi-nft-submit danger"
					disabled={!validation.ok || submitting}
					onClick={handleSubmit}
				>
					{submitting ? 'Burning…' : 'Burn NFT'}
				</button>
			)}
		</Modal>
	);
}
