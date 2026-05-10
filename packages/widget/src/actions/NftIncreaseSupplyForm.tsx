import { useMemo, useState } from 'react';
import { isValidHiveUsername, normalizeHiveAccount, type NftItem } from '@vsc.eco/token-core';
import type { NftClient } from '@vsc.eco/token-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';

export interface NftIncreaseSupplyFormProps {
	client: NftClient;
	username: string;
	item: NftItem;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Owner-only "mint more" form for an existing editioned NFT id.
 *
 * Re-uses the same contract action as the first mint (`mint`) - the
 * Magi NFT contract treats subsequent calls with an existing tokenId
 * as a supply bump, validates that `currentSupply + amount <= maxSupply`,
 * and ignores any `maxSupply` / `soulbound` / `properties` fields you
 * pass on a second call (they're set on first mint only). So this form
 * is a slim variant of NftMintForm:
 *
 *   - tokenId is locked (no input, just a label)
 *   - no maxSupply / soulbound / properties fields - they'd be ignored
 *   - amount is capped at `maxSupply - currentSupply` when both are
 *     known, so the user can't submit something the contract will
 *     just abort.
 *
 * Mirrors okinoko-terminal's "Mint more" affordance on its NFT page.
 */
export function NftIncreaseSupplyForm({
	client,
	username,
	item,
	onSuccess,
	onClose
}: NftIncreaseSupplyFormProps) {
	const [to, setTo] = useState(`hive:${username}`);
	const [amountStr, setAmountStr] = useState('1');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Headroom = how many more copies the contract will allow us to
	// mint. Only computed when the indexer told us currentSupply; if
	// it didn't, we let the user submit anything > 0 and surface a
	// contract abort if they exceed the cap.
	const headroom = useMemo<number | null>(() => {
		if (typeof item.currentSupply !== 'number') return null;
		return Math.max(0, item.maxSupply - item.currentSupply);
	}, [item.maxSupply, item.currentSupply]);

	const parsedAmount = useMemo<number | null>(() => {
		const n = parseInt(amountStr, 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}, [amountStr]);

	const validation = useMemo(() => {
		if (!isValidHiveUsername(to))
			return {
				ok: false,
				err: to.replace(/^hive:/, '').length === 0 ? null : 'Invalid recipient'
			};
		if (parsedAmount === null)
			return { ok: false, err: amountStr ? 'Amount must be > 0' : null };
		if (headroom !== null && parsedAmount > headroom)
			return {
				ok: false,
				err:
					headroom === 0
						? 'This token is already at max supply.'
						: `Only ${headroom} copy${headroom === 1 ? '' : 'ies'} left to mint.`
			};
		return { ok: true, err: null as string | null };
	}, [to, parsedAmount, amountStr, headroom]);

	async function handleSubmit() {
		if (!validation.ok || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			// No maxSupply / soulbound / properties on the wire - the
			// contract uses the values it stored on first mint and will
			// in fact abort if maxSupply is provided AND doesn't match.
			const bundle = client.nft.mintOp(item.contractId, username, {
				to,
				id: item.tokenId,
				amount: parsedAmount as number
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

	const supplyLabel =
		typeof item.currentSupply === 'number'
			? `${item.currentSupply} / ${item.maxSupply}`
			: `${item.maxSupply} max`;

	return (
		<Modal
			title={`Mint more of #${item.tokenId}`}
			subtitle={`${item.collection.name || item.collection.symbol || item.collection.contractId} - supply: ${supplyLabel}`}
			onClose={onClose}
		>
			<Field label="Recipient" hint="Account that receives the newly-minted copies.">
				<TextInput
					value={to}
					onChange={(v) => setTo(normalizeHiveAccount(v))}
					placeholder="hive:username"
					disabled={submitting}
				/>
			</Field>
			<Field
				label="Amount"
				hint={
					headroom !== null
						? `Copies to mint (max ${headroom} left).`
						: 'Copies to mint.'
				}
			>
				<TextInput
					type="number"
					min={1}
					max={headroom ?? undefined}
					value={amountStr}
					onChange={setAmountStr}
					disabled={submitting || headroom === 0}
					inputMode="numeric"
				/>
			</Field>

			{(error || validation.err) && (
				<p className="magi-token-status error">{error ?? validation.err}</p>
			)}

			{txId ? (
				<>
					<BroadcastResult txId={txId} />
					<button type="button" className="magi-token-submit ghost" onClick={onClose}>
						Done
					</button>
				</>
			) : (
				<button
					type="button"
					className="magi-token-submit"
					disabled={!validation.ok || submitting || headroom === 0}
					onClick={handleSubmit}
				>
					{submitting
						? 'Minting…'
						: parsedAmount
							? `Mint ${parsedAmount} more`
							: 'Mint more'}
				</button>
			)}
		</Modal>
	);
}
