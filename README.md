# Token Radar — radar-2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/h2tran/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/h2tran/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry by [@minh-h-tran](https://make.fun) — GitHub
[h2tran/token-radar-01](https://github.com/h2tran/token-radar-01).
No wallet address is set in this entry; the entrant links their Solana
wallet on make.fun when they submit and claim.

Build the best token launch radar: pre-token protocols ranked by implied
value, with a farm plan for each one. Snapshot 2026-11-14, 758 protocols,
40 on the watchlist.

## Model (radar-2)

Implied value is calibrated from the snapshot itself. Live-token protocols
are the comparables: for each category, the median mcap / TVL of its live
protocols, trimmed to [0.005, 5], shrunk toward the global trimmed median
(0.2042) with a prior of 8, clamped to [0.08, 0.50].

```
implied = round( tvl_usd x multiple(category)
                 x (1 + clamp(change_7d, -40, 100) / 100 x 0.55)
                 x maturity x chain x wrapped-discount )
```

Maturity is `0.70 + min(age_days, 1095) / 1095 x 0.50` (unknown age: 0.85).
Chain breadth adds 0.02 per extra chain, to 1.10. A name carrying a whole
word `wrapped`, `staked` or `staking` takes a 0.50 discount. No protocol
name is special-cased; every row's breakdown is in `board.json` and in the
detail view, so any row can be recomputed from the snapshot figures.

Excluded from ranking: CEX, Bridge, Canonical Bridge, Liquid Staking,
Liquid Restaking and Restaked BTC, and names ending in a version marker.
Live-token protocols are set aside in a separate Live view with their
market caps — the market's own values, never a model's.

## Board

203 rows: all 40 watchlist protocols, plus every other rankable pre-token
protocol in the snapshot. Each row carries 7 concrete farm steps with cost
and time, derived from its category, chains, TVL and age.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only. `main.ts` reads the snapshot, writes
`board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and
writes `dossier.json` with the vendored make.fun library.

## Dashboard

Static page, no network: `dashboard/index.html`, `app.css`, `app.js`.
Sortable columns, filters for category, chain, watchlist-only and search,
a detail view for every protocol, and a separate Live-token view.

## License

MIT — see LICENSE.
