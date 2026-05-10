import { useEffect, useMemo, useState } from 'react';
import {
	isValidHiveUsername,
	normalizeHiveAccount,
	type NftCollection
} from '@vsc.eco/nft-core';
import type { NftClient, NftMetadata, NftOpBundle } from '@vsc.eco/nft-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';

export interface NftEditCollectionFormProps {
	client: NftClient;
	username: string;
	collection: NftCollection;
	onSuccess?: (txIds: string[]) => void;
	onClose: () => void;
}

type Mode = 'simple' | 'json';

/**
 * Owner-only "edit collection" dialog. Reads the current
 * `collection_metadata` blob via getStateByKeys so the form pre-fills
 * with whatever's already on chain, then lets the owner update three
 * things post-init:
 *
 *   - baseUri          (setBaseUri op)
 *   - collection_metadata.description + .icon (simple mode)
 *   - collection_metadata raw JSON           (custom mode)
 *   - newOwner         (changeOwner op)
 *
 * The form figures out which ops actually changed and only signs those.
 * If both baseUri AND metadata changed the two ops bundle into one
 * Hive transaction (one signature). Owner-transfer is a separate dialog
 * action - included here for completeness but gated behind a "Show
 * advanced" toggle so it's not a one-click footgun.
 */
export function NftEditCollectionForm({
	client,
	username,
	collection,
	onSuccess,
	onClose
}: NftEditCollectionFormProps) {
	const [mode, setMode] = useState<Mode>('simple');
	const [baseUri, setBaseUri] = useState(collection.baseUri ?? '');
	const [description, setDescription] = useState('');
	const [iconUrl, setIconUrl] = useState('');
	const [metadataJson, setMetadataJson] = useState('');
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [newOwner, setNewOwner] = useState('');
	const [meta, setMeta] = useState<NftMetadata | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [txIds, setTxIds] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);

	// Pre-fill with the on-chain metadata blob so the user edits the
	// current values rather than overwriting them with empties.
	useEffect(() => {
		let cancelled = false;
		client.nft.provider
			.getCollectionMetadata(collection.contractId)
			.then((m) => {
				if (cancelled) return;
				setMeta(m);
				if (m && typeof m === 'object') {
					if (typeof m.description === 'string') setDescription(m.description);
					// okinoko's convention is `icon`; the panel falls back
					// to other image keys for read but we write `icon` for
					// consistency with deploy.
					const ic =
						(typeof m.icon === 'string' && m.icon) ||
						(typeof m.image === 'string' && m.image) ||
						'';
					if (ic) setIconUrl(ic);
					setMetadataJson(JSON.stringify(m, null, 2));
				}
			})
			.catch(() => {
				/* leave blank - user can still set fresh values */
			});
		return () => {
			cancelled = true;
		};
	}, [client, collection.contractId]);

	const baseUriError = useMemo(() => {
		const b = baseUri.trim();
		if (b && !b.endsWith('/')) return 'Base URI must end with `/`.';
		return null;
	}, [baseUri]);

	const jsonError = useMemo(() => {
		if (mode !== 'json' || !metadataJson.trim()) return null;
		try {
			JSON.parse(metadataJson);
			return null;
		} catch (e) {
			return e instanceof Error ? e.message : 'Invalid JSON';
		}
	}, [mode, metadataJson]);

	const newOwnerError = useMemo(() => {
		if (!showAdvanced || !newOwner.trim()) return null;
		if (!isValidHiveUsername(newOwner)) return 'Invalid Hive username';
		return null;
	}, [showAdvanced, newOwner]);

	// Diff: what actually needs writing? The form skips ops when
	// nothing changed, so a user who only updates the description
	// signs once for setCollectionMetadata - not also for setBaseUri.
	const planned = useMemo(() => {
		const out: Array<{ label: string; bundle: NftOpBundle }> = [];
		const nextBaseUri = baseUri.trim();
		const currentBaseUri = (collection.baseUri ?? '').trim();
		if (nextBaseUri !== currentBaseUri && !baseUriError) {
			out.push({
				label: 'Update base URI',
				bundle: client.nft.setBaseUriOp(collection.contractId, username, {
					baseUri: nextBaseUri
				})
			});
		}
		// Build the next metadata blob.
		let nextMetaStr: string | null = null;
		if (mode === 'simple') {
			const m: Record<string, unknown> = meta && typeof meta === 'object' ? { ...meta } : {};
			const d = description.trim();
			const ic = iconUrl.trim();
			if (d) m.description = d;
			else delete m.description;
			if (ic) m.icon = ic;
			else delete m.icon;
			nextMetaStr = Object.keys(m).length > 0 ? JSON.stringify(m) : '';
		} else if (!jsonError) {
			nextMetaStr = metadataJson.trim();
		}
		if (nextMetaStr !== null) {
			const currentMetaStr = meta ? JSON.stringify(meta) : '';
			// Only write if the canonical JSON form actually changed.
			let changed = false;
			try {
				const a = nextMetaStr ? JSON.stringify(JSON.parse(nextMetaStr)) : '';
				const b = currentMetaStr;
				changed = a !== b;
			} catch {
				/* leave changed=false on parse failure - validation catches it */
			}
			if (changed) {
				out.push({
					label: 'Update collection metadata',
					bundle: client.nft.setCollectionMetadataOp(
						collection.contractId,
						username,
						{ metadata: nextMetaStr }
					)
				});
			}
		}
		// Owner-transfer last so it isn't accidentally re-fired by a
		// metadata-only edit. Gated by the "Show advanced" toggle.
		if (showAdvanced && newOwner.trim() && !newOwnerError) {
			const target = normalizeHiveAccount(newOwner);
			const currentOwnerNorm = collection.owner;
			if (target !== currentOwnerNorm) {
				out.push({
					label: 'Transfer ownership',
					bundle: client.nft.changeOwnerOp(collection.contractId, username, {
						newOwner: target
					})
				});
			}
		}
		return out;
	}, [
		baseUri,
		baseUriError,
		collection.baseUri,
		collection.contractId,
		collection.owner,
		client,
		description,
		iconUrl,
		jsonError,
		meta,
		metadataJson,
		mode,
		newOwner,
		newOwnerError,
		showAdvanced,
		username
	]);

	const validation = useMemo(() => {
		if (baseUriError) return { ok: false, err: baseUriError };
		if (jsonError) return { ok: false, err: `Invalid JSON: ${jsonError}` };
		if (newOwnerError) return { ok: false, err: newOwnerError };
		if (planned.length === 0) return { ok: false, err: 'No changes to apply.' };
		return { ok: true, err: null as string | null };
	}, [baseUriError, jsonError, newOwnerError, planned]);

	async function handleSubmit() {
		if (!validation.ok || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const bundles = planned.map((p) => p.bundle);
			// Bundle into one signature when the signer supports it; the
			// SDK's broadcastBatch handles the per-block cap and chunking
			// automatically. With at most 3 ops here we're well under
			// the per-block limit.
			const res = await client.broadcastBatch(bundles);
			setTxIds(res.txIds);
			onSuccess?.(res.txIds);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	const submitLabel = (() => {
		if (submitting) return 'Saving…';
		if (planned.length === 0) return 'No changes to save';
		const verbs = planned.map((p) => p.label.toLowerCase()).join(' + ');
		return `Save (${verbs})`;
	})();

	return (
		<Modal
			title={`Edit ${collection.symbol || 'collection'}`}
			subtitle={`${collection.name} - owner-only`}
			onClose={onClose}
		>
			<Field
				label="Base URI"
				hint="Per-token URIs are appended to this; must end with `/`."
				error={baseUriError ?? undefined}
			>
				<TextInput
					value={baseUri}
					onChange={setBaseUri}
					placeholder="https://example.com/meta/"
					disabled={submitting}
					error={!!baseUriError}
				/>
			</Field>

			<div className="magi-nft-tabs" style={{ marginTop: '0.4rem', marginBottom: '0.4rem' }}>
				<button
					type="button"
					className={`magi-nft-tab ${mode === 'simple' ? 'active' : ''}`}
					onClick={() => setMode('simple')}
					disabled={submitting}
				>
					Simple metadata
				</button>
				<button
					type="button"
					className={`magi-nft-tab ${mode === 'json' ? 'active' : ''}`}
					onClick={() => setMode('json')}
					disabled={submitting}
				>
					Custom JSON
				</button>
			</div>

			{mode === 'simple' ? (
				<>
					<Field label="Description" hint="Short description of the collection.">
						<TextInput
							value={description}
							onChange={setDescription}
							disabled={submitting}
						/>
					</Field>
					<Field
						label="Collection icon URL"
						hint="Image shown next to the collection name in widgets."
					>
						<TextInput
							value={iconUrl}
							onChange={setIconUrl}
							placeholder="https://example.com/cover.png"
							disabled={submitting}
						/>
					</Field>
				</>
			) : (
				<Field
					label="Metadata (JSON)"
					hint="Free-form collection metadata. Stored verbatim on-chain."
					error={jsonError ?? undefined}
				>
					<div className={`magi-nft-input-wrap ${jsonError ? 'error' : ''}`}>
						<textarea
							value={metadataJson}
							onChange={(e) =>
								setMetadataJson((e.target as HTMLTextAreaElement).value)
							}
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

			<label
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.5rem',
					fontSize: '0.8rem',
					color: 'var(--magi-text-secondary)',
					marginTop: '0.4rem'
				}}
			>
				<input
					type="checkbox"
					checked={showAdvanced}
					onChange={(e) => setShowAdvanced((e.target as HTMLInputElement).checked)}
					disabled={submitting}
				/>
				Show advanced (transfer ownership)
			</label>
			{showAdvanced && (
				<Field
					label="New owner"
					hint="Hands the contract to a new account. This is irreversible from your side."
					error={newOwnerError ?? undefined}
				>
					<TextInput
						value={newOwner}
						onChange={(v) => setNewOwner(normalizeHiveAccount(v))}
						placeholder="hive:successor"
						disabled={submitting}
						error={!!newOwnerError}
					/>
				</Field>
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
