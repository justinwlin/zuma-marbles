# Economy architecture

How coins, the shop, items and unlocks are built into the code, and how we test them. The game design is in [charms-and-boosts.md](charms-and-boosts.md).

## Principles

1. **Game rules live in `src/sim`, and stay deterministic.** Item effects, coin earning, shop offers and unlock checks are pure functions or plain-JSON state. No DOM, no `Math.random`, no wall clock. The same seed and inputs always give the same run, so replays, saves and the daily run keep working.
2. **The bot plays the real thing.** The headless simulator uses the exact same shop, item and unlock code as the game. Balance numbers then describe what players actually get.
3. **The browser layer only displays and asks.** `main.ts` and `ui.ts` show the shop and pick screens and pass the player's choices to the sim functions. They never decide outcomes.

## The pieces

```
src/sim/items.ts         Item catalogue (charms + boosts) and Mods: the numbers a loadout changes
src/sim/game.ts          Reads st.mods for item effects; keeps a coin ledger in GameState
src/sim/economy.ts       RunEco (coins, owned items, boost expiry), seeded shop offers,
                         buy / sell / reroll / reserve, free picks, end-of-level settlement
src/sim/achievements.ts  Lifetime progress counters and unlock rules, fed by game events
src/sim/expedition.ts    Headless whole-run simulator: bot plays stages, earns, shops, unlocks
scripts/expedition.ts    Runs many simulated Expeditions in parallel (worker threads) and prints a report
src/game/save.ts         Saves the run's RunEco and the player's unlocks
src/main.ts, src/game/ui.ts   HUD coin counter, payout, pick screens, shop, collection
```

### Items and Mods

Each item is a catalogue entry: id, kind (charm or boost), name, icon, one-line description, price, and whether it's unlocked at the start.

A loadout resolves to a single **`Mods`** object, the only thing the simulation reads:

```ts
interface Mods {
  speedMul: number;        // Slowpoke
  powerChanceMul: number;  // Power Surge
  powerLifeMul: number;    // Long Fuse
  bombRadiusMul: number;   // Bomber
  shotSpeedMul: number;    // Quick Draw
  wildEvery: number;       // Rainbow (0 = off)
  scout: boolean;          // Colour Scout
  pocketBomb: boolean;     // Pocket Bomb
  lives: number;           // Extra Life
  shockwave: boolean;      // Shockwave
  lightningRod: boolean;   // Lightning Rod
  coinSpawnMul: number;    // Scavenger
  serpentWindupAdd: number; chokeExtra: number;  // Snake Charmer
  bossDirectMul: number;   // Boss Breaker
  comboCoinMul: number;    // Combo King
  dangerCoinMul: number;   // Daredevil
  luckyColor: number;      // Lucky Colour (-1 = off)
}
```

`createGame(level, mods)` stores the mods in `GameState`, so a saved mid-level snapshot keeps them. With no items, `Mods` is neutral and the game plays exactly as it does today.

### Coins

`GameState.coins` is a ledger: the total plus a breakdown by source (pops, combos, floating coins, ace, clean clear, boss). The sim adds to it at the moment things happen, so the bot and the player earn identically. Automatic pops when a boss dies don't pay.

### Run economy

`RunEco` is plain JSON stored on the Expedition run:

- coins
- owned charms, each with the price paid, so selling refunds half
- owned boosts, each with the stage where it runs out
- whether this world's Extra Life is spent
- the reserved charm, and the reroll count for the current shop

Shop offers come from a hash of `(run seed, stage, reroll count)`, drawn from the player's unlocked items. That makes them deterministic, and the same for everyone on a daily run.

### Unlocks

`achievements.ts` holds lifetime counters (for example floating coins shot, serpents beaten) and per-level trackers (for example most marbles of one colour popped). A tracker is fed each step's events, the same way in the game and in the simulator. When a rule is met, the item joins the unlocked set saved in the player's save file.

## Testing

| Layer | Tool | What it checks |
|---|---|---|
| Item effects | `tests/economy.test.ts` (Vitest) | Each item changes the game the way its description says, using small frozen chains |
| Coins | Vitest | The ledger pays the right amount per source, and boss cascades pay nothing |
| Shop | Vitest | Offers are deterministic per seed. Buying, selling, rerolls, reserve, slot limits and boost expiry follow the rules |
| Unlocks | Vitest | Each rule fires on the right events and only once |
| Whole runs | `src/sim/expedition.ts` in Vitest | A simulated Expedition replays to the exact same result |
| Balance | `npm run expedition -- <runs>` | Income per world, how far runs get, how often items are bought, how much each item moves survival |

The balance report runs many Expeditions across all CPU cores, using worker threads. The sim runs about 1,100× real time (about 60 ms per level on one core), so a few hundred full runs finish in well under a minute.
