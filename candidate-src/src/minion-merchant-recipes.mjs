/**
 * Verified Tier XII NPC trades missing from NotEnoughUpdates' crafting recipes.
 *
 * Every trade below was checked independently. This is NOT a general rule:
 * different minion families use different vendors and special currencies.
 * The Tier XI minion itself is already represented by steps 1..11.
 * COINS are real one-time NPC payments and must be added to material costs.
 *
 * Audited 2026-10-19. Keep source URL with each entry.
 */
export const VERIFIED_MERCHANT_UPGRADES = Object.freeze({
  COBBLESTONE_GENERATOR:{
    12:{
      vendor:'Bulvar',source:'https://hypixel-skyblock.fandom.com/wiki/Cobblestone_Minion',
      items:[{item:'ENCHANTED_COBBLESTONE',amount:1024},{item:'COINS',amount:2000000}]
    }
  },
  COAL_GENERATOR:{
    12:{
      vendor:'Bulvar',source:'https://wiki.scd.wtf/Coal_Minion_XII',
      items:[{item:'ENCHANTED_COAL_BLOCK',amount:16},{item:'COINS',amount:2000000}]
    }
  },
  DIAMOND_GENERATOR:{
    12:{
      vendor:'Bulvar',source:'https://wiki.scd.wtf/Diamond_Minion_XII',
      items:[{item:'ENCHANTED_DIAMOND_BLOCK',amount:16},{item:'COINS',amount:2000000}]
    }
  },
  HARD_STONE_GENERATOR:{
    12:{
      vendor:'Bulvar',source:'https://wiki.scd.wtf/Hard_Stone_Minion_XII',
      items:[{item:'CONCENTRATED_STONE',amount:16},{item:'COINS',amount:2000000}]
    }
  },
  CARROT_GENERATOR:{
    12:{
      vendor:'Tony',source:'https://wiki.scd.wtf/Carrot_Minion_XII',
      // Pelts are not tradeable Bazaar coins. Their opportunity cost is unknown;
      // show a separate non-coin requirement, never pretend total payback is exact.
      items:[{item:'ENCHANTED_GOLDEN_CARROT',amount:32},{item:'PELTS',amount:75}]
    }
  },
  OBSIDIAN_GENERATOR:{
    12:{
      vendor:'Bulvar',source:'https://wiki.scd.wtf/Obsidian_Minion_XII',
      items:[{item:'ENCHANTED_OBSIDIAN',amount:1024},{item:'COINS',amount:2000000}]
    }
  }
});
