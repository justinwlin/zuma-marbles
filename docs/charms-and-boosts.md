# Charms and boosts: the plan

**Status:** plan, not built yet. Reviewed by Codex and checked against the code.

**In one sentence:** you earn coins by popping marbles, and after every boss you spend them in a shop on boosts (strong, last one world) and charms (yours to keep).

The long background version with inspiration and game theory is in [game-loop.md](game-loop.md). Where the two disagree, this doc wins.

---

## How it works

1. **Play a world.** A world is 10 levels: a mini-boss at level 5, a boss at level 10.
2. **Earn coins** as you play. Skillful play earns more.
3. **Halfway (after the mini-boss):** pick 1 of 2 small boosts for free.
4. **Beat the boss.** Pick 1 of 3 charms for free.
5. **Shop.** Spend your coins on boosts and charms.
6. **Next world.** Your boosts run out when you beat that world's boss. Your charms stay.

That's the whole loop. Everything below is detail.

---

## Your slots

You have **3 charm slots** and **3 boost slots**.

| | Boosts | Charms |
|---|---|---|
| What they are | Strong help for one world | Small rule changes that shape how you play |
| How long they last | Until you beat the next boss | Until you replace them |
| Where you get them | Shop, plus a free pick after the mini-boss | Shop, plus a free pick after the boss |
| Price | 250–450 coins | 500–800 coins |
| When your slots are full | Wait until they run out, or swap one for a free mini-boss pick | Replace one. A bought charm sells back for half; a free one sells for nothing |

---

## Earning coins

Coins are separate from your score. Score still fills the bar and decides stars. Coins are only for the shop.

| What you do | Coins |
|---|---|
| Pop a marble | 1 |
| Each combo step | +5 |
| Gap shot (shooting through a gap in the chain) | +3 |
| Shoot a floating coin | +25 |
| Beat the ace time | +50 |
| Clean clear: win without the chain ever passing halfway | +50 |
| Beat a mini-boss or boss | +100 |

**What doesn't pay:** when a boss dies, the rest of the chain pops by itself. Those marbles pay nothing, because you didn't pop them.

**How much that is:** the bot earns about **1,500–1,900 coins in world 1** before combo bonuses (measured on 6 campaigns each with the casual and good bots). Expect about 2,000. That buys about one charm and two boosts, so you can't have everything. That's the point.

---

## Boosts (strong, last one world)

| Boost | What it does | Price |
|---|---|---|
| 🐢 **Slowpoke** | Chains roll 20% slower | 400 |
| ❤️ **Extra Life** | Once per world: the first time a chain reaches the skull, every chain is pushed back a quarter of the track instead of you losing | 450 |
| ⚡ **Power Surge** | Power-ups appear twice as often | 300 |
| 💣 **Pocket Bomb** | You start every level with one Bomb shot loaded. It explodes where it lands | 350 |
| ⏳ **Long Fuse** | Power marbles last twice as long before they expire (18 s → 36 s) | 250 |
| 🐍 **Snake Charmer** | The serpent's rear-up lasts 1 s longer, and choking it drops 2 extra power-ups | 250 |
| 🔨 **Boss Breaker** | Direct hits on bosses do double damage (shots through gaps at the idol, chokes on the serpent) | 350 |

Pocket Bomb is a new mechanic. Today Bombs only come from popping a Bomb marble in the chain.

---

## Charms (yours to keep)

Each charm nudges you toward a play style. With only 3 slots, picking your 3 is the main decision.

| Charm | What it does | Play style | Price |
|---|---|---|---|
| 🧲 **Magnet** | Gaps in the chain close 30% faster, so combos come easier | Combos | 600 |
| 💥 **Bomber** | Bombs blast 50% wider | Power-ups | 500 |
| 🏹 **Quick Draw** | Your shots fly 25% faster | Fast aim | 500 |
| 🌈 **Rainbow** | Every 15th shot is Wild | Flexible | 700 |
| 🔭 **Colour Scout** | See the marble after next, not just the next one | Planning | 500 |
| 🎯 **Sniper** | Gap shots pay double coins | Precise aim | 600 |
| 👑 **Combo King** | Combos pay double coins | Setting up chains | 700 |
| 🔥 **Daredevil** | Pops while the chain is past 75% of the track pay double coins | Risky play | 600 |
| 🌩️ **Lightning Rod** | Lightning also strikes a second colour, in the front half of the chain only | Power-ups | 800 |
| 🪙 **Scavenger** | Floating coins appear twice as often | Coins | 500 |

Sniper, Combo King and Daredevil pay **extra coins, not extra score**. Extra score would fill bars faster and hurt bosses more, which would throw off the game's tuning. Extra coins only make the shop richer.

---

## The shop

The shop opens after every boss (after levels 10, 20, 30…).

**Before it opens:** pick 1 of 3 charms for free.

**In the shop:**
- **3 charms and 3 boosts** are on offer, picked at random from what you've unlocked.
- **Reroll:** 50 coins for a new set. Each extra reroll in the same visit costs 25 more.
- **Reserve:** pay 50 coins to hold one charm until the next shop, if you can't afford it yet.
- **Sell:** replace a charm when your slots are full.
- **Next up:** the shop shows the next world's boss type, so you can shop for it.

```
┌────────────────────────────────────────────────────────┐
│  BOSS DEFEATED!  Pick a free charm:                    │
│     [ 🧲 Magnet ]    [ 💥 Bomber ]    [ 🔭 Colour Scout ] │
├────────────────────────────────────────────────────────┤
│  SHOP                           🪙 1,850   Next: idol  │
│                                                        │
│  Charms   [🏹 Quick Draw 500] [🌈 Rainbow 700] [🎯 Sniper 600] │
│  Boosts   [🐢 Slowpoke 400]  [⚡ Power Surge 300] [⏳ Long Fuse 250] │
│                                                        │
│  Your charms  [🧲] [  ] [  ]    Your boosts  [  ] [  ] [  ] │
│  [ Reroll 🪙50 ]  [ Reserve 🪙50 ]        [ Continue ▶ ] │
└────────────────────────────────────────────────────────┘
```

---

## The mini-boss pick (level 5)

After the mini-boss, choose 1 of 2 boosts for free. It lasts until the end of the world (level 10). This puts a decision in the middle of each world without needing a second shop screen.

---

## Unlocks: always something new

At the start, only some items can show up. Achievements add more, so the shop keeps surprising you. This is how The Binding of Isaac keeps runs fresh. A **collection screen** shows locked items as silhouettes with their unlock hint.

**Available from the start:**
- **Charms:** Magnet, Bomber, Quick Draw, Rainbow, Colour Scout.
- **Boosts:** Slowpoke, Power Surge, Pocket Bomb, Long Fuse.

**Unlocked by playing:**

| Do this | Unlocks |
|---|---|
| Beat your first serpent | 🐍 Snake Charmer (boost) |
| Beat your first boss | 🔨 Boss Breaker (boost) |
| Reach world 3 | ❤️ Extra Life (boost) |
| Make 50 gap shots | 🎯 Sniper (charm) |
| Make a 4-step combo | 👑 Combo King (charm) |
| Win a level with the chain past 90% of the track | 🔥 Daredevil (charm) |
| Choke a serpent 3 times in one fight | 🌩️ Lightning Rod (charm) |
| Shoot 10 floating coins | 🪙 Scavenger (charm) |

---

## Tricky cases

- **When does a boost run out?** When you beat the boss of the world you bought it for. Buy it after boss 10, and it covers levels 11–20, including boss 20.
- **Two chains and Extra Life?** If either chain reaches its skull, both are pushed back. It works once per world.
- **Slots full and a free pick offered?** Swap it in for one of yours, or skip it. Same for charms after a boss and boosts after a mini-boss.
- **Do coins carry over?** Yes, unspent coins stay with you for the next shop.
- **What resets when I lose?** In Expedition, your coins, charms and boosts all reset. Unlocks are kept forever.

---

## Where it's used

- **Expedition** (endless mode as a roguelite run): built first. Everything resets when you lose, except unlocks.
- **Campaign:** later. Charms are kept for good. Coins only pay out the first time you clear a level or when you beat your best, so replaying old levels can't be used to farm coins.

---

## Build plan

Each step is playable on its own.

| Step | What we build | Done when |
|---|---|---|
| **1. Coins** | Coin counter in the HUD, coins earned per the table above, an itemized coin payout after each level. Coins saved with the run | The bot logs coins by source, and income per world is measured |
| **2. Shop** | Shop after each boss in Expedition: free charm pick, 3 + 3 slots, reroll, buying and selling, boosts running out. Starting pool: Magnet, Bomber, Sniper, Slowpoke, Power Surge | A full run with shopping works, and replays and saves still match exactly |
| **3. Full item list** | All boosts and charms above, the mini-boss pick, Reserve | Balance runs show no item makes the game trivial |
| **4. Unlocks** | Achievement tracking, the collection screen | New items appear in the shop after unlocking |
| **5. Campaign** | Shop in the campaign, coins only for improvements | Replaying old levels pays nothing |

**Rules for every item:**
- Its effect lives in the game simulation (`src/sim/game.ts`) and stays deterministic, so replays and the daily run keep working.
- Shop offers come from the run's seed and are saved with the run.
- Each item gets an icon, a sound and a one-line description.
- The bot learns to use it, so balance numbers stay honest.

---

## Ideas for later

- 🗡️ **Gap Piercer (charm):** a shot that goes through a gap keeps going and can hit a marble behind it, or the boss.
- A 4th charm slot as a rare boss reward.
- Super power-ups charged by a combo meter (see [power-ups](powerups.md)).

## Still to decide

1. Prices are first guesses. Set the final ones after step 1 measures real income.
2. Is the mini-boss pick too generous on top of the free boss charm? Check after playtesting.
