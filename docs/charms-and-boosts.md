# Charms and boosts: the plan

**Status:** built for Expedition (endless mode) on the `feat/expedition-economy` branch. The campaign version is not built. How the code is organised: [economy-architecture.md](economy-architecture.md).

**In one sentence:** you earn coins by popping marbles, and after every boss you spend them in a shop on boosts (strong, last one world) and charms (yours to keep).

The long background version with inspiration and game theory is in [game-loop.md](game-loop.md). Where the two disagree, this doc wins.

---

## How it works

1. **Play a world.** A world is 10 levels: a mini-boss at level 5, a boss at level 10.
2. **Earn coins** as you play. Skillful play earns more.
3. **Halfway (after the mini-boss):** pick 1 of 2 boosts for free, and buy from a small **trader** (2 boosts and 1 charm) on the same screen.
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
| Price (world 2 shop) | about 475–850 coins | about 600–1,200 coins |
| When your slots are full | Wait until they run out, or swap one for a free mini-boss pick | Replace one. A bought charm sells back for half; a free one sells for nothing |

---

## Earning coins

Coins are separate from your score. Score still fills the bar and decides stars. Coins are only for the shop.

| What you do | Coins |
|---|---|
| Pop a marble | 1 |
| Each combo step | +5 |
| Shoot a floating coin | +25 |
| Beat the ace time | +50 |
| Clean clear: win without the chain ever passing halfway | +50 |
| Beat a mini-boss or boss | +100 |

**What doesn't pay:** when a boss dies, the rest of the chain pops by itself. Those marbles pay nothing, because you didn't pop them.

**How much that is:** in simulated runs the good bot earns about **2,100 coins in world 1, 2,400 in world 2 and 2,600 in world 3**. That buys about one charm and two boosts, so you can't have everything. That's the point.

**Prices rise 20% per world**, so they keep pace with income. The prices below are the base prices; the shop after boss 10 charges 1.2×, after boss 20 1.4×, and so on. Simulated runs end each shop with only about 250–400 coins left over.

---

## Boosts (strong, last one world)

| Boost | What it does | Price |
|---|---|---|
| 🐢 **Slowpoke** | Chains roll 20% slower | 600 |
| ❤️ **Extra Life** | Once per world: the first time a chain reaches the skull, every chain is pushed back a quarter of the track instead of you losing | 700 |
| ⚡ **Power Surge** | Power-ups appear twice as often | 450 |
| 💣 **Pocket Bomb** | You start every level with one Bomb shot loaded. It explodes where it lands | 500 |
| ⏳ **Long Fuse** | Power marbles last twice as long before they expire (18 s → 36 s) | 400 |
| 🐍 **Snake Charmer** | The serpent's rear-up lasts 1 s longer, and choking it drops 2 extra power-ups (a choke normally drops 1–2) | 400 |
| 🔨 **Boss Breaker** | Direct hits on bosses do double damage (shots through gaps at the idol, chokes on the serpent) | 500 |
| 🏁 **Head Start** | Levels need 15% less score | 500 |
| ✂️ **Colour Cut** | One fewer marble colour (never below 3) | 700 |
| 🌬️ **Second Wind** | Once per level, the first time a chain passes 90% of the track it rolls back (a free Reverse) | 450 |
| 💰 **Coin Rush** | Popped marbles pay 50% more coins | 450 |
| ⏱️ **Ace Hunter** | Ace time +20 s | 350 |
| 🎁 **Opener** | Every level starts with a power marble in the chain as soon as it rolls in | 400 |

Head Start, Colour Cut and Ace Hunter change the level itself (`boostedLevel` in `src/sim/items.ts`), so the HUD, ace chip and next-stage preview show the boosted values.

Bot win rate on levels 13/23/33 with one boost (40 levels each, good bot): none 65%, Slowpoke 80%, Colour Cut 76%, Head Start 73%, Opener 73%, Second Wind 69%.

Pocket Bomb is a new mechanic. Today Bombs only come from popping a Bomb marble in the chain.

---

## Charms (yours to keep)

Each charm nudges you toward a play style. With only 3 slots, picking your 3 is the main decision.

| Charm | What it does | Play style | Price |
|---|---|---|---|
| 💥 **Shockwave** | Matches of 5 or more also pop the marble on each side | Big matches | 750 |
| 🧨 **Bomber** | Bombs blast 50% wider | Power-ups | 650 |
| 🏹 **Quick Draw** | Your shots fly 25% faster | Fast aim | 600 |
| 🌈 **Rainbow** | Every 15th shot is Wild | Flexible | 850 |
| 🔭 **Colour Scout** | See the marble after next, not just the next one | Planning | 500 |
| 🍀 **Lucky Colour** | One colour (rolled when you get it, shown on the charm) pays triple coins | One colour | 700 |
| 👑 **Combo King** | Combos pay double coins | Setting up chains | 800 |
| 🔥 **Daredevil** | Pops while the chain is past 75% of the track pay double coins | Risky play | 700 |
| 🌩️ **Lightning Rod** | Lightning also strikes a second colour, in the front half of the chain only | Power-ups | 1,000 |
| 🪙 **Scavenger** | Floating coins appear twice as often | Coins | 600 |
| ❄️ **Deep Freeze** | Slow lasts twice as long | Power-ups | 600 |
| ⏪ **Rewinder** | Reverse lasts twice as long | Power-ups | 650 |
| 🦂 **Hungry Scorpion** | Scorpions eat 20 marbles instead of 10 | Power-ups | 600 |
| 🃏 **Double Wild** | Wild power-ups make your next two shots Wild | Power-ups | 650 |

Every in-game power-up has a charm that makes it stronger: Bomber (Bomb), Lightning Rod (Lightning), Deep Freeze (Slow), Rewinder (Reverse), Hungry Scorpion (Scorpion), Double Wild (Wild). Together with Power Surge and Long Fuse, that's a full power-up build.

Shockwave and Lucky Colour replaced the earlier Magnet and Sniper ideas: closing gaps faster and shooting through gaps weren't interesting enough.

Lucky Colour, Combo King and Daredevil pay **extra coins, not extra score**. Extra score would fill bars faster and hurt bosses more, which would throw off the game's tuning. Extra coins only make the shop richer.

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
│     [ 💥 Shockwave ] [ 🧨 Bomber ]    [ 🔭 Colour Scout ] │
├────────────────────────────────────────────────────────┤
│  SHOP                           🪙 1,850   Next: idol  │
│                                                        │
│  Charms   [🏹 Quick Draw 725] [🌈 Rainbow 1,025] [🍀 Lucky 850] │
│  Boosts   [🐢 Slowpoke 725]  [⚡ Power Surge 550] [⏳ Long Fuse 475] │
│                                                        │
│  Your charms  [💥] [  ] [  ]    Your boosts  [  ] [  ] [  ] │
│  [ Reroll 🪙50 ]  [ Reserve 🪙50 ]        [ Continue ▶ ] │
└────────────────────────────────────────────────────────┘
```

---

## Retrying a lost stage

Losing a stage doesn't have to end the run:

- **Retry it for half your coins**, rounded up, and at least 100. You keep your charms and boosts, and the stage restarts from the beginning.
- **Coins earned during the failed attempt aren't banked,** so dying can't be used to farm coins. An Extra Life spent in the failed attempt stays spent for that world.
- **Each retry halves what's left,** so repeated retries drain a run quickly. Below 100 coins, the only option is to end the run.
- **The loss is saved the instant a chain reaches the skull.** Force-closing the app during the "Oh no!" animation brings back the retry screen; it can't be used to resume from before the loss.
- **Daily runs allow retries too.** They cost coins like any other run, and the daily best is a personal record.

## The mini-boss pick and trader (level 5)

After the mini-boss, one screen offers:

- **A free boost:** choose 1 of 2. It lasts until the end of the world (level 10).
- **The trader:** 2 boosts and 1 charm for sale at normal shop prices, never the same items as the free picks. There are no rerolls or holds; those stay special to the boss shop.

The trader was added because, in simulated runs, only about a third of good-bot runs reach the stage-10 boss, so most players never saw the shop. By stage 5 a run has roughly 800–1,000 coins, enough for one boost or a cheap charm: a taste of the shop, not a power spike.

The offers are drawn once per serpent and saved with the run, so closing the app can't re-roll them.

In `npm run expedition` (64 runs, greedy policy), runs that beat a serpent bought about 2 items from the trader. Survival stayed level within noise: an average of 10.8 stages cleared against 11.5 before, and 22% reaching world 3 against 19%. Spending moves earlier rather than runs getting stronger.

---

## Unlocks: always something new

At the start, only some items can show up. Achievements add more, so the shop keeps surprising you. This is how The Binding of Isaac keeps runs fresh. A **collection screen** shows locked items as silhouettes with their unlock hint.

**Available from the start:**
- **Charms:** Shockwave, Bomber, Quick Draw, Rainbow, Colour Scout, Deep Freeze, Hungry Scorpion.
- **Boosts:** Slowpoke, Power Surge, Pocket Bomb, Long Fuse.

**Unlocked by playing:**

| Do this | Unlocks |
|---|---|
| Beat your first serpent | 🐍 Snake Charmer (boost) |
| Beat your first boss | 🔨 Boss Breaker (boost) |
| Reach world 3 | ❤️ Extra Life (boost) |
| Pop 50 marbles of one colour in one level | 🍀 Lucky Colour (charm) |
| Make a combo chain of 4 pops | 👑 Combo King (charm) |
| Win a level with the chain past 90% of the track | 🔥 Daredevil (charm) |
| Choke a serpent 6 times in one fight | 🌩️ Lightning Rod (charm) |
| Shoot 10 floating coins | 🪙 Scavenger (charm) |
| Trigger 8 power-ups in one level | ⏪ Rewinder (charm) |
| Use 3 Wild power-ups in one level | 🃏 Double Wild (charm) |
| Beat the ace time on 5 levels in one run | ⏱️ Ace Hunter (boost) |
| Win a level without any chain passing halfway | 🏁 Head Start (boost) |
| Trigger every type of power-up (across runs) | 🎁 Opener (boost) |
| Crack 5 armored marbles in one level | 🌬️ Second Wind (boost) |
| Bank 2,000 coins in one run | 💰 Coin Rush (boost) |
| Reach world 3 without buying a boost (free picks are fine) | ✂️ Colour Cut (boost) |

---

## Tricky cases

- **When does a boost run out?** When you beat the boss of the world you bought it for. Buy it after boss 10, and it covers levels 11–20, including boss 20.
- **Two chains and Extra Life?** If either chain reaches its skull, both are pushed back. It works once per world.
- **Slots full and a free pick offered?** Swap it in for one of yours, or skip it. Same for charms after a boss and boosts after a mini-boss. A swapped-out boost gives no refund.
- **Closed the app on a pick or the shop?** It shows again when you continue the run.
- **Do coins carry over?** Yes, unspent coins stay with you for the next shop.
- **What resets when I lose?** In Expedition, your coins, charms and boosts all reset. Unlocks are kept forever.

---

## Where it's used

- **Expedition** (endless mode as a roguelite run): built first. Everything resets when you lose, except unlocks.
- **Campaign:** later. Charms are kept for good. Coins only pay out the first time you clear a level or when you beat your best, so replaying old levels can't be used to farm coins.

---

## Build status

| Step | Status |
|---|---|
| **1. Coins** | ✅ Coin ledger in the simulation, HUD counter, coins in the stage-clear banner |
| **2. Shop** | ✅ Free charm pick and shop after each boss, 3 + 3 slots, reroll, buying, selling and replacing, boosts running out |
| **3. Full item list** | ✅ All 7 boosts and 14 charms, the mini-boss pick, Reserve |
| **4. Unlocks** | ✅ Achievement tracking, unlock toasts, the collection screen |
| **5. Campaign** | Not started |

Every item's effect lives in the game simulation and stays deterministic. Shop offers come from the run's seed. The headless simulator (`npm run expedition`) plays whole runs with the real shop, and `tests/economy.test.ts` checks every item, coin source, shop rule and unlock.

**What the simulator says (140 runs, good bot, every item unlocked):**
- Shopping roughly doubles how far runs get: average stages cleared go from 8.6 with no shopping to 14.0 with the greedy shopper, and runs reaching world 3 go from 7% to 34%.
- Extra Life is the strongest item. The coin-only charms don't help survival directly; they pay off by buying more boosts.
- Even with no items, about 10% of runs end on stage 1 or 2: each early stage is lost about 5–8% of the time.

---

## Ideas for later

- 🗡️ **Gap Piercer (charm):** a shot that goes through a gap keeps going and can hit a marble behind it, or the boss.
- A 4th charm slot as a rare boss reward.
- Super power-ups charged by a combo meter (see [power-ups](powerups.md)).

## Still to decide

1. Is the mini-boss pick too generous on top of the free boss charm? Check after playtesting.
2. Should the first stages of a run be gentler, so fewer runs end before the first shop?
3. The bot can't judge Colour Scout, Pocket Bomb or Snake Charmer well, so their numbers in the simulator undersell them. Playtesting decides those.
