import { useMemo, useState } from 'react';
import { isValidHiveUsername, normalizeHiveAccount, type NftItem } from '@vsc.eco/token-core';
import type { NftClient, NftOpBundle } from '@vsc.eco/token-sdk';
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

type Mode = 'single' | 'distribute';

/**
 * Recipients per signed chunk + delay between chunks. Same constants
 * as the token + batch-NFT distribute paths - 4 ops per chunk leaves
 * headroom under Hive's per-block custom_json cap; 4s waits a Hive
 * block + buffer between chunks so consecutive signatures land in
 * different blocks.
 */
const CHUNK_SIZE = 4;
const CHUNK_DELAY_MS = 4000;

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
 * Single-NFT transfer form with two modes via a tab strip:
 *
 *   - "Send to one":   the original behaviour. One recipient, optional
 *     amount for editioned tokens. One signature.
 *   - "Distribute":    paste a recipient list, send 1 copy per
 *     recipient. Only available for editioned tokens (balance > 1) -
 *     a unique token with no copies left to distribute hides the tab.
 *     Each recipient becomes a separate safeTransferFrom op,
 *     chunk-bundled + inter-block-delayed via client.broadcastBatch
 *     the same way the token + batch-NFT distribute paths are.
 *
 * Mirrors okinoko-terminal's NftSendPopup for the single-recipient
 * tab; the distribute tab is the editioned-NFT analogue of the token
 * panel's distribute affordance.
 */
export function NftTransferForm({
	client,
	username,
	item,
	onSuccess,
	onClose
}: NftTransferFormProps) {
	// Editioned tokens (balance >= 2) can usefully distribute. Unique
	// tokens can't (only one copy, only one recipient possible) so we
	// hide the tab strip entirely for them rather than render a
	// confusing always-disabled "Distribute" button.
	const canDistribute = !item.isUnique && item.balance >= 2;

	const [mode, setMode] = useState<Mode>('single');
	const [to, setTo] = useState('hive:');
	const [amountStr, setAmountStr] = useState('1');
	const [recipientsText, setRecipientsText] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [txIds, setTxIds] = useState<string[]>([]);
	const [progress, setProgress] = useState<
		| { phase: 'signing'; done: number; total: number }
		| { phase: 'waiting'; nextChunk: number; total: number; remainingMs: number }
		| null
	>(null);
	const [error, setError] = useState<string | null>(null);

	const parsedAmount = useMemo(() => {
		if (item.isUnique) return 1;
		const n = parseInt(amountStr, 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}, [amountStr, item.isUnique]);

	const recipients = useMemo(
		() => (mode === 'distribute' ? parseRecipients(recipientsText) : []),
		[mode, recipientsText]
	);

	const validation = useMemo(() => {
		if (mode === 'single') {
			if (!isValidHiveUsername(to))
				return {
					ok: false,
					err: to.replace(/^hive:/, '').length === 0 ? null : 'Invalid Hive username'
				};
			if (!item.isUnique) {
				if (parsedAmount === null)
					return { ok: false, err: amountStr ? 'Amount must be > 0' : null };
				if (parsedAmount > item.balance)
					return { ok: false, err: `Amount exceeds balance (${item.balance})` };
			}
			return { ok: true, err: null as string | null };
		}
		// distribute - unique tokens shouldn't reach here (UI hides the tab)
		// but guard defensively in case canDistribute drifts.
		if (item.isUnique || item.balance < 2)
			return { ok: false, err: 'This token has no copies to distribute.' };
		if (recipients.length === 0)
			return { ok: false, err: 'Add at least one recipient.' };
		const invalid = recipients.filter((r) => !isValidHiveUsername(r));
		if (invalid.length)
			return {
				ok: false,
				err: `Invalid username${invalid.length === 1 ? '' : 's'}: ${invalid.join(', ')}`
			};
		if (recipients.length > item.balance) {
			return {
				ok: false,
				err: `Recipient count (${recipients.length}) exceeds your balance (${item.balance}).`
			};
		}
		return { ok: true, err: null as string | null };
	}, [mode, to, parsedAmount, amountStr, recipients, item]);

	async function handleSingle() {
		const res = await client.nft.transfer(item.contractId, username, {
			from: username,
			to,
			tokenId: item.tokenId,
			amount: item.isUnique ? 1 : (parsedAmount as number)
		});
		setTxIds([res.txId]);
		onSuccess?.(res.txId);
	}

	async function handleDistribute() {
		// One safeTransferFrom op per recipient, each sending exactly
		// one copy of this token id. Chunk + inter-block-delay handled
		// inside client.broadcastBatch.
		const bundles: NftOpBundle[] = recipients.map((to) =>
			client.nft.transferOp(item.contractId, username, {
				from: username,
				to,
				tokenId: item.tokenId,
				amount: 1
			})
		);
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
			if (mode === 'single') await handleSingle();
			else await handleDistribute();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
			setProgress(null);
		}
	}

	const distributeChunks =
		recipients.length > 0 ? Math.ceil(recipients.length / CHUNK_SIZE) : 0;

	const submitLabel = (() => {
		if (submitting) {
			if (progress?.phase === 'signing') {
				return `Signing batch ${progress.done}/${progress.total}…`;
			}
			if (progress?.phase === 'waiting') {
				const secs = Math.max(1, Math.ceil(progress.remainingMs / 1000));
				return `Waiting for next block (${secs}s) before batch ${progress.nextChunk}/${progress.total}…`;
			}
			return mode === 'distribute' ? 'Distributing…' : 'Sending…';
		}
		if (mode === 'distribute') {
			return `Distribute to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`;
		}
		return 'Send NFT';
	})();

	return (
		<Modal
			title={mode === 'distribute' ? 'Distribute editions' : 'Transfer NFT'}
			subtitle={`${item.collection.symbol || '???'} #${item.tokenId}${
				item.isUnique ? ' - Unique' : ` - Balance: ${item.balance}`
			}`}
			onClose={onClose}
		>
			{canDistribute && (
				<div className="magi-nft-tabs" style={{ marginBottom: '0.4rem' }}>
					<button
						type="button"
						className={`magi-nft-tab ${mode === 'single' ? 'active' : ''}`}
						onClick={() => setMode('single')}
						disabled={submitting}
					>
						Send to one
					</button>
					<button
						type="button"
						className={`magi-nft-tab ${mode === 'distribute' ? 'active' : ''}`}
						onClick={() => setMode('distribute')}
						disabled={submitting}
					>
						Distribute (1 each)
					</button>
				</div>
			)}

			{mode === 'single' ? (
				<>
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
				</>
			) : (
				<Field
					label="Recipients"
					hint={`Space- / comma- / newline-separated. Each recipient gets 1 copy. Max ${item.balance} (your balance). \`tibfox\`, \`@tibfox\`, \`hive:tibfox\` all work.`}
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

			{mode === 'distribute' && recipients.length > 0 && (
				<p
					style={{
						fontSize: '0.7rem',
						color: 'var(--magi-text-muted)',
						margin: '0.1rem 0'
					}}
				>
					{distributeChunks === 1
						? `Will sign 1 transaction with ${recipients.length} transfer${recipients.length === 1 ? '' : 's'}.`
						: `Will sign ${distributeChunks} transactions (${CHUNK_SIZE} transfers each, last one ${
								recipients.length % CHUNK_SIZE || CHUNK_SIZE
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
