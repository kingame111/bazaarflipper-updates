# BazaarFlipper minion production source audit — 2026-11-01

**Status:** All modeled base production data verified against available sources, but all optional upgrades, special-event behavior and 24h/7d offline PROFIT are NOT fully verified. Do not publish; stable main is untouched.

## Completed source comparisons

- **702 tier speeds and storage entries** over 60 modeled families: NotEnoughUpdates item lore fetched independently tier-by-tier (702/702 matches after repairing 15 wrong speeds). https://github.com/kingame111/bazaarflipper-updates/actions/runs/41272133449
- **61 independent Wiki family pages** checked. The Wiki matches **702/702 storage values** and **701/702 speed values**. Disputed: Fishing Minion tier X is 43 seconds on community Wiki vs 53 seconds on current NEU lore; retain 53 pending independent in-game proof. https://github.com/kingame111/bazaarflipper-updates/actions/runs/41272254121
- **60/60 modeled minion families' base-drop numeric distributions** compared to current SkyBlock Wiki after correcting source parser and code; 60/60 now match for item quantities and probability multiset. This is NOT proof of every product-ID mapping. https://github.com/kingame111/bazaarflipper-updates/actions/runs/41272510495
- **NPC prices for all 107 produced-item entries** compared with official Hypixel items API: 105 entries have defined NPC prices and all 105 match; two entries are duplicate Raw Soulflow outputs from separate upgrades, for which official API supplies no NPC sell-price field. 96 IDs directly resolved, 11 item names uniquely resolved. https://github.com/kingame111/bazaarflipper-updates/actions/runs/41272850948

## Actual fixes committed ONLY on audit branch

- Flower: all 13 drops including 11 missing flowers; 15 incorrect speeds in Flower/Mycelium/Red Sand corrected against NEU.
- Fishing: one action per harvest (not two), corrected all seven chance values and Sponge NPC fallback.
- Hard Stone: 2 instead of 1 per harvest; Lapis: mean 6 from 4–8; Nether Wart: mean 2.5 from 2–3; Skeleton: mean 1.5 from 1–2; Sunflower: 2 instead of 3 in day/night production.
- NPC corrections: Cactus 4, Coal 1, Emerald 4, Gold 3, Nether Wart 4, Tarantula extra Iron 2.
- Hopper percentages 50% Budget and 70% Enchanted (post-2025 nerf); two Minion Expanders +5% each.
- Soulflow/Lesser Soulflow offline cooldown 105/185 seconds, fuel multiplication on Soulflow; Everburning Flame +35% base plus +5% Combat except Spider.
- Added all three missing PERMANENT special fuels, NOT temporary fuels: Thorny Vines (Flower only, 2 Wild Roses), Dayswitch (Sunflower only, 2 Sunflowers), Nightswitch (Sunflower only, 2 Moonflowers). All are +20%; other minions must reject these special fuels. Solar Panel is deliberately excluded for unloaded-island profit.

## Remaining gaps, explicitly NOT verified or implemented

- Inferno Minion lacks tiers/drops in the model, so it is UNSUPPORTED; must not be ranked as profitable.
- Fishing Minion tier X source discrepancy (NEU 53s, Wiki 43s) is unresolved.
- Nine Wiki upgrades are NOT implemented in the candidate upgrade catalog: Auto Smelter, Hunter Knife, Potato Spreading, Sleepy Hollow, Krampus Helmet, Super Jacob Entertainment System, Compactor, Dwarven Super Compactor, Enchanted Shears. These are NOT considered in optimization. Several are restricted to one minion per profile and cannot be safely modeled as unlimited per-minion upgrades.
- Currently supported upgrade base effects are matched to Wiki descriptions, but mixed combinations, drop compaction and exact cooldown/overflow interactions still require discrete-event testing. https://hypixelskyblock.minecraft.wiki/w/Minion_Upgrades
- Raw Soulflow has no NPC sell price in official items API; candidate fallback is zero.
- 11 product IDs were resolved to the official API by uniquely normalized item name, which is weaker than direct ID verification. Verify Bazaar product identities in the profitability phase.
- Exact 24h/7d offline profit is not established: aggregate storage overflow approximation is NOT an event-driven stack/slot simulator. Large Storage, Super Compactor order, Enchanted Hopper, tax, Bazaar liquidity and sell choice must be validated before release.
- Temporary fuels newly absent from candidate are EXCLUDED by user's direction. Remind when planning the NEXT update.
- Missing setup costs/tier crafting recipes are irrelevant to profit-per-day focus and should not block on their own.

## Rerunnable audit machinery

- Tier NEU: tests/minion-neu-source-audit.mjs
- Wiki speed/storage/base drops: tests/minion-reference-audit.mjs
- Official Hypixel NPC prices (incl upgrades/fuels): tests/minion-npc-source-audit.mjs
- Local engine regressions: tests/minions-v0.6.11.test.mjs
- CI workflows under .github/workflows/ with reports as downloadable GitHub Actions artifacts.

**DO NOT merge PR #16 until offline simulation, profit/ranking comparisons, and release gate are validated.**
