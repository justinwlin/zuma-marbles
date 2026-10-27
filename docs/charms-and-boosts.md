# Charms and boosts

Status: design draft, not built. Prices and numbers are starting points to tune with the bot. For the reasoning and inspiration behind this, see [game-loop.md](game-loop.md).

## The idea in one paragraph

Popping marbles earns **coins**. After every boss (every 10 levels) there's a **shop**. You spend coins on **boosts**, which are strong but only last for the next world, and on **charms**, which you keep. Each boss also lets you pick one charm for free. Beating bosses and challenges **unlocks** new charms and boosts, so the shop keeps getting new things.

## The rules

| | Boosts | Charms |
|---|---|---|
| **Slots** | 3 | 3 |
| **Lasts** | The next world (10 levels), then gone | Until you replace it |
| **Strength** | Strong | Medium, changes how you play |
| **Get it from** | The shop | The shop, or a free pick after each boss |
| **Price** | 100–250 coins | 400–700 coins |
| **When slots are full** | Can't buy more until the world ends | Replace one; the old one sells for half |

## Earning coins

| Action | Coins |
|---|---|
| Pop a marble | 1 |
| Combo | +5 per combo step |
| Gap shot | +3 |
| Shoot a floating coin | +25 |
| Beat the ace time | +50 |
| Beat a boss or mini-boss | +100 |

That works out to roughly 2,000 coins per world, enough for **one charm and one or two boosts**, not everything. To be confirmed with the bot.

## Boosts (temporary, 3 slots)

Strong effects that last one world. Buy them to get through a hard stretch.

| Boost | Effect | Price |
|---|---|---|
| **Slowpoke** | Chains roll 20% slower | 200 |
| **Extra Life** | The first time a chain reaches the skull, it's pushed back instead of ending the level. Once per world | 250 |
| **Gold Rush** | +50% coins | 150 |
| **Power Surge** | Power-ups appear twice as often | 150 |
| **Pocket Bomb** | Start every level with one Bomb shot loaded | 200 |
| **Fewer Colours** | Chains use one fewer colour | 250 |
| **Long Fuse** | Power-ups last twice as long, and Slow and Reverse last 50% longer | 150 |
| **Ace Timer** | Ace time is 15 s longer | 100 |
| **Boss Breaker** | Bosses and serpents take 50% more damage | 200 |

## Charms (kept, 3 slots)

Each charm pushes you toward a play style. With only 3 slots, choosing which 3 to keep is the main decision.

| Charm | Effect | Play style | Price |
|---|---|---|---|
| **Sniper** | Gap shots pay double coins and score | Precise aim | 500 |
| **Combo King** | Each combo step counts as two | Setting up chains | 600 |
| **Daredevil** | Pops while the chain is near the skull pay double coins | Risky play | 500 |
| **Rainbow** | Every 10th shot is Wild | Flexible | 600 |
| **Magnet** | Gaps in the chain close 30% faster, so combos come easier | Combos | 500 |
| **Lucky** | Power marbles appear 25% more often | Power-ups | 400 |
| **Bomber** | Bombs blast 50% wider | Power-ups | 400 |
| **Lightning Rod** | Lightning also strikes a second colour | Power-ups | 500 |
| **Quick Draw** | Shots fly 25% faster and reload faster | Fast play | 500 |
| **Piggy Bank** | Earn 1 coin per 10 you're holding at the end of each level (max 10) | Saving | 400 |
| **Scavenger** | Floating coins appear twice as often | Coins | 400 |
| **Snake Charmer** | The serpent's rear-up lasts 1 s longer, and choking it drops 2 extra power-ups | Mini-bosses | 500 |

## The shop

The shop opens after every boss (levels 10, 20, 30…).

- **On display:** 3 charms and 3 boosts, picked at random from what you've unlocked.
- **Reroll:** 50 coins for a fresh set, +25 each time you reroll in the same visit.
- **Free boss charm:** before the shop opens, pick 1 of 3 charms for free.
- **Preview:** the shop shows the next world's theme and boss, so you can buy for it.

```
┌──────────────────────────────────────────────────────┐
│  BOSS DEFEATED!   Pick a free charm:                 │
│   [ 🌈 Rainbow ]  [ 🧲 Magnet ]  [ 💣 Bomber ]      │
├──────────────────────────────────────────────────────┤
│  SHOP                          🪙 1,850   Next: Ice  │
│  Charms:  [🍀 Lucky 400] [⚡ Quick Draw 500] [🐷 Piggy Bank 400] │
│  Boosts:  [🐢 Slowpoke 200] [❤ Extra Life 250] [💰 Gold Rush 150] │
│                                                      │
│  Your charms: [🌈] [ ] [ ]     Your boosts: [ ] [ ] [ ] │
│  [ Reroll 🪙50 ]                       [ Continue ▶ ] │
└──────────────────────────────────────────────────────┘
```

## Unlocks

At the start, only 6 charms and 6 boosts can appear in the shop. Each achievement below adds one more. Players always have something new to unlock, like The Binding of Isaac. A collection screen shows locked items as silhouettes with their unlock hint.

| Achievement | Unlocks |
|---|---|
| Beat the first serpent | Snake Charmer (charm) |
| Beat the first boss | Boss Breaker (boost) |
| Choke a serpent 3 times in one fight | Lightning Rod (charm) |
| Win a level with the chain past 90% of the track | Daredevil (charm) |
| Make 50 gap shots | Sniper (charm) |
| Make a 4-step combo | Combo King (charm) |
| Clear a world without buying a boost | Fewer Colours (boost) |
| Reach world 3 | Extra Life (boost) |
| Shoot 10 floating coins | Scavenger (charm) |

**Starting pool:** charms Rainbow, Magnet, Lucky, Bomber, Quick Draw, Piggy Bank. Boosts Slowpoke, Gold Rush, Power Surge, Pocket Bomb, Long Fuse, Ace Timer. That's 6 of each. The other 9 join the pool through the unlocks above.

## Example: one world

1. **World 1, levels 1–10.** You earn 1,850 coins. You beat the boss.
2. **Free pick:** Rainbow. Your charms: Rainbow.
3. **Shop:** you buy Slowpoke (200) and Gold Rush (150). You have 1,500 left. You reroll once (50) and buy Magnet (500). Charms: Rainbow, Magnet. Boosts: Slowpoke, Gold Rush. 950 coins saved.
4. **World 2.** Chains are slower, coins are up 50%, every 10th shot is Wild, and combos come easier.
5. **Boss of world 2 beaten.** Slowpoke and Gold Rush disappear. Rainbow and Magnet stay. You pick Bomber for free, so your third slot fills.
6. **Shop:** your charm slots are full. Lucky is on offer. Selling Magnet (+250) to make room for it is your choice.

## Where it applies

- **Expedition (endless mode as a roguelite):** everything resets when you lose the run. Unlocks stay forever.
- **Campaign:** charms are kept permanently. Coins are only paid the first time you clear a level or beat your best, so replaying old levels can't be used to farm coins.

## Open questions

1. Build it in Expedition first, then the campaign? (Recommended.)
2. Are 3 + 3 slots too few late in a run? A boss reward could offer a 4th charm slot once.
3. Should the mini-boss (level 5) also open a small shop, so coins don't sit unspent for 10 levels?
