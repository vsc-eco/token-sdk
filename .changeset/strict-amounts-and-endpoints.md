---
"@vsc.eco/token-core": patch
---

`TokenAmount.fromDecimal` is now strict at the user-input boundary: empty input (`""`, `"-"`, `"."`) throws instead of reading as zero, negative amounts throw, and more fractional digits than the token supports throw instead of being silently truncated (matches `MarketAmount` in `@vsc.eco/market-core`). `MAINNET_CONFIG.gqlUrls` drops `api.vsc.eco`, which was retired and hangs instead of failing. NOTE: the published 0.0.2 still ships the dead testnet endpoint `api.testnet.vsc.eco`; the source has used `magi-test.techcoderx.com` since 2026-08-24, so any new release fixes it.
