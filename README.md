# Magi Token SDK

**Live demo + docs:** https://token-sdk.okinoko.io

Embeddable NFT + token panels for the Magi network. Same scope as the NFT and token panels in [okinoko-terminal](https://terminal.okinoko.io) — your collections, your balances, transfer / burn / batch-transfer / mint / deploy / distribute — packaged as a drop-in widget for any Hive app, with a headless mode for hosts that build their own UI.

Built for **Hive Keychain**, **Peakd**, **Ecency**, and any app that wants to give users a one-tag NFT inventory + token wallet + send / mint / deploy flow.

## Packages

| Package | Description |
|---|---|
| [`@vsc.eco/token-core`](packages/core) | NFT (ERC-1155) + token (ERC-20) operation builders, types, decimal helpers. Zero runtime deps. |
| [`@vsc.eco/token-sdk`](packages/sdk) | Hasura-indexed read providers (collections, balances, token info), broadcast orchestrator with chunked-batch support, deployer client. |
| [`@vsc.eco/token-widget`](packages/widget) | React components + web components — `<MagiNftPanel>`, `<MagiTokenPanel>`, `<MagiAssets>`, plus per-action forms and a deploy modal. |

The split mirrors [`@vsc.eco/crosschain-sdk`](../crosschain-sdk): pull only the layer you need.

## What's in the panels

The widget renders the same flows the okinoko-terminal NFT/token panel exposes:

| View | Holder actions | Owner actions |
|---|---|---|
| `MagiNftPanel` — your NFTs grouped by collection | per-tile transfer, per-tile burn, collection-level batch transfer, single-NFT distribute (editioned), batch distribute (1 per recipient) | mint into your collection, edit collection (baseUri / metadata / icon / ownership transfer), deploy a new collection |
| `MagiTokenPanel` — your fungible-token balances | send, burn, distribute (paste a recipient list, 1 transfer per recipient) | mint, deploy a new token |
| `MagiAssets` — combined panel with a tab strip | both of the above | both of the above |

Action forms ship as named exports too — hosts that already render their own NFT inventory can keep their UI and only adopt the modals:

```ts
import {
  // NFT actions
  NftTransferForm,            // single-NFT transfer + distribute (editioned)
  NftBatchTransferForm,       // multi-id batch transfer + distribute
  NftBurnForm,
  NftMintForm,                // owner-only, simple/custom-JSON properties
  NftEditCollectionForm,      // owner-only, baseUri / metadata / ownership
  // Token actions
  TokenTransferForm,          // single-recipient + distribute
  TokenBurnForm,
  TokenMintForm,              // owner-only
  // Deploy
  MagiContractDeploy          // deploy + init in one dialog (NFT or token)
} from '@vsc.eco/token-widget';
```

## Integration paths

### 1. React app (combined panel)

```tsx
import { MagiAssets } from '@vsc.eco/token-widget';
import '@vsc.eco/token-widget/styles.css';

<MagiAssets
  aioha={aiohaInstance}
  username="lordbutterfly"
  keyType={KeyTypes.Active}        // from @aioha/aioha
  enableDeploy                     // show "Deploy collection / token" button
  enableRefresh                    // show top-right refresh button
  enableUserSearch                 // let users browse another account
  onSuccess={(txId) => console.log('Broadcast:', txId)}
/>
```

### 2. React app (NFT-only or token-only)

```tsx
import { MagiNftPanel, MagiTokenPanel } from '@vsc.eco/token-widget';
import '@vsc.eco/token-widget/styles.css';

<MagiNftPanel aioha={aioha} username={username} keyType={KeyTypes.Active} enableDeploy enableRefresh />
<MagiTokenPanel aioha={aioha} username={username} keyType={KeyTypes.Active} enableDeploy enableRefresh />
```

### 3. Web component (Peakd / Vue / vanilla JS)

```html
<script type="module">
  import '@vsc.eco/token-widget/webcomponent';
</script>

<magi-assets id="assets" username="lordbutterfly"></magi-assets>

<script>
  const el = document.getElementById('assets');
  // Object props MUST be set as JS properties, not HTML attributes:
  el.aioha = yourAiohaInstance;
  el.keyType = KeyTypes.Active;
  el.onSuccess = (txId) => console.log(txId);
</script>
```

`<magi-token-panel>` and `<magi-token-panel>` are also registered.

### 4. Locked / read-only viewer

Render an account's holdings without enabling actions or letting visitors switch user. Useful for embeds in a profile page.

```tsx
<MagiAssets
  username={undefined}
  viewAccount="diyhub"     // hard-locked to this account
/>
```

### 5. Headless (no UI)

Use this when you want to build your own UI on top — Keychain extension flows, custom React Native screens, backend signers, etc. The SDK gives you the read providers, op builders, and a chunked-broadcast orchestrator; you do the rendering.

```ts
import { createNftClient, MAINNET_CONFIG } from '@vsc.eco/token-sdk';

const client = createNftClient({ config: MAINNET_CONFIG });

// Reads — same as the widget uses internally.
const nfts = await client.nft.provider.getUserNfts('hive:lordbutterfly');
const owned = await client.nft.provider.getCollectionsByOwner('hive:lordbutterfly');

// Build an op without broadcasting. Sign + broadcast yourself.
const { op, call } = client.nft.transferOp(
  'vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45',
  'lordbutterfly',
  { from: 'lordbutterfly', to: 'alice', tokenId: 'card-001', amount: 1 }
);

// Distribute one NFT copy per recipient — the same chunked path the widget uses.
const bundles = recipients.map((to) =>
  client.nft.transferOp(contractId, 'lordbutterfly', {
    from: 'lordbutterfly', to, tokenId: 'card-001', amount: 1
  })
);
await client.broadcastBatch(bundles, {
  chunkSize: 4,                 // Hive caps custom_json at ~5 ops/account/block
  delayBetweenChunksMs: 4000,   // wait for a fresh block between chunks
  onProgress: (i) => console.log(`signed chunk ${i + 1}`),
  onWaiting:  (next, total, ms) => console.log(`waiting ${ms}ms before chunk ${next + 1}/${total}`)
});
```

### 6. Direct signer (Peakd, Keychain-only apps, backends)

For hosts that don't use Aioha, pass an `onBroadcast` callback. The SDK still builds the ops; your callback only signs and broadcasts via whatever pipeline the host has.

```tsx
import { MagiNftPanel } from '@vsc.eco/token-widget';
import '@vsc.eco/token-widget/styles.css';

<MagiNftPanel
  username="alice"
  onBroadcast={async (op) => {
    // window.hive_keychain.requestBroadcast(...)
    return { txId: '...' };
  }}
/>
```

`onBroadcast` takes precedence over `aioha` when both are set.

### 7. Bring-your-own UI, our action modals

```tsx
import { NftTransferForm, NftMintForm, MagiContractDeploy } from '@vsc.eco/token-widget';
import { createNftClient } from '@vsc.eco/token-sdk';

const client = createNftClient({ aioha });

// Your own NFT list, your own "Transfer" CTA. Open the SDK's modal on click.
{showTransfer && (
  <NftTransferForm
    client={client}
    username="alice"
    item={selectedItem}
    onClose={() => setShowTransfer(false)}
    onSuccess={(tx) => console.log(tx)}
  />
)}

// Owner-only mint, opens the simple/custom-JSON properties form.
{showMint && (
  <NftMintForm
    client={client}
    username="alice"
    collection={selectedCollection}
    onClose={() => setShowMint(false)}
  />
)}

// Deploy a new collection or token in one dialog.
{showDeploy && (
  <MagiContractDeploy
    client={client}
    username="alice"
    onClose={() => setShowDeploy(false)}
    onDeployed={(contractId) => console.log('new contract:', contractId)}
  />
)}
```

## Highlights of what the panels do for you

- **Deploy + init in one flow** — `MagiContractDeploy` posts a build request to `deploy.okinoko.io`, streams the build log via SSE (auto-scroll, word-wrap, stage-pill progress, circular spinner during `building` / `waiting-contract`), polls the indexer for the new `contractId` (filtered by creator + creation timestamp so you only ever see *your* deployment), then opens the init dialog with sensible defaults. NFT init takes name / symbol / baseUri / description / collection icon URL or custom JSON; token init takes name / symbol / decimals.
- **Owner affordances** — pencil icon on collections you own opens `NftEditCollectionForm` (baseUri, simple `{description, icon}` or custom JSON metadata, optional ownership transfer under "Show advanced"); plus icon opens `NftMintForm` with the same simple/custom-JSON properties toggle as okinoko's `NftPropertiesInput`.
- **Distribute paths** — every transfer form has a "Distribute" tab when applicable. Token transfer always; NFT batch transfer always; single-NFT transfer when the token is editioned (`!isUnique && balance >= 2`). Each recipient becomes its own `safeTransferFrom` op, chunked + inter-block-delayed via `client.broadcastBatch`.
- **Hive per-block cap handled** — Hive accepts ~5 `custom_json` ops per account per block. The widget signs in chunks of 4 and waits 4s between chunks so each signed batch lands in a fresh block. Submit label cycles `Signing batch K/N…` → `Waiting for next block (Ts)…`.
- **Empty inventories still useful** — collections you own with 0 NFTs are listed (so you can mint into them without first holding one), and tokens you deployed before any supply exists show up in the token panel.
- **Image priority chain** — NFT images resolve via own `properties.image` → template (`mintSeries`) `properties.image` → `baseUri + tokenId`. Falls back to the bundled Magi logo so a panel never renders broken thumbnails.
- **Collection icons** — small circular thumbnails on each group header, sourced from the collection's `metadata.icon`.
- **Refresh + search** — `enableRefresh` adds a top-right refresh; `enableUserSearch` adds a search input to view another account.

## Props reference

### `<MagiNftPanel>` / `<MagiTokenPanel>` / `<MagiAssets>`

| Prop | Type | Description |
|---|---|---|
| `username` | `string` | Hive username (with or without `hive:` prefix). When omitted, panel renders a "Connect" empty state. |
| `aioha` | `AiohaLike` | Aioha instance. Not needed when `onBroadcast` is provided. |
| `onBroadcast` | `(op, keyType) => Promise<{ txId }>` | Bring-your-own signer. Takes precedence over `aioha`. |
| `keyType` | `KeyTypes` | Use `KeyTypes.Active` — every NFT/token write needs the active key. |
| `config` | `MagiConfig` | Defaults to `MAINNET_CONFIG` (multi-mirror failover). |
| `client` | `NftClient` | Pre-built SDK client. Skips internal `createNftClient(...)` if provided. |
| `viewAccount` | `string` | Hard-lock the panel to a specific account (read-only browse). |
| `enableUserSearch` | `boolean` | Show a search input for browsing other accounts. Ignored when `viewAccount` is set. |
| `enableDeploy` | `boolean` | Show the "Deploy collection / token" button (opens `MagiContractDeploy`). |
| `enableRefresh` | `boolean` | Show a top-right refresh button. |
| `refreshSeq` | `number` | Increment to force a re-fetch from the parent. |
| `onSuccess` | `(txId: string) => void` | Fires after every successful broadcast in any action form. |
| `className` | `string` | Extra class on the root element (use `magi-token-light-host` to opt into the light theme). |
| `hideHeader` | `boolean` | Drop the badge + subtitle. |
| `bare` | `boolean` | Skip the outer card chrome — use when nesting inside another `.magi-token` host. |

### `<MagiContractDeploy>`

| Prop | Type | Description |
|---|---|---|
| `client` | `NftClient` | Required — used for the indexer poll that finds the new contract id. |
| `username` | `string` | Required — used as deployer + initial owner. |
| `aioha` / `onBroadcast` | as above | Used for the init transaction. |
| `kind` | `'nft' \| 'token' \| undefined` | Force a kind, or omit to let the user pick in the dialog. |
| `onDeployed` | `(contractId: string) => void` | Fires after init confirms on-chain. |
| `onClose` | `() => void` | |

## Theming

Both widgets use CSS custom properties scoped to `.magi-token`. Override any `--magi-*` variable to match your host app — the variable naming matches `@vsc.eco/crosschain-widget` so a single host theme block styles both.

**Default is the Altera dark theme** — drop the panel into your app and you get the polished Magi look out of the box. A light theme is bundled as an opt-in:

```ts
import '@vsc.eco/token-widget/themes/light.css';
// then add the host class to any panel (or any ancestor):
<MagiAssets className="magi-token-light-host" ... />
```

### Variables (Altera dark defaults)

| Variable | Default | Description |
|---|---|---|
| `--magi-card-bg` | translucent gradient | Card background |
| `--magi-card-border` | `rgba(255,255,255,0.15)` | Card border |
| `--magi-card-shadow` | layered drop + inner highlights | Card shadow |
| `--magi-accent` | `#6f6af8` | Primary accent (buttons, highlights) |
| `--magi-accent-hover` | `#7e74ff` | Accent hover |
| `--magi-green` / `--magi-red` | `#00c218` / `#e31337` | Success / error |
| `--magi-text` / `--magi-text-secondary` / `--magi-text-muted` | `#ffffff` / `#c0c4cc` / `#828a93` | Text scale |
| `--magi-field-bg` / `--magi-field-border` | `rgba(0,0,0,0.25)` / `rgba(255,255,255,0.08)` | Input fields |
| `--magi-tile-bg` / `--magi-tile-bg-hover` | `rgba(0,0,0,0.2)` / `rgba(255,255,255,0.04)` | NFT tile + token row |
| `--magi-font` | Nunito Sans, system-ui | Font family |

## Demo

```bash
pnpm install
pnpm demo        # starts on http://localhost:5173
```

The demo renders all three React components, the headless mode, the deploy widget, and toggles between the light and Altera-dark themes — all backed by the live Magi mainnet indexer. With a Hive Keychain wallet connected, every action broadcasts a real transaction.

## Architecture

```
@vsc.eco/token-core         pure ops + types        (no deps)
        ▲
        │
@vsc.eco/token-sdk        fetch + orchestrator    (node 18+ fetch / browser fetch)
        ▲
        │
@vsc.eco/token-widget       React + web component   (peer-deps on react, optional aioha)
```

- **Reads** → `client.nft.provider.getUserNfts(account)` calls the Magi indexer (Hasura) and the Magi node (`getStateByKeys` for collection metadata). Tables: `magi_nft_overview`, `magi_nft_balances`, `magi_nft_token_info`, `magi_nft_token_supply`, `magi_nft_template_tokens`, `magi_token_overview`, `magi_token_balances`. `getCollectionsByOwner` and `getOwnedTokens` cover the empty-inventory cases.
- **Endpoint failover** → both `indexerHasuraUrls` and `gqlUrls` accept ordered lists. The SDK tries each in turn — HTTP errors, network errors, GraphQL `errors[]` responses, and timeouts all trigger automatic failover to the next mirror. `MAINNET_CONFIG` ships with multiple endpoints by default. See the [SDK README](packages/sdk#endpoint-failover) for `onAttempt`/`onError` hooks and custom URL lists.
- **Writes** → every action goes through one operation builder. The output is a Hive `custom_json` op with `id: "vsc.call"` and a stringified inner payload (`net_id`, `caller`, `contract_id`, `action`, `payload`, `rc_limit`, `intents`). Aioha's `vscCallContract` produces this shape internally. `client.broadcastBatch` signs N ops in chunks (default 4) with a 4s wait between chunks so each batch lands in a fresh Hive block.
- **Signing** → defaults to `aioha.vscCallContract(...)`. Falls back to `aioha.signAndBroadcastTx([op], keyType)` when present, or a custom `onBroadcast` hook when injected.
- **Deploy** → `client.deployer.deploy({ kind, manifest, ... })` posts a build request to `https://deploy.okinoko.io` and returns an SSE-streamed log; `client.deployer.findContractAfter(creator, ts)` polls `findContract(historical: true)` until the new contract id appears.

## Development

```bash
pnpm install
pnpm build        # build all three packages
pnpm typecheck    # type-check everything
pnpm test         # run unit tests
pnpm demo         # start the demo at localhost:5173
```

## License

MIT.
