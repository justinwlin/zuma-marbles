# Music and sound design

Players single out the sound design, so this doc records how audio works today and the ideas we want to build on it.

## How it works today

Everything is synthesized live in `src/game/audio.ts` on Web Audio. There are no audio files, so the PWA stays small and works offline.

- **Sound effects** are short "voices" built from oscillators and filtered noise (`shoot`, `pop`, `thunk`, `boom`, `zap`, `spit`, and so on). `src/game/feel.ts` maps every game event to a voice and a pitch.
- **Combos climb the scale.** Each combo step and streak raises the pop's pitch, so players learn to chase the rising note.
- **Danger heartbeat.** A low double thump plays as the chain nears the skull.
- **Music** is a generative loop: a sine pad on the chord root every 4 steps and triangle plucks from a minor pentatonic scale, over a 4-chord progression rooted on G3 (196 Hz). The tempo speeds up as danger rises, and layers are added as the chain advances (see S1).

## Pops on the beat (built)

When music is playing, a pop is split in two:

1. The click (filtered noise) plays instantly, so hits still feel immediate.
2. The chime waits for the next 16th note of the music, a quarter step or about 0.1 s at most, and is pitched in the current chord. Combo steps walk up the pentatonic scale from the chord root, so a combo plays an arpeggio in key.

With music off or muted, pops sound exactly as before. The code is `Audio.popOnBeat`. `updateMusic` records each step's time, length and chord root so pops can lock to the grid.

## Ideas

### S1. Layered, reactive music (built)

The loop is built from layers that follow the game, the way Luxor Evolved advertises "interactive soundtracks":

- **Calm:** pad and plucks.
- **Pressure:** a bassline fades in as the lead chain passes about 50% of the track, and drums (sine kick on the beat, noise snare and hats) past about 75%. The tempo still rises with danger.
- **Release:** a combo of 3 or more, a Reverse, or Second Wind drops the bass and drums for about a bar, then they come back.
- **Clear:** once the bar fills, plucks and pops switch to a major pentatonic until the level ends.

Each layer has its own gain node ramped with `setTargetAtTime`, so changes never click. Progress is smoothed (fast up, slow down) so layers don't flicker. Layer notes are only scheduled while audible. `npx tsx scripts/music-check.ts` (with `vite preview` on port 5174) fast-forwards a level and prints the layer levels.

### S2. Music per theme

If we add world themes (one per 10-level block, like Zuma's Revenge's islands), each theme gets its own key, scale, tempo and instruments:

| Theme | Scale | Instruments (synth recipe) | Ambient bed |
|---|---|---|---|
| Jungle temple | Major pentatonic | Marimba (sine with a fast decay), log drum (pitched noise burst) | Birds (chirped sine), insects |
| Desert | Phrygian dominant | Plucked sawtooth through a bandpass filter, frame drum | Wind (lowpass noise, slow sweep) |
| Ice cavern | Natural minor | Bells (sine plus inharmonic partials), glassy pad | Drips (short high sine pings) |
| Volcano | Harmonic minor | Distorted bass (square through a waveshaper), toms | Rumble (very low noise) |
| Deep sea | Lydian | Soft FM pad, sonar ping lead | Bubbles (rising sine blips) |
| Neon | Dorian | Arpeggiated square lead, side-chained pad | None |

Pops on the beat (above) pick up each theme's key automatically, as long as the theme exposes its scale.

### S3. Boss music

Give the serpent and the idol their own loops: lower register, faster tempo, a recurring motif. Sync the boss's wind-up to the music, so the rear-up starts on a bar line and the spit or rock lands on the downbeat. Players then learn the attack rhythm by ear. A short victory sting plays on defeat.

### S4. More things on the grid

Extend the beat lock beyond pops:

- Combo-start and Lightning chimes on the next 8th note.
- Coin pickups as a two-note figure in key.
- The level-clear light sweep ticks on 16ths in the current scale.

Rule of thumb: anything with a tonal tail can wait up to a 16th note, but the transient (the part that says "you hit something") always plays immediately.

### S5. Signature sounds for newer mechanics

- **Tunnels:** a muffled, lowpassed rumble when the chain head enters, and a "pop out" when it exits.
- **Bridges:** a hollow wooden knock as marbles roll onto the deck.
- **Serpent rear-up:** a rising whine across the whole 3 s window, so you can hear the window closing.
- **Choke:** a gulp, then an ascending three-note "power-up" figure.
- **Ace chip:** a soft tick each second during the final 10 s, and a fanfare on "ACE TIME!" at the end.

### S6. Menus and level select

A slower, sparser loop for menus (pad plus occasional bell). Crossfade into the level loop when play starts, so the transition feels continuous.

## Constraints

- Keep everything procedural. Samples would grow the bundle and break the "tiny offline PWA" goal.
- Audio is presentation only. Never let it affect `src/sim`, which must stay deterministic.
- Respect the separate music and effects volume settings, and keep the compressor on the master bus so stacked combos don't clip.
- Mobile Safari only unlocks audio on a user gesture (`Audio.unlock()`). New layers must start from the existing context, not create their own.
