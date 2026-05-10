import { useEffect, useMemo, useState } from 'react';
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

type PropertiesMode = 'simple' | 'json';

/**
 * Owner-only "mint" form for an NFT collection. Mirrors okinoko-terminal's
 * NftMintPopup: pick recipient, token id, amount, optional max supply,
 * optional soulbound flag, plus per-token properties via the same
 * Simple / Custom JSON toggle the okinoko popup uses.
 *
 *   Simple mode:  three fields - name, description, image URL. The form
 *                 builds `{name, description, image}` and passes it as a
 *                 raw object to mintOp.
 *   Custom mode:  textarea for arbitrary JSON. Validated as parseable
 *                 JSON before submit.
 *
 * Either way the wire payload's `properties` key is a raw JSON object,
 * matching what the contract's tinyjson `in.Raw()` reads. (See the
 * collection-metadata commit for the encoding gotcha that motivated
 * raw-object passthrough across all three contract write paths.)
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

	// Simple-mode fields - the three okinoko convention keys.
	const [propsMode, setPropsMode] = useState<PropertiesMode>('simple');
	const [propName, setPropName] = useState('');
	const [propDescription, setPropDescription] = useState('');
	const [propImage, setPropImage] = useState('');
	// Custom-mode raw JSON. Seeded from simple fields when the user
	// flips to custom so they don't lose what they already typed.
	const [propsJson, setPropsJson] = useState('');

	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Whenever the simple fields change in simple mode, mirror them
	// into the JSON-mode buffer so flipping to JSON shows the equivalent
	// stringified form (matches okinoko's NftPropertiesInput behaviour).
	useEffect(() => {
		if (propsMode !== 'simple') return;
		const obj: Record<string, string> = {};
		if (propName.trim()) obj.name = propName.trim();
		if (propDescription.trim()) obj.description = propDescription.trim();
		if (propImage.trim()) obj.image = propImage.trim();
		setPropsJson(Object.keys(obj).length > 0 ? JSON.stringify(obj, null, 2) : '');
	}, [propsMode, propName, propDescription, propImage]);

	function switchMode(next: PropertiesMode) {
		if (next === propsMode) return;
		if (next === 'json') {
			// Going simple -> JSON: the seed effect above already filled
			// propsJson; nothing else to do.
		} else {
			// Going JSON -> simple: try to parse the JSON and split it
			// back into the three known fields. Anything that doesn't
			// fit is silently dropped - that's fine because the user can
			// flip back to JSON to recover the full blob.
			try {
				const trimmed = propsJson.trim();
				const parsed = trimmed ? JSON.parse(trimmed) : null;
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					setPropName(typeof parsed.name === 'string' ? parsed.name : '');
					setPropDescription(
						typeof parsed.description === 'string' ? parsed.description : ''
					);
					setPropImage(typeof parsed.image === 'string' ? parsed.image : '');
				}
			} catch {
				/* leave simple fields as they were */
			}
		}
		setPropsMode(next);
	}

	const jsonError = useMemo(() => {
		if (propsMode !== 'json') return null;
		const trimmed = propsJson.trim();
		if (!trimmed) return null;
		try {
			const parsed = JSON.parse(trimmed);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return 'Properties must be a JSON object (not array / scalar).';
			}
			return null;
		} catch (e) {
			return e instanceof Error ? e.message : 'Invalid JSON';
		}
	}, [propsMode, propsJson]);

	const propertiesObject = useMemo<Record<string, unknown> | undefined>(() => {
		if (propsMode === 'simple') {
			const obj: Record<string, string> = {};
			if (propName.trim()) obj.name = propName.trim();
			if (propDescription.trim()) obj.description = propDescription.trim();
			if (propImage.trim()) obj.image = propImage.trim();
			return Object.keys(obj).length > 0 ? obj : undefined;
		}
		if (jsonError) return undefined;
		const trimmed = propsJson.trim();
		if (!trimmed) return undefined;
		try {
			const parsed = JSON.parse(trimmed);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: undefined;
		} catch {
			return undefined;
		}
	}, [propsMode, propName, propDescription, propImage, propsJson, jsonError]);

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
		if (jsonError) return { ok: false, err: `Properties JSON: ${jsonError}` };
		return { ok: true, err: null as string | null };
	}, [to, tokenId, amount, maxSupply, jsonError]);

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
				properties: propertiesObject
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

			<div className="magi-nft-tabs" style={{ marginTop: '0.4rem', marginBottom: '0.4rem' }}>
				<button
					type="button"
					className={`magi-nft-tab ${propsMode === 'simple' ? 'active' : ''}`}
					onClick={() => switchMode('simple')}
					disabled={submitting}
				>
					Simple metadata
				</button>
				<button
					type="button"
					className={`magi-nft-tab ${propsMode === 'json' ? 'active' : ''}`}
					onClick={() => switchMode('json')}
					disabled={submitting}
				>
					Custom JSON
				</button>
			</div>

			{propsMode === 'simple' ? (
				<>
					<Field label="Name" hint="Display name for the NFT.">
						<TextInput
							value={propName}
							onChange={setPropName}
							placeholder="Card #1"
							disabled={submitting}
						/>
					</Field>
					<Field label="Description" hint="Short description of the NFT.">
						<TextInput
							value={propDescription}
							onChange={setPropDescription}
							disabled={submitting}
						/>
					</Field>
					<Field label="Image URL" hint="URL of the NFT image (used by wallets and marketplaces).">
						<TextInput
							value={propImage}
							onChange={setPropImage}
							placeholder="https://example.com/card-001.png"
							disabled={submitting}
						/>
					</Field>
				</>
			) : (
				<Field
					label="Properties (JSON)"
					hint="Free-form per-token properties. Stored verbatim on-chain."
					error={jsonError ?? undefined}
				>
					<div className={`magi-nft-input-wrap ${jsonError ? 'error' : ''}`}>
						<textarea
							value={propsJson}
							onChange={(e) => setPropsJson((e.target as HTMLTextAreaElement).value)}
							rows={6}
							spellCheck={false}
							disabled={submitting}
							style={{
								flex: 1,
								background: 'transparent',
								border: 0,
								outline: 'none',
								resize: 'vertical',
								color: 'inherit',
								font: 'inherit',
								fontSize: '0.78rem',
								fontFamily:
									"'Noto Sans Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
								minHeight: '110px'
							}}
						/>
					</div>
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
					{submitting ? 'Minting…' : 'Mint NFT'}
				</button>
			)}
		</Modal>
	);
}
