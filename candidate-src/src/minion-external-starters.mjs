/**
 * Special Tier XII requirements for externally acquired minions.
 * A known upgrade recipe DOES NOT price the Tier I starting minion.
 * Neither gifts nor auction bids can be inferred from Bazaar product prices.
 */
export const VERIFIED_EXTERNAL_STARTER_TIER_XII = Object.freeze({
 SNOW_GENERATOR:{
   vendor:'Einary',
   source:'https://hypixelskyblock.minecraft.wiki/w/Snow_Minion',
   items:[
     {item:'ENCHANTED_SNOW_BLOCK',amount:1024},
     {item:'COINS',amount:2000000},
     {item:'NORTH_STARS',amount:500}
   ],
   requirements:[{kind:'EXTERNAL_TIER_I',method:'GIFTS',costKnown:false}]
 },
 FLOWER_GENERATOR:{
   vendor:'CRAFT',
   source:'https://hypixelskyblock.minecraft.wiki/w/Flower_Minion',
   items:[{item:'ENCHANTED_POPPY',amount:16}],
   requirements:[
     {kind:'EXTERNAL_TIER_I',method:'DARK_AUCTION',costKnown:false,minimumListedBid:2500000},
     {kind:'MUSEUM_MILESTONE',amount:10}
   ]
 }
});
