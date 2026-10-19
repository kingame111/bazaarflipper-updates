/**
 * Exact non-Bazaar ingredient crafting recipes verified against item-specific
 * community wiki references (2026-10-19). Used only if no live Bazaar
 * acquisition quote exists. Never substitute NPC SELL prices for BUY prices.
 */
export const VERIFIED_NON_BAZAAR_INGREDIENTS = Object.freeze({
  CRYSTALLIZED_HEART:{
    source:'https://hypixel-skyblock.fandom.com/wiki/Crystallized_Heart',
    recipe:[{item:'ENCHANTED_DIAMOND',amount:256},{item:'ZOMBIE_HEART',amount:1}]
  },
  ZOMBIE_HEART:{
    source:'https://hypixel-skyblock.fandom.com/wiki/Zombie%27s_Heart',
    recipe:[{item:'ENCHANTED_ROTTEN_FLESH',amount:256}]
  },
  BAT_PERSON_HELMET:{
    source:'https://hypixel-skyblock.fandom.com/wiki/Spooky_Fragment',
    supportingSource:'https://hypixel-skyblock.fandom.com/wiki/Spooky_Armor',
    recipe:[{item:'SPOOKY_SHARD',amount:5},{item:'PURPLE_CANDY',amount:64}]
  }
});
