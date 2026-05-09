# @vsc.eco/nft-widget

Embeddable Magi NFT + token panels — React component + web component. Renders the same flows as the okinoko-terminal NFT/token panel (your collections, your balances, transfer / burn / batch-transfer) in a single drop-in tag.

For the full integration guide see the [top-level README](../../README.md). Quick reference below.

## Install

```bash
pnpm add @vsc.eco/nft-widget react react-dom @aioha/aioha
```

## React

```tsx
import { MagiAssets, MagiNftPanel, MagiTokenPanel } from '@vsc.eco/nft-widget';
import '@vsc.eco/nft-widget/styles.css';

// Combined NFTs + tokens with a tab strip:
<MagiAssets aioha={aioha} username="lordbutterfly" keyType={KeyTypes.Active} />

// Or each panel alone:
<MagiNftPanel   aioha={aioha} username="lordbutterfly" keyType={KeyTypes.Active} />
<MagiTokenPanel aioha={aioha} username="lordbutterfly" keyType={KeyTypes.Active} />
```

## Web component

```html
<script type="module">
  import '@vsc.eco/nft-widget/webcomponent';
</script>

<magi-assets id="assets" username="lordbutterfly"></magi-assets>

<script>
  const el = document.getElementById('assets');
  el.aioha = yourAiohaInstance;
  el.keyType = KeyTypes.Active;
</script>
```

Three tags are registered: `<magi-nft-panel>`, `<magi-token-panel>`, `<magi-assets>`. Object-valued props (aioha, config, callbacks) MUST be set as JS properties — string/number/boolean attributes pass through fine.

## Bring-your-own UI

If you already render an NFT inventory and just want the action modals, import the per-action forms:

```tsx
import {
  NftTransferForm,
  NftBurnForm,
  NftBatchTransferForm,
  TokenTransferForm,
  TokenBurnForm
} from '@vsc.eco/nft-widget';
```

Each accepts a `client` (from `createNftClient`), a `username`, the relevant item/info, and `onSuccess` / `onClose` callbacks.

## Theming

CSS custom properties on `.magi-nft` — see the [top-level README](../../README.md#theming) for the full variable list. Altera dark theme is opt-in:

```ts
import '@vsc.eco/nft-widget/themes/altera-dark.css';
// then add the host class to any panel:
<MagiAssets className="magi-nft-altera-host" ... />
```
