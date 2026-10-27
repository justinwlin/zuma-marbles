# Zuma Marbles

A Zuma-style marble shooter for phone (portrait) and desktop. It installs as a PWA, plays offline, and has infinite deterministic levels.

- **Play**: on desktop, move to aim, click to shoot, and right-click or Space to swap. On a phone, drag to aim, release to shoot, and tap the frog or the swap button to swap.
- **Hold to keep shooting**: hold the mouse button, or press and hold without dragging on a phone, to rapid-fire along the aim (slide to steer). You can turn it off in Settings.
- **Touch aiming**:
  - Cancel a shot by sliding onto **✕ Cancel** or back onto the frog, or by touching with a second finger.
  - **Aim assist** (`src/sim/aim.ts`, can be turned off in Settings) moves the shot by at most ±3.5° toward the middle of the slot the ghost marble shows. It sticks to the current target so the preview doesn't flicker between neighbours.
  - The shot uses the aim from 70 ms before your finger lifts, so the wobble as you lift doesn't move it.
  - With a ±0.6° finger wobble, 95% of assisted shots stay in the previewed slot, compared with 54% unassisted.
- **Colours** are picked to stay distinct: blue is a light sky blue and purple a deep violet (their ΔE went from 49 to 89, and from 3 to 31 under deuteranopia), and colour-blind symbols are available in Settings.
- **Characters**: pick the launcher (Frog, Calico Cat, Fox, Penguin) in Settings. They're drawn in code in `src/game/characters.ts`, with blinking, tail sway and ear flicks on recoil.
- **Large-marble campaigns**: switch Marbles to Large on the Levels screen. The levels are generated on a 25% smaller board with the same marble size, so when the board is scaled to fit the screen everything is 25% bigger. The campaign seed gets an `xl-` prefix, so codes like `xl-jade-1234/3` stay deterministic and shareable. Each campaign keeps its own progress. A golden test pins normal-campaign levels so they never change.
- **Aim modes** (touch): Drag & release, **Aim + tap** (drag to set the aim, tap to shoot; the tap is a real one, so iPhones vibrate on every shot), and Tap.
- **Settings mid-game**: the gear button in the HUD pauses the game and opens Settings.
- **Accessibility & comfort** (Settings → Accessibility / Aiming): **Relaxed speed** (chains at 75%), colour-blind symbols, **larger text & buttons**, reduce motion, and **left-handed** controls (swap button on the left). Menus scale up on big screens, every settings row is a tap target, Escape goes back, and losing a level shows a specific tip (offering Relaxed speed after two losses in a row).
- **Haptics**:
  - Android uses `navigator.vibrate` with full patterns.
  - iOS Safari only gives a tick when a real finger taps a switch; since iOS 26 it ignores toggles from code. So invisible switches sit under the board and inside the swap button. Taps (tap-aim shots, tapping the frog, the swap button) tick, but drag-and-release can't.
- **Power-ups** trigger when they pop as part of a match. Tap **?** in the HUD for the reference sheet:
  - Bomb: blasts nearby marbles.
  - Slow: slows the chain.
  - Reverse: rolls the chain back.
  - Lightning: strikes every marble of its colour on the board, on every track (it replaced Laser).
- **Levels** come from `(campaignSeed, levelIndex)`, so the same seed gives the same levels on any device. Level codes look like `jade-1234/12` and can be shared from the Levels screen.
  - **Shapes**: 11 single-chain families (spiral, lobes, wave, square, heart, serpentine, columns, comb, horseshoe, figure-8, tunnel spiral) and 3 two-chain families (twin spiral, twin serpentine, twin columns). Some levels move the launcher off-centre. Per-family chain speeds even out how hard each shape plays.
  - **Bridges and tunnels**: figure-8s cross themselves once, and tunnel spirals bring the chain in under the outer rings to surface beside the launcher. Marbles under a bridge are hidden and can't be hit (shots, bombs and lightning skip them).
  - **Difficulty** runs in a sawtooth: each block of 5 levels climbs to a **mini-boss** (every 5th) or **boss** (every 10th), and the next block starts lower than that peak but higher than the last. Later levels also pick shorter tracks for their shape.
  - **Two chains** show up from level 8 on (more often on bosses): two entrances, two skulls, and losing either chain loses the level.
  - **Twists** on about a third of levels from level 6: **Power surge** (3× power-ups) and **Streaky** (long same-colour runs).
  - Difficulty was tuned with `scripts/balance.ts` (bot win rates per level); `scripts/gen-report.ts` and `scripts/gen-sheet.ts` show the family mix and a contact sheet of generated tracks.
- **Endless mode** (title → Endless): stages roll straight into each other with one life, and the score carries over. Pick a **random run** or today's **daily run** (seed `daily-YYYYMMDD`, the same stages for everyone). Every stage gets a new track; most get a twist, and from stage 10 two can stack. A run in progress survives closing the app; best scores are kept.
- **Level updates**: saves record the generator version (`GEN_VERSION`). When the generator changes, unlocked levels and stars are kept and a one-time notice shows; a level you were in the middle of restarts, because its track changed.
- **Skipping levels**: on the Levels screen, tap the 🔒 card to unlock the next level (or the next 5 or 10). After losing, or from the pause menu, **Skip to level N** moves on. Skipped levels keep 0 stars and stay playable.
- **Saving**: progress, settings and a snapshot of the level you're in are saved to `localStorage`. The snapshot is written every 4 s, when you pause, and when the tab is hidden. "Continue" resumes on the exact tick you left.

Research and design notes: [`zuma-marble-game.md`](./zuma-marble-game.md).

## Play

**https://justinwlin.github.io/zuma-marbles/**: install it from the browser (Android/desktop) or via Share → Add to Home Screen (iPhone) to play full-screen and offline.

Every push to `main` runs the tests, builds, and publishes to GitHub Pages (`.github/workflows/deploy.yml`, which publishes to the `gh-pages` branch).

## Run

```bash
npm install
npm run dev          # http://localhost:5173 (binds 0.0.0.0)
npm run build        # production build + service worker in dist/
npm run preview      # serve dist/ (needed to test the PWA / offline)
```

## Architecture

```
src/sim/      pure, deterministic simulation (no DOM): unit-testable and replayable
  rng.ts        mulberry32 PRNG + string hash; state is one uint32
  track.ts      arc-length lookup table; a ball's position is distance s along the track
  levelgen.ts   infinite level generator (12 shape families, 1–2 chains) + validator + sawtooth difficulty, bosses, twists
  game.ts       fixed-tick (120 Hz) step(state, level, commands) → events; one chain per track
  bot.ts        scripted player used by tests and the balance report
src/game/     presentation
  feel.ts       pure event → feedback map (hit-stop, shake, flash, haptics, sound pitch, particles, slow-mo)
  render.ts     Canvas 2D: cached background/track, pre-rendered rolling marble sprites, aim preview
  layout.ts     world (1280×720) → screen; the board is rotated 90° on portrait phones
  fx.ts         pooled particles + screen-space floating text
  audio.ts      procedural Web Audio SFX + generative music (no audio files)
  haptics.ts    navigator.vibrate on Android, hidden switch-checkbox trick on iOS (best effort)
  ui.ts         DOM HUD and screens; save.ts persistence and level codes
src/main.ts   loop: fixed timestep + hit-stop + slow-mo, input, events → feel, autosave, test hook
```

Mechanics are ported from the Zuma Deluxe decompilation ([alula/CircleShootApp](https://github.com/alula/CircleShootApp)) and converted to per-second units:
- Roll-in that decelerates to cruise speed.
- Slow-down in the danger zone.
- Only the rear segment of the chain is pushed.
- Magnet pull across a gap that accelerates.
- Knockback on combos.
- About 0.15 s of insertion animation before the match check.
- Scoring: `100·combo + 10·n` plus chain bonus and gap bonus.
- The gun only offers colours that are still on the board.
- New chain balls repeat the previous colour 41% of the time.

### Determinism

- The step uses only `+ - * / sqrt`, which are exact in IEEE floating point. Generated control points are quantized to 1/16 px, so engine differences in `sin`/`cos` can't change a track.
- Inputs are recorded as `[tick, command]`. Replaying them from a fresh state reproduces the same state hash, and the tests check this.
- Gameplay feel (hit-stop, slow-mo) only changes when ticks run, never what a tick does.

## Testing

| Command | What it checks |
|---|---|
| `npm test` | 45 Vitest tests (summarized below) |
| `npm run e2e` | Real Chromium on 6 device profiles (summarized below). Needs `npm run dev` running. |
| `npm run pwa-check` | After `npm run build`: manifest, Chrome installability, active service worker, cold **offline** boot and play |
| `npm run sim -- <seed> <levels>` | Bot playthroughs per level: outcome, time, peak danger, combos, gap shots, power-ups |
| `npm run balance -- <campaigns> <levels…>` | Win-rate/time table per bot skill. Difficulty ramps, then plateaus for endless play. |
| `npx tsx scripts/showcase.ts phone\|desktop` | Frame sequences of combo, bomb, danger, win and menus in `e2e-out/showcase/` for visual review |

**`npm test`** covers:
- **Mechanics**: generator validity over 120 levels, arc-length uniformity, matching, insertion side, spacing, magnet pull and its acceleration, combos, scoring, power-ups, gun colours, cooldown, win and lose.
- **Determinism**: same inputs give the same state hash, and save → load → continue matches an uninterrupted run.
- **Aim-preview honesty**: the highlighted ball is the ball the shot actually hits, at least 97% of the time. With assist, at least 99% of shots land in the previewed slot.
- **Aim assist**: correction stays within ±3.5° and keeps the slot you pointed at, it tolerates finger wobble better than raw aim, and the sticky target holds across slot boundaries.
- **Game feel**:
  - Combos escalate monotonically, all effects are capped, and the bomb is the biggest moment.
  - Reduce-motion works.
  - Shake stays bounded and decays in about 0.6 s, and the aim spring is critically damped.
  - Fire feedback arrives on the next tick, and the magnet pull visibly closes a gap in 0.1–0.5 s. Roll-in pacing is checked too.
  - Over a full level, under 5% of play time is frozen by hit-stop, big shakes are rare, and pops come at a steady rhythm.

**`npm run e2e`** checks, on each profile:
- Orientation is detected, the board fits and uses the screen well, and marbles stay readable.
- The HUD doesn't cover the board.
- Real touch drag and mouse aim show the guide and predict a pop.
- Releasing on ✕ cancels the shot, a second finger cancels it, and a normal drag still fires afterwards.
- The "?" sheet pauses the game and resumes it.
- One shot leads to a match, and the pop gets hit-stop, shake, particles and sound. A bomb in the match triggers.
- Frame rate is acceptable, pause → quit → continue restores the snapshot, and there are no console errors.

The test hook `window.__zuma` exposes state, layout, events, the feel log, `setup()` for scripted chains, and `fireAt()`.
