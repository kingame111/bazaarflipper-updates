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

## Critical follow-up: does a full minion STOP at the first unplaceable drop?

The earlier **6.19098% is not a verified gameplay error.** The user correctly challenged how much revenue can depend on a single contested inventory slot. The exact 6.19% was independently reproduced from source item data, using the **same twelve RNG seeds** and stack-slot rules as the candidate. Evidence: https://github.com/kingame111/bazaarflipper-updates/actions/runs/41368494206, test `tests/minion-overflow-stop-sensitivity.mjs`.

**The 193rd action (77 min 12 sec without fuel)** is decisive for Sheep Minion XI, Corrupt Soil + Diamond Spreading, **no Super Compactor**, no Hopper or external chest. In one representative trial after 192 cycles, Mutton 192, Wool 192, Sulphur 192, Corrupted Fragment 192 (3 stacks each), and Diamonds 76 (2 stacks): **14 occupied slots out of 15**. Both native Mutton and external Sulphur require a fourth stack *simultaneously*. Which is first decides the 15th slot. The current simulation then allows its chosen new stack to grow from 1 to 64 items while other outputs are rejected. That magnifies the value difference to **64 × (10 − 5) = 320 NPC coins in one seed**. Across 12 seeds, native-first 4,768 vs external-first 5,082.6667 coins: **-6.19098%**.

**Alternative behavior: STOP_ON_FIRST_REJECT** immediately stops the whole minion when any item will not fit (no hopper), rather than continuing to fill a partial stack. With exactly the same seeded output stream:
- No Hopper, current continue-compatible-stacks policy: native-first **4,768**, external-first **5,082.6667**, relative **-6.191%**.
- No Hopper, halt on first unplaceable item: native-first **4,052.5**, external-first **4,057.4167**, relative **-0.1212%**.
- Enchanted Hopper (70% NPC overflow), continue: native-first **54,815.2**, external-first **54,909.6**, relative **-0.1719%** at 24 hours.

These values represent **alternative algorithm rules**, not validated real-game revenue. Hypixel player forum descriptions say minions stop when storage is full unless a hopper exists, but do NOT establish whether a single rejected output halts all other outputs or allows continued filling a pre-existing stack. Source context: https://hypixel.net/threads/is-there-a-limit-of-minion-actions.5649535/ ; official wiki documents that automated shipping sells overflow at NPC fraction and minion storages add slots.

**Release safety:** This was recorded as HIGH unresolved in `tests/minion-audit-v0.6.11.mjs` under `NO_HOPPER_FULL_INVENTORY_STOP_UNVERIFIED`. Profit calculations for full minions without Hopper now display an explicit warning. The stable release remains unchanged. Neither the 6.19% nor the 0.12% is safe to present as known game accuracy.

**Targeted in-game experiment:** Run Sheep XI without fuel, SC3000, Hopper or chest, with Corrupt Soil + Diamond Spreading and empty storage. At ~77 minutes the code predicts the final slot contested (timing may differ with in-game mechanics). Photograph the inventory around ~80 minutes and again after ~105 minutes, without collecting. If the chosen Mutton/Sulphur stack remains at ~1 item, that favors the immediate-stop model; if it grows toward 64 despite other outputs being blocked, it favors the continue-partial model. This check is MORE diagnostic of the 6.19% question than a Snow Minion experiment, because four guaranteed Sheep/Corrupt Soil drops naturally synchronize every 64 cycles.
