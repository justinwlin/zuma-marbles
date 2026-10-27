# Game loop and economy

Status: design draft. Nothing here is built yet. Numbers are starting points to tune with the bot (`scripts/balance.ts`).

This doc proposes an economy for the game: **pop marbles → earn coins → spend them in a shop → play differently → pop more**. It covers what it looks like, how it fits the campaign and endless mode, and the game design thinking behind it.

Related docs: [power-ups](powerups.md), [music](music.md), [development](development.md).

## 1. Goals

1. **Progress you can feel.** Players should leave each session with something more than a score.
2. **Interesting decisions.** Every shop visit and every emergency buy should be a real choice, not an obvious one.
3. **Skill pays.** Coins should measure how well you played, not how long you played.
4. **Variety.** What you buy should change how you play, so runs and worlds feel different.
5. **No grind, no dark patterns.** No real money, no loot boxes, no timers that punish you for not logging in.

## 2. The loops

Good games nest loops at several timescales. Each loop feeds the next one.

```
 seconds   ┌───────────── MOMENT ─────────────┐
           │ aim → shoot → match → POP → coins │
           └───────────────┬──────────────────┘
 minutes   ┌───────────── LEVEL ──────────────┐
           │ survive the chain, fill the bar,  │
           │ chase combos / gap shots / danger │
           │ for coins; maybe an emergency buy │
           │ → payout: ace + sweep + interest  │
           └───────────────┬──────────────────┘
 ~20 min   ┌───────────── WORLD (10 levels) ──┐
           │ new theme + one new mechanic      │
           │ mini-boss at 5 → TRADER (small)   │
           │ boss at 10    → WORLD SHOP (big)  │
           └───────────────┬──────────────────┘
 sessions  ┌───────────── META ───────────────┐
           │ unlocks: new charms, items and    │
           │ power-ups enter the pool (Isaac)  │
           └──────────────────────────────────┘
```

The world loop is the new piece. It pairs with the planned worlds idea: every 10 levels you get a new theme and music, one new mechanic, a boss, and then a shop.

## 3. Earning coins

Today's floating "bonus coins" are worth 300 score. In this design, coins become the currency. Floating coins stay, but they pay currency instead of score.

Coins should reward skill and risk. Flat pay per marble turns into grinding.

| Source | Coins | Why |
|---|---|---|
| Each popped marble | 1 | The baseline. Every pop feels like income |
| Combo step | ×2 per step (a 3-step combo pays ×8) | Rewards planning chains |
| Gap shot | +3 | Rewards precise aim |
| Pop while the chain is in the danger zone (head past 72% of the track) | +5 | Risk pays. Letting it get close is a choice |
| Gold marble popped (a bag item, see section 4c) | +10 | An investment paying off |
| Floating coin shot | +25 | Same skill shot as today |
| Ace time | +50 | Speed pays |
| Light sweep | +1 per 2% of track never reached | Clean play pays |
| Interest at level end | +1 per 10 held, max +10 | Saving competes with spending |

Estimated income is about 150–300 coins per level, or 2,000–3,000 per world. This has to be measured with the bot before setting prices.

**Feel:** each pop throws small coins toward the counter, and each coin landing plays a soft chime. Pops already lock to the music's beat, so coins should too. A big combo then plays a rising arpeggio of coin chimes, and players will chase that sound.

## 4. Spending coins

There are three places to spend, at three timescales.

### 4a. In the level: emergency buys

A small radial or bar menu, opened by holding the frog or pressing a key. The game keeps running, because pausing to shop would remove the tension.

| Buy | Cost | Effect |
|---|---|---|
| Slow | 40 | Instant Slow (as the power-up) |
| Reroll | 15 | Swap your loaded marble for a random new colour |
| Push back | 80 | Instant Reverse |

Prices double each time you buy the same thing in one level. These buys are the "survive now or save for the shop" decision, the same tension Balatro gets from spending discards.

### 4b. The trader (after the mini-boss, level 5)

A small shop with 2 offers and no rerolls. It gives the middle of a world a decision point, so coins don't just pile up for 10 levels.

### 4c. The world shop (after the boss, level 10)

The main event. It has four kinds of offers.

| Offer type | Example | Price |
|---|---|---|
| **Charms**: passive rule-benders, 5 slots | "Gap shots pay ×2 coins", "Combos of 3+ trigger twice", "Red pops give +1 combo step" | 300–900 |
| **Items**: one-shot, 2 slots, used mid-level | Bomb, Freeze, "next 5 shots are Wild" | 100–250 |
| **Bag changes**: alter the chain's colour mix | Remove a colour, add Gold marbles, add Armored marbles | 400–1,000 |
| **Upgrades**: permanent for the rest of the world or run | +1 charm slot, power-ups last 25% longer, interest cap +5 | 1,000+ |

Shop rules:

- **3 charm slots, 2 item slots and 1 bag or upgrade slot** on display.
- **Reroll** the offers for 50, rising by 25 each time this visit (explore or exploit, see section 8).
- **Sell** a charm for half its price, so you can change builds.
- **Preview** the next world's boss rule and new mechanic, so you buy to prepare for them.

### Shop mockup (desktop)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  WORLD 2 CLEAR · Ice Cavern next                         🪙 1,240 coins  │
│  Next boss rule: "Blue marbles are frozen"   New: armored marbles        │
├──────────────────────────────────────────────────────────────────────────┤
│  CHARMS                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                    │
│  │  🎯 Sniper   │  │  🔥 Hothead  │  │  🌈 Prism    │                    │
│  │ Gap shots    │  │ Danger-zone  │  │ Every 8th    │                    │
│  │ pay ×2 coins │  │ pops +2 combo│  │ shot is Wild │                    │
│  │    🪙 450    │  │    🪙 600    │  │    🪙 750    │                    │
│  └──────────────┘  └──────────────┘  └──────────────┘                    │
│  ITEMS                         BAG / UPGRADE                             │
│  ┌──────────┐ ┌──────────┐     ┌──────────────────┐                      │
│  │ ❄ Freeze │ │ 💣 Bomb  │     │ ✂ Remove a colour │                     │
│  │  🪙 150  │ │  🪙 120  │     │      🪙 800       │                     │
│  └──────────┘ └──────────┘     └──────────────────┘                      │
├──────────────────────────────────────────────────────────────────────────┤
│  YOUR CHARMS [🎯][ ][ ][ ][ ]    ITEMS [💣][ ]    Interest next: +10     │
│  [ Reroll 🪙50 ]                                     [ Continue ▶ ]      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Shop mockup (phone, portrait)

```
┌─────────────────────────┐
│ WORLD 2 CLEAR  🪙 1,240 │
│ Next: Ice Cavern        │
│ Boss: blue = frozen     │
├─────────────────────────┤
│ ◀  ┌───────────────┐  ▶ │   swipe between offers
│    │   🎯 Sniper   │    │
│    │ Gap shots pay │    │
│    │   ×2 coins    │    │
│    │   [ 🪙 450 ]  │    │
│    └───────────────┘    │
│        ● ○ ○ ○ ○ ○      │
├─────────────────────────┤
│ [🎯][ ][ ][ ][ ]  [💣][ ]│
│ [Reroll 50] [Continue ▶]│
└─────────────────────────┘
```

### In-level HUD additions

```
┌─────────────────────────────────────────────────────────────┐
│ ⏸ ⚙ ?  Level 13        [████████░░ ZUMA]        🪙 312  4,210 │
│                          ACE 0:42                           │
│                   [SLOW 6]      charms: 🎯 🔥 🌈             │
```

The coin counter sits beside the score and bumps when coins land. Equipped charms show as small icons that flash when they trigger, so players learn what their build is doing. That visible cause and effect is a big part of why Balatro's jokers feel good.

### Level-end payout

```
┌──────────────────────────────┐
│        LEVEL CLEAR!          │
│  Pops          148  → 🪙 148 │
│  Combos         ×3  → 🪙  64 │
│  Gap shots       5  → 🪙  15 │
│  Ace time 1:12  ✓   → 🪙  50 │
│  Track bonus   38%  → 🪙  19 │
│  Interest (312)     → 🪙  10 │
│  ─────────────────────────── │
│  Total             🪙 +306   │
└──────────────────────────────┘
```

Rows count up one at a time with a tick sound, ending on a bigger chime for the total. That's the same staged reveal Balatro uses when scoring a hand.

## 5. What you keep: three tiers

The shop sells two kinds of things: **temporary boosts** that are strong but wiped when a world ends, and **charms** that you keep. On top of that, every boss and challenge **unlocks** something new forever, the way The Binding of Isaac does. Even after a wipe, you always have something new to look forward to.

| Tier | Lasts | Strength | Examples | Where it comes from |
|---|---|---|---|---|
| **Temporary** | Until the world's boss is beaten, then wiped | Strong | Items (Bomb, Freeze), "+50% coins this world", "chain 15% slower this world", extra lives | World shop, trader |
| **Charms** | Across worlds (the whole Expedition, or permanently equipped in the campaign) | Medium, slot-limited (5) | "Gap shots ×2 coins", "Combos of 3+ trigger twice" | World shop (pricier than temporary boosts), boss rewards |
| **Unlocks** | Forever, across all runs | Adds **options**, not raw power | New charms, items, power-ups and marble types enter the pool | Beating bosses, challenges, milestones |

### The wipe and the boss reward

When a world ends, temporary boosts vanish. The boss then offers **a choice of 1 of 3 charms**, which is the bridge between worlds. Losing your temporary boosts hurts a little, but you always walk into the next world with something new. That's the same rhythm as Hades' boss rewards.

### Unlocks, Isaac-style

Isaac's lasting progress is mostly **variety**. Beating bosses and finishing challenges adds new items to the pool, so later runs contain things early runs never had. Most unlocks are interesting rather than strictly stronger. Some are just strong, as a reward.

Unlock triggers for us:

| Trigger | Unlocks (example) |
|---|---|
| Beat the serpent for the first time | Charm "Snake charmer": choking the serpent drops +2 power-ups |
| Beat the idol for the first time | Power-up "Rockfall": drops a rock that crushes 5 marbles |
| Clear a world without using an emergency buy | Charm "Thrifty": +5 interest cap |
| Choke the serpent 3 times in one fight | Item "Gulp": the next serpent rear-up lasts twice as long |
| Win a level with the chain past 90% | Charm "Daredevil": danger-zone pops +2 combo |
| 50 gap shots total | Charm "Sniper" |
| Reach world 3 in an Expedition | Marble type "Gold marbles" in the shop |
| Beat world 5 | A new character with its own starting charm |

Show unlock progress on a **collection screen**: locked silhouettes with their unlock hint, like Isaac's item collection. Seeing what's left is a goal in itself.

### Getting stronger as the worlds get harder

To answer "a power-up in exchange as the world gets harder", there are two options that don't break balance:

1. **Boss rewards scale with the world.** The world 1 boss offers common charms. The world 4 boss offers rare ones, and possibly a super power-up (see [power-ups](powerups.md)). The player's power climbs alongside the difficulty, which keeps play in flow.
2. **"Pact" trade-offs.** After each boss you may also take one pact, which is a strong permanent boon with a cost. For example "+1 charm slot, but chains are 10% faster" or "power-ups never expire, but score targets are 20% higher". Harder worlds offer bigger pacts. This is Hades' Heat system and Isaac's devil deals: power you choose to pay for.

## 6. Builds: why spending has a direction

Random upgrades feel flat. Upgrades that combo give each run an identity. The shop should offer charms from a few build types, so players start to commit to one:

| Build | Core charms | Plays like |
|---|---|---|
| **Colour** | "Red pops +1 combo step", bag change "Remove a colour" | Narrow the colours, make every match bigger |
| **Combo** | "Combos of 3+ trigger twice", "Combo steps carry over between shots" | Set up chains, slow and deliberate |
| **Sniper** | "Gap shots ×2 coins", "Shots through gaps pierce one marble" | Precision through the chain |
| **Daredevil** | "Danger-zone pops +2 combo", "Second wind: survive one skull hit" | Let the chain come close on purpose |
| **Power** | "Power marbles never expire", "Power-ups also pay 20 coins" | Hunt power marbles |
| **Investor** | Bag change "Add Gold marbles", "Interest cap +10" | Get rich early, buy everything late |

Each build should be strong but beatable. Boss rules (for example "red marbles won't pop") should sometimes counter a build, so players keep some flexibility.

## 7. Campaign vs. Expedition

The campaign has persistent, replayable levels. A roguelite run economy needs to be able to fail. The two need different rules.

### Campaign (persistent)

- Coins persist. The world shop opens after each boss and can be revisited from the level-select screen.
- **No grinding:** a level pays coins only for **improvement**: the first clear, a new best score, a first ace or a new star. Replaying a level you've already mastered pays nothing.
- Purchases are mostly **choices, not raw power**: charms are permanently unlocked, but only a few can be equipped (a loadout).
- Campaign difficulty, ace times and boss tuning stay valid, because equip slots cap the extra power.

### Expedition (roguelite, built on endless mode)

- Endless mode already has one life and a score that carries over. It becomes the roguelite run.
- Coins, charms, items and bag changes last **for the run only** and are lost on death.
- There's a trader every 5 stages and a world shop every 10. Boss stages roll a boss rule, which the twist system already supports.
- **Seeded:** the whole run, including shop offers, comes from the run seed, because the game logic is deterministic. A daily Expedition gives everyone the same shops, and seeds can be shared.
- Meta progress: finishing milestones unlocks new charms into the pool and harder difficulty tiers.

## 8. Inspiration

### How other games do it

| Game | What they do | What we take |
|---|---|---|
| **Balatro** | Antes of 3 blinds with a boss rule. Shop between blinds: jokers (5 slots), consumables, vouchers. Interest of 1 per 5 money held, capped. Reroll costs rise. Sell jokers for half | Shop structure, interest, rising rerolls, selling, boss rules, staged score reveal |
| **Slay the Spire** | A branching map with shops, elites and rest sites. Removing cards from your deck is a premium purchase. Relics are run-long passives | "Remove a colour" as a premium bag change; charms as relics |
| **Hades** | Several currencies for different purposes. Permanent upgrades in the Mirror can be swapped freely. God boons combo with each other. Boss rooms give a reward choice. The Heat system lets you opt into harder rules | Loadout-style permanent upgrades, charms that combo, boss reward choices, pacts |
| **Dead Cells** | Cells are only banked between biomes and are lost on death | Banking risk, and a shop between worlds |
| **Rogue Legacy** | Gold buys permanent castle upgrades, but you must spend it all before the next run | "Spend it or lose it" in an Expedition |
| **Vampire Survivors** | In-run gold buys permanent stat upgrades, and the upgrades can be refunded | Cheap permanent nudges, refundable so they're never a trap |
| **Peglin** | A roguelite about shooting balls: relics and orbs change how each shot scores | Proof that charms work for a shooting game |
| **The Binding of Isaac** | Every run starts from scratch, but beating bosses and challenges unlocks new items into the pools. A collection screen shows what's left. Devil deals trade health for power | Unlocks add variety, not raw power. The collection screen, and pacts |
| **Zuma's Revenge** | 6 worlds of 10 levels, each ending in a boss | The world rhythm |
| **Luxor** | 21 power-ups plus 3 super power-ups; Survival and Blast modes | A bigger power-up pool to feed the shop |

### Game design and game theory ideas we use

| Idea | Source | How it shows up here |
|---|---|---|
| "A game is a series of interesting decisions" | Sid Meier | Every shop visit offers more good options than you can afford |
| **Opportunity cost** | Economics | Prices sit above income. Buying the charm means skipping the upgrade |
| **Explore vs. exploit** (the multi-armed bandit problem) | Decision theory | Reroll the shop to explore, or take a decent offer now. Rising reroll costs make exploring cost more over time |
| **Expected value and risk** | Game theory | Danger-zone pops pay more but risk the run. Players weigh reward against the chance of losing |
| **Loss aversion** (prospect theory) | Kahneman & Tversky | Losses feel about twice as bad as equal gains. Banking coins and "second wind" lean on that, so use it gently |
| **Positive and negative feedback loops** | *Game Mechanics: Advanced Game Design* (Adams & Dormans) | Coins → charms → more coins is a positive loop that snowballs. Rising targets, rising prices and boss rules counter it |
| **Sources, sinks and converters** (Machinations diagrams) | Adams & Dormans | Sources: pops, aces, interest. Sinks: emergency buys, shop, rerolls. Converters: Gold marbles turn pops into coins. Balance means sinks keep up with sources |
| **Flow** | Csikszentmihalyi | Difficulty rises with player power. The sawtooth curve plus shop power keeps play between boredom and frustration |
| **Meaningful play** | *Rules of Play* (Salen & Zimmerman) | Every action has a visible result. Charms flash when they trigger and the payout shows where coins came from |
| **Intrinsic vs. extrinsic rewards** | Self-determination theory | Coins (extrinsic) should feed mastery (intrinsic). Pay for skill, not time spent |

## 9. Guardrails

- **No real money** and no premium currency. Coins are earned only by playing.
- **No random paid rewards.** Shop offers are visible before you buy. There are no loot boxes.
- **No punishing timers.** The daily Expedition is a bonus, not a streak you lose by missing a day.
- **No grinding.** Campaign coins only pay for improvement (section 7).
- **Readable on phones.** If a number isn't needed to decide, hide it. Big icons, short one-line descriptions.

## 10. Open questions

1. Campaign economy, Expedition economy, or both? (Recommendation: start with Expedition, where a run economy is self-contained and can't break campaign tuning.)
2. Should emergency buys exist in the campaign, or only in Expedition?
3. Does score stay as it is, or move to Balatro-style chips × mult? Chips × mult multiplies better with charms, but every target needs retuning.
4. How many charms for launch? (Suggestion: 15–20 across 4 builds.)
5. How does the bot shop? It needs a simple buying policy before balance numbers mean anything.

## 11. Build plan

Each phase is playable on its own.

1. **Coins as currency.** Pops, combos, gap shots and danger pay coins. Coin counter in the HUD, coin chimes on the beat, payout screen. Measure income with the bot.
2. **World shop in Expedition.** A shop every 10 stages with about 10 charms across 3 builds, item slots, rerolls and selling. Charm icons in the HUD flash when they trigger.
3. **Interest, trader and emergency buys.** Interest at level end, a trader every 5 stages, the in-level buy menu.
4. **Tiers and boss rewards.** Temporary boosts that wipe at the world's end, a charm choice from each boss, scaled by world.
5. **Unlocks and collection.** Isaac-style unlock triggers that add charms, items and power-ups to the pool, a collection screen, pacts.
6. **Bag changes and boss rules.** Remove a colour, Gold and Armored marbles, boss rules previewed in the shop.
7. **Campaign.** The campaign world shop with improvement-only income and loadouts, difficulty tiers.
