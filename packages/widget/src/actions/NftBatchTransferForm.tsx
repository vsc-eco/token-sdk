import { useMemo, useState } from 'react';
import { isValidHiveUsername, normalizeHiveAccount, type NftItem } from '@vsc.eco/nft-core';
import type { NftClient } from '@vsc.eco/nft-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';

export interface NftBatchTransferFormProps {
	client: NftClient;
	username: string;
	contractId: string;
	collectionSymbol?: string;
	items: NftItem[];
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

interface SelectedRow {
	tokenId: string;
	balance: number;
	isUnique: boolean;
	checked: boolean;
	amount: string;
}

/**
 * Multi-NFT transfer to a single recipient. Mirrors okinoko-terminal's
 * "same-recipient" mode of NftBatchTransferPopup. We intentionally don't
 * port the per-row recipient mode here - keep the demo widget tight; an
 * integrator who wants per-recipient flows can call `client.nft.transfer`
 * in a loop.
 */
export function NftBatchTransferForm({
	client,
	username,
	contractId,
	collectionSymbol,
	items,
	onSuccess,
	onClose
}: NftBatchTransferFormProps) {
	const [to, setTo] = useState('hive:');
	const [rows, setRows] = useState<SelectedRow[]>(() =>
		items.map((it) => ({
			tokenId: it.tokenId,
			balance: it.balance,
			isUnique: it.isUnique,
			checked: false,
			amount: ''
		}))
	);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	function toggle(idx: number) {
		setRows((prev) => {
			const next = [...prev];
			const wasChecked = next[idx].checked;
			next[idx] = {
				...next[idx],
				checked: !wasChecked,
				amount: !wasChecked ? '1' : ''
			};
			return next;
		});
	}
	function setAmount(idx: number, val: string) {
		setRows((prev) => {
			const next = [...prev];
			next[idx] = { ...next[idx], amount: val };
			return next;
		});
	}

	const checked = rows.filter((r) => r.checked);

	const validation = useMemo(() => {
		if (!checked.length) return { ok: false, err: null as string | null };
		if (!isValidHiveUsername(to))
			return { ok: false, err: to.replace(/^hive:/, '').length === 0 ? null : 'Invalid Hive username' };
		for (const r of checked) {
			const n = parseInt(r.amount, 10);
			if (!Number.isFinite(n) || n <= 0)
				return { ok: false, err: `Invalid amount for ${r.tokenId}` };
			if (n > r.balance) return { ok: false, err: `Amount exceeds balance for ${r.tokenId}` };
		}
		return { ok: true, err: null as string | null };
	}, [to, checked]);

	async function handleSubmit() {
		if (!validation.ok || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const ids = checked.map((r) => r.tokenId);
			const amounts = checked.map((r) => parseInt(r.amount, 10));
			const res = await client.nft.batchTransfer(contractId, username, {
				from: username,
				to,
				ids,
				amounts
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
			title="Batch transfer"
			subtitle={`${collectionSymbol ?? '???'} - pick tokens to transfer`}
			onClose={onClose}
		>
			<Field label="Recipient" hint="All selected tokens go to this Hive account.">
				<TextInput
					value={to}
					onChange={(v) => setTo(normalizeHiveAccount(v))}
					placeholder="hive:username"
					disabled={submitting}
				/>
			</Field>

			<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '40vh', overflowY: 'auto' }}>
				{rows.map((r, idx) => (
					<label key={r.tokenId} className={`magi-nft-batch-row ${r.checked ? 'checked' : ''}`}>
						<input type="checkbox" checked={r.checked} onChange={() => toggle(idx)} />
						<span className="magi-nft-batch-row-id">{r.tokenId}</span>
						{!r.isUnique && (
							<span className="magi-nft-batch-row-balance">bal: {r.balance}</span>
						)}
						{r.checked && !r.isUnique && (
							<input
								type="number"
								min={1}
								max={r.balance}
								value={r.amount}
								onChange={(e) => setAmount(idx, (e.target as HTMLInputElement).value)}
								onClick={(e) => e.stopPropagation()}
							/>
						)}
					</label>
				))}
				{!rows.length && (
					<div className="magi-nft-state">No tokens in this collection.</div>
				)}
			</div>

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
					{submitting
						? 'Transferring…'
						: `Transfer ${checked.length} token${checked.length !== 1 ? 's' : ''}`}
				</button>
			)}
		</Modal>
	);
}
