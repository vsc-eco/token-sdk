# @vsc.eco/token-core

Pure operation builders + types for the Magi NFT (ERC-1155) and token (ERC-20) contracts. Zero runtime dependencies.

This package builds Hive `custom_json` operations and the inner `vsc.call` payloads — it does NOT broadcast, query, or sign anything. Use it directly when you want full control of the signing pipeline; otherwise reach for `@vsc.eco/token-sdk` (which adds queries + a broadcast orchestrator + a deployer client) or `@vsc.eco/token-widget` (which adds React components).

## Install

```bash
pnpm add @vsc.eco/token-core
```

## Op builders

Every builder takes a `ctx` (`{ contractId, username, network }`) and the action's params, returning `{ op, call }`:

- `op` — a Hive `custom_json` operation tuple, ready to broadcast via dhive / Keychain / Aioha.
- `call` — the inner contract-call payload with `contractId`, `action`, `payload`, `rcLimit`, `intents`. Use it when broadcasting via `aioha.vscCallContract(...)`.

### NFT builders

```ts
import {
  buildNftTransfer,
  buildNftBatchTransfer,
  buildNftBurn,
  buildNftBurnBatch,
  buildNftMint,
  buildNftSetApprovalForAll,
  buildNftApprove,
  buildNftSetUri,
  buildNftSetBaseUri,
  buildNftSetProperties,
  buildNftSetCollectionMetadata,
  buildNftChangeOwner,
  buildNftPause,
  buildNftUnpause,
  buildNftInit
} from '@vsc.eco/token-core';

const ctx = {
  contractId: 'vsc1Brvi4YZHLkocYNAFd7Gf1JpsPjzNnv4i45',
  username: 'lordbutterfly',
  network: 'vsc-mainnet' as const
};

const { op } = buildNftTransfer(ctx, {
  from: 'lordbutterfly',
  to: 'alice',
  tokenId: 'card-001',
  amount: 1
});
// op = ['custom_json', { required_auths: [...], required_posting_auths: [], id: 'vsc.call', json: '...' }]
```

### Metadata / properties — wire-format gotcha

The contract's tinyjson unmarshaler reads the `metadata` (collection) and `properties` (per-token) fields via `in.Raw()`, which means the wire payload must carry those keys as **raw JSON objects, not stringified-JSON strings**:

```ts
// CORRECT — raw object passthrough
{ metadata: { description: '...', icon: '...' } }

// WRONG — gets stored as the literal string `"{...}"`, including the quotes
{ metadata: '{"description":"...","icon":"..."}' }
```

The four builders that touch these fields — `buildNftInit`, `buildNftMint`, `buildNftSetCollectionMetadata`, `buildNftSetProperties` — accept both shapes (a plain object or a JSON string) and always emit the raw-object form on the wire. Pass whatever's convenient for your UI:

```ts
// Plain object (most common)
buildNftMint(ctx, {
  to: 'alice',
  id: 'card-001',
  amount: 1,
  properties: { name: 'Card #1', description: '...', image: 'https://...' }
});

// JSON string (e.g. straight from a textarea — parsed and re-injected as object)
buildNftMint(ctx, {
  to: 'alice',
  id: 'card-001',
  amount: 1,
  properties: '{"name":"Card #1","description":"...","image":"https://..."}'
});
```

If the input is a string and isn't valid JSON, or parses to a non-object (array / scalar), the builder throws.

### Token builders

```ts
import {
  buildTokenTransfer,
  buildTokenBurn,
  buildTokenMint,
  buildTokenApprove,
  buildTokenIncreaseAllowance,
  buildTokenDecreaseAllowance,
  buildTokenTransferFrom,
  buildTokenChangeOwner,
  buildTokenPause,
  buildTokenUnpause,
  buildTokenInit,
  TokenAmount
} from '@vsc.eco/token-core';

// Tokens carry their own decimals — use TokenAmount to convert from human input.
const amount = TokenAmount.fromDecimal('12.345', 3);
// amount.raw === 12345n   (smallest units, as bigint)

const { op } = buildTokenTransfer(
  { contractId: 'vsc1...', username: 'alice', network: 'vsc-mainnet' },
  { to: 'bob', amount: amount.raw.toString() }
);
```

## Helpers

- `normalizeHiveAccount(input)` — accepts `username`, `@username`, or `hive:username` and always returns `hive:username`.
- `isValidHiveUsername(input)` — quick syntactic check (does not confirm L1 existence).
- `buildVscCallOp({ username, network, call })` — base helper that wraps any `VscCall` in a `custom_json` op. Used internally; useful when you want to call a contract action that doesn't have a dedicated builder.

## Types

The package re-exports every shape used elsewhere in the SDK:

```ts
import type {
  MagiConfig,
  NftCollection,
  NftBalance,
  NftTokenInfo,
  NftItem,            // includes templateId for mintSeries grouping
  NftMetadata,
  TokenInfo,
  TokenBalance,
  CustomJsonOp,
  VscCall,
  VscIntent
} from '@vsc.eco/token-core';
```

`MAINNET_CONFIG` and `TESTNET_CONFIG` are the canonical configs the SDK uses by default. Both ship with multiple `indexerHasuraUrls` + `gqlUrls` for automatic mirror failover.
