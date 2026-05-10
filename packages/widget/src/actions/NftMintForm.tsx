import { useMemo, useState } from 'react';
import { isValidHiveUsername, normalizeHiveAccount } from '@vsc.eco/nft-core';
import type { NftClient, NftCollection } from '@vsc.eco/nft-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';

export interface NftMintFormProps {
	client: NftClient;
	username: string;
	collection: NftCollection;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Owner-only "mint" form for an NFT collection. Mirrors okinoko-terminal's
 * NftMintPopup: pick recipient, token id, amount, optional max supply,
 * optional soulbound flag, optional properties JSON. Surfaced from the
 * panel's group header when the connected user owns the collection.
 */
export function NftMintForm({
	client,
	username,
	collection,
	onSuccess,
	onClose
}: NftMintFormProps) {
	const [to, setTo] = useState(`hive:${username}`);
	const [tokenId, setTokenId] = useState('');
	const [amount, setAmount] = useState('1');
	const [maxSupply, setMaxSupply] = useState('');
	const [soulbound, setSoulbound] = useState(false);
	const [properties, setProperties] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const validation = useMemo(() => {
		if (!tokenId.trim()) return { ok: false, err: null as string | null };
		if (!isValidHiveUsername(to))
			return { ok: false, err: to.replace(/^hive:/, '').length === 0 ? null : 'Invalid recipient' };
		const n = parseInt(amount, 10);
		if (!Number.isFinite(n) || n <= 0) return { ok: false, err: amount ? 'Amount must be > 0' : null };
		if (maxSupply.trim()) {
			const m = parseInt(maxSupply, 10);
			if (!Number.isFinite(m) || m <= 0) return { ok: false, err: 'Max supply must be > 0' };
		}
		if (properties.trim()) {
			try {
				JSON.parse(properties);
			} catch {
				return { ok: false, err: 'Properties must be valid JSON.' };
			}
		}
		return { ok: true, err: null as string | null };
	}, [to, tokenId, amount, maxSupply, properties]);

	async function handleSubmit() {
		if (!validation.ok || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const bundle = client.nft.mintOp(collection.contractId, username, {
				to,
				id: tokenId.trim(),
				amount: parseInt(amount, 10),
				maxSupply: maxSupply.trim() ? parseInt(maxSupply, 10) : undefined,
				soulbound: soulbound ? true : undefined,
				properties: properties.trim() || undefined
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

	return (
		<Modal
			title="Mint NFT"
			subtitle={`${collection.name || collection.contractId} - owner-only`}
			onClose={onClose}
		>
			<Field label="Recipient" hint="Account that receives the minted token(s).">
				<TextInput
					value={to}
					onChange={(v) => setTo(normalizeHiveAccount(v))}
					placeholder="hive:username"
					disabled={submitting}
				/>
			</Field>
			<Field label="Token id" hint="Used as the on-chain token identifier (string).">
				<TextInput
					value={tokenId}
					onChange={setTokenId}
					placeholder="card-001"
					disabled={submitting}
				/>
			</Field>
			<Field label="Amount" hint="Copies to mint. 1 = unique when maxSupply is also 1.">
				<TextInput
					type="number"
					min={1}
					value={amount}
					onChange={setAmount}
					inputMode="numeric"
					disabled={submitting}
				/>
			</Field>
			<Field
				label="Max supply (first mint only)"
				hint="Optional. Cap the token's total supply. 1 = strictly unique."
			>
				<TextInput
					type="number"
					min={1}
					value={maxSupply}
					onChange={setMaxSupply}
					inputMode="numeric"
					placeholder="1"
					disabled={submitting}
				/>
			</Field>
			<label
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.5rem',
					fontSize: '0.85rem',
					color: 'var(--magi-text-secondary)'
				}}
			>
				<input
					type="checkbox"
					checked={soulbound}
					onChange={(e) => setSoulbound((e.target as HTMLInputElement).checked)}
					disabled={submitting}
				/>
				Soulbound (non-transferable, set on first mint only)
			</label>
			<Field
				label="Properties (JSON)"
				hint='Optional. e.g. {"image": "https://…", "name": "Card 1"}'
			>
				<TextInput
					value={properties}
					onChange={setProperties}
					placeholder='{"image": "..."}'
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
					{submitting ? 'Minting…' : 'Mint NFT'}
				</button>
			)}
		</Modal>
	);
}
