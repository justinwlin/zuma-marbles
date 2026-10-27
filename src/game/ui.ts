// DOM screens (menus, results, settings) and the HUD. Kept separate from the
// canvas so text is crisp, accessible and laid out by CSS on every screen size.

import { type BossKind, generateLevel, isLargeCampaign, type Mutator, MUTATOR_INFO } from '../sim/levelgen';
import { POWER_NAMES, type GameState, progress, type Power } from '../sim/game';
import type { Level } from '../sim/levelgen';
import { PALETTE, powerIconUrl } from './render';
import { CHARACTERS, characterThumb, type CharacterId } from './characters';
import { TUNING } from '../sim/game';
import { dailySeed, type EndlessRun, levelCode, type SaveData, type Settings } from './save';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface UiActions {
  play(index: number): void;
  continueSnapshot(): void;
  resume(): void;
  restart(): void;
  endless(daily: boolean): void;
  continueEndless(): void;
  quit(): void;
  showLevels(): void;
  next(): void;
  settingsChanged(s: Settings): void;
  resetProgress(): void;
  newCampaign(seed: string): void;
  setLargeMarbles(large: boolean): void;
  playCode(code: string): void;
  install(): void;
  click(): void;
}

const marbleCss = (c: number) => {
  const p = PALETTE[c];
  return `background: radial-gradient(circle at 35% 30%, ${p.light}, ${p.base} 48%, ${p.dark});`;
};

export class UI {
  root = $('screens');
  hud = $('hud');
  current = '';
  canInstall = false;
  constructor(private a: UiActions) {
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!el) return;
      this.a.click();
      this.handle(el.dataset.a!, el);
    });
  }

  private handlers: Record<string, (el: HTMLElement) => void> = {};

  private handle(action: string, el: HTMLElement) {
    this.handlers[action]?.(el);
  }

  private show(name: string, html: string, handlers: Record<string, (el: HTMLElement) => void>, cls = '') {
    this.current = name;
    this.handlers = handlers;
    this.root.innerHTML = `<div class="screen ${cls}" data-screen="${name}">${html}</div>`;
  }

  /** Escape / browser-back on a menu: run its Back (or Resume) action if it has one. */
  back(): boolean {
    const h = this.handlers.back ?? this.handlers.resume;
    if (!this.current || !h) return false;
    h(document.body);
    return true;
  }

  hide() {
    this.current = '';
    this.root.innerHTML = '';
  }

  showHud(on: boolean) {
    this.hud.classList.toggle('hidden', !on);
  }

  // ------------------------------------------------------------ screens

  title(save: SaveData) {
    const snap = save.snapshot;
    const marbles = PALETTE.map((_, i) => `<span style="${marbleCss(i)};animation-delay:${i * 0.12}s"></span>`).join('');
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
    const stars = Object.values(save.best).reduce((a, r) => a + r.stars, 0);
    const fresh = save.unlocked === 0 && !snap;
    this.show(
      'title',
      `<div class="logo"><div class="z">ZUMA</div><div class="m">MARBLES</div><div class="marbles">${marbles}</div></div>
      ${fresh ? '' : `<div class="progress-chip"><span>Level ${save.unlocked + 1}</span><span class="star">★ ${stars}</span>${isLargeCampaign(save.campaignSeed) ? '<span>Large marbles</span>' : ''}</div>`}
      <div class="btns">
        ${
          snap
            ? `<button class="btn primary big" data-a="continue">▶ Continue<small>Level ${snap.levelIndex + 1} · pick up where you left off</small></button>`
            : `<button class="btn primary big" data-a="play">▶ ${fresh ? 'Start' : 'Play'}<small>Level ${save.unlocked + 1}</small></button>`
        }
        <div class="row">
          <button class="btn" data-a="levels"><span class="ico">▦</span>Levels</button>
          <button class="btn endless-btn" data-a="endless"><span class="ico">∞</span>Endless${save.endless ? '<small>run in progress</small>' : save.endlessBest ? `<small>best ${save.endlessBest.score.toLocaleString()}</small>` : ''}</button>
        </div>
        <div class="row">
          <button class="btn" data-a="settings"><span class="ico">⚙</span>Settings</button>
          <button class="btn" data-a="help"><span class="ico">?</span>Help</button>
        </div>
        ${this.canInstall ? `<button class="btn ghost" data-a="install">⬇ Install app</button>` : ''}
      </div>
      ${isIOS && !standalone ? '<div class="foot">Tip: Share → <b>Add to Home Screen</b> to play full-screen & offline.</div>' : ''}`,
      {
        continue: () => this.a.continueSnapshot(),
        play: () => this.a.play(save.unlocked),
        levels: () => this.levels(save),
        endless: () => this.endless(save),
        settings: () => this.settings(save, () => this.title(save)),
        help: () => this.help(() => this.title(save)),
        install: () => this.a.install(),
      },
    );
  }

  levels(save: SaveData) {
    const large = isLargeCampaign(save.campaignSeed);
    const count = save.unlocked + 1;
    const stars = Object.values(save.best).reduce((a, r) => a + r.stars, 0);
    const cards: string[] = [];
    // Natural order (1, 2, 3 …); the screen scrolls to the level you're on.
    for (let i = 0; i < count; i++) {
      const rec = save.best[i];
      const meta = levelMeta(save.campaignSeed, i);
      const st = rec ? '★'.repeat(rec.stars) + `<i>${'★'.repeat(3 - rec.stars)}</i>` : '<i>★★★</i>';
      const label = `Level ${i + 1}, ${meta.name}${meta.boss ? `, ${meta.boss === 'boss' ? 'boss' : 'mini-boss'}` : ''}${rec ? `, ${rec.stars} stars` : ', not cleared'}`;
      cards.push(
        `<button class="lv ${i === save.unlocked ? 'next' : ''} ${meta.boss ?? ''}" data-a="lv" data-i="${i}" aria-label="${label}"><b>${i + 1}</b><small>${meta.name}</small>${badges(meta)}<span class="st">${st}</span></button>`,
      );
    }
    cards.push(`<div class="lv locked" aria-hidden="true"><b>🔒</b><small>Level ${count + 1}</small></div>`);
    this.show(
      'levels',
      `<div class="levels-head"><button class="icon-btn" data-a="back" aria-label="Back">←</button><h2>Levels</h2>
        <span class="chip star">★ ${stars} / ${save.unlocked * 3 || 0}</span></div>
      <div class="size-row"><span>Marble size</span><div class="seg">
        <button data-a="size" data-v="0" class="${large ? '' : 'on'}">Normal</button>
        <button data-a="size" data-v="1" class="${large ? 'on' : ''}">Large</button></div>
        <small>${large ? 'Bigger marbles on a smaller board — easier to see and hit on phones.' : 'Large: 25% bigger marbles. It has its own levels & progress.'}</small>
      </div>
      <div class="legend"><span><span class="bd boss">BOSS</span> boss</span><span><span class="bd mini">MINI</span> mini-boss</span><span><span class="bd">2×</span> two chains</span><span><span class="bd">⚡</span> power surge</span><span><span class="bd">🌈</span> streaky</span></div>
      <div class="grid">${cards.join('')}</div>
      <details class="share">
        <summary>Share or play a custom campaign</summary>
        <p>Levels are generated from a seed, so a code like <b>${levelCode(save.campaignSeed, save.unlocked)}</b> opens the same level on any device. Type a new word to start a fresh campaign.</p>
        <div class="code-form">
          <button class="btn" data-a="copy" style="padding:10px 14px;font-size:15px">Copy my code</button>
        </div>
        <form class="code-form" onsubmit="return false">
          <input type="text" id="code" placeholder="Level code or new seed" aria-label="Level code or new seed" autocomplete="off" autocapitalize="off" spellcheck="false">
          <button class="btn" data-a="code" style="padding:10px 16px;font-size:16px">Go</button>
        </form>
      </details>`,
      {
        back: () => this.title(save),
        size: (el) => this.a.setLargeMarbles(el.dataset.v === '1'),
        lv: (el) => this.a.play(Number(el.dataset.i)),
        copy: () => {
          const code = levelCode(save.campaignSeed, save.unlocked);
          void navigator.clipboard?.writeText(code).catch(() => {});
          this.toast(`Copied level code ${code}`);
        },
        code: () => {
          const v = ($('code') as HTMLInputElement).value.trim();
          if (!v) return;
          if (v.includes('/')) this.a.playCode(v);
          else this.a.newCampaign(v);
        },
      },
    );
    // Bring the current level into view.
    this.root.querySelector('.lv.next')?.scrollIntoView({ block: 'nearest' });
  }

  endless(save: SaveData) {
    const run = save.endless;
    const today = dailySeed().slice(6);
    const daily = save.dailyBest?.day === today ? save.dailyBest : undefined;
    const fmt = (b?: { score: number; stage: number }) => (b ? `best ${b.score.toLocaleString()} · stage ${b.stage}` : 'no run yet');
    this.show(
      'endless',
      `<div class="panel"><h2>Endless</h2>
        <p class="sub">Stages roll straight into each other — one life, the score carries over. Every stage brings a new track and twist, with a mini-boss every 5 and a boss every 10.</p>
        <div class="btns" style="margin:0 auto">
          ${run ? `<button class="btn gold" data-a="cont">Continue run<small>${run.daily ? 'Daily' : 'Random'} · stage ${run.stage + 1} · ${run.runScore.toLocaleString()} pts</small></button>` : ''}
          <button class="btn primary" data-a="random">Random run<small>${fmt(save.endlessBest)}</small></button>
          <button class="btn" data-a="daily">Daily run<small>Same stages for everyone today · ${fmt(daily)}</small></button>
          <button class="btn ghost" data-a="back">Back</button>
        </div>
        ${run ? '<p class="sub" style="font-size:12px;margin-top:10px">Starting a new run ends the one in progress.</p>' : ''}</div>`,
      {
        cont: () => this.a.continueEndless(),
        random: () => this.a.endless(false),
        daily: () => this.a.endless(true),
        back: () => this.title(save),
      },
    );
  }

  endlessOver(r: { daily: boolean; total: number; stage: number; newBest: boolean; best: number }) {
    this.show(
      'result',
      `<div class="panel">
        <h2>Run over</h2>
        <p class="sub">${r.daily ? 'Daily run' : 'Endless run'} · reached stage ${r.stage}</p>
        <div class="big-score">${r.total.toLocaleString()}</div>
        <p class="sub">${r.newBest ? '🏆 New best!' : `Best ${r.best.toLocaleString()}`}</p>
        <div class="btns" style="margin:0 auto">
          <button class="btn primary" data-a="again">${r.daily ? 'Retry daily' : 'New run'}</button>
          <button class="btn" data-a="quit">Menu</button>
        </div>
      </div>`,
      {
        again: () => this.a.endless(r.daily),
        quit: () => this.a.quit(),
      },
    );
  }

  pause(save: SaveData, level: Level, run: EndlessRun | null = null) {
    const where = run
      ? `Stage ${level.index + 1} · ${level.name}<br><span style="font-size:12px">${run.daily ? 'Daily' : 'Endless'} run · ${(run.runScore).toLocaleString()} banked</span>`
      : `Level ${level.index + 1} · ${level.name}<br><span style="font-size:12px">code ${levelCode(level.campaignSeed, level.index)}</span>`;
    const info = [
      level.boss === 'boss' ? '<b>Boss</b> level' : level.boss === 'mini' ? '<b>Mini-boss</b>' : '',
      level.tracks.length > 1 ? 'two chains' : '',
      ...level.mutators.map((m) => `<b>${MUTATOR_INFO[m].name}</b>: ${MUTATOR_INFO[m].desc}`),
    ].filter(Boolean);
    this.show(
      'pause',
      `<div class="panel"><h2>Paused</h2><p class="sub">${where}</p>${info.length ? `<p class="sub level-info">${info.join(' · ')}</p>` : ''}
      <div class="btns" style="margin:0 auto">
        <button class="btn primary" data-a="resume">Resume</button>
        <div class="row"><button class="btn" data-a="restart">${run ? 'New run' : 'Restart'}</button><button class="btn" data-a="settings">Settings</button></div>
        <button class="btn ghost" data-a="quit">Save & quit to menu</button>
      </div></div>`,
      {
        resume: () => this.a.resume(),
        restart: () => this.a.restart(),
        settings: () => this.settings(save, () => this.pause(save, level, run)),
        quit: () => this.a.quit(),
      },
    );
  }

  result(won: boolean, st: GameState, level: Level, stars: number, seconds: number, best: number, peak: number, tip = '') {
    const s = st.stats;
    const starHtml = won ? [0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.18}s">★</span>`).join('') : '';
    const mm = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    this.show(
      'result',
      `<div class="panel">
        <h2>${won ? 'Level clear!' : 'Swallowed!'}</h2>
        <p class="sub">Level ${level.index + 1} · ${level.name}</p>
        ${won ? `<div class="stars">${starHtml}</div>` : ''}
        ${!won && tip ? `<div class="tip">💡 ${tip}</div>` : ''}
        <div class="big-score" id="res-score">0</div>
        <div class="stats">
          <div>Time <b>${mm}</b></div><div>Best <b>${best.toLocaleString()}</b></div>
          <div>Max combo <b>×${s.maxCombo + 1}</b></div><div>Best chain <b>${s.maxStreak}</b></div>
          <div>Gap shots <b>${s.gapShots}</b></div><div>Accuracy <b>${s.shots ? Math.round(((s.shots - s.misses) / s.shots) * 100) : 0}%</b></div>
          <div>Power-ups <b>${s.powers}</b></div><div>Nearest the skull <b>${Math.min(100, Math.round(peak * 100))}%</b></div>
        </div>
        <div class="btns" style="margin:0 auto">
          ${won ? '<button class="btn primary" data-a="next">Next level</button>' : '<button class="btn primary" data-a="restart">Try again</button>'}
          <div class="row"><button class="btn" data-a="${won ? 'restart' : 'quit'}">${won ? 'Replay' : 'Menu'}</button><button class="btn" data-a="levels">Levels</button></div>
        </div>
      </div>`,
      {
        next: () => this.a.next(),
        restart: () => this.a.restart(),
        quit: () => this.a.quit(),
        levels: () => this.a.showLevels(),
      },
    );
    // Score count-up
    const el = $('res-score');
    const t0 = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / 900);
      el.textContent = Math.round(st.score * (1 - Math.pow(1 - t, 3))).toLocaleString();
      if (t < 1 && this.current === 'result') requestAnimationFrame(tick);
    };
    tick();
  }

  settings(save: SaveData, back: () => void, inGame = false) {
    const s = save.settings;
    const tog = (k: keyof Settings, on: boolean) => `<button class="toggle ${on ? 'on' : ''}" data-a="tog" data-k="${k}" role="switch" aria-pressed="${on}" aria-label="${k}"></button>`;
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.show(
      'settings',
      `<div class="panel settings"><h2>Settings</h2>
        <h3>Character</h3>
        <div class="chars">${CHARACTERS.map((c) => `<button class="char ${s.character === c.id ? 'on' : ''}" data-a="char" data-v="${c.id}" aria-pressed="${s.character === c.id}"><img src="${characterThumb(c.id, thumbMarble)}" alt=""><span>${c.name}</span></button>`).join('')}</div>
        <h3>Aiming</h3>
        ${
          coarse
            ? `<div class="setting col"><label>Touch aiming<small id="aim-hint">${AIM_HINTS[s.touchAim]}</small></label><div class="seg seg3">${(['drag', 'aimtap', 'tap'] as const).map((m) => `<button data-a="aim" data-v="${m}" class="${s.touchAim === m ? 'on' : ''}">${AIM_LABELS[m]}</button>`).join('')}</div></div>`
            : ''
        }
        <div class="setting"><label>Aim guide<small>Dotted line, target ring & ghost marble</small></label>${tog('guide', s.guide)}</div>
        <div class="setting"><label>Aim assist<small>Nudges shots (±3.5°) into the slot the ghost marble shows</small></label>${tog('assist', s.assist)}</div>
        <div class="setting"><label>Hold to keep shooting<small>${coarse ? 'Press and hold (without dragging) to rapid-fire' : 'Hold the mouse button to rapid-fire'}</small></label>${tog('holdFire', s.holdFire)}</div>
        ${coarse ? `<div class="setting"><label>Left-handed<small>Swap button on the left, cancel target on the right</small></label>${tog('leftHanded', s.leftHanded)}</div>` : ''}
        <h3>Accessibility</h3>
        <div class="setting"><label>Relaxed speed<small>Chains roll 25% slower — more time to think</small></label>${tog('relaxed', s.relaxed)}</div>
        <div class="setting"><label>Colour-blind symbols<small>A shape on every marble colour</small></label>${tog('colorblind', s.colorblind)}</div>
        <div class="setting"><label>Larger text & buttons</label>${tog('largeUi', s.largeUi)}</div>
        <div class="setting"><label>Reduce motion<small>No screen shake or flashes</small></label>${tog('reduceMotion', s.reduceMotion)}</div>
        <h3>Sound & vibration</h3>
        <div class="setting"><label>Sound</label><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-k="sfx" aria-label="Sound volume"></div>
        <div class="setting"><label>Music</label><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-k="music" aria-label="Music volume"></div>
        <div class="setting"><label>Vibration<small>${/iP(hone|od)/.test(navigator.userAgent) ? 'iPhone: ticks on taps only (Safari limit) — Tap aiming gives a tick per shot' : 'Haptic feedback on hits & pops'}</small></label>${tog('haptics', s.haptics)}</div>
        <div class="btns sticky-done">
          <button class="btn primary" data-a="back">${inGame ? 'Back to game' : 'Done'}</button>
          ${inGame ? '' : '<button class="btn ghost" data-a="reset">Reset progress…</button>'}
        </div></div>`,
      {
        back,
        tog: (el) => {
          const k = el.dataset.k as 'haptics' | 'guide' | 'colorblind' | 'reduceMotion' | 'assist' | 'holdFire' | 'relaxed' | 'leftHanded' | 'largeUi';
          s[k] = !s[k];
          el.classList.toggle('on', s[k]);
          el.setAttribute('aria-pressed', String(s[k]));
          this.a.settingsChanged(s);
        },
        char: (el) => {
          s.character = el.dataset.v as CharacterId;
          el.parentElement!.querySelectorAll('.char').forEach((b) => {
            b.classList.toggle('on', b === el);
            b.setAttribute('aria-pressed', String(b === el));
          });
          this.a.settingsChanged(s);
        },
        aim: (el) => {
          s.touchAim = el.dataset.v as 'drag' | 'aimtap' | 'tap';
          const hint = document.getElementById('aim-hint');
          if (hint) hint.textContent = AIM_HINTS[s.touchAim];
          el.parentElement!.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
          this.a.settingsChanged(s);
        },
        reset: (el) => {
          if (el.dataset.confirm) this.a.resetProgress();
          else {
            el.dataset.confirm = '1';
            el.textContent = 'Tap again to erase all progress';
            el.style.color = 'var(--danger)';
          }
        },
      },
    );
    // Whole row toggles (bigger target); switches get their row's label as their name.
    this.root.querySelectorAll<HTMLElement>('.setting').forEach((row) => {
      const t = row.querySelector<HTMLElement>('.toggle');
      if (!t) return;
      t.setAttribute('aria-label', row.querySelector('label')?.firstChild?.textContent?.trim() ?? '');
      row.classList.add('tappable');
      row.addEventListener('click', (e) => {
        if (e.target !== t) t.click();
      });
    });
    this.root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) =>
      inp.addEventListener('input', () => {
        (s as unknown as Record<string, number>)[inp.dataset.k!] = Number(inp.value);
        this.a.settingsChanged(s);
      }),
    );
  }

  /** Power-up reference (HUD "?" button and title "How to play"). */
  powerups(back: () => void, backLabel = 'Back to game') {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const row = (p: number, color: number, name: string, text: string) =>
      `<div class="pw-row"><img src="${powerIconUrl(p as 1, color)}" alt=""><div><b>${name}</b><span>${text}</span></div></div>`;
    this.show(
      'powerups',
      `<div class="panel powers-sheet"><h2>Power-ups</h2>
        <p class="sub">Marbles with a white ring carry a power. Pop one <b>as part of a match</b> to trigger it. They blink, then fade after ${TUNING.powerLife}s.</p>
        ${row(1, 0, 'Bomb', 'Blasts every marble within ~3 marbles of it — even across tracks.')}
        ${row(2, 3, 'Slow', `The chain crawls at ¼ speed for ${TUNING.slowTime}s.`)}
        ${row(3, 1, 'Reverse', `The chain rolls backwards, away from the skull, for ${TUNING.reverseTime}s.`)}
        ${row(4, 4, 'Laser', `A full aiming beam plus faster, double-rate shots for ${TUNING.aimTime}s.`)}
        <div class="tips">
          <b>Combos:</b> when a gap's two ends match, they snap together and pop again.<br>
          <b>Gap shot:</b> shoot through a gap in the chain for bonus points.<br>
          <b>Chain bonus:</b> 5+ popping shots in a row.<br>
          ${coarse ? '<b>Cancel a shot:</b> slide onto <b>✕</b> (or back onto your character), or touch with a second finger.' : '<b>Swap:</b> right-click or Space.'}
        </div>
        <div class="btns" style="margin:14px auto 0"><button class="btn primary" data-a="back">${backLabel}</button></div></div>`,
      { back },
    );
  }

  help(back: () => void) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.show(
      'help',
      `<div class="panel help"><h2>How to play</h2>
        <p>Marbles roll toward the <b>skull</b>. Shoot marbles into the chain — <b>3 or more</b> of a colour pop.</p>
        <p>${coarse ? '<b>Drag</b> to aim, <b>release</b> to shoot. Changed your mind? Slide onto <b>✕</b> or back to the frog, or touch with a second finger. Tap your character (the launcher) or the swap button to swap.' : '<b>Move</b> to aim, <b>click</b> to shoot. <b>Right-click</b> or <b>Space</b> swaps marbles.'}</p>
        <p>When a gap opens and both sides match, they <b>snap together</b> for a combo. Fill the gold <b>ZUMA bar</b> to stop new marbles, then clear the rest.</p>
        <div class="pw"><span>Bomb</span><span>blasts nearby marbles</span><span>Slow</span><span>slows the chain</span><span>Reverse</span><span>rolls the chain back</span><span>Laser</span><span>precise aim & rapid fire</span></div>
        <p style="color:var(--muted);font-size:13px">Pop a power-up marble as part of a match to trigger it. Keep the chain far from the skull for more stars.</p>
        <div class="btns" style="margin:12px auto 0"><button class="btn primary" data-a="back">Got it</button><button class="btn ghost" data-a="pw">Power-ups in detail →</button></div></div>`,
      { back, pw: () => this.powerups(() => this.help(back), 'Back') },
    );
  }

  toast(msg: string, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout((t as unknown as { _h: number })._h);
    (t as unknown as { _h: number })._h = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------ HUD

  private lastScore = -1;
  private lastPowers = '';
  updateHud(st: GameState, level: Level, run: EndlessRun | null = null) {
    $('hud-level').textContent = `${run ? 'Stage' : 'Level'} ${level.index + 1}`;
    $('hud-name').textContent = level.boss === 'boss' ? `BOSS · ${level.name}` : level.boss === 'mini' ? `MINI-BOSS · ${level.name}` : level.name;
    const score = st.score + (run?.runScore ?? 0);
    const pr = progress(st, level);
    $('hud-bar').style.transform = `scaleX(${pr.bar})`;
    const bar = $('hud-bar').parentElement!;
    bar.classList.toggle('full', st.barFull);
    $('hud-bar-label').textContent = st.barFull ? 'CLEAR!' : 'ZUMA';
    if (score !== this.lastScore) {
      const el = $('hud-score');
      el.textContent = score.toLocaleString();
      if (this.lastScore >= 0 && score > this.lastScore) {
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      }
      this.lastScore = score;
    }
    $('hud-streak').textContent = st.streak >= 3 ? `chain ×${st.streak}` : '';
    $('swap-cur').setAttribute('style', marbleCss(st.gun.cur));
    $('swap-next').setAttribute('style', marbleCss(st.gun.next));
    const pw: [Power, number, number][] = [];
    if (st.slowT > 0) pw.push([2, st.slowT, 8]);
    if (st.revT > 0) pw.push([3, st.revT, 3]);
    if (st.aimT > 0) pw.push([4, st.aimT, 16]);
    const key = pw.map((p) => `${p[0]}:${Math.ceil(p[1] * 4)}`).join(',');
    if (key !== this.lastPowers) {
      this.lastPowers = key;
      $('hud-powers').innerHTML = pw
        .map(([p, t, max]) => {
          const c = 2 * Math.PI * 22;
          return `<div class="power"><svg class="ring" viewBox="0 0 50 50"><circle cx="25" cy="25" r="22" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="4"/><circle cx="25" cy="25" r="22" fill="none" stroke="#36e0b0" stroke-width="4" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - t / max)}" stroke-linecap="round"/></svg><span class="lbl">${POWER_NAMES[p]}</span></div>`;
        })
        .join('');
    }
  }

  resetHud() {
    this.lastScore = -1;
    this.lastPowers = '';
  }
}

/** Marble in a thumbnail's mouth (golden). */
function thumbMarble(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const p = PALETTE[1];
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  gr.addColorStop(0, p.light);
  gr.addColorStop(0.5, p.base);
  gr.addColorStop(1, p.dark);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

const AIM_LABELS = { drag: 'Drag & release', aimtap: 'Aim + tap', tap: 'Tap' } as const;
const AIM_HINTS = {
  drag: 'Drag to aim, lift to shoot · press and hold to keep shooting',
  aimtap: 'Drag to aim, tap to shoot (hold to keep shooting) — iPhone vibrates on every shot',
  tap: 'Tap where you want to shoot · hold and slide to keep shooting',
} as const;

interface LevelMeta {
  name: string;
  boss: BossKind;
  mutators: Mutator[];
  twin: boolean;
}
const metaCache = new Map<string, LevelMeta>();
export function levelMeta(seed: string, i: number): LevelMeta {
  const k = `${seed}#${i}`;
  let m = metaCache.get(k);
  if (!m) {
    const l = generateLevel(seed, i);
    m = { name: l.name, boss: l.boss, mutators: l.mutators, twin: l.tracks.length > 1 };
    metaCache.set(k, m);
  }
  return m;
}

const MUTATOR_ICON: Record<Mutator, string> = { surge: '⚡', streaky: '🌈' };
function badges(m: LevelMeta): string {
  const b: string[] = [];
  if (m.boss === 'boss') b.push('<span class="bd boss" title="Boss">BOSS</span>');
  else if (m.boss === 'mini') b.push('<span class="bd mini" title="Mini-boss">MINI</span>');
  if (m.twin) b.push('<span class="bd" title="Two chains">2×</span>');
  for (const x of m.mutators) b.push(`<span class="bd" title="${MUTATOR_INFO[x].name}: ${MUTATOR_INFO[x].desc}">${MUTATOR_ICON[x]}</span>`);
  return b.length ? `<span class="bds">${b.join('')}</span>` : '';
}
