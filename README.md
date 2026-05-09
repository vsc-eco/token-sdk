# Magi NFT SDK

Embeddable NFT + token panels for the Magi network. Same scope as the NFT and token panels in [okinoko-terminal](https://terminal.okinoko.io) — your collections, your balances, transfer / burn / batch-transfer actions — packaged as a drop-in widget for any Hive app, with a headless mode for hosts that build their own UI.

Built for **Hive Keychain**, **Peakd**, **Ecency**, and any app that wants to give users a one-tag NFT inventory + send flow.

## Packages

| Package | Description |
|---|---|
| [`@vsc.eco/nft-core`](packages/core) | NFT (ERC-1155) + token (ERC-20) operation builders, types, decimal helpers. Zero runtime deps. |
| [`@vsc.eco/nft-sdk`](packages/sdk) | Hasura-indexed read providers (collections, balances, token info), broadcast orchestrator. |
| [`@vsc.eco/nft-widget`](packages/widget) | React components + web components — `<MagiNftPanel>`, `<MagiTokenPanel>`, `<MagiAssets>`, plus per-action forms. |

The split mirrors [`@vsc.eco/crosschain-sdk`](../crosschain-sdk): you can pull only the layer you need.

## What's in the panels

The widget renders the same flows the okinoko-terminal NFT/token panel exposes:

| View | Actions |
|---|---|
| `MagiNftPanel` — your NFTs grouped by collection | per-tile transfer, per-tile burn, collection-level batch transfer |
| `MagiTokenPanel` — your fungible-token balances | send, burn |
| `MagiAssets` — combined panel with a tab strip | both of the above |

Action forms ship as named exports too (`NftTransferForm`, `NftBurnForm`, `NftBatchTransferForm`, `TokenTransferForm`, `TokenBurnForm`) so hosts that already render their own NFT inventory can keep their UI and only adopt the action modals.

## Integration paths

### 1. React app (combined panel)

```tsx
import { MagiAssets } from '@vsc.eco/nft-widget';
import '@vsc.eco/nft-widget/styles.css';

<MagiAssets
  aioha={aiohaInstance}
  username="lordbutterfly"
  keyType={KeyTypes.Active}        // from @aioha/aioha
  onSuccess={(txId) => console.log('Broadcast:', txId)}
/>
```

### 2. React app (NFT-only or token-only)

```tsx
import { MagiNftPanel, MagiTokenPanel } from '@vsc.eco/nft-widget';
import '@vsc.eco/nft-widget/styles.css';

<MagiNftPanel aioha={aioha} username={username} keyType={KeyTypes.Active} />
<MagiTokenPanel aioha={aioha} username={username} keyType={KeyTypes.Active} />
```

### 3. Web component (Peakd / Vue / vanilla JS)

```html
<script type="module">
  import '@vsc.eco/nft-widget/webcomponent';
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

`<magi-nft-panel>` and `<magi-token-panel>` are also registered.

### 4. Headless (no UI)

Use this when you want to build your own UI on top — Keychain extension flows, custom React Native screens, backend signers, etc. The SDK gives you the read providers and the operation builders; you do the rendering and the broadcasting.

```ts
import { createNftClient, MAINNET_CONFIG } from '@vsc.eco/nft-sdk';

const client = createNftClient({ config: MAINNET_CONFIG });

// Reads — identical to what the widget uses internally.
const nfts = await client.nft.provider.getUserNfts('hive:lordbutterfly');

// Build an op without broadcasting. Sign + broadcast yourself.
const { op, call } = client.nft.transferOp(
  'vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45',
  'lordbutterfly',
  { from: 'lordbutterfly', to: 'alice', tokenId: 'card-001', amount: 1 }
);

// `op` is a Hive `custom_json` operation: ['custom_json', { required_auths: [...], ... }]
// `call` is the inner contract-call payload — useful when broadcasting via
//        aioha.vscCallContract(call.contractId, call.action, call.payload, call.rcLimit, call.intents, keyType)
```

### 5. Direct signer (Peakd, Keychain-only apps, backends)

For hosts that don't use Aioha, pass an `onBroadcast` callback. The SDK still builds the ops; your callback only signs and broadcasts via whatever pipeline the host has.

```tsx
import { MagiNftPanel } from '@vsc.eco/nft-widget';
import '@vsc.eco/nft-widget/styles.css';

<MagiNftPanel
  username="alice"
  onBroadcast={async (op) => {
    // window.hive_keychain.requestBroadcast(...)
    return { txId: '...' };
  }}
/>
```

`onBroadcast` takes precedence over `aioha` when both are set.

### 6. Bring-your-own UI, our action modals

```tsx
import { NftTransferForm, NftBurnForm } from '@vsc.eco/nft-widget';
import { createNftClient } from '@vsc.eco/nft-sdk';

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
```

## Props reference

### `<MagiNftPanel>` / `<MagiTokenPanel>` / `<MagiAssets>`

| Prop | Type | Required | Description |
|---|---|---|---|
| `username` | `string` | for reads + signing | Hive username (with or without `hive:` prefix). When omitted, panel renders a "Connect" empty state. |
| `aioha` | `AiohaLike` | for signing | Aioha instance. Not needed when `onBroadcast` is provided. |
| `onBroadcast` | `(op, keyType) => Promise<{ txId }>` | optional | Bring-your-own signer. Takes precedence over `aioha`. |
| `keyType` | `KeyTypes` | for signing | Use `KeyTypes.Active` — every NFT/token write needs the active key. |
| `config` | `MagiConfig` | no | Defaults to `MAINNET_CONFIG`. |
| `client` | `NftClient` | no | Pre-built SDK client. Skips internal `createNftClient(...)` if provided. |
| `onSuccess` | `(txId: string) => void` | no | Fires after every successful broadcast in any action form. |
| `className` | `string` | no | Extra class on the root element (use `magi-nft-altera-host` for the dark theme). |
| `hideHeader` | `boolean` | no | Drop the badge + subtitle. |
| `bare` | `boolean` | no | Skip the outer card chrome — use when nesting inside another `.magi-nft` host. |

## Theming

Both widgets use CSS custom properties scoped to `.magi-nft`. Override any `--magi-*` variable to match your host app — the variable naming matches `@vsc.eco/crosschain-widget` so a single host theme block styles both.

Default is a neutral light theme. An Altera dark theme is available:

```ts
import '@vsc.eco/nft-widget/themes/altera-dark.css';
// then:
<MagiAssets className="magi-nft-altera-host" ... />
```

### Variables

| Variable | Default | Description |
|---|---|---|
| `--magi-card-bg` | `#ffffff` | Card background |
| `--magi-card-border` | `#e2e5e9` | Card border |
| `--magi-card-shadow` | subtle shadow | Card shadow |
| `--magi-accent` | `#4f46e5` | Primary accent (buttons, highlights) |
| `--magi-accent-hover` | `#4338ca` | Accent hover |
| `--magi-green` / `--magi-red` | `#16a34a` / `#dc2626` | Success / error |
| `--magi-text` / `--magi-text-secondary` / `--magi-text-muted` | `#111827` / `#4b5563` / `#9ca3af` | Text scale |
| `--magi-field-bg` / `--magi-field-border` | `#f3f4f6` / `#e5e7eb` | Input fields |
| `--magi-tile-bg` / `--magi-tile-bg-hover` | `#ffffff` / `#f9fafb` | NFT tile + token row |
| `--magi-font` | Inter, system-ui | Font family |

## Demo

```bash
pnpm install
pnpm demo        # starts on http://localhost:5173
```

The demo renders all three React components, the headless mode, and toggles between the light and Altera-dark themes — all backed by the live Magi mainnet indexer. With a Hive Keychain wallet connected, transfer / burn / batch-transfer actions broadcast real transactions.

## Architecture

```
@vsc.eco/nft-core         pure ops + types        (no deps)
        ▲
        │
@vsc.eco/nft-sdk          fetch + orchestrator    (node 18+ fetch / browser fetch)
        ▲
        │
@vsc.eco/nft-widget       React + web component   (peer-deps on react, optional aioha)
```

- **Reads** → `client.nft.provider.getUserNfts(account)` calls the Magi indexer (Hasura) and the Magi node (`getStateByKeys` for collection metadata). Tables: `magi_nft_overview`, `magi_nft_balances`, `magi_nft_token_info`, `magi_nft_token_supply`.
- **Endpoint failover** → both `indexerHasuraUrls` and `gqlUrls` accept ordered lists. The SDK tries each in turn — HTTP errors, network errors, GraphQL `errors[]` responses, and timeouts all trigger automatic failover to the next mirror. `MAINNET_CONFIG` ships with multiple endpoints by default. See the [SDK README](packages/sdk#endpoint-failover) for `onAttempt`/`onError` hooks and custom URL lists.
- **Writes** → every action goes through one operation builder. The output is a Hive `custom_json` op with `id: "vsc.call"` and a stringified inner payload (`net_id`, `caller`, `contract_id`, `action`, `payload`, `rc_limit`, `intents`). Aioha's `vscCallContract` produces this shape internally.
- **Signing** → defaults to `aioha.vscCallContract(...)`. Falls back to `aioha.signAndBroadcastTx([op], keyType)` when present, or a custom `onBroadcast` hook when injected.

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
