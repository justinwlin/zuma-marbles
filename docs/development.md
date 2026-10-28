# Development guide

This guide covers how to run the game locally, how the code is organized, how to test changes (unit tests, browser end-to-end checks, screenshots, bot balance runs), and how to ship to the live site.

For what the game does, see the [README](../README.md). For research and design notes, see [`zuma-marble-game.md`](../zuma-marble-game.md).

## Quick start

You need Node 22 or newer (CI uses 22) and npm.

```bash
npm install
npx playwright install chromium   # one time; only needed for e2e and screenshot scripts
npm run dev                       # http://localhost:5173, hot reload
```

Before you push, run the same checks CI runs, plus the browser suite:

```bash
npm test                    # unit tests (about 2 s)
npm run build               # type-check + production build into dist/
npm run preview &           # serve dist/ on :5173
npm run e2e                 # browser checks on 7 device profiles (about 5 min)
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on `0.0.0.0:5173` with hot reload. The service worker is off in dev. |
| `npm run build` | `tsc --noEmit` (it type-checks `src/`, `tests/` and `scripts/`), then `vite build` into `dist/` with the PWA service worker. |
| `npm run preview` | Serves `dist/` on `0.0.0.0:5173`. Use it to test the PWA, offline mode and the exact production bundle. |
| `npm test` | Vitest: all of `tests/*.test.ts`. |
| `npm run typecheck` | Type-check only. |
| `npm run e2e` | Browser end-to-end checks against `http://localhost:5173/`. A server must already be running. Prefer `npm run preview`: the dev server can reload the page mid-test after source changes. Pass another URL as an argument (`npm run e2e -- http://localhost:5174/`). |
| `npm run pwa-check` | Verifies the build is installable and works offline (run `npm run build` first). |
| `npm run sim -- <seed> <levels> [preset…]` | Bot playthroughs per level: outcome, time, peak danger, combos. |
| `npm run balance -- <campaigns> <levels…>` | Win-rate and average-time table per bot skill. |
| `npm run expedition -- [runs] [bot] [policies] [maxStages]` | Simulated Expedition runs across all CPU cores: stages cleared, coins per world, items bought, item impact. `UNLOCK_ALL=1` starts with every item unlocked. See [economy-architecture.md](economy-architecture.md). |
| `npx tsx scripts/layout-audit.ts [baseUrl] [--only=…]` | Opens every menu screen on every device profile, fails if one spills sideways or overflows a screen that should fit (title, endless, pause, results, picks, shop, collection), and saves screenshots to `e2e-out/layout/`. Needs a running server. |
| `npm run icons` | Re-renders `public/icons/icon.svg` into the PNG icon sizes. |

Scripts that `npm run` doesn't wrap run with `npx tsx scripts/<name>.ts`; see [Visual checks](#visual-checks-screenshots) and [Balance](#balance-bot-runs).

## Project layout

```
src/sim/        Pure, deterministic simulation. No DOM, no wall-clock, no Math.random.
  rng.ts          mulberry32 PRNG + string hash
  track.ts        arc-length track lookup, bridges/tunnels (hidden ranges)
  levelgen.ts     level generator: shape families, validation, difficulty, bosses,
                  rail boss fights, ace time, GEN_VERSION
  game.ts         step(state, level, commands) → events at 120 Hz; chains, shots,
                  power-ups, coins, scorpions, rail + boss, end-of-level bonuses
  aim.ts          aim assist (slot lock + hysteresis)
  bot.ts          scripted player used by tests, balance runs and the title screen
src/game/       Presentation (browser only)
  render.ts       Canvas 2D renderer
  ui.ts           DOM screens + HUD
  feel.ts         pure event → feedback map (hit-stop, shake, haptics, sound, particles)
  audio.ts        procedural Web Audio sound effects + music
  layout.ts       world → screen transform (the board is rotated 90° on portrait screens)
  save.ts         localStorage save, settings, level codes, generator migration
  fx.ts, haptics.ts, characters.ts
src/main.ts     Game loop, input (mouse, touch modes, rail, trackpad), events → feel,
                autosave, and the window.__zuma test hook
tests/          Vitest unit tests (helpers.ts has frozen-chain helpers)
scripts/        Playwright and Node tools: e2e, screenshots, balance, generator reports
e2e-out/        Screenshots from the tools (git-ignored)
```

### The one rule: keep `src/sim` deterministic

A level is fully defined by `(campaignSeed, levelIndex)`, and a game is fully defined by its level plus the recorded `[tick, command]` inputs. Replays, save/continue and shared level codes all depend on that, so inside `src/sim`:

- **Use only `+ - * / sqrt`** in `step()`. Other math functions (`sin`, `cos`, `pow`, `atan2`, `hypot`) can differ by a bit between JS engines. Generators may use them, but they quantize points to 1/16 px (`q()` / `withEntry()`).
- **Draw all randomness from the RNG streams stored in state**: `rngChain`, `rngGun` and `rngBonus`. Never use `Math.random()` or `Date`.
- **Keep all state as plain JSON in `GameState`**, so snapshots are just `JSON.stringify`.
- **Send all input through `Command`s** (`fire`, `swap`, `move`). The renderer and UI only read state.

The tests check this: replays, snapshot/restore mid-level, and a golden hash of generated levels.

### Changing the level generator

Changing anything that alters generated levels (track shapes, difficulty numbers, which levels are bosses, and so on) changes every campaign. When you do it on purpose:

1. Bump `GEN_VERSION` in `src/sim/levelgen.ts`. On the next load, existing saves keep their unlocked levels and stars, drop mid-level snapshots and endless runs, and show a one-time "Levels got an update" toast. Update that toast text in `src/main.ts`.
2. Update the golden hash in `tests/sim.test.ts` (`generator stability (golden)`). The failing test prints the new value.
3. Re-check balance with `npm run balance` (below).

Changes to the sim that don't touch the generator (new mechanics, tuning in `TUNING`) don't need a version bump, but they still change replays. The tests re-record their own inputs, so they keep passing.

## Testing

### Unit tests (`npm test`)

| File | Covers |
|---|---|
| `tests/sim.test.ts` | Generator validity, difficulty shape, two chains, bridges, matching, gaps/magnet/combos, power-ups, win/lose, determinism (replay, save/load), aim-preview honesty, golden level hash |
| `tests/features.test.ts` | Wild and Scorpion, bonus coins, track/ace bonuses, rail boss fights (slide, fire, damage, rocks/stun, defeat cascade, bot can win, exact replays), power-up spawn mix |
| `tests/aim.test.ts` | Aim assist: capped correction, assisted shots land in the previewed slot, wobble tolerance |
| `tests/feel.test.ts` | Game feel: every event has feedback, escalation and caps, reduce-motion, shake decay, hit-stop budget over a level |
| `tests/variety.test.ts` | New power-ups (Colour Cloud, Black Hole, Magnet), special marbles (armored, chameleon, gem), and the schedule that introduces them |
| `tests/economy.test.ts` | Expedition economy: coin ledger, every charm and boost, shop rules (slots, prices, rerolls, reserve, boost expiry), unlocks, reproducible simulated runs |
| `tests/save.test.ts` | Save round-trip, corrupted storage, level codes, stars, per-campaign progress, generator-version migration, daily seed |

To run one file or one test:

```bash
npx vitest run tests/features.test.ts
npx vitest run -t "boss fights"
npx vitest            # watch mode
```

For sim tests, `tests/helpers.ts` has `frozenGame(colors)`, which builds a stopped chain near the inner end of a track, plus `aimAt`, `run` and `untilHit`. Use them to set up exact situations without waiting for real play.

### End-to-end checks (`npm run e2e`)

`scripts/e2e.ts` drives real Chromium (through Playwright) with real mouse and touch input against a running server. It runs each of these profiles: `phone`, `smallPhone`, `phoneLandscape`, `tablet`, `desktop`, `laptop`, and `iphoneNotch` (safe-area insets applied after load).

On each profile it checks:
- **Layout:** orientation detection, the board fits and is well used, and the HUD doesn't cover the board.
- **Aiming and firing:** aim guide, cancel gestures, the aim modes (including Trackpad), and hold-to-shoot.
- **A scripted match:** it pops with feedback.
- **Menus and settings:** the power-ups sheet, settings and accessibility options, pause → continue.
- **Campaigns and progression:** large-marble campaigns, unlock/skip, endless runs, two-chain levels.
- **Boss fights:** the HUD shows boss health. On touch, a drag or tap only moves the frog (no shot, no cancel pill) and the Fire button shoots; with a mouse, the frog follows and a click fires.
- **Health:** frame rate and console errors.

```bash
npm run build && npm run preview &        # or: npm run dev &
npm run e2e                               # all profiles, against http://localhost:5173/
npm run e2e -- --only=phone,desktop       # a subset (faster while iterating)
npm run e2e -- http://localhost:4173/     # a different server
E2E_SEED=my-seed npm run e2e              # a different fixed campaign
```

- The script prints ✓ or ✗ per check and exits non-zero if any check fails. Screenshots of each step go to `e2e-out/<profile>-NN-*.png`.
- A full run takes about 5 minutes. On a pod, start it in the background and wait for it to finish; piping it through `grep` hides the output until the end.
- To find Chromium, `scripts/browser.ts` uses the newest Playwright Chromium in `~/.cache/ms-playwright`. Set `CHROME_PATH=/path/to/chrome` to override.
- The game exposes a test hook, `window.__zuma`, defined at the bottom of `src/main.ts`. It offers:
  - state, layout and view;
  - `load(seed, index)` to jump to any level, and `setup(colors, opts)` to drop in a frozen scripted chain;
  - `ballScreen(i, chain)` and `worldToScreen(x, y)` to aim real input at a marble;
  - `fireAt`, `swap` and `pause`;
  - the event and feel logs.

  Prefer these over pixel-guessing. When you add a feature, add an e2e check that drives it with real input.

### Visual checks (screenshots)

The e2e suite checks behaviour, not looks. After a visual change, take screenshots and look at them, on both a phone and a desktop:

| Script | Output |
|---|---|
| `npx tsx scripts/ui-shots.ts` | Every menu screen (title, levels, endless, settings, help, play, pause, result) → `e2e-out/ui-<profile>-<screen>.png` |
| `npx tsx scripts/feature-shots.ts` | Boss fight (banner, fight, angry, defeat, result), coin + wild + scorpion, end-of-level sweep and result, trackpad crosshair → `e2e-out/feat-<profile>-*.png` |
| `npx tsx scripts/showcase.ts phone\|desktop` | Frame sequences of combo, bomb, danger, win → `e2e-out/showcase/` |
| `npx tsx scripts/characters-shot.ts` | Every launcher character through the real Settings UI |
| `npx tsx scripts/gen-sheet.ts out.png [family,…] [xl]` | Contact sheet of generated tracks (green = valid, red = rejected) |
| `npx tsx scripts/montage.ts out.png <cols> <width> files…` | Combine screenshots into one image |
| `npx tsx scripts/perf.ts [url] [throttle]` | Frame times under CPU throttling (mid-range phone) |

All of these need a server on `:5173`, except `gen-sheet` and `montage`. Pass a URL as an argument to point them elsewhere.

### Balance (bot runs)

`src/sim/bot.ts` plays through the same `Command` interface as a person. It has three presets (`casual`, `good`, `expert`) that differ in aim noise and reaction time. It handles rail boss fights too: it picks a rail spot, shoots straight across, and dodges rocks.

```bash
npm run balance -- 10 9 19 29 39                  # 10 campaigns × boss levels 10/20/30/40
BOTS=casual,good npm run balance -- 10 8 14 18    # only some presets
PREFIX=xl- npm run balance -- 10 4 9              # large-marble campaigns
npm run sim -- alpha 12 good                      # per-level detail for one campaign
npx tsx scripts/gen-report.ts [prefix] [count]    # family / twin / boss / twist mix, lengths
```

The current targets come from the balance runs in `levelgen.ts` and its comments:
- normal levels: about 40–90% wins for the `good` bot;
- boss fights: around the same, with the first boss easier because it's a new mechanic;
- ace time: a bit under half of the `good` bot's wins beat it.

Use 10 or more campaigns per level: with fewer, the noise is ±15%.

## Workflow

1. **Branch** from an up-to-date `main`:

   ```bash
   git checkout main && git pull && git checkout -b justin/<short-description>
   ```

2. **Build the feature.** Sim changes go in `src/sim` (with unit tests). Visuals go in `render.ts`, input and wiring in `main.ts`, and menus in `ui.ts`.
3. **Validate**:
   - `npm test`
   - `npm run build`, then `npm run preview &`
   - `npm run e2e`
   - the relevant screenshot script, and look at the images
   - `npm run balance` if you changed difficulty or the generator
4. **Document.** Update the feature list in `README.md` and the status section of `zuma-marble-game.md`. Update this guide if the workflow or tools changed.
5. **Commit** with a message that says what changed for the player.
6. **Ship.** Fast-forward `main` to the branch and push:

   ```bash
   git fetch && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
   ```

   If the `merge-base` check fails, `main` has moved: rebase onto `origin/main` first.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`, which does `npm ci`, `npm test` and `npm run build`, then publishes `dist/` to the `gh-pages` branch. The site is **https://justinwlin.github.io/zuma-marbles/**.

- If `npm test` fails in CI, nothing is published.
- GitHub's Pages step sometimes queues for about 10 minutes. To confirm a deploy is live, check that the bundle hash in the live `index.html` matches the one in your local `dist/index.html`:

  ```bash
  curl -s https://justinwlin.github.io/zuma-marbles/ | grep -o 'assets/index-[^"]*\.js'
  grep -o 'assets/index-[^"]*\.js' dist/index.html
  ```

- The PWA updates itself (`registerType: 'autoUpdate'`). Installed copies pick up the new version on their next launch.

## Working on a Runpod pod

- The dev and preview servers bind `0.0.0.0:5173`, so on a Runpod pod the game is reachable at `https://$RUNPOD_POD_ID-5173.proxy.runpod.net`. That's handy for trying it on a real phone. Rebuild before checking preview: it serves `dist/`, not the source.
- Pod disks are wiped on restart, so push anything you want to keep.
