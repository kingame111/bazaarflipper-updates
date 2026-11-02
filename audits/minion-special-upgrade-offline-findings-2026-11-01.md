# Special upgrade offline discrepancies — follow-up 2026-11-01

**Status: material reference discrepancies FIXED IN AUDIT BRANCH; release remains CLOSED until full CI and in-game validation.**

## Before

The independent event-by-event benchmark covered 16 minion / upgrade setups with Diamond Spreading, Corrupt Soil, Soulflow Engine, Berberis Fuel Injector, Enchanted Egg and Flint Shovel. Across 192 configurations (1,536 independent seeded trials), 20 configurations differed by >5% and 10 by >20%. Snow + Diamond Spreading + Super Compactor 3000 was overestimated by ~120% in a 7-day no-hopper, no-extra-storage reference case.

Original evidence: https://github.com/kingame111/bazaarflipper-updates/actions/runs/41274655971

## After

The candidate now uses candidate-src/src/offline-upgrade-inventory.mjs: stepwise inventory stacks, compactor conversions, conditional additional drops, Diamond Spreading per resource item, 105/185-second Soulflow cooldowns, Large Storage and hopper overflow handling, under the documented offline assumptions. Unsupported variants continue to use an expressly labeled estimate, not a fabricated exact result.

The independent 16-setup reference suite now reports:
- **192/192 configurations with relative deviation no greater than 5%.**
- **0 configurations exceeding 5%; none exceeding 20%.**
- Mean absolute deviation **0.2364%** in this specific set of reference tests.
- Maximum observed absolute deviation **1.8182%**, Ghast + Soulflow Engine + no hopper/extra storage.
- Latest completed independent special-upgrade CI: https://github.com/kingame111/bazaarflipper-updates/actions/runs/41278241147
- Coverage: 1/3/7 days, Large Storage on/off, Enchanted Hopper on/off, selected 16 upgrade mixes, fixed NPC price assumptions; 8 comparison seeds per case.

## Open validation work

1. This is **model-versus-independent-model** agreement, not verified in-game accuracy or a universal 0.2364% Hypixel error estimate. Both simulators depend on some shared game assumptions.
2. In-game comparison of exact compaction order, treatment of linked chest, partially filled initial inventories, loaded/unloaded transitions and drop RNG is required for empirical accuracy.
3. Additional combinations with uncommon upgrades, all permanent fuels, every tier and live Bazaar liquidity should be checked; 16 combinations are not all possible combinations.
4. Full candidate synthetic/performance and dual-machine sync/update gates remain mandatory. Do NOT merge solely because this special-upgrade source comparison passes.
5. Inferno remains unsupported; additional temporary fuels remain deferred by user request.

Stable release has not been changed.
