# @vsc.eco/nft-sdk

Read providers + broadcast orchestrator on top of [`@vsc.eco/nft-core`](../core). This is the layer the widget consumes; reach for it directly when you want full SDK functionality but no UI.

## Install

```bash
pnpm add @vsc.eco/nft-sdk
```

## Quick start

```ts
import { createNftClient, MAINNET_CONFIG } from '@vsc.eco/nft-sdk';

// No signer — read-only mode.
const client = createNftClient({ config: MAINNET_CONFIG });

// Pull every NFT a user holds, joined with collection + token info.
const items = await client.nft.provider.getUserNfts('hive:lordbutterfly');
// items: NftItem[] — { contractId, tokenId, balance, isUnique, soulbound, collection, ... }

// Same for fungible tokens.
const tokens = await client.token.provider.getUserTokens('hive:lordbutterfly');
// tokens: Array<TokenBalance & { info: TokenInfo }>
```

## Writing transactions

Pass an Aioha instance — or any object that exposes `vscCallContract` / `signAndBroadcastTx` — and the client will sign + broadcast for you:

```ts
import { Aioha, KeyTypes } from '@aioha/aioha';
import { createNftClient } from '@vsc.eco/nft-sdk';

const aioha = new Aioha();
// register providers, login, etc...

const client = createNftClient({ aioha, keyType: KeyTypes.Active });

const { txId } = await client.nft.transfer(contractId, 'lordbutterfly', {
  from: 'lordbutterfly',
  to: 'alice',
  tokenId: 'card-001',
  amount: 1
});
```

For non-Aioha hosts:

```ts
const client = createNftClient({
  onBroadcast: async (op) => {
    // window.hive_keychain.requestBroadcast(...) etc.
    return { txId: '...' };
  }
});
```

## Build-without-broadcast

Every write method has a sibling `*Op` method that returns the bundle without broadcasting. Use these when you want the SDK's payload formatting but a fully custom signing path:

```ts
const bundle = client.nft.transferOp(contractId, 'alice', {
  from: 'alice', to: 'bob', tokenId: 'card-001', amount: 1
});
// bundle.op   → broadcast via dhive: client.broadcast.sendOperations([bundle.op], key)
// bundle.call → broadcast via aioha: aioha.vscCallContract(
//                 bundle.call.contractId, bundle.call.action,
//                 bundle.call.payload, bundle.call.rcLimit,
//                 bundle.call.intents, KeyTypes.Active)
```

The full surface (`transferOp`, `batchTransferOp`, `burnOp`, `mintOp`, `approveOp`, `setApprovalForAllOp`, `setUriOp`, ... and the same set for tokens) is documented in the type definitions.

## Providers

`createNftClient` builds a default `NftProvider` and `TokenProvider` from the config. Override either with your own implementation if you've got a different indexer or a cache layer:

```ts
const client = createNftClient({
  config: MAINNET_CONFIG,
  nftProvider: myCustomProvider,
  tokenProvider: myCustomTokenProvider
});
```

The default providers query:

| Source | Tables / endpoints |
|---|---|
| Hasura indexer | `magi_nft_overview`, `magi_nft_balances`, `magi_nft_token_info`, `magi_nft_token_supply`, `magi_token_overview`, `magi_token_balances` |
| Magi GraphQL node | `getStateByKeys` (for collection_metadata) |

## Endpoint failover

Both `MAINNET_CONFIG` and any custom `MagiConfig` accept ordered URL lists for both the indexer and the Magi node. The first entry is tried first; on any HTTP, network, parse, or `errors[]` response the next entry is tried automatically. After every URL fails, the SDK throws with a per-URL summary so you can see what went wrong.

```ts
import { createNftClient, MAINNET_CONFIG } from '@vsc.eco/nft-sdk';

// Mainnet ships with multiple mirrors out of the box — no extra config needed.
const client = createNftClient({ config: MAINNET_CONFIG });

// Or pass your own list, in priority order:
const client2 = createNftClient({
  config: {
    network: 'vsc-mainnet',
    indexerHasuraUrls: [
      'https://my-indexer.example.com/v1/graphql',
      'https://indexer.magi.milohpr.com/v1/graphql'
    ],
    gqlUrls: [
      'https://api.vsc.eco/api/v1/graphql',
      'https://vsc.techcoderx.com/api/v1/graphql'
    ]
  }
});
```

The legacy single-URL fields (`indexerHasuraUrl`, `gqlUrl`) still work — they're treated as a one-element list. When both forms are set, the array wins.

### Hooking failover events

Pass `fetchOptions` for telemetry and timeouts. Useful when you want to surface "endpoint X is degraded" messages or measure tail latency:

```ts
const client = createNftClient({
  config: MAINNET_CONFIG,
  fetchOptions: {
    timeoutMs: 5000,
    onAttempt: (url, i) => console.debug(`[gql] try #${i}: ${url}`),
    onError:   (url, i, err) => console.warn(`[gql] ${url} failed → ${err.message}`)
  }
});
```

For one-off calls outside the client, the fetcher is exported directly:

```ts
import { gqlFetchFailover, resolveIndexerUrls, MAINNET_CONFIG } from '@vsc.eco/nft-sdk';

const data = await gqlFetchFailover(
  resolveIndexerUrls(MAINNET_CONFIG),
  `query { magi_nft_overview { contract_id name } }`
);
```

## Headless RC handling

Unlike `@vsc.eco/crosschain-sdk`'s `quickSwap`, the NFT client does not run a simulation step before broadcasting — most NFT/token actions are far below RC pressure. If you need RC checks, build the op with `*Op`, run your own `simulateContractCall`, and rebuild the bundle with the tightened `rc_limit`.
