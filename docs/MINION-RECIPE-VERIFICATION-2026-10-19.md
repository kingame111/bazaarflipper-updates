# BazaarFlipper — Tier XII merchant recipe verification (19 October 2026)

**Status:** All 29 Tier XII merchant recipe families below were cross-checked against their individual current community Hypixel SkyBlock wiki tables, plus the versioned NotEnoughUpdates minion catalog where a crafting recipe was available. This is source verification, **not live in-game NPC interaction**. Hypixel discontinued the official wiki in July 2026; older archived values can disagree.

The code stores the per-level XI→XII ingredients separately from cumulative Tier I→XII crafting materials. Coin payments and other earned non-Bazaar currencies are **not** interchangeable. No non-Bazaar currency is assigned a fabricated coin value.

**Live Hypixel diagnostic run** https://github.com/kingame111/bazaarflipper-updates/actions/runs/39278531640 assessed 702 supported minion/tier combinations on 2026-10-19: **662 full setup quotes; 40 incomplete**. Earlier audit showed 111 incomplete on a prior revision and market snapshot. Remaining 40 divide precisely into **24** Snow/Flower starter acquisition gaps (12 tiers each), **15** Tier XII Tony trades costing **75 Pelts** and **1** Ice XII costing **300 North Stars**. These are cost/pricing gaps, not unidentified upgrade ingredient recipes. Price completeness may vary with live market conditions.

## Source-checked merchant trades

Each row represents the *additional step* from Tier XI to Tier XII; Tier I–XI ingredient totals come from versioned NEU `upgradeRecipes`.

| Minion | Vendor | Tier XI → Tier XII cost / requirements | Checked against |
|---|---|---|---|
| Cactus | Tony | 32 Enchanted Cactus + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Cactus_Minion) |
| Carrot | Tony | 32 Enchanted Golden Carrot + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Carrot_Minion) |
| Chicken | Tony | 1024 Enchanted Raw Chicken + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Chicken_Minion) |
| Coal | Bulvar | 16 Enchanted Coal Blocks + 2,000,000 Coins | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Coal_Minion) |
| Cobblestone | Bulvar | 1024 Enchanted Cobblestone + 2,000,000 Coins | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Cobblestone_Minion) |
| Cocoa Beans | Tony | 16 Enchanted Cookies + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Cocoa_Beans_Minion) |
| Cow | Tony | 1024 Enchanted Leather + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Cow_Minion) |
| Diamond | Bulvar | 16 Enchanted Diamond Blocks + 2,000,000 Coins | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Diamond_Minion) |
| Emerald | Bulvar | 16 Enchanted Emerald Blocks + 2,000,000 Coins | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Emerald_Minion) |
| Gold | Bulvar | 16 Enchanted Gold Blocks + 2,000,000 Coins | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Gold_Minion) |
| Hard Stone | Bulvar | 16 Concentrated Stone + 2,000,000 Coins (conflicting historical item-usage references say 32) | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Hard_Stone_Minion) |
| Ice | Einary | 1024 Enchanted Ice + 1,000,000 Coins + 300 North Stars | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Ice_Minion) |
| Iron | Bulvar | 16 Enchanted Iron Blocks + 2,000,000 Coins | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Iron_Minion) |
| Lapis | Bulvar | 64 Enchanted Lapis Lazuli Blocks + 2,000,000 Coins | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Lapis_Minion) |
| Melon | Tony | 32 Enchanted Melon Blocks + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Melon_Minion) |
| Mithril | Bulvar | 16 Refined Mithril + 2,000,000 Coins | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Mithril_Minion) |
| Mushroom | Tony | 512 Enchanted Brown Mushrooms + 512 Enchanted Red Mushrooms + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Mushroom_Minion) |
| Nether Wart | Tony | 1024 Enchanted Nether Wart + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Nether_Wart_Minion) |
| Obsidian | Bulvar | 1024 Enchanted Obsidian + 2,000,000 Coins | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Obsidian_Minion) |
| Pig | Tony | 16 Enchanted Cooked Porkchops + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Pig_Minion) |
| Potato | Tony | 32 Enchanted Baked Potatoes + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Potato_Minion) |
| Pumpkin | Tony | 1024 Enchanted Pumpkins + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Pumpkin_Minion) |
| Rabbit | Tony | 16 Enchanted Cooked Rabbit + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Rabbit_Minion) |
| Red Sand | Marthos | 32 Enchanted Red Sand Cubes + 2,000,000 Coins; 12,000 Barbarian Reputation (eligibility) | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Red_Sand_Minion) |
| Redstone | Bulvar | 32 Enchanted Redstone Blocks + 2,000,000 Coins | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Redstone_Minion) |
| Sheep | Tony | 16 Enchanted Cooked Mutton + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Sheep_Minion) |
| Sugar Cane | Tony | 32 Enchanted Sugar Cane + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Sugar_Cane_Minion) |
| Sunflower | SkyMart | 32 Compacted Sunflowers | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Sunflower_Minion) |
| Wheat | Tony | 1024 Enchanted Wheat + 75 Pelts | [Community recipe](https://hypixelskyblock.minecraft.wiki/w/Wheat_Minion) |

## Important caveats and user impact

- **Snow I** comes from Gifts; minion acquisition cannot be quoted from regular Bazaar ingredients. Twelve levels retain unknown **starting acquisition cost**. The upgrade material recipes are known, but total payback is not exactly computable from Bazaar: https://hypixelskyblock.minecraft.wiki/w/Snow_Minion
- **Flower I** comes from Dark Auction, where bids are variable and the documented minimum is 2,500,000 coins. Treat the minimum as a floor, **not** as a guaranteed market acquisition cost. Its Tier XII crafting path requires Museum Milestone 10: https://hypixelskyblock.minecraft.wiki/w/Flower_Minion
- **Pelts** are earned NPC/trade currency, and **North Stars** are event currency; they must appear as explicit requirements. UI total setup price, ROI and payback remain `N/A` until an explicit acquisition-cost model is supplied and verified.
- **Hard Stone XII conflict:** the individual current community minion recipe table and wiki.scd.wtf list **16 Concentrated Stone**, while an older item-specific usage reference lists **32**. Candidate uses the current minion-specific **16** and records this discrepancy. Do not silently claim certainty without current in-game Bulvar verification.
- **Live market availability:** a recipe may be source verified while the Bazaar book lacks a usable acquisition price for one material. Continue displaying `N/A` instead of zero or a guessed cost.
- **Inferno Minion** is intentionally unsupported by economics; cannot label that minion validated just because the 702 other tiers passed.

## Reproducible tests and code
- 29 precise merchant-trade regression fixtures with expected vendor/ingredients, source URLs, non-Bazaar currencies, 24 external starters: `tests/minion-merchant-provenance-v0.7.0.test.mjs`
- On-run live Hypixel classification: `tests/minion-unverified-breakdown-v0.7.0.mjs` and `.github/workflows/minion-unverified-diagnostic.yml`
- Data-backed resolver: `candidate-src/src/minion-recipes.mjs`, merchant data: `candidate-src/src/minion-merchant-recipes.mjs`
- Release integration tests: `.github/workflows/stabilization-v0.7.0.yml`
- **Do not merge or release** until all candidate tests and user's real laptop/desktop acceptance are complete.
