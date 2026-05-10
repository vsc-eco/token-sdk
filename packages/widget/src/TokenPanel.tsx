import { useEffect, useMemo, useState } from 'react';
import {
	createNftClient,
	MAINNET_CONFIG,
	TokenAmount,
	type AiohaLike,
	type BroadcastHook,
	type MagiConfig,
	type NftClient,
	type TokenBalance,
	type TokenInfo
} from '@vsc.eco/nft-sdk';
import { TokenTransferForm } from './actions/TokenTransferForm.js';
import { TokenBurnForm } from './actions/TokenBurnForm.js';
import { TokenMintForm } from './actions/TokenMintForm.js';
import { MagiContractDeploy } from './MagiContractDeploy.js';
import { RefreshButton } from './NftPanel.js';
import { UserSearch } from './components/UserSearch.js';

export interface MagiTokenPanelProps {
	/** The connected user's signing identity. */
	username?: string;
	aioha?: AiohaLike;
	onBroadcast?: BroadcastHook;
	keyType?: unknown;
	config?: MagiConfig;
	client?: NftClient;
	onSuccess?: (txId: string) => void;
	className?: string;
	hideHeader?: boolean;
	bare?: boolean;
	/**
	 * Account whose token balances to display. Defaults to `username`.
	 * When set to a different account the panel goes read-only - send and
	 * burn buttons disappear because the user can't sign for someone
	 * else's tokens. Internal search input takes precedence when active.
	 */
	viewAccount?: string;
	/** Render a built-in search input for looking up another wallet. */
	enableUserSearch?: boolean;
	/** Render a "Deploy token" button in the panel header. Default `true`. */
	enableDeploy?: boolean;
	/** Override the deployer service URL. Defaults to `config.deployerUrl`. */
	deployerUrl?: string;
	/** Render a refresh button in the panel's top-right corner. Default `true`. */
	enableRefresh?: boolean;
	/** External refresh trigger - bumping forces a reload from a parent. */
	refreshSeq?: number;
}

type ActionState =
	| { kind: 'send'; row: TokenBalance & { info: TokenInfo } }
	| { kind: 'burn'; row: TokenBalance & { info: TokenInfo } }
	| { kind: 'mint'; row: TokenBalance & { info: TokenInfo } }
	| null;

function isOwnedToken(info: TokenInfo, username: string | undefined): boolean {
	if (!username) return false;
	const ownerBare = (info.owner ?? '').replace(/^(@|hive:)+/, '').toLowerCase();
	const userBare = username.replace(/^(@|hive:)+/, '').toLowerCase();
	return !!ownerBare && ownerBare === userBare;
}

export function MagiTokenPanel(props: MagiTokenPanelProps) {
	const {
		username,
		aioha,
		onBroadcast,
		keyType,
		config = MAINNET_CONFIG,
		client: providedClient,
		onSuccess,
		className,
		hideHeader,
		bare,
		viewAccount,
		enableUserSearch = true,
		enableDeploy = true,
		deployerUrl,
		enableRefresh = true,
		refreshSeq
	} = props;
	const [deployOpen, setDeployOpen] = useState(false);
	const [refreshing, setRefreshing] = useState(false);

	const client = useMemo<NftClient>(
		() => providedClient ?? createNftClient({ config, aioha, onBroadcast, keyType }),
		[providedClient, config, aioha, onBroadcast, keyType]
	);

	const [rows, setRows] = useState<Array<TokenBalance & { info: TokenInfo }> | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reloadTick, setReloadTick] = useState(0);
	const [action, setAction] = useState<ActionState>(null);

	const [searchInput, setSearchInput] = useState('');
	const [internalView, setInternalView] = useState<string | undefined>(undefined);

	const { account, readOnly } = useMemo(() => {
		const bare = (s?: string) => s?.replace(/^(@|hive:)+/, '').toLowerCase() ?? null;
		const internalBare = bare(internalView);
		const viewBare = bare(viewAccount);
		const effective = internalBare ?? viewBare;
		const userBare = bare(username);
		const target = effective ?? userBare;
		if (!target) return { account: null as string | null, readOnly: false };
		return {
			account: `hive:${target}`,
			readOnly: effective != null && effective !== userBare
		};
	}, [username, viewAccount, internalView]);

	function commitSearch() {
		const cleaned = searchInput.trim().replace(/^(@|hive:)+/i, '').toLowerCase();
		setInternalView(cleaned || undefined);
	}
	function clearSearch() {
		setSearchInput('');
		setInternalView(undefined);
	}

	useEffect(() => {
		if (!account) {
			setRows(null);
			return;
		}
		let cancelled = false;
		setError(null);
		client.token.provider
			.getUserTokens(account)
			.then((data) => {
				if (!cancelled) {
					setRows(data);
					setRefreshing(false);
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
					setRefreshing(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [account, client, reloadTick]);

	useEffect(() => {
		if (refreshSeq === undefined) return;
		setRefreshing(true);
		setReloadTick((n) => n + 1);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [refreshSeq]);

	function handleRefresh() {
		setRefreshing(true);
		setReloadTick((n) => n + 1);
	}
	function handleSuccess(txId: string) {
		setReloadTick((n) => n + 1);
		onSuccess?.(txId);
	}

	const rootClass = bare
		? `magi-nft-bare ${className ?? ''}`.trim()
		: `magi-nft ${className ?? ''}`.trim();
	return (
		<div className={rootClass}>
			{enableRefresh && account && (
				<RefreshButton refreshing={refreshing} onClick={handleRefresh} />
			)}
			{!hideHeader && (
				<div className="magi-nft-header">
					<div className="magi-nft-badge">
						<span className="magi-nft-dot" />
						<span className="magi-nft-badge-text">
							{readOnly ? 'TOKENS - read only' : 'MAGI TOKENS'}
						</span>
					</div>
					<p className="magi-nft-subtitle">
						{readOnly
							? `Viewing @${account?.replace(/^hive:/, '')} - actions disabled`
							: 'Your fungible-token balances on the Magi network'}
					</p>
				</div>
			)}

			{(enableUserSearch || (enableDeploy && !readOnly && username)) && (
				<div className="magi-nft-toolbar">
					{enableUserSearch && (
						<UserSearch
							searchInput={searchInput}
							onChange={setSearchInput}
							onSubmit={commitSearch}
							onClear={clearSearch}
							readOnly={readOnly}
							connected={!!username}
							viewing={readOnly ? account?.replace(/^hive:/, '') ?? null : null}
						/>
					)}
					{enableDeploy && !readOnly && username && (
						<button
							type="button"
							className="magi-nft-toolbar-action"
							title="Deploy a new token contract"
							onClick={() => setDeployOpen(true)}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<line x1="12" y1="5" x2="12" y2="19" />
								<line x1="5" y1="12" x2="19" y2="12" />
							</svg>
							<span>Deploy</span>
						</button>
					)}
				</div>
			)}

			{!account && (
				<div className="magi-nft-state">Connect your Hive wallet to load tokens.</div>
			)}
			{account && rows === null && !error && <div className="magi-nft-state">Loading…</div>}
			{error && <div className="magi-nft-state magi-nft-status error">{error}</div>}
			{account && rows && rows.length === 0 && (
				<div className="magi-nft-state">
					No token balances for @{account.replace(/^hive:/, '')}.
				</div>
			)}

			<div className="magi-nft-token-list">
				{rows?.map((row) => {
					const amt = new TokenAmount(row.balance, row.info.decimals);
					const initials = row.info.symbol.slice(0, 3).toUpperCase();
					return (
						<div className="magi-nft-token-row" key={row.contractId}>
							<div className="magi-nft-token-icon">{initials}</div>
							<div className="magi-nft-token-info">
								<span className="magi-nft-token-name">{row.info.name}</span>
								<span className="magi-nft-token-symbol">{row.info.symbol}</span>
							</div>
							<div className="magi-nft-token-balance">
								<div className="magi-nft-token-balance-value">
									{amt.toDecimalStringTrimmed()}
								</div>
								<div className="magi-nft-token-balance-label">{row.info.symbol}</div>
							</div>
							{!readOnly && (
								<div className="magi-nft-token-actions">
									{isOwnedToken(row.info, username) && (
										<button
											type="button"
											className="magi-nft-icon-btn"
											title="Issue (mint)"
											onClick={() => setAction({ kind: 'mint', row })}
										>
											<MintIcon />
										</button>
									)}
									<button
										type="button"
										className="magi-nft-icon-btn"
										title={row.balance > 0n ? 'Send' : 'No balance to send'}
										disabled={row.balance <= 0n}
										onClick={() => setAction({ kind: 'send', row })}
									>
										<SendIcon />
									</button>
									<button
										type="button"
										className="magi-nft-icon-btn danger"
										title={row.balance > 0n ? 'Burn' : 'No balance to burn'}
										disabled={row.balance <= 0n}
										onClick={() => setAction({ kind: 'burn', row })}
									>
										<BurnIcon />
									</button>
								</div>
							)}
						</div>
					);
				})}
			</div>

			{!readOnly && action?.kind === 'send' && username && (
				<TokenTransferForm
					client={client}
					username={username}
					info={action.row.info}
					balance={action.row.balance}
					onSuccess={handleSuccess}
					onClose={() => setAction(null)}
				/>
			)}
			{deployOpen && username && (
				<MagiContractDeploy
					aioha={aioha}
					username={username}
					onBroadcast={onBroadcast}
					keyType={keyType}
					config={config}
					client={client}
					serviceUrl={deployerUrl}
					lockType="token"
					onClose={() => setDeployOpen(false)}
					onSuccess={(r) => {
						setDeployOpen(false);
						handleSuccess(r.initTxId);
					}}
				/>
			)}
			{!readOnly && action?.kind === 'mint' && username && (
				<TokenMintForm
					client={client}
					username={username}
					info={action.row.info}
					onSuccess={handleSuccess}
					onClose={() => setAction(null)}
				/>
			)}
			{!readOnly && action?.kind === 'burn' && username && (
				<TokenBurnForm
					client={client}
					username={username}
					info={action.row.info}
					balance={action.row.balance}
					onSuccess={handleSuccess}
					onClose={() => setAction(null)}
				/>
			)}
		</div>
	);
}

function SendIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<line x1="22" y1="2" x2="11" y2="13" />
			<polygon points="22 2 15 22 11 13 2 9 22 2" />
		</svg>
	);
}
function MintIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</svg>
	);
}
function BurnIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
		</svg>
	);
}
