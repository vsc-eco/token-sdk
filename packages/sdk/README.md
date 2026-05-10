# @vsc.eco/token-sdk

Read providers + broadcast orchestrator + deployer client on top of [`@vsc.eco/token-core`](../core). This is the layer the widget consumes; reach for it directly when you want full SDK functionality but no UI.

## Install

```bash
pnpm add @vsc.eco/token-sdk
```

## Quick start

```ts
import { createNftClient, MAINNET_CONFIG } from '@vsc.eco/token-sdk';

// No signer — read-only mode.
const client = createNftClient({ config: MAINNET_CONFIG });

// Pull every NFT a user holds, joined with collection + token info.
const items = await client.nft.provider.getUserNfts('hive:lordbutterfly');
// items: NftItem[] — { contractId, tokenId, balance, isUnique, soulbound, templateId, collection, ... }

// Collections the user owns, even when they hold zero tokens themselves.
const owned = await client.nft.provider.getCollectionsByOwner('hive:lordbutterfly');

// Same for fungible tokens (held + owned-but-unminted).
const tokens = await client.token.provider.getUserTokens('hive:lordbutterfly');
const ownedTokens = await client.token.provider.getOwnedTokens('hive:lordbutterfly');
```

## Writing transactions

Pass an Aioha instance — or any object that exposes `vscCallContract` / `signAndBroadcastTx` — and the client will sign + broadcast for you:

```ts
import { Aioha, KeyTypes } from '@aioha/aioha';
import { createNftClient } from '@vsc.eco/token-sdk';

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

Every write method has a sibling `*Op` method that returns the bundle without broadcasting. Use these when you want the SDK's payload formatting but a fully custom signing path, or when you're feeding `broadcastBatch` (below):

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

The full surface (`transferOp`, `batchTransferOp`, `burnOp`, `mintOp`, `approveOp`, `setApprovalForAllOp`, `setUriOp`, `setPropertiesOp`, `setCollectionMetadataOp`, `changeOwnerOp`, ... and the same set for tokens) is documented in the type definitions.

## Chunked batch broadcasting

Hive accepts at most ~5 `custom_json` operations per account per Hive block. When you fan out N ops (distributing one NFT per recipient, batch-minting an editioned series, etc.) signing them all in one batch is rejected with `Account already submitted N custom json operation(s) this block`. Use `broadcastBatch` to chunk + delay automatically:

```ts
const bundles = recipients.map((to) =>
  client.nft.transferOp(contractId, 'alice', {
    from: 'alice', to, tokenId: 'card-001', amount: 1
  })
);

const result = await client.broadcastBatch(bundles, {
  chunkSize: 4,                  // ops per signature (defaults to 4 — leaves headroom under Hive's per-block cap)
  delayBetweenChunksMs: 4000,    // wait between chunks so each lands in a fresh block
  onProgress: (i)               => console.log(`signed chunk ${i + 1}`),
  onWaiting:  (next, total, ms) => console.log(`waiting ${ms}ms before chunk ${next + 1}/${total}`)
});
// result.txIds: string[]   — one entry per chunk
```

This is the same code path the widget's distribute tabs and batch transfers use.

## Deployer client

Deploy a brand-new NFT collection or token contract by posting a build request to `https://deploy.okinoko.io`, streaming the build log via SSE, and polling the indexer for the new contract id once on-chain.

```ts
const stream = client.deployer.deploy({
  kind: 'nft',           // 'nft' | 'token'
  username: 'alice',
  manifest: {            // canonical magi_nft-contract / magi_token-contract templates
    repo: 'magi-eco/magi_nft-contract',
    ref: 'main'
  },
  timeoutMs: 300_000     // default 300s — building can take a few minutes
});

for await (const evt of stream) {
  // evt: { stage: 'queued'|'building'|'broadcasting'|'waiting-contract'|'done'|'error', line?, contractId?, error? }
}

// Or hand it to MagiContractDeploy (in @vsc.eco/token-widget), which
// renders the stream as a stage-pill + log pane.

// Find the new contract id (creator + creation timestamp filter, so you
// only ever resolve to YOUR deployment, not a concurrent one):
const contractId = await client.deployer.findContractAfter('alice', deployStartedAt);
```

## Image resolution

NFT images come from three sources, in priority order:

```ts
import { resolveNftImages } from '@vsc.eco/token-sdk';

const items = await client.nft.provider.getUserNfts('hive:alice');
const withImages = await resolveNftImages(items);
// withImages[i].imageUrl resolves to the first hit:
//   1. own properties.image
//   2. template (mintSeries) properties.image
//   3. baseUri + tokenId
//   ...else the bundled Magi-logo data URI
```

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
| Hasura indexer | `magi_nft_overview`, `magi_nft_balances`, `magi_nft_token_info`, `magi_nft_token_supply`, `magi_nft_template_tokens`, `magi_token_overview`, `magi_token_balances` |
| Magi GraphQL node | `getStateByKeys` (collection / token metadata), `findContract` (deployer poll) |

## Endpoint failover

Both `MAINNET_CONFIG` and any custom `MagiConfig` accept ordered URL lists for both the indexer and the Magi node. The first entry is tried first; on any HTTP, network, parse, or `errors[]` response the next entry is tried automatically. After every URL fails, the SDK throws with a per-URL summary so you can see what went wrong.

```ts
import { createNftClient, MAINNET_CONFIG } from '@vsc.eco/token-sdk';

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
import { gqlFetchFailover, resolveIndexerUrls, MAINNET_CONFIG } from '@vsc.eco/token-sdk';

const data = await gqlFetchFailover(
  resolveIndexerUrls(MAINNET_CONFIG),
  `query { magi_nft_overview { contract_id name } }`
);
```

## Headless RC handling

Unlike `@vsc.eco/crosschain-sdk`'s `quickSwap`, the NFT/token client does not run a simulation step before broadcasting — most NFT/token actions are far below RC pressure. If you need RC checks, build the op with `*Op`, run your own `simulateContractCall`, and rebuild the bundle with the tightened `rc_limit`.
