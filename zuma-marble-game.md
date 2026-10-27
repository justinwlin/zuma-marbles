# Zuma marble game: research and design doc

Status: research / pre-build · Date: 2026-10-27

Goal: build a Zuma-style marble shooter that you can play in a desktop browser and install as a PWA on your phone. It should have a few simple power-ups and strong game feel: you should feel the ball while you aim, and things should explode satisfyingly.

---

## 1. What Zuma is (the rules we are copying)

Zuma (PopCap, 2003) is a puzzle-action game descended from Mitchell's *Puzz Loop* (1998). Luxor and Zuma's Revenge are its best-known relatives.

- A **chain of colored marbles** rolls along a fixed track toward a **skull hole**. If any marble reaches the hole, the rest of the chain rushes in and you lose a life.
- A **launcher** sits at a fixed point, usually near the center of the screen (in Zuma it's a stone frog). It rotates to aim and fires the **current** marble. You can swap the current marble with the **next** one.
- A fired marble that hits the chain is **inserted** at that point. If the insertion makes a run of **3 or more of the same color**, the run pops.
- Popping a run leaves a **gap**. If the marbles on either side of the gap are the same color, they attract **magnetically**. The front part of the chain is pulled *backwards* (away from the skull) until the two parts touch. If they now form a run of 3+, that run pops too. This is a **combo**, and it can cascade.
- If the colors on either side of the gap don't match, the front part of the chain stops. Only the rear part, the one being pushed by new marbles entering from the start of the track, keeps moving.
- A **progress bar** (the "Zuma bar") fills as you score. When it's full, no new marbles enter the track. Clear what's left to finish the level.
- The launcher only hands you **colors that are still on the board**. This rule matters a lot: without it, the endgame is luck.
- Scoring bonuses:
  - **Combo**: cascades from one shot.
  - **Chain bonus**: consecutive shots that each pop something, with no miss in between.
  - **Gap bonus**: a shot that passes through a gap in the chain, or between two overlapping tracks, and scores on the other side.
  - **Coins**: pickups you shoot that fill the bar quickly. In the original game they were worth 500, 600 or 700 points depending on the stage.
- Classic power-up marbles carry an icon. They activate when they're **part of a popped run**, not when they're hit:
  - **Reverse**: the chain rolls backwards for a few seconds.
  - **Slow**: the chain slows down for a few seconds.
  - **Accuracy**: an aim laser appears and shots fire faster.
  - **Bomb**: clears every marble within a radius.

Sources: [StrategyWiki – Zuma Deluxe gameplay](https://strategywiki.org/wiki/Zuma_Deluxe/Gameplay), [TrueAchievements – Zuma hints](https://www.trueachievements.com/game/Zuma/walkthrough/2), [Zuma's Revenge info](https://solitaireparadise.com/games_list/zumas-revenge.html), [Wikipedia – Zuma](https://en.wikipedia.org/wiki/Zuma_(video_game)).

---

## 2. Reference implementations reviewed

### 2a. Tsuma by Jamie Ly ([post](https://codesmith.jamie.ly/post/zuma-clone/) · [source](https://github.com/jamiely/tsuma) · [play](https://jamiely.github.io/tsuma))

Stack: TypeScript, Vite, Vitest, plain Canvas 2D, and `jsfxr` for procedural sound. About 8.4k lines, roughly 35 boards recreated from real Zuma levels.

**What to borrow**

- **A deterministic game loop with no rendering in it.** One `Game` state object is advanced in a fixed order each step: effects, movement, collisions, matches, launcher, then win/lose. Because the loop is deterministic and serializable, Tsuma gets rewind, single-step debugging and JSON save/load for reproducing bugs. That's the most valuable idea in either repo.
- **Separate state, renderer and input.** Sound and effects hang off an **event bus** (`explosion`, `match`, `slow`…) instead of being called from inside game logic. That's also exactly where game-feel hooks belong (see section 6).
- **A level editor.** Overlay a screenshot, click waypoints, then smooth them with **Chaikin's algorithm** (3 iterations, factor 0.25). It's a cheap way to turn a few clicks into a smooth track (`src/util.ts:152`).
- **A front-or-behind insertion rule.** Project the vector from the hit ball to the projectile onto the hit ball's direction of travel: `dot(c, m) / |m|²`. A positive result inserts the new marble ahead of the hit ball, a negative one behind it.
- **Power-up spawning.** Use weighted frequencies, and never place two power-ups next to each other.

**What to avoid**

- Balls move **waypoint to waypoint** at a fixed speed per frame, not per unit of time. Speed therefore depends on the frame rate, and spacing drifts.
- The magnetic pull is ad hoc (`movement.ts:147`, with comments like *"this is not quite working right"*), and the author admits it pulls "when they feel like it".
- The chain is a linked list, and that made serialization painful because of circular references.

### 2b. zuma-js-game by madebyaris ([source](https://github.com/madebyaris-research-repo/zuma-js-game))

Stack: Phaser 3.60, TypeScript, Webpack and Jest. About 5k lines with 30 generated levels. The art is AI-generated sprites. The code itself appears to be largely AI-agent-written (the repo has a heavy `.cursor/` agent setup).

**What to borrow**

- Project layout: `core/` (Ball, Chain, Shooter, Projectile), `mechanics/` (Collision, Score), `levels/`, `scenes/` and `ui/HUD`.
- Phaser's built-ins: curves, tweens, camera shake and the scale manager.
- The feature list: 30 levels across 6 stages, two-track levels, a skull warning, extra life every 50k points, and the four classic power-ups.

**What to avoid** (each one is a concrete bug to design around)

- Balls are placed with `path.getPoint(t)` (`Ball.ts:83`), using a shared `t` increment for every ball. On spline and Bézier paths, `t` is **not proportional to distance along the track**, so spacing stretches and squashes around curves. `closeGaps()` then patches over this by averaging `t` values. Use arc-length positions instead (see section 4).
- The chain moves as **one block**. There's no real segment model, so there's no genuine gap, stop or magnetic-pull behavior.
- The insertion point is the "nearest midpoint", which picks the wrong side on curves.
- Power-ups activate **when hit**, not when matched, which changes the strategy.
- The explosion radius check removes balls without collapsing the gaps or re-checking for matches afterwards.
- The game logic is tied to Phaser sprites, so the tests need heavy Phaser mocks.

**Takeaway:** use Tsuma's architecture (a pure, deterministic simulation and an event bus), Phaser-level presentation tools, and a proper arc-length segment model that neither repo has.

---

## 3. Recommended tech stack

| Concern | Choice | Why |
|---|---|---|
| Language/build | **TypeScript + Vite** | Fast development server, easy PWA plugin, Vitest for the simulation |
| Rendering/presentation | **Phaser** (v3.90 stable, or v4 if it's stable when we start; reportedly released April 2026, unverified) | Scale manager, tweens, particles, camera shake/flash, input, audio and scenes all built in. PixiJS v8 renders faster, but you build everything else yourself. |
| Simulation | **Plain TS module, no Phaser imports** | Deterministic, unit-testable, supports replay and rewind (the Tsuma lesson) |
| PWA | **vite-plugin-pwa** (Workbox) | Generates the manifest, precaches every asset and handles auto-update |
| Sound | Web Audio through Phaser, with **jsfxr** for prototype SFX | Procedural SFX with no asset licensing. Swap in recorded or licensed sounds later. |
| Haptics | `navigator.vibrate` on Android, plus the iOS switch-checkbox trick (e.g. the `web-haptics` library) | Safari still has no Vibration API (see section 7) |
| Storage | `localStorage` (or IndexedDB) | Level progress, best scores, settings |
| Hosting | GitHub Pages / Cloudflare Pages / Vercel | Static and HTTPS (a PWA requires HTTPS) |

A **Canvas 2D** build with no engine, like Tsuma, is a valid lighter option. You'd hand-write the tweens, particles and shake. That's maybe 300–500 lines, but you'd control everything.

---

## 4. Core simulation design (the hard part)

### 4.1 Track as an arc-length lookup table

- Author each track as control points: Chaikin-smoothed clicks, or Catmull-Rom/Bézier curves.
- At load time, **resample at fixed arc-length spacing**, for example every 1 logical pixel, into `Float32Array`s `xs[]`, `ys[]` and `angle[]`. Total length is `L`.
- A marble's position is a single number, **`s` = distance along the track** in pixels. `pos(s)` is an array lookup with lerp. Spacing is exact everywhere, so no `closeGaps` hack is needed.
- Store `s` in game state. It's trivially serializable.
- In Phaser, `Curve.getPointAt(u)` and `getSpacedPoints()` are arc-length based. `getPoint(t)` is not, and that's the madebyaris bug.

### 4.2 Chain as segments

```ts
type Ball = { id: number; color: Color; power?: PowerType; s: number; spin: number };
type Segment = { balls: Ball[] /* ordered tail→head */; v: number /* px/s, signed */ };
type Track = { lut: TrackLUT; segments: Segment[]; toSpawn: number; speedProfile: ... };
```

- Within a segment, balls sit exactly `D = 2r` apart: `s[i] = s[0] + i*D`.
- Only the **rearmost segment** is driven by the spawner, at the level speed. Any segment ahead of it moves only when something pushes it from behind, or when it's magnetically pulled backwards.
- **Contact:** when a segment's head comes within `D` of the next segment's tail, merge them into one segment. On the merge, check for a match at the join. A match here counts as a combo.
- **Magnetic pull:** if `segA.head.color === segB.tail.color` across a gap, segment B gets a backwards velocity that accelerates to a cap. This is deterministic, unlike Tsuma's ad hoc pull. When the two segments touch, merge them and resolve matches, then add a small bounce for feel.
- **Speed profile:** at level start the chain rushes in fast, then settles to cruise speed. Optionally slow it slightly as it nears the skull, because classic Zuma gives you a tense last chance. All values are per second, using a fixed timestep.
- **Fixed timestep:** run the simulation at 120 Hz and interpolate rendering between steps. Phones that run at 60, 90 or 120 Hz then all play identically.

### 4.3 Shooting and insertion

1. A projectile moves in a straight line at about 1,200–1,600 px/s. Use swept circle-vs-circle tests against chain balls, or substeps, so fast shots can't tunnel through. Use a spatial grid or a broad phase on track `s`-ranges if it gets slow.
2. On a hit, use Tsuma's projection test to decide front or back: compare the projection of `(projectile − hit)` onto the track tangent at `hit.s`.
3. Insert at index `i` with an **insertion animation** of about 80–120 ms. The new ball slides from the impact point to its slot while the balls in front shift forward by `D`. During the animation the segment is marked `inserting`, and match resolution waits until it settles. This is what makes the hit feel physical.
4. Resolve the match: expand left and right from the inserted ball while the color is the same. If the run is 3 or longer, start popping it. The balls play a short pop state (about 120 ms) before they're removed.
5. Popping splits the segment. Then the magnetic-pull and contact rules in 4.2 take over, and those produce the combos.
6. A missed shot leaves the screen and resets the chain-bonus counter.

### 4.4 Launcher color rules

- `current` and `next` are always drawn from the **colors still present** on the board, optionally weighted toward colors near the front of the chain. A just-in-case re-roll happens when the last ball of a color disappears.
- Swap: right-click or Space on desktop, and tap the launcher on mobile.

### 4.5 Win and lose

- **Lose:** any ball's `s` reaches `L` (the skull). Play a dramatic "slurp" where the chain accelerates into the hole, the screen goes red and a life is lost.
- **Win:** the bar is full, `toSpawn` is 0 and every segment is empty. Then play the end-of-level bonus: a light runs along the remaining track to the skull, adding points as it goes.

### 4.6 Testing

The pure simulation lets you unit-test with Vitest: insertion side on curves, match expansion, magnetic merge, combo counting, power-up effects, and lose detection. Add a **replay recorder** that stores the seed plus input events, so any bug becomes a reproducible test case.

---

## 5. Power-ups (simple set)

The rule for all of them: a power-up is an icon on a chain marble that blinks out after about 10–15 s if you don't use it. It **fires when it's part of a popped run**. Spawn chance is about 3–5% per spawned ball, weighted, and never adjacent to another power-up.

| Power-up | Effect | Duration | Feel cue |
|---|---|---|---|
| **Bomb** 💣 | Pops every ball within about 3 ball diameters, along *all* tracks | instant | Hit-stop, white flash, shockwave ring, heavy shake, debris |
| **Slow** ⏱ | All segments move at 50% speed | 6 s | Desaturated blue tint, music pitch drops, ticking clock |
| **Reverse** ⏪ | The rear segment rolls backwards at about 1.2× cruise speed | 3 s | Rewind whoosh, arrows flowing back along the track |
| **Laser sight** 🎯 | Aim line goes all the way to the target ball, fire rate 2× | 8 s | Glowing beam, crisp "lock-on" tick when the target changes |

Optional extras if the base game feels thin (each is still simple):

- **Lightning:** pops every ball of the struck color within a short stretch of track.
- **Wild ball:** the launcher gets a rainbow marble that matches anything.
- **Coins:** floating pickups you shoot for points. They fill the bar fast.

Show active timers as small radial icons next to the launcher.

---

## 6. Game feel ("juice") spec

You asked to *feel the ball when aiming* and for *things to explode*. These are the concrete techniques, ranked by impact relative to effort.

### Aiming (feel the ball)

- **Target preview:** raycast from the launcher and **highlight the ball you'd hit**, with a rim glow. Draw a faint **ghost marble in the slot it would insert into**. This is the biggest single improvement to aiming feel.
- **Trajectory line:** draw short dotted segments that animate toward the target. Without the laser power-up the line stays short. With it, the line runs all the way to the target.
- **Lock-on tick:** when the targeted ball changes, play a soft click and a light haptic tap on mobile. You *feel* the aim moving across the chain.
- **Launcher springiness:** rotation follows the pointer through a critically damped spring rather than snapping, plus a slight idle "breathing" animation.
- **Loaded-ball wobble:** the marble in the launcher spins and bobs slightly. The next marble is shown smaller in the launcher's back.

### Firing

- Launcher **recoil**: kick back 6 px and spring back. Add a muzzle flash and puff.
- Projectile **stretch**: squash and stretch along its velocity, with a short motion trail.
- A layered "thwip" sound with ±5% random pitch.

### Impact and insertion

- **Hit-stop:** freeze the simulation for 30–50 ms on contact. It's tiny, but hugely tactile.
- A **ripple** runs through the chain as balls shift to make room: each neighbor plays a quick scale pulse, delayed by its distance from the impact.
- "Clack" sound on contact, with the pitch varied by color.

### Pops, combos and explosions

- Popping balls **swell, flash white, then burst** into color-matched particles: shards plus sparkles plus a glow ring.
- **Floating score** text with a scale-in and drift up. Combo text grows each step, e.g. "COMBO ×3!".
- **Escalating pitch**: each successive combo step plays the pop a semitone higher. Players learn to chase that sound.
- **Screen shake** scales with the event (pop < combo < bomb). Use trauma-based shake (`shake = trauma²`, decaying) with a cap, and always offer a reduce-motion setting.
- **Magnetic pull** is visible: a faint arc or spark between the two attracting ends, a rising whoosh, and a satisfying *thunk* plus a bounce when they connect.
- **Bomb:** hit-stop of about 80 ms, a full-screen white flash for 1 frame, an expanding shockwave ring (optionally a displacement filter), debris, a bass-heavy boom and a strong haptic.

### Marbles themselves

- **Rolling:** rotate each marble's texture or highlight by `s / r` radians so they visibly *roll* rather than slide. It's cheap and it sells the physics.
- Glossy shading: radial-gradient base, a specular highlight that stays fixed to the light source, a soft drop shadow on the track, and a track groove drawn along the path.

### Tension and payoff

- **Danger zone:** as the head nears the skull, the track glows red, a heartbeat SFX speeds up, the skull's jaw opens, and a vignette pulses.
- **Clutch save:** when you clear the ball nearest the skull, play brief slow-motion (0.3× for about 300 ms).
- **Level clear:** confetti, the bonus light run, and the score counting up with ticks.

### Accessibility

- **Colorblind mode:** each color also gets a distinct symbol or pattern.
- Options for reduce motion (no shake or flash), haptics on/off, and separate SFX and music volume.

References on juice: Jonsson and Purho, *Juice It or Lose It* (GDC Europe 2012), and Jan Willem Nijman, *The Art of Screenshake* (2013).

---

## 7. PWA and cross-device plan

### Install and offline

- `vite-plugin-pwa` with `registerType: 'autoUpdate'` precaches HTML, JS, sprites and audio, so the game works fully **offline**.
- `manifest.webmanifest`:
  - `display: "fullscreen"`, falling back to `standalone`
  - `orientation: "any"`
  - `theme_color` and `background_color`
  - 192 px and 512 px icons plus a **maskable** icon
  - optional `screenshots` for the richer Android install UI
- iOS: add `apple-touch-icon`, `apple-mobile-web-app-capable` and a status bar style. iOS has **no install prompt**, so show a one-time "Share → Add to Home Screen" hint when the game runs in Safari outside standalone mode.
- Android/desktop Chrome and Edge: catch `beforeinstallprompt` and show an "Install" button on the menu.

### Mobile browser gotchas

- **Audio unlock:** browsers won't play sound until a user gesture. Make the menu's "Play" tap resume the `AudioContext`.
- **No page scrolling or zooming:**
  - `touch-action: none` on the canvas
  - `overscroll-behavior: none`
  - `user-scalable=no` in the viewport meta tag
  - `viewport-fit=cover` with `env(safe-area-inset-*)` padding for notches
  - block `contextmenu` and long-press text selection
- **Keep the screen awake** during play with the Screen Wake Lock API (`navigator.wakeLock.request('screen')`).
- **Pause automatically** on `visibilitychange`, and save progress then too.
- **Haptics:** `navigator.vibrate` works on Android Chrome. **iOS Safari still doesn't support it.** The known workaround is programmatically toggling a hidden `<input type="checkbox" switch>`, which Safari answers with a haptic tick (iOS 17.4/18+). One source says iOS 26.5 patched this, so treat iOS haptics as best-effort and test on a real device. The `web-haptics` library wraps both paths. Sources: [web-haptics browser support](https://www.mintlify.com/lochie/web-haptics/advanced/browser-support), [ionic issue #29942](https://github.com/ionic-team/ionic-framework/issues/29942), [iOS haptics tester](https://rapidtoolset.com/en/tool/ios-haptics-tester).
- **Fullscreen API:** this isn't available on iPhone Safari. Installed standalone mode is the way to get the browser chrome out of the way there.

### Input model

| | Desktop | Phone/tablet |
|---|---|---|
| Aim | Mouse position | Drag anywhere. The launcher aims at the finger, offset so the finger doesn't cover the target. |
| Fire | Left click | **Lift the finger to fire.** Cancel by dragging back onto the launcher. |
| Swap | Right click / Space | Tap the launcher, or a dedicated swap button near your thumb |
| Pause | Esc / P | Pause button (top corner, within the safe area) |

Use Pointer Events throughout so mouse, touch and pen share one code path.

Tap-to-fire (fire at the tapped point) is the simpler alternative. Make it a setting, because some players prefer it.

### Screen sizes and orientation

- Author levels in a fixed **logical space** (e.g. 1280×720) and let Phaser's `Scale.FIT` letterbox them. Put the HUD in the letterbox margins when they exist.
- **Portrait phones:** rather than shrinking a landscape board, **rotate the level 90°**. Transform the track points and the launcher position at load time. Every level then works in both orientations for free, and the HUD moves to the top and bottom.
- Keep the ball radius at least 18 logical px, so a marble stays at least about 7 mm on a phone.
- Use `devicePixelRatio`-aware rendering (capped at 2) for sharpness without burning battery.

---

## 8. UI and screens

- **Title:** animated background with a marble chain looping around the logo. Buttons: Play, Levels, Settings, Install.
- **Level select:** a map or temple path, with stars per level (by score or time) and locked or unlocked state.
- **HUD:** score, lives, the progress bar (it glows when full, with the text "No more marbles!"), active power-up timers, and the pause button.
- **Pause:** resume, restart, settings, quit. The game also pauses itself on blur.
- **Level clear / game over:** score breakdown (combos, best chain, gap shots), stars, next/retry.
- **Settings:** music/SFX volume, haptics, reduce motion, colorblind symbols, aim style (drag-release vs tap), and a reset-progress option.
- **Visual direction (to decide):** classic Aztec-temple stone and jungle, or a cleaner modern neon/glass look. Neon/glass suits procedural rendering and glow effects, so it needs fewer art assets.

---

## 9. Levels

- Path shapes to cover: spiral-in, S-curve, figure-8 with a crossing (good for gap shots), zigzag, two tracks into two skulls, and tunnels where the track goes under scenery and hides the balls.
- Difficulty levers: color count (4 → 6), chain speed, total balls to spawn, track length (shorter is harder), and launcher position.
- Include an **in-game editor mode** (dev only): click to place points, Chaikin-smooth them, preview the chain running, and export JSON. Tsuma shows this pays for itself.
- Starting scope: **12 levels across 3 worlds**, with an **endless mode** using random tracks and rising speed for replay value.

---

## 10. Build roadmap

1. **Simulation core** (no art): track LUT, segments, spawner, shooting, insertion, matching, magnetic pull, win/lose, all unit-tested. Debug render with circles on Canvas.
2. **Playable vertical slice:** Phaser scene, 1 level, desktop and touch input, basic SFX.
3. **Juice pass:** target preview, hit-stop, rolling marbles, pop particles, shake, combo pitch, danger zone. *Play it on a phone at this point.*
4. **Power-ups:** bomb, slow, reverse, laser.
5. **PWA:** manifest, service worker, offline, install hint, wake lock, haptics, portrait rotation.
6. **Content and UI:** menus, level select, 12 levels, settings, saving.
7. **Polish:** music, accessibility, performance pass on a low-end Android device.

---

## 11. Open questions for you

1. Visual theme: classic temple, or modern neon/glass?
2. Is Phaser fine, or do you want a zero-engine Canvas build (smaller, more hand-rolled)?
3. Should portrait mode rotate the level (recommended), or should we design portrait-specific levels?
4. Campaign levels only, or campaign plus endless mode?
5. Where should the code live (new GitHub repo name?) and where should it be hosted (GitHub Pages, Cloudflare, Vercel)?

---

## 12. Implementation status (2026-10-27)

Built in this folder. See `README.md`.

- **What changed from the plan above**:
  - Custom Canvas 2D instead of Phaser. The bundle is about 27 KB gzipped.
  - Mechanics are ported from the Zuma Deluxe decompilation ([alula/CircleShootApp](https://github.com/alula/CircleShootApp)) rather than guessed.
  - Levels are infinite and seed-generated rather than hand-authored.
- **Reference survey**: alula/CircleShootApp (decompilation, the most authoritative), 9933fa/Zuma-Deluxe-TAS (a JS port of it), jamiely/tsuma, madebyaris/zuma-js-game, GalaxyShad/Zuma-Deluxe-HD (C).
