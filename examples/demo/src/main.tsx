import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Aioha, KeyTypes, type Providers } from '@aioha/aioha';
import {
	MagiAssets,
	MagiContractDeploy,
	MagiNftPanel,
	MagiTokenPanel,
	magiFallbackImage
} from '@vsc.eco/nft-widget';
import {
	createNftClient,
	MAINNET_CONFIG,
	TokenAmount
} from '@vsc.eco/token-sdk';

// Optional dark theme - toggled at runtime in the demo.
import '@vsc.eco/nft-widget/themes/altera-dark.css';

type Theme = 'light' | 'dark';

/**
 * Sections rendered on the page, in the order they appear. Each entry's
 * `id` matches the corresponding `<h2 id="...">` so the sticky sidebar
 * can both jump to and highlight the active section.
 */
const SECTIONS: Array<{ id: string; label: string }> = [
	{ id: 'install', label: 'Installation' },
	{ id: 'auth', label: 'Auth setup' },
	{ id: 'assets', label: '<MagiAssets>' },
	{ id: 'nft-panel', label: '<MagiNftPanel>' },
	{ id: 'token-panel', label: '<MagiTokenPanel>' },
	{ id: 'deploy', label: 'Deploy contract' },
	{ id: 'locked', label: 'Locked mode' },
	{ id: 'headless-reads', label: 'Headless: reads' },
	{ id: 'headless-ops', label: 'Headless: ops' },
	{ id: 'headless-images', label: 'Headless: images' },
	{ id: 'custom-signer', label: 'Custom signer' },
	{ id: 'web-component', label: 'Web component' },
	{ id: 'theming', label: 'Theming' },
	{ id: 'failover', label: 'Endpoint failover' },
	{ id: 'proof', label: 'What this demo proves' }
];

/**
 * Hook: track which section is currently in view via IntersectionObserver.
 * Picks the topmost intersecting heading so the sidebar stays in sync as
 * the user scrolls. Cleans up its observer on unmount.
 */
function useActiveSection(ids: readonly string[]): string {
	const [activeId, setActiveId] = useState<string>(ids[0] ?? '');
	useEffect(() => {
		const headings = ids
			.map((id) => document.getElementById(id))
			.filter((el): el is HTMLElement => !!el);
		if (!headings.length) return;
		// rootMargin biases towards "what the reader is looking at right
		// now" by ignoring the very top edge and most of the bottom.
		const obs = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (visible[0]) setActiveId(visible[0].target.id);
			},
			{ rootMargin: '-15% 0px -70% 0px', threshold: 0 }
		);
		headings.forEach((h) => obs.observe(h));
		return () => obs.disconnect();
	}, [ids]);
	return activeId;
}

interface ResolvedImage {
	tokenId: string;
	templateId: string | null;
	url: string | null;
}

function DemoApp() {
	const [aioha, setAioha] = useState<Aioha | null>(null);
	const [username, setUsername] = useState<string | undefined>(undefined);
	const [theme, setTheme] = useState<Theme>('light');
	const [lastTx, setLastTx] = useState<string | null>(null);

	useEffect(() => {
		const instance = new Aioha();
		instance.registerKeychain();
		instance.registerHiveSigner({
			app: 'magi-token-sdk-demo',
			callbackURL: typeof window !== 'undefined' ? window.location.origin : ''
		});
		instance.registerHiveAuth({ name: 'magi-token-sdk-demo' });
		const existing = instance.loadAuth();
		if (existing) setUsername(instance.getCurrentUser() ?? undefined);
		setAioha(instance);
	}, []);

	useEffect(() => {
		document.body.dataset.theme = theme;
	}, [theme]);

	async function connect() {
		if (!aioha) return;
		const providers = aioha.getProviders();
		const first =
			providers.find((p) => p === 'keychain') ??
			providers.find((p) => p === 'hiveauth') ??
			providers[0];
		if (!first) return;
		const user = window.prompt('Hive username:');
		if (!user) return;
		const res = await aioha.login(first as Providers, user, {
			msg: 'Sign in to Magi Token SDK demo',
			keyType: KeyTypes.Posting
		});
		if (res.success) setUsername(aioha.getCurrentUser() ?? user);
		else alert(`Login failed: ${res.error}`);
	}
	async function disconnect() {
		if (!aioha) return;
		await aioha.logout();
		setUsername(undefined);
	}

	const themedClass = theme === 'dark' ? 'magi-nft-altera-host' : '';
	const connected = !!username;
	const [deployOpen, setDeployOpen] = useState(false);
	const sectionIds = useMemo(() => SECTIONS.map((s) => s.id), []);
	const activeId = useActiveSection(sectionIds);

	return (
		<div className="layout">
			<aside className="toc">
				<p className="toc-title">On this page</p>
				<ul>
					{SECTIONS.map((s) => (
						<li key={s.id}>
							<a
								href={`#${s.id}`}
								className={activeId === s.id ? 'active' : ''}
								onClick={(e) => {
									// Use smooth scroll programmatically; the default
									// browser jump feels abrupt in a long doc.
									e.preventDefault();
									document
										.getElementById(s.id)
										?.scrollIntoView({ behavior: 'smooth', block: 'start' });
									history.replaceState(null, '', `#${s.id}`);
								}}
							>
								{s.label}
							</a>
						</li>
					))}
				</ul>
			</aside>
			<main className="main">
			<h1>Magi Token SDK</h1>
			<p className="intro">
				Drop-in NFT + token panels for the Magi network. Implements the
				official Magi NFT (ERC-1155-style) and token (ERC-20-style) contract
				standards from{' '}
				<a
					href="https://github.com/vsc-eco/magi_nft-contract"
					target="_blank"
					rel="noopener noreferrer"
				>
					magi_nft-contract
				</a>{' '}
				and{' '}
				<a
					href="https://github.com/vsc-eco/magi_token-contract"
					target="_blank"
					rel="noopener noreferrer"
				>
					magi_token-contract
				</a>
				. Renders collections, balances, transfer / burn / batch-transfer /
				mint / deploy / distribute flows, with a headless mode for hosts
				that build their own UI.
			</p>

			{/* ============== Wallet status (prominent CTA) ============== */}

			<div className={`wallet-bar ${connected ? 'connected' : 'disconnected'}`}>
				<div className="wallet-bar-icon" aria-hidden="true">
					{connected ? (
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<polyline points="20 6 9 17 4 12" />
						</svg>
					) : (
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<rect x="3" y="6" width="18" height="13" rx="2" />
							<path d="M3 10h18" />
							<circle cx="16" cy="14" r="1" fill="currentColor" />
						</svg>
					)}
				</div>
				<div className="wallet-bar-body">
					<div className="wallet-bar-title">
						{connected ? (
							<>
								Connected as <code>@{username}</code>
							</>
						) : (
							'Connect your wallet to use the interactive widgets below'
						)}
					</div>
					<div className="wallet-bar-sub">
						{connected
							? 'Network: mainnet · transfers, burns, and approvals are live'
							: 'Read-only mode is fine for browsing; signing requires a Hive wallet'}
						{lastTx && (
							<>
								{' · last tx: '}
								<a
									href={`https://vsc.techcoderx.com/tx/${lastTx}`}
									target="_blank"
									rel="noopener noreferrer"
								>
									<code>{lastTx.slice(0, 10)}…</code>
								</a>
							</>
						)}
					</div>
				</div>
				<div className="wallet-bar-actions">
					{connected ? (
						<button onClick={disconnect}>Disconnect</button>
					) : (
						<button className="primary" onClick={connect}>
							Connect Hive wallet
						</button>
					)}
				</div>
			</div>

			{/* ============== Theme ============== */}

			<div className="theme-row">
				<span>
					<strong>Theme:</strong>
				</span>
				<button
					className={theme === 'light' ? 'active' : ''}
					onClick={() => setTheme('light')}
				>
					Light
				</button>
				<button
					className={theme === 'dark' ? 'active' : ''}
					onClick={() => setTheme('dark')}
				>
					Altera dark
				</button>
				<span style={{ color: '#64748b' }}>
					- driven by CSS custom properties on <code>.magi-nft</code>
				</span>
			</div>

			{/* ============== Installation ============== */}

			<h2 id="install">Installation</h2>
			<p>
				Three packages, mirroring{' '}
				<a
					href="https://github.com/vsc-eco/crosschain-sdk"
					target="_blank"
					rel="noopener noreferrer"
				>
					@vsc.eco/crosschain-sdk
				</a>
				. Install only the layer you need.
			</p>
			<pre className="code">
				<Code>{INSTALL_SNIPPET}</Code>
			</pre>
			<ul>
				<li>
					<code>@vsc.eco/nft-core</code> - operation builders and types. Zero deps.
				</li>
				<li>
					<code>@vsc.eco/token-sdk</code> - Hasura-indexed reads, broadcast orchestrator,
					per-token image resolver, multi-endpoint failover.
				</li>
				<li>
					<code>@vsc.eco/nft-widget</code> - React components + web components.
				</li>
			</ul>

			{/* ============== Auth setup ============== */}

			<h2 id="auth">Auth setup</h2>
			<p>
				All write operations sign through Aioha - same setup the okinoko-terminal,
				Altera, and the QuickSwap widget use. Register Keychain, HiveSigner, and
				HiveAuth once at app boot; the SDK picks the connected provider when the
				user clicks an action button.
			</p>
			<pre className="code">
				<Code>{AUTH_SNIPPET}</Code>
			</pre>
			<p className="callout">
				<strong>Don't use Aioha?</strong> Pass an <code>onBroadcast</code> hook
				instead - see the <a href="#custom-signer">custom signer</a> section
				below. The SDK still builds the operations; your callback only signs and
				broadcasts.
			</p>

			{/* ============== Quick start ============== */}

			<h2 id="assets">
				Quick start - <code>&lt;MagiAssets&gt;</code>
			</h2>
			<p>
				Single drop-in component that tabs between NFTs and tokens. Most hosts
				only need this. Headers, action modals, theming, and a built-in
				wallet-lookup search are all included. Set{' '}
				<code>enableUserSearch={`{false}`}</code> if you'd rather drive the
				viewed account programmatically via the <code>viewAccount</code> prop.
			</p>
			<pre className="code">
				<Code>{ASSETS_SNIPPET}</Code>
			</pre>
			<div className="live">
				{aioha && (
					<MagiAssets
						aioha={aioha}
						username={username}
						keyType={KeyTypes.Active}
						onSuccess={(tx) => setLastTx(tx)}
						className={themedClass}
					/>
				)}
			</div>

			{/* ============== NFT panel ============== */}

			<h2 id="nft-panel">
				<code>&lt;MagiNftPanel&gt;</code>
			</h2>
			<p>
				Lists every NFT the connected user holds, grouped by collection. Each
				tile has transfer + burn buttons; multi-token collections expose a
				batch-transfer affordance in the group header. Image resolution honours
				okinoko-terminal's exact priority: own props image → template props
				image (mintSeries inheritance) → <code>baseUri+tokenId</code>. Resolution
				fans out one <code>getStateByKeys</code> call per collection in parallel,
				and tiles repaint as each collection's response arrives - slow
				collections don't block fast ones.
			</p>
			<pre className="code">
				<Code>{NFT_SNIPPET}</Code>
			</pre>
			<div className="live">
				{aioha && (
					<MagiNftPanel
						aioha={aioha}
						username={username}
						keyType={KeyTypes.Active}
						onSuccess={(tx) => setLastTx(tx)}
						className={themedClass}
					/>
				)}
			</div>

			{/* ============== Token panel ============== */}

			<h2 id="token-panel">
				<code>&lt;MagiTokenPanel&gt;</code>
			</h2>
			<p>
				Lists the user's fungible-token balances with send + burn actions per
				row. <code>TokenAmount</code> from{' '}
				<code>@vsc.eco/token-sdk</code> handles per-token decimals - the action
				forms render values in human units and translate to smallest units when
				building the transfer op.
			</p>
			<pre className="code">
				<Code>{TOKEN_SNIPPET}</Code>
			</pre>
			<div className="live">
				{aioha && (
					<MagiTokenPanel
						aioha={aioha}
						username={username}
						keyType={KeyTypes.Active}
						onSuccess={(tx) => setLastTx(tx)}
						className={themedClass}
					/>
				)}
			</div>

			{/* ============== Deploy + init ============== */}

			<h2 id="deploy">
				Deploying a new contract - <code>&lt;MagiContractDeploy&gt;</code>
			</h2>
			<p>
				Optional dialog that combines{' '}
				<a
					href="https://github.com/vsc-eco/magi_nft-contract"
					target="_blank"
					rel="noopener noreferrer"
				>
					magi_nft-contract
				</a>{' '}
				/{' '}
				<a
					href="https://github.com/vsc-eco/magi_token-contract"
					target="_blank"
					rel="noopener noreferrer"
				>
					magi_token-contract
				</a>{' '}
				deployment with the contract's <code>init()</code> call into a single
				flow: build the wasm on the deployer backend, sign one deploy transaction,
				wait for the indexer to register the new contract id, sign one init
				transaction. The default endpoint is{' '}
				<code>{MAINNET_CONFIG.deployerUrl}</code> - override via{' '}
				<code>serviceUrl="https://your-deployer..."</code> to point at your own
				instance. Templates are filtered by tag (<code>nft</code> /{' '}
				<code>token</code>) so the form only offers the right wasm builds.
			</p>
			<pre className="code">
				<Code>{DEPLOY_SNIPPET}</Code>
			</pre>
			<p>
				Live trigger below. Requires a connected wallet (the deploy fee is paid
				via Aioha) and broadcasts <strong>real</strong> deploy + init
				transactions on mainnet.
			</p>
			<div className="live">
				<button
					className="magi-nft-submit"
					style={{ maxWidth: 280 }}
					disabled={!connected}
					onClick={() => setDeployOpen(true)}
				>
					{connected ? 'Open deploy dialog' : 'Connect wallet to deploy'}
				</button>
			</div>
			{deployOpen && (
				<MagiContractDeploy
					aioha={aioha ?? undefined}
					username={username}
					keyType={KeyTypes.Active}
					onClose={() => setDeployOpen(false)}
					onSuccess={(r) => setLastTx(r.initTxId)}
					className={themedClass}
				/>
			)}

			{/* ============== Locked / profile mode ============== */}

			<h2 id="locked">Locked mode</h2>
			<p>
				Profile pages, dashboards, and embeds for a specific community
				wallet usually want the panel pinned to one account with no search
				input. Pass <code>enableUserSearch={`{false}`}</code> to suppress
				the lookup row, and optionally <code>viewAccount</code> to fix the
				displayed account. When <code>viewAccount</code> differs from the
				connected <code>username</code>, the panel auto-flips to read-only
				and hides every write affordance.
			</p>
			<pre className="code">
				<Code>{LOCKED_SNIPPET}</Code>
			</pre>
			<p>
				Live example below: <code>viewAccount="diyhub"</code> with the
				search hidden - a real read-only profile embed showing diyhub's NFT
				holdings and DIY token balance. No wallet connection needed; works
				the same whether you're signed in or not.
			</p>
			<div className="live">
				<MagiAssets
					aioha={aioha ?? undefined}
					viewAccount="diyhub"
					enableUserSearch={false}
					className={themedClass}
				/>
			</div>

			{/* ============== Headless ============== */}

			<h2 id="headless-reads">Headless SDK - read providers</h2>
			<p>
				No UI - just data. Every panel above uses these reads internally; pull
				them directly when you build your own UI (Keychain extension flows,
				custom React Native screens, server-side rendering). Reads work without
				a connected wallet - they only need an account name.
			</p>

			<HeadlessReads username={username} />

			<h2 id="headless-ops">Headless SDK - building ops without broadcasting</h2>
			<p>
				Every action method has a sibling <code>*Op</code> method that returns
				the bundle without broadcasting. Use this when you want the SDK's
				payload formatting but a fully custom signing path -{' '}
				<code>bundle.op</code> is a Hive <code>custom_json</code> ready for
				dhive, <code>bundle.call</code> exposes the inner contract-call fields
				if you'd rather call <code>aioha.vscCallContract(...)</code> directly.
			</p>
			<pre className="code">
				<Code>{OP_SNIPPET}</Code>
			</pre>
			<HeadlessOp username={username} />

			{/* ============== Image resolver ============== */}

			<h2 id="headless-images">Headless SDK - resolving NFT images</h2>
			<p>
				<code>resolveNftImages(items)</code> mirrors the okinoko-terminal
				priority chain. One <code>getStateByKeys</code> per contract, batched
				across all token + template ids. Returns a Map keyed by{' '}
				<code>{`${'$'}{contractId}:${'$'}{tokenId}`}</code>.
			</p>
			<pre className="code">
				<Code>{IMAGE_SNIPPET}</Code>
			</pre>
			<HeadlessImages username={username} />

			{/* ============== Custom signer ============== */}

			<h2 id="custom-signer">Custom signer (no Aioha)</h2>
			<p>
				For Keychain-only apps, Peakd integrations, or backend signers, pass
				an <code>onBroadcast</code> hook instead of an Aioha instance. The SDK
				still builds and stringifies the operation; your callback signs and
				broadcasts however the host already does.
			</p>
			<pre className="code">
				<Code>{CUSTOM_SIGNER_SNIPPET}</Code>
			</pre>

			{/* ============== Web component ============== */}

			<h2 id="web-component">Web component (vanilla JS / Vue / Svelte)</h2>
			<p>
				Three custom elements register on import:{' '}
				<code>&lt;magi-nft-panel&gt;</code>,{' '}
				<code>&lt;magi-token-panel&gt;</code>, <code>&lt;magi-assets&gt;</code>.
				String, number, and boolean attributes pass through normally - the
				Aioha instance and any callback props must be set as JS properties on
				the element.
			</p>
			<pre className="code">
				<Code>{WEB_COMPONENT_SNIPPET}</Code>
			</pre>

			{/* ============== Theming ============== */}

			<h2 id="theming">Theming</h2>
			<p>
				Both panels expose the same CSS custom properties used by{' '}
				<code>@vsc.eco/crosschain-widget</code>, so a single host theme block
				styles the swap widget and the NFT widget consistently. Override any{' '}
				<code>--magi-*</code> variable on <code>.magi-nft</code> (or any
				ancestor). The <code>magi-nft-altera-host</code> class on a panel opts
				it into the bundled Altera dark theme - switch via the toggle at the
				top of this page.
			</p>
			<pre className="code">
				<Code>{THEMING_SNIPPET}</Code>
			</pre>

			<h2 id="failover">Endpoint failover</h2>
			<p>
				Both <code>indexerHasuraUrls</code> and <code>gqlUrls</code> accept
				ordered lists. The SDK tries each in turn - HTTP errors, network
				errors, GraphQL <code>errors[]</code> responses, and timeouts all
				trigger automatic failover to the next mirror. <code>MAINNET_CONFIG</code>{' '}
				ships with multiple endpoints by default; pass <code>fetchOptions</code>{' '}
				to plumb in <code>onAttempt</code> / <code>onError</code> hooks for
				telemetry.
			</p>
			<pre className="code">
				<Code>{FAILOVER_SNIPPET}</Code>
			</pre>

			<h2 id="proof">What this demo proves</h2>
			<ul>
				<li>Widgets render in plain HTML - zero framework imports beyond React.</li>
				<li>
					Read providers query the Magi indexer for live balances + collection
					state.
				</li>
				<li>
					Action forms build the same JSON payloads okinoko-terminal broadcasts
					today.
				</li>
				<li>
					Aioha handoff works for Keychain / HiveSigner / HiveAuth /
					PeakVault / Ledger.
				</li>
				<li>Headless mode (no UI) returns ready-to-broadcast operation bundles.</li>
				<li>Theme switching is purely CSS-variable driven - no rebuild needed.</li>
				<li>
					<code>viewAccount</code> mode lets the panels render any wallet's
					assets read-only - no signer, no actions.
				</li>
			</ul>
			</main>
		</div>
	);
}

/**
 * Tiny syntax-ish highlighter - just enough to make snippets readable
 * without a heavyweight dependency. Tokens detected: //-comments, single
 * and double-quoted strings, language keywords, capitalised types, JSX
 * tags. Anything not detected falls through as plain text.
 */
function Code({ children }: { children: string }) {
	const tokens: ReactNode[] = [];
	const re =
		/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\b(import|from|export|const|let|var|function|return|async|await|if|else|for|of|in|new|class|extends|interface|type|true|false|null|undefined|as|void)\b|\b([A-Z][A-Za-z0-9]+)\b|\b(\d+(?:\.\d+)?)\b/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(children)) !== null) {
		if (m.index > last) tokens.push(children.slice(last, m.index));
		if (m[1]) tokens.push(<span key={`c-${m.index}`} className="com">{m[1]}</span>);
		else if (m[2]) tokens.push(<span key={`s-${m.index}`} className="str">{m[2]}</span>);
		else if (m[3]) tokens.push(<span key={`k-${m.index}`} className="kw">{m[3]}</span>);
		else if (m[4]) tokens.push(<span key={`t-${m.index}`} className="typ">{m[4]}</span>);
		else if (m[5]) tokens.push(<span key={`n-${m.index}`} className="num">{m[5]}</span>);
		last = re.lastIndex;
	}
	if (last < children.length) tokens.push(children.slice(last));
	return <>{tokens}</>;
}

function HeadlessReads({ username }: { username: string | undefined }) {
	const client = useMemo(() => createNftClient({ config: MAINNET_CONFIG }), []);
	const [nftBalances, setNftBalances] = useState<unknown[] | null>(null);
	const [tokenBalances, setTokenBalances] = useState<unknown[] | null>(null);

	useEffect(() => {
		if (!username) {
			setNftBalances(null);
			setTokenBalances(null);
			return;
		}
		let cancelled = false;
		const account = username.startsWith('hive:') ? username : `hive:${username}`;
		client.nft.provider
			.getBalances(account)
			.then((rows) => {
				if (!cancelled) setNftBalances(rows);
			})
			.catch(() => {
				if (!cancelled) setNftBalances([]);
			});
		client.token.provider
			.getUserTokens(account)
			.then((rows) => {
				if (!cancelled) {
					setTokenBalances(
						rows.map((r) => ({
							contractId: r.contractId,
							symbol: r.info.symbol,
							balance: new TokenAmount(r.balance, r.info.decimals).toDecimalStringTrimmed()
						}))
					);
				}
			})
			.catch(() => {
				if (!cancelled) setTokenBalances([]);
			});
		return () => {
			cancelled = true;
		};
	}, [client, username]);

	const bare = username?.replace(/^hive:/, '');
	return (
		<>
			<pre className="code">
				<Code>{READS_SNIPPET}</Code>
			</pre>
			<p>
				<strong>NFT balances</strong>
				{bare ? ` for @${bare}:` : ' (connect a wallet or search above):'}
			</p>
			<pre className="code">
				{!username
					? '// no account provided'
					: nftBalances === null
						? 'loading…'
						: JSON.stringify(nftBalances, null, 2) || '[]'}
			</pre>
			<p>
				<strong>Token balances</strong>
				{bare ? ` for @${bare}:` : ' (connect a wallet or search above):'}
			</p>
			<pre className="code">
				{!username
					? '// no account provided'
					: tokenBalances === null
						? 'loading…'
						: JSON.stringify(tokenBalances, null, 2) || '[]'}
			</pre>
		</>
	);
}

function HeadlessOp({ username }: { username: string | undefined }) {
	const client = useMemo(() => createNftClient({ config: MAINNET_CONFIG }), []);
	const sampleBundle = useMemo(() => {
		const contractId = 'vsc1BdrQ6EtbQ64rq2PkPd21x4MaLnVRcJj85d';
		const u = username ?? 'alice';
		const bare = u.replace(/^hive:/, '');
		return client.nft.transferOp(contractId, bare, {
			from: bare,
			to: 'bob',
			tokenId: 'card-001',
			amount: 1
		});
	}, [client, username]);
	return (
		<pre className="code">{JSON.stringify(sampleBundle, null, 2)}</pre>
	);
}

function HeadlessImages({ username }: { username: string | undefined }) {
	const client = useMemo(() => createNftClient({ config: MAINNET_CONFIG }), []);
	const [images, setImages] = useState<ResolvedImage[] | null>(null);

	useEffect(() => {
		if (!username) {
			setImages(null);
			return;
		}
		let cancelled = false;
		const account = username.startsWith('hive:') ? username : `hive:${username}`;
		(async () => {
			try {
				const items = await client.nft.provider.getUserNfts(account);
				if (cancelled) return;
				if (!items.length) {
					setImages([]);
					return;
				}
				const map = await client.nft.provider.resolveNftImages(items);
				if (cancelled) return;
				setImages(
					items.slice(0, 6).map((it) => ({
						tokenId: `${it.collection.symbol || '???'}#${it.tokenId}`,
						templateId: it.templateId ?? null,
						url: map.get(`${it.contractId}:${it.tokenId}`) ?? null
					}))
				);
			} catch {
				if (!cancelled) setImages([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [client, username]);

	if (!username)
		return (
			<pre className="code">{`// connect a wallet or search above to populate`}</pre>
		);
	if (images === null) return <pre className="code">resolving…</pre>;
	if (images.length === 0)
		return (
			<pre className="code">{`// no NFTs found for @${username.replace(/^hive:/, '')}`}</pre>
		);
	return (
		<>
			<pre className="code">{JSON.stringify(images, null, 2)}</pre>
			<div className="thumb-grid">
				{images.map((r) => (
					<div className="thumb" key={r.tokenId}>
						<div className="thumb-frame">
							{r.url ? (
								<img
									src={r.url}
									alt={r.tokenId}
									onError={(e) => {
										const el = e.currentTarget as HTMLImageElement;
										el.src = magiFallbackImage;
										el.classList.add('fallback');
									}}
								/>
							) : (
								<img className="fallback" src={magiFallbackImage} alt="no image" />
							)}
						</div>
						<code>{r.tokenId}</code>
						{r.templateId && <span className="thumb-template">tpl: {r.templateId}</span>}
					</div>
				))}
			</div>
		</>
	);
}

const INSTALL_SNIPPET = `// React app - pull the widget; it depends on the core + sdk packages
pnpm add @vsc.eco/nft-widget react react-dom @aioha/aioha

// Headless / no UI - pull just the SDK
pnpm add @vsc.eco/token-sdk

// Pure op builders, zero deps
pnpm add @vsc.eco/nft-core`;

const AUTH_SNIPPET = `import { Aioha, KeyTypes } from '@aioha/aioha';

const aioha = new Aioha();
aioha.registerKeychain();
aioha.registerHiveSigner({
  app: 'your-app',
  callbackURL: window.location.origin
});
aioha.registerHiveAuth({ name: 'your-app' });

// Restore an existing session on reload
aioha.loadAuth();

// Login when the user clicks "connect"
async function login(username: string) {
  const providers = aioha.getProviders();
  const first = providers.find((p) => p === 'keychain') ??
                providers.find((p) => p === 'hiveauth') ??
                providers[0];
  const res = await aioha.login(first, username, {
    msg: 'Sign in to Your App',
    keyType: KeyTypes.Posting
  });
  if (!res.success) throw new Error(res.error);
}`;

const ASSETS_SNIPPET = `import { MagiAssets } from '@vsc.eco/nft-widget';
import '@vsc.eco/nft-widget/styles.css';
import { KeyTypes } from '@aioha/aioha';

// The built-in search bar lets users look up any other wallet - when
// active, the panel auto-switches to read-only mode for that account.
// Pass enableUserSearch={false} to suppress it (drive viewAccount yourself).
<MagiAssets
  aioha={aiohaInstance}
  username="alice"
  keyType={KeyTypes.Active}
  onSuccess={(txId) => console.log('Broadcast:', txId)}
/>`;

const NFT_SNIPPET = `import { MagiNftPanel } from '@vsc.eco/nft-widget';
import '@vsc.eco/nft-widget/styles.css';

<MagiNftPanel
  aioha={aiohaInstance}
  username="alice"
  keyType={KeyTypes.Active}
  onSuccess={(txId) => console.log(txId)}
/>`;

const TOKEN_SNIPPET = `import { MagiTokenPanel } from '@vsc.eco/nft-widget';
import '@vsc.eco/nft-widget/styles.css';

<MagiTokenPanel
  aioha={aiohaInstance}
  username="alice"
  keyType={KeyTypes.Active}
  onSuccess={(txId) => console.log(txId)}
/>`;

const DEPLOY_SNIPPET = `import { MagiContractDeploy } from '@vsc.eco/nft-widget';
import '@vsc.eco/nft-widget/styles.css';

// Single dialog: deploy wasm -> sign deploy tx -> wait for the contract
// to be indexed -> sign init tx with the same form's name/symbol/etc.
// Closes by itself when the user clicks Done; onSuccess fires once both
// txs are broadcast and the new contract id is known.
{deployOpen && (
  <MagiContractDeploy
    aioha={aiohaInstance}
    username="alice"
    keyType={KeyTypes.Active}
    // serviceUrl="https://your-deployer.example.com"  // optional
    // defaultType="nft"                                // or "token"
    // lockType="nft"                                   // hide the tab strip
    onClose={() => setDeployOpen(false)}
    onSuccess={({ contractId, deployTxId, initTxId, type }) => {
      console.log(\`Deployed \${type} \${contractId}\`);
      console.log('deploy tx', deployTxId);
      console.log('init tx', initTxId);
    }}
  />
)}`;

const LOCKED_SNIPPET = `// Lock to the connected user, no search input.
// Useful for personal dashboards where the user can't switch identities.
<MagiAssets
  aioha={aiohaInstance}
  username="alice"
  keyType={KeyTypes.Active}
  enableUserSearch={false}
/>

// Lock to a specific account (read-only profile / community-wallet embeds).
// viewAccount differs from username so write actions are auto-hidden.
<MagiAssets
  username="alice"             // optional - signer is irrelevant in read-only mode
  viewAccount="diyhub"
  enableUserSearch={false}
/>

// No connected wallet at all - pure read-only embed.
// Drop into a static site to show a fixed wallet's holdings.
<MagiAssets
  viewAccount="diyhub"
  enableUserSearch={false}
/>`;

const READS_SNIPPET = `import { createNftClient, MAINNET_CONFIG, TokenAmount } from '@vsc.eco/token-sdk';

const client = createNftClient({ config: MAINNET_CONFIG });

// NFTs the account holds, joined with collection + token info
const items = await client.nft.provider.getUserNfts('hive:alice');

// Token balances joined with token info (name, symbol, decimals)
const tokens = await client.token.provider.getUserTokens('hive:alice');
for (const row of tokens) {
  const human = new TokenAmount(row.balance, row.info.decimals).toDecimalStringTrimmed();
  console.log(\`\${human} \${row.info.symbol}\`);
}`;

const OP_SNIPPET = `import { createNftClient, MAINNET_CONFIG } from '@vsc.eco/token-sdk';

const client = createNftClient({ config: MAINNET_CONFIG });

const { op, call } = client.nft.transferOp(
  'vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45',
  'alice',
  { from: 'alice', to: 'bob', tokenId: 'card-001', amount: 1 }
);

// Broadcast via dhive:
//   client.broadcast.sendOperations([op], activeKey)
// Or via Aioha.vscCallContract:
//   aioha.vscCallContract(call.contractId, call.action, call.payload,
//     call.rcLimit, call.intents, KeyTypes.Active)`;

const IMAGE_SNIPPET = `import { createNftClient, MAINNET_CONFIG } from '@vsc.eco/token-sdk';

const client = createNftClient({ config: MAINNET_CONFIG });

const items = await client.nft.provider.getUserNfts('hive:alice');
const imageMap = await client.nft.provider.resolveNftImages(items);

for (const item of items) {
  const url = imageMap.get(\`\${item.contractId}:\${item.tokenId}\`);
  console.log(item.tokenId, url ?? 'no image found');
}`;

const CUSTOM_SIGNER_SNIPPET = `import { MagiAssets } from '@vsc.eco/nft-widget';
import '@vsc.eco/nft-widget/styles.css';

<MagiAssets
  username="alice"
  onBroadcast={async (op) => {
    // Keychain example - adapt to whatever signer your host uses:
    return new Promise((resolve, reject) => {
      window.hive_keychain.requestBroadcast(
        'alice',
        [op],
        'Active',
        (res) => res.success
          ? resolve({ txId: res.result.id })
          : reject(new Error(res.message))
      );
    });
  }}
/>`;

const WEB_COMPONENT_SNIPPET = `<script type="module">
  import '@vsc.eco/nft-widget/webcomponent';
</script>

<magi-assets id="assets" username="alice"></magi-assets>

<script>
  const el = document.getElementById('assets');
  // Object props MUST be set as JS properties, not HTML attributes:
  el.aioha = yourAiohaInstance;
  el.keyType = KeyTypes.Active;
  el.onSuccess = (txId) => console.log(txId);
</script>`;

const THEMING_SNIPPET = `// Built-in Altera dark - opt-in via the host class on any panel
import '@vsc.eco/nft-widget/themes/altera-dark.css';
<MagiAssets className="magi-nft-altera-host" ... />

// Or override variables yourself
.my-host .magi-nft {
  --magi-card-bg: #fafafa;
  --magi-accent: #ff5e3a;
  --magi-accent-hover: #f04a23;
  --magi-text: #1a1a1a;
  /* full list in the README under "Theming" */
}`;

const FAILOVER_SNIPPET = `import { createNftClient } from '@vsc.eco/token-sdk';

const client = createNftClient({
  config: {
    network: 'vsc-mainnet',
    indexerHasuraUrls: [
      'https://indexer.magi.milohpr.com/v1/graphql',
      'https://api.okinoko.io/hasura/v1/graphql'
    ],
    gqlUrls: [
      'https://api.vsc.eco/api/v1/graphql',
      'https://vsc.techcoderx.com/api/v1/graphql'
    ]
  },
  fetchOptions: {
    timeoutMs: 5000,
    onAttempt: (url, i) => console.debug(\`[gql] try #\${i}: \${url}\`),
    onError:   (url, i, err) => console.warn(\`[gql] \${url} failed: \${err.message}\`)
  }
});`;

const root = createRoot(document.getElementById('root')!);
root.render(
	<React.StrictMode>
		<DemoApp />
	</React.StrictMode>
);
