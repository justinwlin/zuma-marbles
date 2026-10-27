# Music and sound design

Players single out the sound design, so this doc records how audio works today and the ideas we want to build on it.

## How it works today

Everything is synthesized live in `src/game/audio.ts` on Web Audio. There are no audio files, so the PWA stays small and works offline.

- **Sound effects** are short "voices" built from oscillators and filtered noise (`shoot`, `pop`, `thunk`, `boom`, `zap`, `spit`, and so on). `src/game/feel.ts` maps every game event to a voice and a pitch.
- **Combos climb the scale.** Each combo step and streak raises the pop's pitch, so players learn to chase the rising note.
- **Danger heartbeat.** A low double thump plays as the chain nears the skull.
- **Music** is a generative loop: a sine pad on the chord root every 4 steps and triangle plucks from a minor pentatonic scale, over a 4-chord progression rooted on G3 (196 Hz). The tempo speeds up as danger rises (`updateMusic(dt, intensity)`).

## Pops on the beat (built)

When music is playing, a pop is split in two:

1. The click (filtered noise) plays instantly, so hits still feel immediate.
2. The chime waits for the next 16th note of the music, a quarter step or about 0.1 s at most, and is pitched in the current chord. Combo steps walk up the pentatonic scale from the chord root, so a combo plays an arpeggio in key.

With music off or muted, pops sound exactly as before. The code is `Audio.popOnBeat`. `updateMusic` records each step's time, length and chord root so pops can lock to the grid.

## Ideas

### S1. Layered, reactive music

Build the loop from layers that fade in and out with the game state, the way Luxor Evolved advertises "interactive soundtracks":

- **Calm:** pad and plucks, as today.
- **Pressure:** as the head passes about 50% of the track, add a bassline. Past about 75%, add drums (noise hats on 8ths, a sine kick on the beat).
- **Release:** after a big combo or a Reverse, drop to the pad for a bar, then bring the layers back.
- **Clear:** when the bar fills, switch the progression to a major key until the level ends.

Implementation note: keep one scheduler and give each layer its own gain node, ramped with `setTargetAtTime` so changes never click.

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
