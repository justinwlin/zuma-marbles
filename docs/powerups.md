# Power-ups

This doc records the power-ups we have and ideas for growing the set. Luxor Evolved lists 21 power-ups plus 3 "super" power-ups, while we have 6. A bigger set is one of the cheapest ways to keep later levels fresh.

## Current set

Power-ups appear on random marbles in the chain (and 3-5 at once when you choke the serpent). Pop the marble in a match to trigger it. A power marble loses its power after `powerLife` (18 s). Numbers below come from `TUNING` in `src/sim/game.ts`.

| Power | Effect |
|---|---|
| Bomb | Pops every marble within `bombRadius` (122 px, scaled), on every track |
| Slow | The chain crawls at ¼ speed for 8 s |
| Reverse | Rolls the chain back for 3 s |
| Lightning | Pops every visible marble of its colour, on every track |
| Wild | Your next shot is a rainbow marble that becomes the colour of the neighbour giving the longer run |
| Scorpion | Runs back from the skull and eats the 10 front marbles |

Marbles hidden under a bridge or in a tunnel are safe from Bomb and Lightning, and never receive a power.

## Ideas for new power-ups

Names in the Luxor series include Black Hole, Double Shooter, Color Cloud, Net, Dagger, Spiker Ball and Lead Barrage. We only found the names, not the exact effects, so the designs below are our own takes.

| Code | Idea | Effect | Why it's interesting |
|---|---|---|---|
| P1 | Split shot | The next 3 shots each fire two marbles in a narrow V | Two insertions per shot, great for setting up runs |
| P2 | Colour cloud | Recolours the 6-8 marbles around it to one colour, then pops them | A guaranteed big match with satisfying setup |
| P3 | Black hole | Opens a vortex at the power marble's spot for 3 s that sucks in and pops marbles rolling past it | A positional power: pays off when the chain is dense |
| P4 | Dagger | The next shot pierces straight through the chain and pops every marble on its line | Rewards aiming across several rows of track |
| P5 | Freeze | Stops the chain completely for 4 s (Slow is ¼ speed) | A panic button for the danger zone |
| P6 | Magnet shot | For 8 s, shots home onto the nearest marble of the same colour | Forgiving aim, fun for touch players |
| P7 | Net | Catches the 6 front marbles and drags them back down the track | A targeted Reverse for when the head is close |
| P8 | Accuracy | A long, precise aim line for 10 s, showing exactly where each shot lands | Zuma's Revenge has an aiming power-up; ours would suit the always-on guide |

### Super power-ups

Luxor has a separate tier of rarer, stronger powers. Ours could be charged by a meter that fills with combos and streaks, then triggered by the player (a button or a key) instead of appearing on a marble:

- **S1. Storm:** Lightning on every colour at once, but only for the front third of the chain.
- **S2. Rewind:** Pushes the whole chain back to where it was 10 s ago.
- **S3. Rainbow run:** For 5 s every shot is Wild.

A player-triggered meter gives combo play a long-term goal and lets the player choose when to use it, which no current power-up does.

## Design rules

- **One sentence each.** The help screen describes every power in one line. If a power needs two sentences, simplify it.
- **Distinct icon, colour and sound.** Players read powers at a glance on a moving chain. Every new power needs a `render.ts` icon, a `feel.ts` entry and an `audio.ts` voice.
- **Deterministic.** All effects live in `src/sim/game.ts`, draw randomness only from the state's RNG streams, and use only `+ - * / sqrt`.
- **Bot support.** `src/sim/bot.ts` should value the new power, or balance runs undercount it.
- **Spawn mix.** Introduce new powers gradually (for example one per 10-level world) instead of adding all of them to the pool at once. The Power surge twist triples the spawn rate, so check that new powers aren't overwhelming there.
- **Saves.** `Power` values are stored in snapshots. Add new powers at the end of the enum, and keep `POWER_COUNT` and `POWER_NAMES` in sync.
