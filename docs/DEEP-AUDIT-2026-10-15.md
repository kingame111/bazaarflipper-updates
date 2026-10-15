# BazaarFlipper — full-source, live-API, multi-server audit
Date: 2026-10-15
Candidate: `stabilization/v0.7.0-foundation` / draft PR #15.
Production: `main` still publishes v0.6.13. **Do not deploy this candidate until all gates, including real-PC validation, pass.**

## Evidence policy

PASS means the indicated implementation passed the specific reproducible test, **not** that no defects remain.
The target environment is two Windows computers on the owner's local network with
persisted historical data. GitHub-hosted Linux/Windows replicas cannot prove actual
LAN reliability, disk I/O latency, firewall, local Node installation or integrity of
the user's original multi-million-row database.

## Audited subsystems and traceable tests

| Subsystem | Real checks | Result / limitation |
| --- | --- | --- |
| Source completeness | 19 original src/public files supplied; packaged clean runtime, JS syntax, dependency resolution | Candidate bundle boot-tested from scratch on Linux and Windows in prior CI; validate again after last change |
| Hypixel integration | Actual public Bazaar, item and election endpoints; error/timeout mocking; valid product bid/ask pairs | 2,201 Bazaar products; 5,680 items; around 1,797–1,798 two-sided books, zero invalid top prices. GitHub runner, not user's LAN |
| Bazaar economics | Live values processed by scanner; net profits, tax, ROI, market-speed, bounded numeric metrics | ~1,793–1,798 two-sided products scored with no nonfinite metrics; 403–408 products skipped when no valid two-sided market |
| Minion production/setup | Every minion tier, NPC/bazaar quotes, nested recipes, item aliases, fallback handling, pricing completeness | 61 catalog families, 60 supported. 702 tiers checked; 591 complete setup quotes, **111 missing/unverified** at time of live audit. All 702 have priced modeled recurring profits, not in-game verified throughput |
| Hypixel buy/sell book directions | Explicit synthetic 100 bid / 120 ask, distinct quick-status fallbacks | FOUND/FIXED v0.7: minion instant selling was incorrectly quoting ask and ingredient acquisition quoting bid; regressions run Win/Linux |
| Historical statistics | 700*2,200 SQLite rows, independent 1–7d reference queries | 1,540,000-row query regression passed previously; timing depends on real desktop |
| Desktop/laptop synchronization | Two independent Node servers and SQLite DBs, authenticated HTTP peer, offline failure and retry, source collision, 80 & 700 snapshot backlogs | 176,000 and 1,540,000 rows accepted and verified; tampered replay rejected, conflicting observations recorded. Actual home LAN remains to be checked |
| Pending snapshot retention | DB ack-only deletion and code regression on storage-pressure path | FOUND/FIXED v0.7: previous code could delete up to 1,000 unacknowledged laptop snapshots on low disk; new version blocks new writes and prioritizes sync; not retroactive restoration |
| Update manager | Standalone localhost:3212 supervisor, restarts, failed-upgrade rollback, interrupted transaction recovery, verified database backup | Windows and Linux integration tests pass; missing original Windows deployment test on both user devices |
| Browser UI | Playwright Chromium full homepage + minion page, searching, upgrade/column selectors, independent update button, uncaught JS errors | Browser smoke passed; price data may update live between render steps |
| Security and controls | Peer token enforcement, imported snapshot hashes, update-origin restriction, no data/config packaged | Peer LAN API unauthorized status/import requests must return HTTP 401; broader pen-testing not done |

## Critical bugs confirmed and fixed in candidate

### C1. Reverse Minion price-side mapping
- Original `src/minions.mjs` mapped Instant Sell to `buy_summary` and component purchase to `sell_summary`, reversing the user's executable bid/ask.
- New `currentPrice` maps `instantSell` to best `sell_summary` bid; `sellOrder`/ingredient `acquisition` to `buy_summary` ask.
- `tests/market-contract-v0.7.0.test.mjs` and corrected v0.6.11 fixtures fail if sides get reversed again.
- This bug could overstate instantaneous profits and understate construction cost; all old calculated results should be treated as suspect until recalculated.

### C2. Deleted unacknowledged laptop history on low disk
- Old `enforceLaptopStoragePolicy` called `dropOldestPendingSnapshots` (10 per iteration, at most 100 iterations), deleting up to 1,000 unacknowledged snapshots.
- New storage policy never evicts unsent snapshots. It triggers verified sync and skips **new** collection writes while low disk, visibly reporting `skippedForLowDisk`.
- Previously deleted historical samples, if any, are not recovered by the code change. Existing source data remains untouched pending backup.

### C3. Same-bucket origin collisions and false sync completion
- SQLite `history` primary key `(ts, product_id)` cannot hold both laptop and desktop canonical data. Original `INSERT OR IGNORE` discarded alternate observations.
- New side table `history_observation_conflicts` retains source and differing numeric fields. New imported-snapshot SHA256 receipts reject modified replays.
- Separate desktop 'accepted trigger' vs 'confirmed transfer' timestamps; peer token tests exercise real endpoints.

### C4. Recipe identity mismatch (NEU -> Hypixel)
- Found seven legacy NEU ingredient ids like `LOG-2`, `SAND-1`, `INK_SACK-4`.
- Exact corresponding Bazaar keys `LOG:2`, `SAND:1`, `INK_SACK:4` exist in live API.
- Canonicalize only when target exists, in market/history/item metadata; don't invent equivalent items.
- Nested Slayer minion ingredients `ZOMBIE_GENERATOR_1`, `SPIDER_GENERATOR_1`, `ENDERMAN_GENERATOR_1` now recursively quote verified cumulative minion-tier recipes. Missing ingredients fail closed rather than invent setup price.

### C5. Fabricated UI ranks and incomplete setup display
- Original browser fallback `r.sortRank||i+1` numbered filtered rows even if the backend withheld the rank as unpriced.
- UI now prints rank only when backend supplied integer rank; top-profit selection excludes incomplete recurring economics.
- Partial setup subtotals no longer look like fully priced setup/ROI; confidence is capped for missing economics.

### C6. Expensive old updater and historical work
- v0.6.13 already reduced historic scans and backgrounded maintenance, but v0.6.10 desktop could be blocked by synchronous DB work.
- v0.7 includes independent update supervisor, lightweight readiness endpoints, verified SQLite backups, journaled replacement and rollback; minion workers off HTTP event loop.

## Live measurements

- 2026-10-15 GitHub Actions live run: [public Bazaar/items/mayor contract](https://github.com/kingame111/bazaarflipper-updates/actions/runs/38705309936).
- [Full live market and all-tier minion economic audit](https://github.com/kingame111/bazaarflipper-updates/actions/runs/38708023539): 702 tier calculations; **111 incomplete setup costs**. Not a PASS for full recipe completeness.
- [Two-server 700 snapshot / 1.54M-row stress](https://github.com/kingame111/bazaarflipper-updates/actions/runs/38706182049) was already demonstrated at a previous head. Repeat after all changes.
- [Windows/Linux full packaged runtime success](https://github.com/kingame111/bazaarflipper-updates/actions/runs/38707299768) at previous candidate head. Repeat after all changes.

## Unresolved or unproven requirements

**R1 — Full minion economics remains incomplete (release/blocking for 'all minions fully verified').**
Live audit: 111/702 tier setup quotes missing or unverifiable. Causes include external auction/gift acquisition (e.g. Snow/Flower), missing canonical non-Bazaar ingredients, missing level XII recipes, and special-tier costs. These must show N/A rather than invented numbers. Inferno currently not economically supported. Complete these via verifiable source data; never assume hypothetical Bazaar prices for untradeable items.

**R2 — Real desktop/laptop validation remains required.**
Check on each installed Windows computer:
- exact running version, Node runtime; startup responsiveness with actual DB;
- SQLite consistency plus durable backups;
- Hypixel freshness and refresh after 504/network failures;
- 3211 authenticated peer reachability across the actual LAN;
- pending queue drops to zero after verified delivery and never on partial acknowledgement;
- measured UI latency while importing a large backlog, while simultaneously reading history;
- updater v0.7 success+rollback once on disposable copies of the actual install before live install.
No installed code or user DB has been remotely changed by this audit.

**R3 — Confidence/accuracy of modeled in-game production.**
Storage overflows and multitype slot packing are modeled approximately; Minion Expander, Diamond Spreading and some special minion interactions rely on model assumptions. Synthetic number correctness cannot establish game-world production accuracy without authoritative source or in-game measurements.

**R4 — Browser and API security outside defined token/CORS tests.**
Peer auth and origin checks were exercised; exhaustive vulnerability scanning or fuzzing of user-supplied paths, filenames and large payloads has not been completed.

## Release gates

1. Green Windows+Linux candidate CI on the *same final commit*.
2. Green true clean-boot package smoke on both operating systems.
3. Green authenticated two-server 700*2,200 snap-transfer, offline/restore and tamper/duplicate detection; unchanged user DB under upgrade/rollback.
4. Browser UI test green, including search rank and independent update.
5. No unverified costs disguised as exact economic figures; unsupported/unknown sources correctly N/A.
6. Test on disposable backups of BOTH real Windows installations, then staged deployment. Keep `main` on v0.6.13 until then.

This ledger intentionally distinguishes observed defects, fixed candidate code,
automated proof and remaining risks so future conversations can continue the audit
without repeating the original investigation.
