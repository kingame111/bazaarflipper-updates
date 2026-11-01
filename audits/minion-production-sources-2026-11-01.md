# Minion production-source verification — 2026-11-01 (IN PROGRESS)

Scope: verify *production* speeds, drops, fuels and upgrades against current Hypixel SkyBlock Wiki, excluding setup recipes and setup ROI. This is a source audit, **not** proof that all 61 families or all tiers are verified.

## Confirmed matches
- Enchanted Hopper: 70% NPC value after 2025-10-15 nerf, 2026-01-27 old-placement fix. Candidate uses 0.7. https://hypixelskyblock.minecraft.wiki/w/Enchanted_Hopper
- Budget Hopper: 50% NPC value. https://hypixelskyblock.minecraft.wiki/w/Minions
- Diamond Spreading: 10% chance per harvested resource unit, not per cycle; code includes chance .1 and counts resource items. https://hypixelskyblock.minecraft.wiki/w/Diamond_Spreading
- Catalyst: 3x drops without action-speed change; code speed=0,drops=3,duration=10800 seconds. https://hypixelskyblock.minecraft.wiki/w/Catalyst
- Two Minion Expanders: +5% each additive; candidate engine corrected to 0.05 * count. https://hypixelskyblock.minecraft.wiki/w/Minion_Fuels
- Solar Panel must not be treated as a normal always-on 25% offline fuel; currently absent from fuel catalog. https://hypixelskyblock.minecraft.wiki/w/Minion_Fuels

## Confirmed source discrepancies — must fix and regression-test
1. Flower Minion: code only models 35% Dandelion and 15% Poppy. Wiki documents 11 additional flower types at 4.545% each, totaling the missing 50%. The code's output probabilities sum to 0.50. https://hypixelskyblock.minecraft.wiki/w/Flower_Minion
2. Soulflow Engine: code cooldown=90 sec, wiki offline cooldown=105 sec. Lesser Soulflow Engine: code=180 sec, wiki offline=185 sec. These directly overstate offline Soulflow. https://hypixelskyblock.minecraft.wiki/w/Soulflow_Engine and https://hypixelskyblock.minecraft.wiki/w/Minion_Upgrades
3. Soulflow Engine with Catalyst/Hyper Catalyst: wiki states drop-multiplying fuel multiplies Raw Soulflow, but candidate cooldownDrop processing calls addDrop(...,1), without fuelDropMultiplier. https://hypixelskyblock.minecraft.wiki/w/Soulflow_Engine
4. Wiki lists Potato Spreading (5%) and several other special upgrades, but candidate's upgrades catalog does not include them. This is a supported-feature gap, not necessarily a wrong calculation for existing supported setups. https://hypixelskyblock.minecraft.wiki/w/Minion_Upgrades

## Still unverified — do not mark complete
- All tier I–XII speed values for all 61 families; each tier must be crosschecked individually against a versioned source.
- Complete item drop probabilities, quantities and NPC values for all families, including recent Sunflower, Vampire, Lily Pad, and Flower changes.
- All fuel speed/duration/stack behavior and any new fuels absent from candidate (candidate currently lists 12 entries including NONE).
- All upgrade conditions, offline behavior, per-profile limits and absent upgrades (candidate currently lists 11 entries including NONE).
- Offline two-action-cycle exceptions, drop transformation, compaction order, storage packing and hopper overflow need separate simulation validation.
- Inferno remains unsupported and must be explicitly excluded from profitability ranking until implemented.

Do not merge this PR or publish a release until the data audit and financial regression gate pass. Stable manifest and production data unchanged.
