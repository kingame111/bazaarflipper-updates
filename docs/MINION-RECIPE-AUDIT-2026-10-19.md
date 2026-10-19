# Minion recipe verification — 2026-10-19

Branch: `stabilization/v0.7.0-foundation`, **unreleased** v0.7.0. Do NOT merge before final CI and customer laptop/real-PC preflight.

## What the old "111 incomplete" actually means

The 111/702 number came from attempting **live coin-valued construction quotations**. It did not imply 111 missing recipes. Of 61 minion families, Inferno is intentionally unsupported, Flower and Snow start at Tier I via non-Bazaar acquisition, and the remaining 58 families have explicit NEU-derived upgrade steps through their tiers. The old dataset had **29 Tier XII vendor recipes missing**, not a universal, derivable 11->12 step.

## Exact sources, not a multiplier heuristic

`candidate-src/src/minion-merchant-recipes.mjs` now contains **29** independent source-linked Tier XII vendor entries:
- Bulvar and similar mining NPCs: tier-specific priced items and 2,000,000 coin fees, e.g. Cobblestone 1024 Enchanted Cobblestone, Lapis 64 Enchanted Lapis Lazuli Blocks. Never assume all mineral materials use 16 or 1024.
- Tony: individually sourced crop/animal materials **plus 75 Pelts**. Mushroom XII has **512 Enchanted Brown Mushroom AND 512 Enchanted Red Mushroom**, unlike a single-material tier.
- Einary: Ice XII needs 1024 Enchanted Ice, 1,000,000 coins, and **300 North Stars**.
- Marthos: Red Sand XII requires 32 Enchanted Red Sand Cubes, 2,000,000 coins, and the separate **12,000 Barbarian Reputation** eligibility prerequisite (explicitly recorded in entry metadata).
- SkyMart: Sunflower XII requires 32 Compacted Sunflowers and Sunflower XI. Do not manufacture a coin or Pelt cost.

The catalog regression test `tests/minion-catalog-coverage-v0.7.0.test.mjs` independently enumerates exact `item/amount` requirements, proves no step disappeared from levels I–XI, and verifies all tiers of all otherwise craftable supported minions have a resolvable material recipe. The implementation returns complete recipe provenance but **does not convert non-coin currencies or reputation into coin cost**.

### Craftable items missing from Bazaar

`candidate-src/src/minion-ingredient-recipes.mjs` holds individually verified nested recipes for Zombie Heart, Crystallized Heart and Bat Person Helmet. These can be costed recursively **only if all base ingredients have valid acquisition quotes**; an unpriced base item must keep setup cost and payback N/A.

### Strict model limitations

- **Flower, Snow:** Tier I auction/gift acquisition cannot be determined from Bazaar; the entire cumulative purchase path must not claim an exact payback.
- **Fishing Rod:** verified 3 sticks + 2 string crafted from 1 whole oak log and 2 string, using live Bazaar acquisition quotes (the unused planks/stick are not credited). Missing ingredient prices fail closed. This is a documented crafting path, not necessarily the globally cheapest acquisition.
- **Pelts and North Stars:** source-linked exact quantity, but no universal coin market price. Cumulative coin-only setup cost, ROI and payback must stay N/A in their presence.
- **Red Sand Reputation:** required 12k Barbarian reputation is a separate eligibility gate, not a Bazaar coin payment.
- **Inferno:** special fuel and tier mechanics still unsupported as a full economic model.
- This review verifies ingredient *data provenance* and calculation invariants, not all measured in-game production rates. Recipes may change in a future Hypixel update; code must fail closed when sources become stale.

## Reference evidence

Minion base steps derive from the pinned NEU repository tree, `MINION_DATA.recipeDataVersion.commit=c4f7d4757641f3a11c74d3d77cec76c100abaf98`. Each vendor trade references the exact community wiki or live-derived NPC listing in its data entry. Representative independent cross-checks:
- https://hypixel-skyblock.fandom.com/wiki/Mushroom_Minion (two mushroom colors, 512 each + 75 Pelts).
- https://hypixel-skyblock.fandom.com/wiki/Melon_Minion and https://hypixel-skyblock.fandom.com/wiki/Enchanted_Melon (32 Enchanted Melon, Bazaar product ID ENCHANTED_MELON_BLOCK, plus 75 Pelts).
- https://hypixel-skyblock.fandom.com/wiki/Red_Sand_Minion (Marthos + 12,000 reputation gate).
- https://skykings.net/wiki/npc/skymart-npc (Sunflower XII for 32 Compacted Sunflower).
- https://skykings.net/wiki/npc/einary-npc (Ice XII star currency).
- https://wiki.scd.wtf/Cow_Minion_XII (1024 Enchanted Leather plus Pelts).
- https://hypixel-skyblock.fandom.com/wiki/Spooky_Fragment and https://hypixel-skyblock.fandom.com/wiki/Crystallized_Heart (recursive craft components).

## Release acceptance

Run `tests/minion-recursive-v0.7.0.test.mjs`, `tests/minion-merchant-v0.7.0.test.mjs`, `tests/minion-nonbazaar-craft-v0.7.0.test.mjs`, `tests/minion-catalog-coverage-v0.7.0.test.mjs`, live `tests/hypixel-live-v0.7.0.mjs`, all-UI Chromium, full Windows/Linux package boot and 700*2200 sync stress on the SAME code SHA. *The current laptop report/real-PC verification still gates publishing to main.*
