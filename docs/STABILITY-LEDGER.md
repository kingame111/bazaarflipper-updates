# BazaarFlipper stability roadmap and fault ledger

Status: VALIDATING INTEGRATED ORIGINAL SOURCES — branch `stabilization/v0.7.0-foundation`.
Do not merge or release until a fully packaged runtime boots on Windows and Linux.

## Latest verification 2026-10-15
- Independent supervisor integration tests passed on Linux and Windows.
- Verified SQLite pre-update backup, forced unhealthy-update rollback, crash journal recovery passed.
- Conflicting-origin snapshot preservation, tampered replay rejection and legacy hash schema tests passed.
- Minion incomplete setup pricing and bounded worker equivalence tests passed.
- 1.54-million-row historical aggregation test passed.
- SOURCE GAP RESOLVED: 7 original runtime files were provided in src.zip, hash-verified
  and imported into candidate-src on this branch only. No data/config/token was copied.
  Standalone packaged-runtime tests must still pass before a release.
- ENGINE MINIMUM ERROR FOUND: package.json previously claimed Node >=22.5 but Node 22.5
  cannot load node:sqlite with default flags. Node 22.13/22.15 have SQLite but lack
  its named backup export; supervisor now uses VACUUM INTO fallback and cross-version tests.
  Reconfirm all supported versions before approving release.


## System contract
- One local Node HTTP API on port 3210, Hypixel polling and dynamic market calculations.
- Desktop is the full history authority; laptop stores an unacknowledged transfer queue.
- SQLite stores collection snapshots and rollups; a successful network request is NOT proof a batch was durably imported.
- Future updates must proceed even when the data server is unresponsive.
- Never remove unsent laptop history as part of upgrades, repair, or role switching.
- An update does not migrate or replace user databases by copying arbitrary packaged files.

## Fault ledger (proof versus suspicion)
| Area | Evidence | Cause/status | Acceptance criteria |
| --- | --- | --- | --- |
| v0.6.10 desktop updates | manifest v0.6.12 detected, /api/update/apply hung | server handles staging in-process; trigger ambiguous | independent update listener responds while server is busy or absent, with rollback |
| Desktop history compute | server log contained 1,022-second and repeated ~200-second calculations | repeated 1–7 day raw data scans; v0.6.13 optimized | benchmark, compare every window to reference query, monitor HTTP latency under load |
| Startup | long STARTING before v0.6.12 | startup waited for Hypixel earlier | local HTTP and updater available independent of Hypixel |
| History source collisions | history PRIMARY KEY(ts,product_id); two origins use INSERT OR IGNORE | overwrite/ignore possibility CONFIRMED in schema; real lost rows not proven | retain conflicting origin observations and flag true conflicts |
| Sync flags | desktop marks lastSuccess when laptop accepted an async push request | trigger != transfer receipt | per-batch acknowledged proof, explicit states, no false completion |
| Backlog | v0.6.12 max 2*4 snapshots / 30s | excessive latency by design | adaptive draining, bounded response times, no data loss |
| Update health | old updater uses /api/status with expensive DB status queries | false-negative rollback risk | /health/live & /health/ready with no heavy queries |
| Update replacement | old copy removed target before rename | crash window loses file | pre-copy backup + journal + atomic rename, recovered on next startup |
| Minion reliability | old audit: incomplete recipes=39, unpriced tier setups=55; 61 families, only 60 supported | model incompleteness | validation gates fail on known invalid conditions; targeted source verification |
| UI version | old fixed banner v0.6.9 | stale metadata | UI displays live server version |

## Release strategy
1. Independent runtime manager (separate port and Node process), external update staging, journaled replacement and rollback, dedicated light health endpoints, Windows launcher.
2. Preserve observations from concurrent collectors; verified idempotent transfer acknowledgements and accurate sync states.
3. Measure and optimize long-history queries, retention, and minion computations without blocking API responsiveness.
4. Full real-scale two-process integration (including failed network, stalled collector, 700x2200 backlogs, restart, rollback), Windows integration.
5. Enforce minion data quality and review unresolved assumptions; don't claim fully audited until issues cleared.
6. Release only when green checks + installation test from prior version passes, and validate first on desktop database.

## Known limitations (do not conceal)
- GitHub CI synthetic load cannot replicate the desktop's hardware, disk state or existing millions of records.
- An emergency one-time installer may still be necessary to leave v0.6.10 because its old updater cannot install itself reliably.
- The published v0.6.13 package is not proof of independent update architecture.
