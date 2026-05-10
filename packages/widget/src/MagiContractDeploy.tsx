import { useEffect, useMemo, useRef, useState } from 'react';
import {
	createDeployerClient,
	createNftClient,
	MAINNET_CONFIG,
	substituteDeployerOps,
	type AiohaLike,
	type BroadcastHook,
	type DeployLogEntry,
	type DeployResult,
	type DeployedCode,
	type DeployerClient,
	type DeployerOp,
	type MagiConfig,
	type NftClient
} from '@vsc.eco/nft-sdk';
import { BroadcastResult } from './components/BroadcastResult.js';
import { Field, TextInput } from './components/Field.js';
import { Modal } from './components/Modal.js';

/**
 * Deploy + init in a single dialog. The flow is:
 *
 *   1. User picks NFT or Token, fills in name/symbol/etc., clicks Deploy.
 *   2. SDK calls deployer.prepareDeploy({ repo, name, owner, tag }) and
 *      streams the build log into the modal.
 *   3. Backend emits a `result` event with the deploy operations - the
 *      user signs + broadcasts (one Aioha prompt).
 *   4. SDK polls the Magi node for the freshly-registered contract id
 *      (matches by creator + creation_ts > deploy time).
 *   5. SDK fires the contract's `init(name, symbol, ...)` call - the user
 *      signs + broadcasts (second Aioha prompt).
 *   6. Modal shows both tx ids + the contract id with copy/explorer
 *      affordances reusing the BroadcastResult component.
 *
 * Endpoint defaults to `MAINNET_CONFIG.deployerUrl`; override via the
 * `serviceUrl` prop. Backend templates are filtered by `tag=nft` /
 * `tag=token` matching what okinoko-terminal's deploy popup uses today.
 */

export type DeployContractType = 'nft' | 'token';

export interface MagiContractDeployProps {
	username?: string;
	aioha?: AiohaLike;
	onBroadcast?: BroadcastHook;
	keyType?: unknown;
	config?: MagiConfig;
	client?: NftClient;
	/** Override the deployer URL (defaults to `config.deployerUrl`). */
	serviceUrl?: string;
	/** Default contract type to start the form on. */
	defaultType?: DeployContractType;
	/** Lock the form to a single contract type and hide the tab strip. */
	lockType?: DeployContractType;
	/** Called when the dialog is closed. */
	onClose: () => void;
	/** Called once everything succeeded — before the user dismisses. */
	onSuccess?: (result: {
		type: DeployContractType;
		contractId: string;
		deployTxId: string;
		initTxId: string;
	}) => void;
	className?: string;
}

type Stage =
	| 'form'
	| 'building'
	| 'signing-deploy'
	| 'waiting-contract'
	| 'signing-init'
	| 'done'
	| 'error';

interface NftInitFields {
	name: string;
	symbol: string;
	baseUri: string;
	trackMinted: boolean;
}
interface TokenInitFields {
	name: string;
	symbol: string;
	decimals: string;
	maxSupply: string;
}

export function MagiContractDeploy(props: MagiContractDeployProps) {
	const {
		username,
		aioha,
		onBroadcast,
		keyType,
		config = MAINNET_CONFIG,
		client: providedClient,
		serviceUrl,
		defaultType = 'nft',
		lockType,
		onClose,
		onSuccess,
		className
	} = props;

	const client = useMemo<NftClient>(
		() => providedClient ?? createNftClient({ config, aioha, onBroadcast, keyType }),
		[providedClient, config, aioha, onBroadcast, keyType]
	);
	const deployer = useMemo<DeployerClient>(
		() => createDeployerClient({ config, serviceUrl }),
		[config, serviceUrl]
	);

	const [type, setType] = useState<DeployContractType>(lockType ?? defaultType);
	const [stage, setStage] = useState<Stage>('form');
	const [logs, setLogs] = useState<DeployLogEntry[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [deployTxId, setDeployTxId] = useState<string | null>(null);
	const [contractId, setContractId] = useState<string | null>(null);
	const [initTxId, setInitTxId] = useState<string | null>(null);

	// Form fields - separate sets for NFT vs Token; the inactive set
	// remembers what the user typed when they switch tabs.
	const [nftFields, setNftFields] = useState<NftInitFields>({
		name: '',
		symbol: '',
		baseUri: '',
		trackMinted: false
	});
	const [tokenFields, setTokenFields] = useState<TokenInitFields>({
		name: '',
		symbol: '',
		decimals: '0',
		maxSupply: ''
	});

	// Templates the deployer offers for the active tag. Loaded lazily.
	const [templates, setTemplates] = useState<DeployedCode[] | null>(null);
	useEffect(() => {
		let cancelled = false;
		setTemplates(null);
		deployer
			.listDeployedCodes({ tag: type })
			.then((rows) => {
				if (!cancelled) setTemplates(rows);
			})
			.catch(() => {
				if (!cancelled) setTemplates([]);
			});
		return () => {
			cancelled = true;
		};
	}, [deployer, type]);

	const subscribeRef = useRef<(() => void) | null>(null);
	useEffect(() => () => subscribeRef.current?.(), []);

	const fields = type === 'nft' ? nftFields : tokenFields;

	const validation = useMemo(() => {
		if (!username) return { ok: false, err: 'Connect a wallet first.' };
		if (!fields.name.trim()) return { ok: false, err: 'Name is required.' };
		if (!fields.symbol.trim()) return { ok: false, err: 'Symbol is required.' };
		if (type === 'token') {
			const dec = parseInt(tokenFields.decimals, 10);
			if (!Number.isFinite(dec) || dec < 0 || dec > 18)
				return { ok: false, err: 'Decimals must be between 0 and 18.' };
		}
		return { ok: true, err: null as string | null };
	}, [username, fields, type, tokenFields.decimals]);

	function appendLog(entry: DeployLogEntry) {
		setLogs((prev) => [...prev, entry]);
	}

	async function signAndBroadcast(ops: unknown[]): Promise<string> {
		// Prefer the host's onBroadcast hook (allows non-Aioha signers);
		// otherwise use aioha.signAndBroadcastTx for the raw Hive ops.
		if (onBroadcast) {
			const r = await onBroadcast(ops as unknown[], keyType);
			return r.txId;
		}
		if (!aioha?.signAndBroadcastTx) {
			throw new Error(
				'Deploy needs a signer: pass `aioha` (with signAndBroadcastTx) or `onBroadcast`.'
			);
		}
		const r = await aioha.signAndBroadcastTx(ops as unknown[], keyType);
		if (!r.success || typeof r.result !== 'string') {
			throw new Error(`signAndBroadcastTx failed: ${r.error ?? 'unknown'}`);
		}
		return r.result;
	}

	async function handleDeploy() {
		if (!validation.ok || !username) return;

		// Reset transient state then walk the stages.
		setStage('building');
		setError(null);
		setLogs([]);
		setDeployTxId(null);
		setContractId(null);
		setInitTxId(null);

		const repo =
			type === 'nft' ? 'vsc-eco/magi_nft-contract' : 'vsc-eco/magi_token-contract';
		const fullName = fields.name.trim();
		const startedAt = new Date();

		appendLog({
			level: 'INFO',
			timestamp: startedAt.toISOString(),
			message: `Preparing deploy from ${repo} (tag=${type})…`
		});

		let deploymentId: string;
		try {
			const r = await deployer.prepareDeploy({
				repo,
				branch: 'main',
				name: fullName,
				owner: username,
				tag: type
			});
			deploymentId = r.deploymentId;
		} catch (err) {
			setStage('error');
			setError(err instanceof Error ? err.message : String(err));
			return;
		}

		appendLog({
			level: 'INFO',
			timestamp: new Date().toISOString(),
			message: `Deployment ${deploymentId} started, awaiting build logs…`
		});

		const cleanup = deployer.subscribeLogs(deploymentId, {
			onLog: appendLog,
			onResult: async (result) => {
				try {
					await onDeployerResult(result, startedAt);
				} catch (err) {
					setStage('error');
					setError(err instanceof Error ? err.message : String(err));
				}
			},
			onError: (err) => {
				setStage('error');
				setError(err.message);
			}
		});
		subscribeRef.current = cleanup;
	}

	async function onDeployerResult(result: DeployResult, startedAt: Date) {
		if (!result.success) {
			throw new Error(result.error ?? result.message ?? 'Build failed.');
		}
		const ops: DeployerOp[] = result.operations ?? [];
		if (!ops.length) throw new Error('Deployer returned no operations to sign.');

		setStage('signing-deploy');
		appendLog({
			level: 'INFO',
			timestamp: new Date().toISOString(),
			message: 'Build complete. Sign the deploy transaction in your wallet.'
		});

		const ready = substituteDeployerOps(ops, username!, config.network);
		const txId = await signAndBroadcast(ready);
		setDeployTxId(txId);
		appendLog({
			level: 'INFO',
			timestamp: new Date().toISOString(),
			message: `Deploy broadcast: ${txId}`
		});

		setStage('waiting-contract');
		appendLog({
			level: 'INFO',
			timestamp: new Date().toISOString(),
			message: 'Waiting for the indexer to register the new contract…'
		});
		const found = await deployer.findContractAfter({
			owner: username!,
			since: startedAt
		});
		setContractId(found.contractId);
		appendLog({
			level: 'INFO',
			timestamp: new Date().toISOString(),
			message: `Contract registered: ${found.contractId}`
		});

		setStage('signing-init');
		appendLog({
			level: 'INFO',
			timestamp: new Date().toISOString(),
			message: 'Sign the init transaction to set the collection metadata.'
		});

		const bundle =
			type === 'nft'
				? client.nft.initOp(found.contractId, username!, {
						name: nftFields.name,
						symbol: nftFields.symbol,
						baseUri: nftFields.baseUri || undefined,
						trackMinted: nftFields.trackMinted
					})
				: client.token.initOp(found.contractId, username!, {
						name: tokenFields.name,
						symbol: tokenFields.symbol,
						decimals: parseInt(tokenFields.decimals, 10) || 0,
						maxSupply: tokenFields.maxSupply || undefined
					});
		const initRes = await client.broadcast(bundle);
		setInitTxId(initRes.txId);
		appendLog({
			level: 'INFO',
			timestamp: new Date().toISOString(),
			message: `Init broadcast: ${initRes.txId}`
		});

		setStage('done');
		onSuccess?.({
			type,
			contractId: found.contractId,
			deployTxId: txId,
			initTxId: initRes.txId
		});
	}

	const subtitle =
		stage === 'form'
			? 'Deploy a new collection or token contract to the Magi network.'
			: stage === 'building'
				? 'Building the contract on the deployer…'
				: stage === 'signing-deploy'
					? 'Approve the deploy transaction in your wallet.'
					: stage === 'waiting-contract'
						? 'Polling the indexer for the new contract id…'
						: stage === 'signing-init'
							? 'Approve the init transaction to set the metadata.'
							: stage === 'done'
								? 'Contract deployed and initialised.'
								: 'Deployment failed.';

	return (
		<Modal
			title={`Deploy ${type === 'nft' ? 'NFT collection' : 'token contract'}`}
			subtitle={subtitle}
			onClose={onClose}
		>
			{!lockType && stage === 'form' && (
				<div className="magi-nft-tabs" style={{ marginBottom: '0.6rem' }}>
					<button
						type="button"
						className={`magi-nft-tab ${type === 'nft' ? 'active' : ''}`}
						onClick={() => setType('nft')}
					>
						NFT collection
					</button>
					<button
						type="button"
						className={`magi-nft-tab ${type === 'token' ? 'active' : ''}`}
						onClick={() => setType('token')}
					>
						Token
					</button>
				</div>
			)}

			{stage === 'form' && (
				<>
					{type === 'nft' ? (
						<>
							<Field
								label="Collection name"
								hint="The display name shown in wallets and the registry."
							>
								<TextInput
									value={nftFields.name}
									onChange={(v) => setNftFields((p) => ({ ...p, name: v }))}
									placeholder="My NFTs"
								/>
							</Field>
							<Field label="Symbol" hint="Short ticker, e.g. MNFT.">
								<TextInput
									value={nftFields.symbol}
									onChange={(v) =>
										setNftFields((p) => ({ ...p, symbol: v.toUpperCase() }))
									}
									placeholder="MNFT"
								/>
							</Field>
							<Field
								label="Base URI"
								hint="Optional. Per-token URIs are appended to this."
							>
								<TextInput
									value={nftFields.baseUri}
									onChange={(v) => setNftFields((p) => ({ ...p, baseUri: v }))}
									placeholder="https://example.com/meta/"
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
									checked={nftFields.trackMinted}
									onChange={(e) =>
										setNftFields((p) => ({
											...p,
											trackMinted: (e.target as HTMLInputElement).checked
										}))
									}
								/>
								Track total minted (enables the totalMinted query)
							</label>
						</>
					) : (
						<>
							<Field label="Token name" hint="The display name in wallets.">
								<TextInput
									value={tokenFields.name}
									onChange={(v) => setTokenFields((p) => ({ ...p, name: v }))}
									placeholder="My Token"
								/>
							</Field>
							<Field label="Symbol" hint="Short ticker, e.g. MTK.">
								<TextInput
									value={tokenFields.symbol}
									onChange={(v) =>
										setTokenFields((p) => ({ ...p, symbol: v.toUpperCase() }))
									}
									placeholder="MTK"
								/>
							</Field>
							<Field label="Decimals" hint="0-18. 0 means smallest unit = 1 token.">
								<TextInput
									type="number"
									min={0}
									max={18}
									value={tokenFields.decimals}
									onChange={(v) => setTokenFields((p) => ({ ...p, decimals: v }))}
									placeholder="0"
								/>
							</Field>
							<Field
								label="Max supply (smallest units)"
								hint="Optional. Empty = no cap."
							>
								<TextInput
									value={tokenFields.maxSupply}
									onChange={(v) => setTokenFields((p) => ({ ...p, maxSupply: v }))}
									placeholder="1000000"
								/>
							</Field>
						</>
					)}

					{templates && templates.length === 0 && (
						<p className="magi-nft-status error">
							No <code>{type}</code> templates available on the deployer at{' '}
							<code>{serviceUrl ?? config.deployerUrl}</code>. Configure a different
							endpoint via the <code>serviceUrl</code> prop.
						</p>
					)}
					{validation.err && (
						<p className="magi-nft-status error">{validation.err}</p>
					)}
					<button
						type="button"
						className="magi-nft-submit"
						disabled={!validation.ok || (templates !== null && templates.length === 0)}
						onClick={handleDeploy}
					>
						Deploy {type === 'nft' ? 'collection' : 'token'}
					</button>
				</>
			)}

			{stage !== 'form' && (
				<DeployProgress
					stage={stage}
					logs={logs}
					error={error}
					deployTxId={deployTxId}
					contractId={contractId}
					initTxId={initTxId}
					onDone={onClose}
				/>
			)}
		</Modal>
	);
}

interface DeployProgressProps {
	stage: Stage;
	logs: DeployLogEntry[];
	error: string | null;
	deployTxId: string | null;
	contractId: string | null;
	initTxId: string | null;
	onDone: () => void;
}

function DeployProgress({
	stage,
	logs,
	error,
	deployTxId,
	contractId,
	initTxId,
	onDone
}: DeployProgressProps) {
	const stages: Array<{ key: Stage; label: string }> = [
		{ key: 'building', label: 'Build' },
		{ key: 'signing-deploy', label: 'Sign deploy' },
		{ key: 'waiting-contract', label: 'Index' },
		{ key: 'signing-init', label: 'Sign init' },
		{ key: 'done', label: 'Done' }
	];
	const currentIdx = stages.findIndex((s) => s.key === stage);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
			<div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
				{stages.map((s, i) => {
					const reached = currentIdx >= i;
					const active = currentIdx === i && stage !== 'done';
					return (
						<span
							key={s.key}
							style={{
								fontSize: '0.7rem',
								padding: '0.2rem 0.55rem',
								borderRadius: '999px',
								border: '1px solid var(--magi-field-border)',
								background:
									reached && stage !== 'error'
										? 'var(--magi-accent-light)'
										: 'transparent',
								color:
									reached && stage !== 'error'
										? 'var(--magi-accent)'
										: 'var(--magi-text-muted)',
								fontWeight: active ? 700 : 500
							}}
						>
							{i + 1}. {s.label}
						</span>
					);
				})}
			</div>

			{logs.length > 0 && (
				<pre
					style={{
						background: '#0f172a',
						color: '#e2e8f0',
						padding: '10px 12px',
						borderRadius: '8px',
						maxHeight: '240px',
						overflowY: 'auto',
						fontSize: '11.5px',
						lineHeight: 1.45,
						margin: 0,
						fontFamily:
							"'Noto Sans Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
					}}
				>
					{logs.map((l, i) => (
						<div
							key={i}
							style={{
								color:
									l.level === 'ERROR'
										? '#fca5a5'
										: l.level === 'DEBUG'
											? '#94a3b8'
											: '#e2e8f0'
							}}
						>
							{l.message}
						</div>
					))}
				</pre>
			)}

			{error && <p className="magi-nft-status error">{error}</p>}

			{deployTxId && (
				<>
					<span
						style={{
							fontSize: '0.7rem',
							color: 'var(--magi-text-muted)',
							marginTop: '0.2rem'
						}}
					>
						Deploy tx
					</span>
					<BroadcastResult txId={deployTxId} />
				</>
			)}
			{contractId && (
				<>
					<span style={{ fontSize: '0.7rem', color: 'var(--magi-text-muted)' }}>
						Contract id
					</span>
					<div className="magi-nft-success" style={{ marginTop: 0 }}>
						<span className="magi-nft-success-label">vsc:</span>
						<code className="magi-nft-success-tx" title={contractId}>
							{contractId}
						</code>
					</div>
				</>
			)}
			{initTxId && (
				<>
					<span style={{ fontSize: '0.7rem', color: 'var(--magi-text-muted)' }}>
						Init tx
					</span>
					<BroadcastResult txId={initTxId} />
				</>
			)}

			{(stage === 'done' || stage === 'error') && (
				<button type="button" className="magi-nft-submit ghost" onClick={onDone}>
					{stage === 'done' ? 'Done' : 'Close'}
				</button>
			)}
		</div>
	);
}
