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
- **Aim modes** (touch): Drag & release, **Aim + tap** (drag to set the aim, tap to shoot; the tap is a real one, so iPhones vibrate on every shot), Tap, and **Trackpad**: drag anywhere to move a crosshair by your finger's motion (scaled to 0.8× for finer control, and your finger never covers the target), tap to shoot, hold to keep shooting.
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
  - Wild: your next marble turns rainbow. When it lands it takes the colour of whichever neighbour makes the longer run (the guide's "will pop" preview accounts for this).
  - Scorpion: a scorpion runs back from the skull and eats the 10 marbles closest to it.
- **Bonus coins**: every 17–29 s a gold coin appears in an open spot that has a clear line of fire. Shoot through it within 6.5 s for +300. Coins and end-of-level bonuses count toward your score but not the ZUMA bar.
- **End of level**: a light runs down the empty track from the furthest point the chain reached to the skull, counting up a **track bonus** (10 points per 1% of track the chain never reached). Then comes the **ace time** bonus (+1000) if you cleared the level within its ace time. The ace time shows on the level banner, the pause screen and the result screen, and is fit so that a bit under half of the good bot's wins beat it.
- **Boss fights** (every 10th level, campaign and endless):
  - Your character slides along a **rail** on the right edge (the bottom on a portrait phone) and shoots straight across. Aim anywhere and it slides there: it follows the mouse, a drag, or the crosshair, and a tap or click slides there and fires. Arrow keys move it on desktop.
  - The boss is a carved stone idol sitting on the far side behind the chain. It has a rotating sun halo, a glowing gem, eyes that follow you, cracks that spread as it weakens, and two floating stone hands. **Every marble you pop** sends a spark into it (1 damage, plus 1 per combo step), and a shot through a gap that hits it does 6. The HUD bar shows its health.
  - **Its attack:** one hand winds up while a molten rock forms in it. During the wind-up a **yellow target follows you** along the rail. Then the rock is lobbed in a high arc, with its shadow on the ground, and the target **turns red, locks and closes in** until it lands 1.45 s later. Move out from under it, or you're stunned for 1.2 s. Below half health the idol turns red, its cracks glow, and both hands sometimes throw.
- **Mini-bosses** (levels 5, 15, 25…): a **skull serpent** lives in chain 0's skull pit. It has a bone-plated head, horns, slit eyes, a flicking tongue and a health ring.
  - Every marble you pop hurts it, and slaying it clears the level the same way as the big boss: the chain cascades away.
  - Every 7 s it rears back with a marble glowing in its mouth, then lunges and spits 2 marbles onto the front of the chain (3 once it's below half health). It holds back once the chain is close to the skull, so a spit can't cause a cheap loss.
  - At 0 health the boss crumbles, no more marbles come, and the chain pops from the head back.
- **Levels** come from `(campaignSeed, levelIndex)`, so the same seed gives the same levels on any device. Level codes look like `jade-1234/12` and can be shared from the Levels screen.
  - **Shapes**: 11 single-chain families (spiral, lobes, wave, square, heart, serpentine, columns, comb, horseshoe, figure-8, tunnel spiral) and 3 two-chain families (twin spiral, twin serpentine, twin columns). Some levels move the launcher off-centre. Per-family chain speeds even out how hard each shape plays.
  - **Bridges and tunnels**: figure-8s cross themselves once, and tunnel spirals bring the chain in under the outer rings to surface beside the launcher. Marbles under a bridge are hidden and can't be hit (shots, bombs and lightning skip them).
  - **Difficulty** runs in a sawtooth: each block of 5 levels climbs to a **mini-boss** (every 5th) or **boss fight** (every 10th), and the next block starts lower than that peak but higher than the last. Later levels also pick shorter tracks for their shape. Boss health is 0.8× the level's marble target and serpent health 2.2× (free aiming pops much faster than the rail), tuned with `scripts/balance.ts`.
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

**Developing?** See the [development guide](docs/development.md). It covers project layout, the determinism rules for `src/sim`, unit and e2e tests, screenshot tools, bot balance runs, the branch → validate → ship workflow, and deploys.

## Architecture

```
src/sim/      pure, deterministic simulation (no DOM): unit-testable and replayable
  rng.ts        mulberry32 PRNG + string hash; state is one uint32
  track.ts      arc-length lookup table; a ball's position is distance s along the track
  levelgen.ts   infinite level generator (15 shape families incl. rail boss arenas, 1–2 chains) + validator + sawtooth difficulty, bosses, twists, ace time
  game.ts       fixed-tick (120 Hz) step(state, level, commands) → events; one chain per track, power-ups, coins, rail + boss
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
| `npm test` | 81 Vitest tests (summarized below) |
| `npm run e2e` | Real Chromium on 7 device profiles (summarized below). Needs `npm run dev` or `npm run preview` running. |
| `npm run pwa-check` | After `npm run build`: manifest, Chrome installability, active service worker, cold **offline** boot and play |
| `npm run sim -- <seed> <levels>` | Bot playthroughs per level: outcome, time, peak danger, combos, gap shots, power-ups |
| `npm run balance -- <campaigns> <levels…>` | Win-rate/time table per bot skill. Difficulty ramps, then plateaus for endless play. |
| `npx tsx scripts/showcase.ts phone\|desktop` | Frame sequences of combo, bomb, danger, win and menus in `e2e-out/showcase/` for visual review |

**`npm test`** covers:
- **Mechanics**: generator validity over 120 levels, arc-length uniformity, matching, insertion side, spacing, magnet pull and its acceleration, combos, scoring, power-ups, gun colours, cooldown, win and lose.
- **New features** (`tests/features.test.ts`):
  - The Wild marble picks the longer run and pops it, and its rainbow survives swaps.
  - The Scorpion eats exactly the 10 front marbles.
  - Coins spawn clear of tracks, pay out without filling the bar, and expire.
  - Track and ace bonuses are calculated correctly.
  - Boss levels are rail fights clear of the rail.
  - The frog slides and fires straight across, and pops and direct hits hurt the boss.
  - Defeat cascades into a win.
  - Rocks stun only if you stay put, and a stunned frog can't fire.
  - The bot beats boss fights, and boss-fight replays and snapshots are exact.
  - All six power-ups spawn.
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
- The "?" sheet pauses the game and resumes it, and lists all 6 power-ups.
- Boss fight: the HUD shows the boss's health, and the frog slides to the aimed spot on its rail and fires from there.
- Trackpad: a drag moves the crosshair by the scaled finger motion without shooting, and a tap shoots.
- One shot leads to a match, and the pop gets hit-stop, shake, particles and sound. A bomb in the match triggers.
- Frame rate is acceptable, pause → quit → continue restores the snapshot, and there are no console errors.

The test hook `window.__zuma` exposes state, layout, events, the feel log, `setup()` for scripted chains, and `fireAt()`.
