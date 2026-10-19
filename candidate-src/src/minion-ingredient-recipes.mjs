/**
 * Exact non-Bazaar ingredient crafting recipes verified against item-specific
 * community wiki references (2026-10-19). Used only if no live Bazaar
 * acquisition quote exists. Never substitute NPC SELL prices for BUY prices.
 */
export const VERIFIED_NON_BAZAAR_INGREDIENTS = Object.freeze({
  FISHING_ROD:{
    source:'https://www.minecraft.net/ru-ru/article/fishing-rod',
    supportingSource:'https://hypixel-skyblock.fandom.com/wiki/Fishing_Rods',
    // 3 Sticks + 2 String. One Oak Log -> 4 Planks; 2 Planks -> 4 Sticks,
    // enough for one rod. This deliberately charges the FULL log consumed,
    // and leaves a spare stick and two planks, rather than inventing partial
    // stick purchases or a nonexistent Bazaar fishing-rod quote.
    // A verifiable crafting path, not necessarily the cheapest acquisition.
    recipe:[{item:'LOG',amount:1},{item:'STRING',amount:2}]
  },
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
