# Minion outstanding 111 setup quotes — source audit (2026-10-25)

This is a **provenance and costing audit**, not a claim that all 111 currently have coin-denominated acquisition prices.

## What the 111 really mean
The full external market audit on 2026-10-19 evaluated 702 tier configurations: 591 had complete setup-price quotes and 111 were missing or unverified. A missing **setup cost quote** does not always mean an unknown ingredient recipe:
- Tier XII merchant upgrades can depend on specific NPCs, currencies, access prerequisites, or upgrade stones, not just Bazaar items.
- Snow Tier I comes from Gifts; Flower Tier I comes from Dark Auction. A known Tier XII step does not establish the cost of the starter.
- Some recipes use item IDs unavailable in the live two-sided Bazaar. Absence of a Bazaar quote is not proof of a missing craft.
- Models of minion *running income* are separate from one-time setup costs.

## Source-verified facts
1. Hypixel SkyBlock Wiki's Minions / Tier XII section specifies that many Tier XII tiers are noncraftable NPC acquisitions, naming Tony, Bulvar, Einary, Ant, Hilda/Marthos, Lukas, The Lotus Eater, SkyMart and Bartender; Flower XII is a museum-milestone craft. https://hypixelskyblock.minecraft.wiki/w/Minions
2. Clay XII requires the special Clay Minion XII Upgrade Stone. This ingredient is explicitly listed in the current Clay Minion source; a Bazaar-only price for the stone must NOT be invented. https://hypixelskyblock.minecraft.wiki/w/Clay_Minion
3. Flower I has a Dark Auction **minimum starting bid** of 2,500,000 coins; this is NOT the sale price, so it does not justify an exact total setup cost. Flower XII unlock requires Museum Milestone 10. https://hypixelskyblock.minecraft.wiki/w/Flower_Minion
4. Tier XII merchant requirements already entered as exact trade data live at `candidate-src/src/minion-merchant-recipes.mjs`, with per-entry references. Snow/Flower external starter restrictions live at `candidate-src/src/minion-external-starters.mjs`.

## Release quality rules
- The recipe model may state *which ingredients or special currencies are required* only with a verifiable source.
- Do not display an absolute coin cost, precise payback/ROI, or HIGH cost confidence when either starter acquisition or any component price is unknown.
- Preserve distinct statuses: RECIPE_UNKNOWN, RECIPE_VERIFIED_PRICE_UNKNOWN, NON_BAZAAR_CURRENCY, STARTER_PRICE_UNKNOWN. No fabricated zero-price entries.
- Tier XII dealer rules must be checked by minion family rather than generalized to all minions.
- Future authoritative ingredient/aquisition data needs a source URL and dated regression proof; market live prices must be snapshotted separately.

## Remaining work
The audited material is enough to distinguish sources and suppress misleading costs, **not enough to certify all 111 exact acquisition values**. Obtain item-specific authoritative price and availability for each unresolved non-Bazaar component, or keep an explicit N/A until obtainable. Inferno minion economics require a separate fuel/drop-rate model and remain unsupported.

The user's laptop read-only diagnostics have not yet been received; do not merge main based on this minion provenance note.
