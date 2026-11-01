# Special upgrade offline findings (2026-11-01)

Independent event-by-event reference: https://github.com/kingame111/bazaarflipper-updates/actions/runs/41274655971

- 16 meaningful special upgrade setups were tested with and without Large Storage, Enchanted Hopper, and over 1/3/7 days: 192 configurations, 1,536 seeded trials.
- 20 configurations show more than 5% estimated coin discrepancies from the current candidate engine; 10 exceed 20%.
- Most severe: Snow XI with Diamond Spreading + Super Compactor, 7 days, no Large Storage or Hopper: model ~334,966 NPC coins vs reference ~152,320 (120% overestimate in that specific reference scenario).
- Slime XI with Corrupt Soil + Super Compactor and Ghast XI with Soulflow + Super Compactor also show material errors.
- The current candidate uses the aggregate approximate overflow model for combinations with extra-drop or cooldown upgrades, even though base deterministic and stochastic minions have a chronological model.
- This is a **measured HIGH release blocker**, not an exception to waive. In-game compaction ordering, stochastic output details and NPC pricing require further checks; the reference still relies on documented behavior assumptions.
- An attempted generic event-based special-upgrade implementation was deliberately NOT retained because it could not be completed and validated. Only confirmed code changes remain on audit branch.
- The stable v0.6.13 release remains untouched; DO NOT merge audit PR #16 or publish new updater bundle.
