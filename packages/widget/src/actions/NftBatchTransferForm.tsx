import { useMemo, useState } from 'react';
import { isValidHiveUsername, normalizeHiveAccount, type NftItem } from '@vsc.eco/nft-core';
import type { NftClient, NftOpBundle } from '@vsc.eco/nft-sdk';
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

type Mode = 'same' | 'distribute';

/**
 * Recipients per signed chunk + delay between chunks. Same constants
 * as the token distribute path - Hive caps an account at ~5
 * custom_json ops per produced block, so 4 leaves headroom for any
 * unrelated custom_json the user might fire from a parallel tab; 4s
 * waits for one block + buffer between chunks.
 */
const CHUNK_SIZE = 4;
const CHUNK_DELAY_MS = 4000;

/** Parse the recipients textarea, normalising and de-duplicating. */
function parseRecipients(raw: string): string[] {
	if (!raw.trim()) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(/[\s,;]+/).filter(Boolean)) {
		const norm = normalizeHiveAccount(part);
		if (seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out;
}

/**
 * Multi-NFT transfer with two modes via a tab strip:
 *
 *   - "Same recipient": pick tokens + amounts, every selected unit
 *     lands on one Hive account. Uses safeBatchTransferFrom (one op,
 *     one signature).
 *   - "Distribute":      pick tokens + amounts, paste a list of
 *     recipients, the form pairs each token-unit with one recipient
 *     in order. Each pairing becomes a separate safeTransferFrom op.
 *     Chunked + inter-block-delayed via client.broadcastBatch the
 *     same way the token distribute path is, so the user signs
 *     ceil(N/4) times and we never overrun Hive's per-block cap.
 *
 * For an editioned token with balance > 1, the "amount" field is
 * how many copies to *distribute* - one copy per recipient. Thus
 * if you have 10 copies of card-X and check it with amount=3, three
 * recipients each get 1 copy.
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
	const [mode, setMode] = useState<Mode>('same');
	const [to, setTo] = useState('hive:');
	const [recipientsText, setRecipientsText] = useState('');
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
	const [txIds, setTxIds] = useState<string[]>([]);
	const [progress, setProgress] = useState<
		| { phase: 'signing'; done: number; total: number }
		| { phase: 'waiting'; nextChunk: number; total: number; remainingMs: number }
		| null
	>(null);
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
	const totalUnits = useMemo(
		() =>
			checked.reduce((sum, r) => {
				const n = parseInt(r.amount, 10);
				return sum + (Number.isFinite(n) && n > 0 ? n : 0);
			}, 0),
		[checked]
	);
	const recipients = useMemo(
		() => (mode === 'distribute' ? parseRecipients(recipientsText) : []),
		[mode, recipientsText]
	);

	const validation = useMemo(() => {
		if (!checked.length) return { ok: false, err: null as string | null };
		// Per-row amount + balance checks apply to both modes.
		for (const r of checked) {
			const n = parseInt(r.amount, 10);
			if (!Number.isFinite(n) || n <= 0)
				return { ok: false, err: `Invalid amount for ${r.tokenId}` };
			if (n > r.balance) return { ok: false, err: `Amount exceeds balance for ${r.tokenId}` };
		}
		if (mode === 'same') {
			if (!isValidHiveUsername(to))
				return {
					ok: false,
					err: to.replace(/^hive:/, '').length === 0 ? null : 'Invalid Hive username'
				};
			return { ok: true, err: null as string | null };
		}
		// distribute
		if (recipients.length === 0)
			return { ok: false, err: 'Add at least one recipient.' };
		const invalid = recipients.filter((r) => !isValidHiveUsername(r));
		if (invalid.length)
			return {
				ok: false,
				err: `Invalid username${invalid.length === 1 ? '' : 's'}: ${invalid.join(', ')}`
			};
		if (recipients.length !== totalUnits) {
			return {
				ok: false,
				err: `Recipient count (${recipients.length}) must equal total NFT units (${totalUnits}).`
			};
		}
		return { ok: true, err: null as string | null };
	}, [mode, to, checked, recipients, totalUnits]);

	async function handleSame() {
		const ids = checked.map((r) => r.tokenId);
		const amounts = checked.map((r) => parseInt(r.amount, 10));
		const res = await client.nft.batchTransfer(contractId, username, {
			from: username,
			to,
			ids,
			amounts
		});
		setTxIds([res.txId]);
		onSuccess?.(res.txId);
	}

	async function handleDistribute() {
		// Walk checked rows in order, expanding each row's amount into
		// `amount` separate (tokenId, recipient) pairs. The recipients
		// list is consumed in order, so the assignment is predictable
		// and visible in the on-chain ops if anyone wants to inspect.
		const bundles: NftOpBundle[] = [];
		let recipientIdx = 0;
		for (const r of checked) {
			const amount = parseInt(r.amount, 10);
			for (let i = 0; i < amount; i++) {
				const recipient = recipients[recipientIdx++];
				bundles.push(
					client.nft.transferOp(contractId, username, {
						from: username,
						to: recipient,
						tokenId: r.tokenId,
						amount: 1
					})
				);
			}
		}
		const totalChunks = Math.ceil(bundles.length / CHUNK_SIZE);
		setProgress({ phase: 'signing', done: 0, total: totalChunks });
		const res = await client.broadcastBatch(bundles, {
			chunkSize: CHUNK_SIZE,
			delayBetweenChunksMs: CHUNK_DELAY_MS,
			onProgress: (i) =>
				setProgress({ phase: 'signing', done: i + 1, total: totalChunks }),
			onWaiting: (next, total, remainingMs) =>
				setProgress({
					phase: 'waiting',
					nextChunk: next + 1,
					total,
					remainingMs
				})
		});
		setTxIds(res.txIds);
		setProgress(null);
		for (const id of res.txIds) onSuccess?.(id);
	}

	async function handleSubmit() {
		if (!validation.ok || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			if (mode === 'same') await handleSame();
			else await handleDistribute();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
			setProgress(null);
		}
	}

	const distributeChunks = totalUnits > 0 ? Math.ceil(totalUnits / CHUNK_SIZE) : 0;

	const submitLabel = (() => {
		if (submitting) {
			if (progress?.phase === 'signing') {
				return `Signing batch ${progress.done}/${progress.total}…`;
			}
			if (progress?.phase === 'waiting') {
				const secs = Math.max(1, Math.ceil(progress.remainingMs / 1000));
				return `Waiting for next block (${secs}s) before batch ${progress.nextChunk}/${progress.total}…`;
			}
			return 'Transferring…';
		}
		if (mode === 'distribute') {
			return `Distribute to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`;
		}
		return `Transfer ${checked.length} token${checked.length !== 1 ? 's' : ''}`;
	})();

	return (
		<Modal
			title="Batch transfer"
			subtitle={`${collectionSymbol ?? '???'} - pick tokens to transfer`}
			onClose={onClose}
		>
			<div className="magi-nft-tabs" style={{ marginBottom: '0.4rem' }}>
				<button
					type="button"
					className={`magi-nft-tab ${mode === 'same' ? 'active' : ''}`}
					onClick={() => setMode('same')}
					disabled={submitting}
				>
					Same recipient
				</button>
				<button
					type="button"
					className={`magi-nft-tab ${mode === 'distribute' ? 'active' : ''}`}
					onClick={() => setMode('distribute')}
					disabled={submitting}
				>
					Distribute (1 per recipient)
				</button>
			</div>

			{mode === 'same' ? (
				<Field label="Recipient" hint="All selected tokens go to this Hive account.">
					<TextInput
						value={to}
						onChange={(v) => setTo(normalizeHiveAccount(v))}
						placeholder="hive:username"
						disabled={submitting}
					/>
				</Field>
			) : (
				<Field
					label="Recipients"
					hint={`Space- / comma- / newline-separated. Total recipients must equal total selected NFT units (${totalUnits}). \`tibfox\`, \`@tibfox\`, \`hive:tibfox\` all work.`}
				>
					<div className="magi-nft-input-wrap">
						<textarea
							value={recipientsText}
							onChange={(e) =>
								setRecipientsText((e.target as HTMLTextAreaElement).value)
							}
							placeholder="@alice bob hive:carol"
							disabled={submitting}
							rows={3}
							style={{
								flex: 1,
								background: 'transparent',
								border: 0,
								outline: 'none',
								resize: 'vertical',
								color: 'inherit',
								font: 'inherit',
								fontSize: '0.85rem',
								minHeight: '60px'
							}}
						/>
					</div>
				</Field>
			)}

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: '0.3rem',
					maxHeight: '40vh',
					overflowY: 'auto'
				}}
			>
				{rows.map((r, idx) => (
					<label
						key={r.tokenId}
						className={`magi-nft-batch-row ${r.checked ? 'checked' : ''}`}
					>
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

			{mode === 'distribute' && totalUnits > 0 && recipients.length > 0 && (
				<p
					style={{
						fontSize: '0.7rem',
						color: 'var(--magi-text-muted)',
						margin: '0.1rem 0'
					}}
				>
					{distributeChunks === 1
						? `Will sign 1 transaction with ${totalUnits} transfer${totalUnits === 1 ? '' : 's'}.`
						: `Will sign ${distributeChunks} transactions (${CHUNK_SIZE} transfers each, last one ${
								totalUnits % CHUNK_SIZE || CHUNK_SIZE
							}). Pauses ~${Math.round(CHUNK_DELAY_MS / 1000)}s between batches so each lands in a fresh Hive block - total ~${
								Math.round(((distributeChunks - 1) * CHUNK_DELAY_MS) / 1000)
							}s of waits plus one signature each.`}
				</p>
			)}

			{(error || validation.err) && (
				<p className="magi-nft-status error">{error ?? validation.err}</p>
			)}

			{txIds.length > 0 ? (
				<>
					{txIds.map((id) => (
						<BroadcastResult key={id} txId={id} />
					))}
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
					{submitLabel}
				</button>
			)}
		</Modal>
	);
}
