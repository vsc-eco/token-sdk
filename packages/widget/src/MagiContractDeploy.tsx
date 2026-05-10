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
	type DeployerClient,
	type DeployerOp,
	type MagiConfig,
	type NftClient
} from '@vsc.eco/token-sdk';
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

/**
 * Source template the deployer backend can build from. Mirrors the schema
 * in okinoko-terminal's `github-templates.json`: a `repo` + `branch` pair
 * tagged by contract type. The deploy widget filters by `tag === type`.
 */
export interface ContractTemplate {
	id: string;
	label: string;
	description?: string;
	repo: string;
	branch: string;
	tag: DeployContractType | string;
}

/**
 * Default templates - the canonical Magi NFT + token contract sources.
 * Hosts can override or extend this list via the `templates` prop;
 * forks of the contracts that build on a different branch / fork can
 * register their own template entries without needing a deployer
 * configuration change.
 */
export const DEFAULT_DEPLOY_TEMPLATES: ContractTemplate[] = [
	{
		id: 'magi-token',
		label: 'Magi NFT (ERC-1155)',
		description: 'Official Magi NFT contract from vsc-eco/magi_nft-contract.',
		repo: 'vsc-eco/magi_nft-contract',
		branch: 'main',
		tag: 'nft'
	},
	{
		id: 'magi-token',
		label: 'Magi Token (ERC-20)',
		description: 'Official Magi token contract from vsc-eco/magi_token-contract.',
		repo: 'vsc-eco/magi_token-contract',
		branch: 'main',
		tag: 'token'
	}
];

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
	/**
	 * Override the source-template list. Each entry is a `{ repo, branch,
	 * tag }` triple the deployer backend will clone + build. Defaults to
	 * `DEFAULT_DEPLOY_TEMPLATES` (the canonical magi_nft-contract /
	 * magi_token-contract repos). Pass an extended list to offer custom
	 * forks alongside the defaults.
	 */
	templates?: ContractTemplate[];
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
	description: string;
	iconUrl: string;
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
		templates: providedTemplates,
		onClose,
		onSuccess,
		className
	} = props;
	const templates = providedTemplates ?? DEFAULT_DEPLOY_TEMPLATES;

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
		trackMinted: false,
		description: '',
		iconUrl: ''
	});
	const [tokenFields, setTokenFields] = useState<TokenInitFields>({
		name: '',
		symbol: '',
		decimals: '0',
		maxSupply: ''
	});

	// Templates available for the active tag. okinoko-terminal ships these
	// as a static config (github-templates.json) - the deployer's
	// /api/deployed-codes endpoint returns on-chain code hashes, not
	// build sources, so it can't be used here.
	const availableTemplates = useMemo(
		() => templates.filter((t) => t.tag === type),
		[templates, type]
	);
	const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
	useEffect(() => {
		// When the user flips the type tab, reset the dropdown to the
		// first template of that tag (or empty if there isn't one).
		setSelectedTemplateId(availableTemplates[0]?.id ?? '');
	}, [availableTemplates]);
	const selectedTemplate =
		availableTemplates.find((t) => t.id === selectedTemplateId) ?? availableTemplates[0];

	const subscribeRef = useRef<(() => void) | null>(null);
	useEffect(() => () => subscribeRef.current?.(), []);

	const fields = type === 'nft' ? nftFields : tokenFields;

	const validation = useMemo(() => {
		if (!username) return { ok: false, err: 'Connect a wallet first.' };
		if (!fields.name.trim()) return { ok: false, err: 'Name is required.' };
		if (!fields.symbol.trim()) return { ok: false, err: 'Symbol is required.' };
		if (type === 'nft') {
			// Match okinoko's NftInitPopup: baseUri must end with `/` so
			// per-token URIs concatenate cleanly. Empty is allowed.
			const b = nftFields.baseUri.trim();
			if (b && !b.endsWith('/'))
				return { ok: false, err: 'Base URI must end with a trailing slash (`/`).' };
		}
		if (type === 'token') {
			const dec = parseInt(tokenFields.decimals, 10);
			if (!Number.isFinite(dec) || dec < 0 || dec > 18)
				return { ok: false, err: 'Decimals must be between 0 and 18.' };
		}
		return { ok: true, err: null as string | null };
	}, [username, fields, type, tokenFields.decimals, nftFields.baseUri]);

	/**
	 * Build the okinoko-shaped collection_metadata JSON from the simple
	 * description + icon fields. Returns `undefined` when both are
	 * empty so we don't write an empty object into contract state.
	 */
	function buildNftMetadata(f: NftInitFields): string | undefined {
		const meta: Record<string, string> = {};
		if (f.description.trim()) meta.description = f.description.trim();
		if (f.iconUrl.trim()) meta.icon = f.iconUrl.trim();
		return Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined;
	}

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

		if (!selectedTemplate) {
			setStage('error');
			setError(
				`No ${type} template configured. Pass \`templates\` prop to provide one.`
			);
			return;
		}
		const fullName = fields.name.trim();
		const startedAt = new Date();

		appendLog({
			level: 'INFO',
			timestamp: startedAt.toISOString(),
			message: `Preparing deploy from ${selectedTemplate.repo}@${selectedTemplate.branch} (tag=${type})…`
		});

		let deploymentId: string;
		try {
			const r = await deployer.prepareDeploy({
				repo: selectedTemplate.repo,
				branch: selectedTemplate.branch,
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

	async function onDeployerResult(result: DeployResult, _startedAt: Date) {
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
		// Anchor the indexer poll to the moment immediately *before*
		// broadcast - tighter than `_startedAt` (which is when the build
		// kicked off, several seconds earlier). The contract can't have
		// been registered before this point, so any post-`broadcastAt`
		// contract from this user is the one we just signed for.
		const broadcastAt = new Date();
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
			since: broadcastAt
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
						trackMinted: nftFields.trackMinted,
						metadata: buildNftMetadata(nftFields)
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

	// Confirm before closing while a deploy is in flight - the user can
	// otherwise lose the deploy txid mid-way (signed deploy already
	// broadcast, init not yet signed) which leaves an orphan contract
	// they'd have to init separately.
	const inFlight =
		stage === 'building' ||
		stage === 'signing-deploy' ||
		stage === 'waiting-contract' ||
		stage === 'signing-init';
	function handleClose() {
		if (
			inFlight &&
			!window.confirm(
				'A deploy is still in progress. Closing now may abandon the partially-deployed contract. Close anyway?'
			)
		) {
			return;
		}
		onClose();
	}

	return (
		<Modal
			title={`Deploy ${type === 'nft' ? 'NFT collection' : 'token contract'}`}
			subtitle={subtitle}
			onClose={handleClose}
		>
			{!lockType && stage === 'form' && (
				<div className="magi-token-tabs" style={{ marginBottom: '0.6rem' }}>
					<button
						type="button"
						className={`magi-token-tab ${type === 'nft' ? 'active' : ''}`}
						onClick={() => setType('nft')}
					>
						NFT collection
					</button>
					<button
						type="button"
						className={`magi-token-tab ${type === 'token' ? 'active' : ''}`}
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
							<Field label="Description" hint="Short description of the collection. Stored in collection_metadata.">
								<TextInput
									value={nftFields.description}
									onChange={(v) => setNftFields((p) => ({ ...p, description: v }))}
									placeholder="A series of generative art pieces"
								/>
							</Field>
							<Field
								label="Collection icon URL"
								hint="Image shown next to the collection name in widgets. Stored in collection_metadata.icon."
							>
								<TextInput
									value={nftFields.iconUrl}
									onChange={(v) => setNftFields((p) => ({ ...p, iconUrl: v }))}
									placeholder="https://example.com/cover.png"
								/>
							</Field>
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

					{availableTemplates.length > 1 && (
						<Field
							label="Source template"
							hint="Built by the deployer backend. Override via the `templates` prop."
						>
							<select
								className="magi-token-input-wrap"
								style={{ padding: '0.55rem 0.7rem', fontSize: '0.85rem' }}
								value={selectedTemplate?.id ?? ''}
								onChange={(e) => setSelectedTemplateId(e.currentTarget.value)}
							>
								{availableTemplates.map((t) => (
									<option key={t.id} value={t.id}>
										{t.label}
									</option>
								))}
							</select>
						</Field>
					)}
					{availableTemplates.length === 0 && (
						<p className="magi-token-status error">
							No <code>{type}</code> source template configured. Pass a{' '}
							<code>templates</code> prop with a matching <code>tag</code> to
							offer one.
						</p>
					)}
					{availableTemplates.length === 1 && (
						<p
							style={{
								fontSize: '0.7rem',
								color: 'var(--magi-text-muted)',
								margin: '0.2rem 0'
							}}
						>
							Building from{' '}
							<code>
								{selectedTemplate?.repo}@{selectedTemplate?.branch}
							</code>
						</p>
					)}
					{validation.err && (
						<p className="magi-token-status error">{validation.err}</p>
					)}
					<button
						type="button"
						className="magi-token-submit"
						disabled={!validation.ok || availableTemplates.length === 0}
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
					onDone={handleClose}
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

			{(stage === 'waiting-contract' || stage === 'building') && (
				<div className="magi-token-spinner-row" role="status" aria-live="polite">
					<span className="magi-token-spinner" aria-hidden="true" />
					<span>
						{stage === 'waiting-contract'
							? 'Waiting for the indexer to register the new contract id - this can take a minute or two…'
							: 'Building the contract wasm on the deployer…'}
					</span>
				</div>
			)}

			{logs.length > 0 && <DeployLogPane logs={logs} />}

			{error && <p className="magi-token-status error">{error}</p>}

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
					<div className="magi-token-success" style={{ marginTop: 0 }}>
						<span className="magi-token-success-label">vsc:</span>
						<code className="magi-token-success-tx" title={contractId}>
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
				<button type="button" className="magi-token-submit ghost" onClick={onDone}>
					{stage === 'done' ? 'Done' : 'Close'}
				</button>
			)}
		</div>
	);
}

/**
 * Streaming log pane used by the deploy progress view. Sticks to the
 * bottom whenever new lines arrive (so the latest output is always
 * visible without manual scrolling), but releases the stick when the
 * user scrolls up - that way someone reading earlier output doesn't get
 * yanked back down by the next log line. Long lines wrap inside the
 * pane instead of producing a horizontal scrollbar.
 */
function DeployLogPane({ logs }: { logs: DeployLogEntry[] }) {
	const ref = useRef<HTMLPreElement>(null);
	const stickRef = useRef(true);

	useEffect(() => {
		const el = ref.current;
		if (!el || !stickRef.current) return;
		// Use rAF so the DOM has the new line laid out before we measure.
		const id = requestAnimationFrame(() => {
			el.scrollTop = el.scrollHeight;
		});
		return () => cancelAnimationFrame(id);
	}, [logs]);

	function onScroll() {
		const el = ref.current;
		if (!el) return;
		// 12px slack so a brief overshoot during smooth-scroll still
		// counts as "at the bottom" - otherwise the stick can flicker off
		// each time a new line lands.
		stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
	}

	return (
		<pre
			ref={ref}
			onScroll={onScroll}
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
				whiteSpace: 'pre-wrap',
				overflowWrap: 'anywhere',
				wordBreak: 'break-word',
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
	);
}
