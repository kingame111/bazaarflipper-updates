# Offline production, storage and Hopper audit — 2026-11-01

**Scope:** 60 modeled minion families, with current tier XI, collection horizons of 1, 3, and 7 days, empty starting inventory. Working audit branch only; stable release is unchanged.

## A. Chronological deterministic production

Independent event-by-event implementation in tests/minion-offline-reference.mjs; production implementation in candidate-src/src/offline-inventory.mjs; separate source files and stack accounting. 
- 45 deterministic-family variants.
- 1,080 scenarios: 1/3/7 days, Super Compactor 3000 ON/OFF, Large Storage ON/OFF, Hopper NONE/ENCHANTED.
- BEFORE fix: 179/1,080 scenarios differed by >5% and 137 >20%; most from missing default Large Storage.
- AFTER including 15 external slots, only 2/1,080 were >5%; Ghast with SC3000 after 7 days.
- AFTER introducing chronological inventory production algorithm: all **1,080/1,080** match the independently coded reference to floating-point precision; differences are numerically negligible. Run: https://github.com/kingame111/bazaarflipper-updates/actions/runs/41273703923

**Caution:** The independent reference itself assumes 64-unit stacks, the item being inserted BEFORE a compaction trigger, compaction processing linked chest inventory, and hopper sales AFTER both inventories reject overflow. Some precise inventory edge behavior is not independently documented in-game. A match between code and this independent reference is NOT proof that the in-game action order matches.

## B. Random drop minions

Independent seeded random generator in tests/minion-offline-stochastic.mjs, compared with a distinct 12-seed offline calculation in the candidate:
- **15 random-output families**.
- **360 configurations** across 1/3/7-day horizons, with Large Storage/no storage, Hopper NONE/ENCHANTED, SC3000 ON/OFF.
- **4,672 total independent seeded trials**, including **100 seeds** in each Fishing Minion + SC3000 7-day configuration.
- **0/360** scenario mean-profit discrepancies greater than 5% in the latest reference (before stochastic engine correction: 9/180 >5% without compactor).
- Mean absolute relative difference between independent simulated mean and candidate estimator: approximately **0.156%**.
- Highest remaining observed difference: **4.25%** for Fishing Minion XI, 7 days, SC3000 ON, NO external storage, NO Hopper. Under Large Storage and Hopper for the same family, errors are smaller.
- Many models differ from the 95% confidence interval computed from a small finite sample; those intervals do NOT establish full game accuracy or perfect RNG conformity.
- Run: https://github.com/kingame111/bazaarflipper-updates/actions/runs/41274158556

**Caution:** These simulations use expected-amount Bernoulli rounding for ranged drops and a random exclusive branch for drop tables whose probabilities sum to 1. Actual game drop RNG/lag, pre-loaded inventory and non-empty storage were NOT validated in-game.

## C. Product behavior implemented

- Production uses deterministic chronological item stacks when all base outputs are integer and guaranteed, and seeded Monte Carlo chronological inventory for random base-drop families.
- 15-slot Large Storage is enabled by default in engine, API and UI; explicit OFF option exists.
- Hopper overflow rate 70% of NPC value for Enchanted Hopper and 50% for Budget Hopper; sold items are not assumed to be sold to Bazaar.
- The status field storage.model reports DETERMINISTIC_EVENT, STOCHASTIC_MONTE_CARLO_12 or ESTIMATED. The model is deliberately labeled ESTIMATED when the special upgrade mix has not been independently verified.
- Candidate unit regressions include minion and fuel special cases and expected upgrade output rates.

## D. Important remaining limits; release gate stays CLOSED

- **Extra-drop and special upgrade combinations**, such as Diamond Spreading + Corrupt Soil, Soulflow, Berberis, Flint Shovel and Enchanted Egg with multi-stage compaction, may still use the old aggregate storage approximation: source-level production rates have unit checks, but in-game stack/hopper timing and optimizer ranking for these combinations are NOT completely independently verified.
- Missing upgrade types and Inferno remain excluded (see audits/minion-production-validation-2026-11-01.md). No additional temporary fuel types added, per user preference.
- Bazaar order fills, actual market liquidity, sell taxes and 7-day history pricing have NOT been benchmarked against independent real trades in this offline inventory audit. All quoted coin comparisons here use fixed NPC fallback prices to isolate mechanical correctness.
- Fishing tier X source conflict remains (NEU 53s; community Wiki 43s).
- Real game inventory state when minion starts with partial stacks, chest-specific compaction order, random correlation and unloaded/loaded transitions were not observed live. Nothing in these reports asserts precise production-game equivalence for these conditions.

**Release status:** No merge, release bundle, manifest or stable database modifications. The audit branch is not deployment-approved without targeted independent validation of upgrade mixtures and actual prices/market liquidity.

## E. Follow-up: mixed upgrade fixes and measured discrepancy reduction

The initial 16-setup independent special-upgrade audit found **20/192 configurations >5%** and **10/192 >20%**. A new event-based special-upgrade inventory implementation has now eliminated all >5% differences in that same audit: **0/192 >5%, mean absolute model-reference deviation ~0.2364%, maximum ~1.8182%**. Evidence: https://github.com/kingame111/bazaarflipper-updates/actions/runs/41278241147

The previous Section D warnings for unmodeled mixed special upgrades now apply only to **unsupported or untested variants**, not all common supported combinations. These synthetic results still do NOT measure error against real Hypixel drops and trades, and do not prove accuracy beyond tested configurations. Full candidate performance/stability tests and representative in-game comparisons remain necessary before release.
