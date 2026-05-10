import { useMemo, useState } from 'react';
import {
	TokenAmount,
	isValidHiveUsername,
	normalizeHiveAccount,
	type TokenInfo
} from '@vsc.eco/nft-core';
import type { NftClient, TokenOpBundle } from '@vsc.eco/token-sdk';
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

type Mode = 'single' | 'distribute';

/**
 * Recipients per signed chunk. Hive caps an account at ~5 custom_json
 * ops per block, so 4 leaves headroom for any unrelated custom_json
 * fired in parallel (e.g. another tab, a vote, a reblog) without
 * tripping the limit. Matches the SDK's broadcastBatch default.
 */
const CHUNK_SIZE = 4;
/** Seconds we wait between chunks so each lands in a fresh block. */
const CHUNK_DELAY_MS = 4000;

/**
 * Parse a free-form recipient list (any of `tibfox`, `@tibfox`,
 * `hive:tibfox`, comma- newline- or space-delimited) into a normalised
 * `hive:bare` username list with duplicates removed.
 */
function parseRecipients(raw: string): string[] {
	if (!raw.trim()) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	// Accept any whitespace, comma, or semicolon as separators - paste-
	// friendly so users don't need to massage the input.
	for (const part of raw.split(/[\s,;]+/).filter(Boolean)) {
		const norm = normalizeHiveAccount(part);
		if (seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out;
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

	const [mode, setMode] = useState<Mode>('single');
	const [to, setTo] = useState('hive:');
	const [recipientsText, setRecipientsText] = useState('');
	const [amountStr, setAmountStr] = useState('');
	const [submitting, setSubmitting] = useState(false);
	// Single tx id for the send mode + bundled distribute path; or
	// progress info ("3 of 10 …") for the sequential fallback.
	const [txIds, setTxIds] = useState<string[]>([]);
	const [progress, setProgress] = useState<
		| { phase: 'signing'; done: number; total: number }
		| { phase: 'waiting'; nextChunk: number; total: number; remainingMs: number }
		| null
	>(null);
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

	const recipients = useMemo(
		() => (mode === 'distribute' ? parseRecipients(recipientsText) : []),
		[mode, recipientsText]
	);

	// Pre-compute totals + per-recipient validity so we can render a
	// summary line ("Sending 5 × 1.000 DIY = 5.000 DIY total") and flag
	// invalid usernames before the user submits.
	const distributeStats = useMemo(() => {
		if (mode !== 'distribute') return null;
		const invalid = recipients.filter((r) => !isValidHiveUsername(r));
		const total =
			parsedRaw !== null && recipients.length > 0
				? parsedRaw * BigInt(recipients.length)
				: null;
		const exceeds = total !== null && total > balance;
		return { invalid, total, exceeds };
	}, [mode, recipients, parsedRaw, balance]);

	const validation = useMemo(() => {
		if (parsedRaw === null)
			return { ok: false, err: amountStr ? 'Amount must be > 0' : null };
		if (mode === 'single') {
			if (!isValidHiveUsername(to))
				return {
					ok: false,
					err: to.replace(/^hive:/, '').length === 0 ? null : 'Invalid Hive username'
				};
			if (parsedRaw > balance)
				return {
					ok: false,
					err: `Amount exceeds balance (${balanceDisplay} ${info.symbol})`
				};
			return { ok: true, err: null as string | null };
		}
		// distribute
		if (recipients.length === 0)
			return { ok: false, err: 'Add at least one recipient.' };
		if (distributeStats?.invalid.length) {
			return {
				ok: false,
				err: `Invalid username${distributeStats.invalid.length === 1 ? '' : 's'}: ${distributeStats.invalid.join(', ')}`
			};
		}
		if (distributeStats?.exceeds) {
			return {
				ok: false,
				err: `Total (${distributeStats.total !== null ? new TokenAmount(distributeStats.total, info.decimals).toDecimalStringTrimmed() : '?'} ${info.symbol}) exceeds balance.`
			};
		}
		return { ok: true, err: null as string | null };
	}, [
		mode,
		to,
		parsedRaw,
		amountStr,
		balance,
		balanceDisplay,
		info.symbol,
		info.decimals,
		recipients,
		distributeStats
	]);

	async function handleSingle() {
		if (parsedRaw === null) return;
		const res = await client.token.transfer(info.contractId, username, {
			to,
			amount: parsedRaw.toString()
		});
		setTxIds([res.txId]);
		onSuccess?.(res.txId);
	}

	async function handleDistribute() {
		if (parsedRaw === null || recipients.length === 0) return;
		const amount = parsedRaw.toString();
		const bundles: TokenOpBundle[] = recipients.map((to) =>
			client.token.transferOp(info.contractId, username, { to, amount })
		);
		// Chunk into CHUNK_SIZE-sized signatures and wait CHUNK_DELAY_MS
		// between them - Hive caps an account at 5 custom_json ops per
		// block, so two consecutive 4-op chunks would land in one block
		// and the second would trip "Account already submitted N
		// custom json operation(s) this block." The SDK handles the
		// chunking and the inter-chunk delay; we just plumb its
		// onProgress / onWaiting callbacks into the visible progress.
		const chunks = Math.ceil(bundles.length / CHUNK_SIZE);
		setProgress({ phase: 'signing', done: 0, total: chunks });
		const res = await client.broadcastBatch(bundles, {
			chunkSize: CHUNK_SIZE,
			delayBetweenChunksMs: CHUNK_DELAY_MS,
			onProgress: (i) =>
				setProgress({ phase: 'signing', done: i + 1, total: chunks }),
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
		// Fire onSuccess once per resulting tx so external listeners
		// (e.g. the panel's lastTx state) update for each one.
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
		return `Send ${info.symbol}`;
	})();
	const distributeChunks =
		recipients.length > 0 ? Math.ceil(recipients.length / CHUNK_SIZE) : 0;

	return (
		<Modal
			title={mode === 'distribute' ? `Distribute ${info.symbol}` : `Send ${info.symbol}`}
			subtitle={`${info.name} - Balance: ${balanceDisplay} ${info.symbol}`}
			onClose={onClose}
		>
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
					Distribute to many
				</button>
			</div>

			{mode === 'single' ? (
				<Field label="Recipient" hint="The Hive username to receive tokens.">
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
					hint="One per username, separated by spaces / commas / newlines. `tibfox`, `@tibfox`, `hive:tibfox` all work."
				>
					<div className={`magi-nft-input-wrap ${distributeStats?.invalid.length ? 'error' : ''}`}>
						<textarea
							value={recipientsText}
							onChange={(e) => setRecipientsText((e.target as HTMLTextAreaElement).value)}
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

			<Field
				label={mode === 'distribute' ? `Amount per recipient (${info.symbol})` : 'Amount'}
				hint={
					mode === 'distribute' && distributeStats?.total !== null && distributeStats?.total !== undefined
						? `${recipients.length} × ${amountStr || '0'} = ${new TokenAmount(distributeStats.total, info.decimals).toDecimalStringTrimmed()} ${info.symbol} total · Balance ${balanceDisplay}`
						: `Max ${balanceDisplay} ${info.symbol}`
				}
			>
				<TextInput
					inputMode="decimal"
					value={amountStr}
					onChange={setAmountStr}
					placeholder="0"
					disabled={submitting}
				/>
			</Field>

			{mode === 'distribute' && recipients.length > 0 && !distributeStats?.invalid.length && (
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
