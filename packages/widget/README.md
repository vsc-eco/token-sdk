# @vsc.eco/token-widget

Embeddable Magi NFT + token panels — React component + web component. Renders the same flows as the okinoko-terminal NFT/token panel (your collections, your balances, transfer / burn / batch-transfer / mint / deploy / distribute) in a single drop-in tag.

For the full integration guide see the [top-level README](../../README.md). Quick reference below.

## Install

```bash
pnpm add @vsc.eco/token-widget react react-dom @aioha/aioha
```

## React

```tsx
import { MagiAssets, MagiNftPanel, MagiTokenPanel } from '@vsc.eco/token-widget';
import '@vsc.eco/token-widget/styles.css';

// Combined NFTs + tokens with a tab strip:
<MagiAssets
  aioha={aioha}
  username="lordbutterfly"
  keyType={KeyTypes.Active}
  enableDeploy        // Deploy collection / token button
  enableRefresh       // top-right refresh
  enableUserSearch    // browse another account
/>

// Or each panel alone:
<MagiNftPanel   aioha={aioha} username="lordbutterfly" keyType={KeyTypes.Active} />
<MagiTokenPanel aioha={aioha} username="lordbutterfly" keyType={KeyTypes.Active} />
```

### Locked / read-only viewer

```tsx
<MagiAssets username={undefined} viewAccount="diyhub" />
```

## Web component

```html
<script type="module">
  import '@vsc.eco/token-widget/webcomponent';
</script>

<magi-assets id="assets" username="lordbutterfly"></magi-assets>

<script>
  const el = document.getElementById('assets');
  el.aioha = yourAiohaInstance;
  el.keyType = KeyTypes.Active;
  el.enableDeploy = true;
  el.enableRefresh = true;
</script>
```

Three tags are registered: `<magi-token-panel>`, `<magi-token-panel>`, `<magi-assets>`. Object-valued props (`aioha`, `config`, callbacks) MUST be set as JS properties — string/number/boolean attributes pass through fine.

## Bring-your-own UI

If you already render an NFT inventory and just want the action modals, import the per-action forms:

```tsx
import {
  // NFT
  NftTransferForm,            // single-recipient + distribute tab (editioned NFTs)
  NftBatchTransferForm,       // multi-id batch + distribute tab
  NftBurnForm,
  NftMintForm,                // owner-only, simple/custom-JSON properties toggle
  NftIncreaseSupplyForm,      // owner-only, "mint more" of an existing editioned tokenId
  NftEditCollectionForm,      // owner-only, baseUri / metadata / ownership transfer
  // Token
  TokenTransferForm,          // single-recipient + distribute tab
  TokenBurnForm,
  TokenMintForm,              // owner-only
  // Deploy
  MagiContractDeploy          // deploy + init in one dialog
} from '@vsc.eco/token-widget';
```

Each accepts a `client` (from `createNftClient`), a `username`, the relevant item/info, and `onSuccess` / `onClose` callbacks.

### Distribute tabs

Three forms ship a "Distribute (1 each)" tab beside the single-recipient flow:

- **`TokenTransferForm`** — always available. Paste a recipient list, sends `amount` of token per recipient.
- **`NftBatchTransferForm`** — always available. Each recipient gets one copy of each id you selected (expanded by amount).
- **`NftTransferForm`** — only when the NFT is editioned (`!isUnique && balance >= 2`). Each recipient gets one copy of the same token id.

Each builds N independent ops and broadcasts via `client.broadcastBatch` with `chunkSize: 4` + `delayBetweenChunksMs: 4000` to clear Hive's per-block `custom_json` cap. The submit button cycles through `Signing batch K/N…` → `Waiting for next block (Ts)…` so the user knows what's happening.

### Owner affordances

When a user views a collection they own:

- The collection header shows a pencil icon → `NftEditCollectionForm` (baseUri, simple `{description, icon}` or custom JSON, optional ownership transfer under "Show advanced" — only signs ops for fields that actually changed).
- The collection header shows a plus icon → `NftMintForm` (recipient, token id, amount, max supply, soulbound, properties via simple `{name, description, image}` or custom JSON; mirrors okinoko's `NftPropertiesInput`).
- Each editioned tile shows a stack icon → `NftIncreaseSupplyForm` (mint more copies of an existing tokenId, capped at `maxSupply - currentSupply`). The button is hidden for unique tokens, soulbound tokens, and tokens already at max supply.
- Empty-but-owned collections (you own the contract, hold zero tokens) still appear in the panel so you can mint into them.

### Deploy widget

```tsx
import { MagiContractDeploy } from '@vsc.eco/token-widget';

<MagiContractDeploy
  client={client}
  username="alice"
  kind="nft"                 // or "token", or omit to let the user pick
  onDeployed={(contractId) => console.log('new:', contractId)}
  onClose={() => setOpen(false)}
/>
```

It posts a build request to `https://deploy.okinoko.io`, streams the build log via SSE (auto-scroll, word-wrap, stage pills, circular spinner during `building` / `waiting-contract`), polls the indexer for the new contract id (filtered by creator + creation timestamp so you only ever resolve to *your* deployment), and opens the init dialog with sensible defaults. Closing the dialog while in flight asks for confirmation.

## Theming

CSS custom properties on `.magi-token` — see the [top-level README](../../README.md#theming) for the full variable list. **The default theme is Altera dark** — embed and you get the Magi look automatically. The light theme ships as an opt-in:

```ts
import '@vsc.eco/token-widget/themes/light.css';
// then add the host class to any panel (or any ancestor):
<MagiAssets className="magi-token-light-host" ... />
```
