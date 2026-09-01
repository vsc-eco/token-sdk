# @vsc.eco/token-sdk

## 0.0.3

### Patch Changes

- Read every row from the indexer, not the first hundred

  `nftProvider` issued one unpaged query per read. The indexer's Hasura role
  caps every response at 100 rows and ignores a larger `limit`, so a wallet
  holding more than 100 NFTs silently showed an arbitrary alphabetical slice of
  them. `getBalances`, both `getCollections` forms and `getTokenInfos` now page,
  each with an `order_by` so the window is stable.

  Point the testnet config at a node that answers

  `TESTNET_CONFIG.gqlUrls` pointed at `api.testnet.vsc.eco`, which does not
  respond. Image resolution reads token properties through `getStateByKeys` on
  that endpoint, so every NFT fell back to the placeholder logo — including ones
  with artwork.

  Don't let one artless token blank a whole batch of images

  `resolveNftImages` reached into `it.collection.baseUri` unconditionally, but
  callers legitimately pass a bare `{contractId, tokenId}` when all they want is
  art. The first token whose own props yielded no image threw, and since callers
  wrap the call in a `catch`, no images were committed at all.

- Updated dependencies
  - @vsc.eco/token-core@0.0.3
