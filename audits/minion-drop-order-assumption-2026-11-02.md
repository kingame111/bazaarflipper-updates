# Linked storage compaction and native-drop priority — 2026-11-02

## Findings supplied by in-game user observation

- **Super Compactor 3000 continues compacting items in linked Large Storage.** The candidate already compacts both internal and linked inventory at production events; this remains enabled. Added a synthetic 1-slot-minion/15-slot-linked-storage regression that proves chest compaction takes place in the implementation. This is user-reported gameplay behavior, not a server-side live-game API measurement.
- **Native minion drops before upgrade-generated drops** (e.g. diamonds from Diamond Spreading) is a *plausible user hypothesis*, **not independently verified in-game**. Default candidate ordering is now native drops first, then generated/extra upgrade drops, including timed cooldown drops. An explicit alternate ordering is available only to test sensitivity.

External references:
- https://hypixelskyblock.minecraft.wiki/w/Super_Compactor_3000 — compaction triggered by production
- https://hypixelskyblock.minecraft.wiki/w/Minion_Storage — Large Storage adds 15 slots; automated shipping after both inventories are filled
- https://hypixelskyblock.minecraft.wiki/w/Minion_Upgrades — Diamond Spreading rolls per harvested item; can include extra unloaded-island drops
- Neither cited reference establishes *which produced item is stored first when capacity is insufficient*.

## Independent priority-sensitivity experiment

- GitHub Actions run: https://github.com/kingame111/bazaarflipper-updates/actions/runs/41363967459
- Source: tests/minion-drop-order-sensitivity.mjs
- 12 minion/upgrade mixes x 3 durations (1,3,7d) x 2 external-storage settings x 2 Hopper settings = **144** cases.
- Comparing identical seeded streams with MINION_FIRST versus EXTERNAL_FIRST storage insertion yielded **32/144 nonzero** modeled NPC-income differences. This difference is between hypothetical insertion policies, **not a measured game-accuracy error**.
- Maximum **relative** difference: **6.19098%** in Sheep Minion XI + Corrupt Soil + Diamond Spreading at 1 day, no Large Storage, no Hopper: 4,768 coins native-first versus 5,082.67 coins upgrade-first (NPC fallback values; fixed seeded trials). The same saturated-storage amounts recur at 3 and 7 days.
- Maximum **absolute** difference: **938.67 NPC coins** in Fishing Minion XI + Diamond Spreading + SC3000 at 7 days, Large Storage ON, Hopper OFF: 48,494.67 coins native-first versus 47,556 coins external-first.
- A short non-saturating Snow Minion scenario produced identical revenue with both priorities, as expected.
- Explicit linked-storage compaction regression passed (SC3000 forms enchanted item in a linked storage that would not otherwise fit without it).

## Candidate code changes

- candidate-src/src/offline-upgrade-inventory.mjs: default native-first storage insertion on a per-cycle basis; both orderings available for the sensitivity test, and the selected ordering is included in the cache key.
- candidate-src/src/minions.mjs: if extra-drop priority matters because storage overflows, the caller receives a warning that minion-first ordering has not been confirmed in-game.
- **This assumption is *not* an accuracy certificate**. Do not release or advertise universal percent accuracy based solely on synthetic comparisons.

## Targeted empirical check needed

A minion (ideally Snow with Diamond Spreading, no Hopper) should have its storage almost filled such that a native drop and an upgrade drop compete for the last free stack slot. Record before-and-after inventory item counts across repeated production events, including whether the item not stored is lost or sold. A clean confirmed observation can then replace this assumption, and these tests should be rerun.

As requested, temporary fuels not currently supported remain deferred; stable release unaffected.
