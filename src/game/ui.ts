// DOM screens (menus, results, settings) and the HUD. Kept separate from the
// canvas so text is crisp, accessible and laid out by CSS on every screen size.

import { type BossKind, generateLevel, INTRO, isLargeCampaign, type Mutator, MUTATOR_INFO } from '../sim/levelgen';
import { POWER_NAMES, type GameState, progress, type Power, WILD } from '../sim/game';
import type { Level } from '../sim/levelgen';
import { PALETTE, powerIconUrl } from './render';
import { CHARACTERS, characterThumb, type CharacterId } from './characters';
import { TICK_HZ, TUNING } from '../sim/game';
import { dailySeed, type EndlessRun, levelCode, type SaveData, type Settings, type StageSummary, type TraderVisit } from './save';
import { ITEMS, type ItemId, STARTER_ITEMS } from '../sim/items';
import { activeItems, BOOST_SLOTS, bossStageFor, CHARM_SLOTS, type Fail, priceAt, RESERVE_COST, rerollCost, type RunEco } from '../sim/economy';
import { type MetaProgress, UNLOCKS } from '../sim/achievements';

/** What the shop screen needs from the game: current state and the player's actions. */
export interface ShopApi {
  eco: RunEco;
  stage: number;
  offers(): { charms: ItemId[]; boosts: ItemId[]; reserved: ItemId | null };
  buy(id: ItemId, replace?: number): Fail | null;
  sell(index: number): void;
  reroll(): Fail | null;
  reserve(id: ItemId): Fail | null;
  done(): void;
}

/** The trader after a serpent: one free boost plus a small shop, on one screen. */
export interface TraderApi {
  eco: RunEco;
  stage: number;
  visit: TraderVisit;
  /** Take the free boost (replace = live boost to give up when full). */
  take(id: ItemId, replace?: number): Fail | null;
  buy(id: ItemId, replace?: number): Fail | null;
  done(): void;
}

const PALETTE_NAMES = ['Red', 'Yellow', 'Green', 'Blue', 'Purple', 'White'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface UiActions {
  play(index: number): void;
  continueSnapshot(): void;
  resume(): void;
  restart(): void;
  endless(daily: boolean): void;
  continueEndless(): void;
  collection(): void;
  quit(): void;
  showLevels(): void;
  next(): void;
  settingsChanged(s: Settings): void;
  resetProgress(): void;
  newCampaign(seed: string): void;
  setLargeMarbles(large: boolean): void;
  playCode(code: string): void;
  /** Unlock every level up to `index` (0-based) without clearing them; optionally play it. */
  unlockTo(index: number, play: boolean): void;
  install(): void;
  click(): void;
}

const BOMB = -2;
const marbleCss = (c: number) => {
  if (c === BOMB) return 'background: radial-gradient(circle at 35% 30%, #8a8a96, #1b1b22 50%, #000);';
  if (c === WILD) return 'background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.9), transparent 45%), conic-gradient(#ff3b5c, #ffbe1f, #22df8c, #1cb0ff, #9a3cff, #ff3b5c);';
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
    // Re-rendering the same screen (shop after a purchase, etc.) shouldn't replay the pop-in.
    const again = this.current === name;
    this.current = name;
    this.handlers = handlers;
    this.root.innerHTML = `<div class="screen ${cls}${again ? ' again' : ''}" data-screen="${name}">${html}</div>`;
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
    const marbles = PALETTE.slice(0, 6).map((_, i) => `<span style="${marbleCss(i)};animation-delay:${i * 0.12}s"></span>`).join('');
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
    cards.push(`<button class="lv locked" data-a="unlock" aria-label="Unlock level ${count + 1}"><b>🔒</b><small>Level ${count + 1}</small><span class="st unlock-hint">tap to unlock</span></button>`);
    this.show(
      'levels',
      `<div class="levels-head"><button class="icon-btn" data-a="back" aria-label="Back">←</button><h2>Levels</h2>
        <span class="chip star">★ ${stars} / ${save.unlocked * 3 || 0}</span></div>
      <div class="size-row"><span>Marble size</span><div class="seg">
        <button data-a="size" data-v="0" class="${large ? '' : 'on'}">Normal</button>
        <button data-a="size" data-v="1" class="${large ? 'on' : ''}">Large</button></div>
        <small>${large ? 'Bigger marbles on a smaller board — easier to see and hit on phones.' : 'Large: 50% bigger marbles. It has its own levels & progress.'}</small>
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
        unlock: () => this.unlock(save),
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

  /** Skip ahead: unlock levels without clearing them. */
  unlock(save: SaveData) {
    const n = save.unlocked + 1; // 0-based index of the first locked level
    this.show(
      'unlock',
      `<div class="panel"><h2>Unlock levels</h2>
        <p class="sub">Skip ahead without clearing levels. Skipped levels keep 0 stars, and you can go back and play them any time.</p>
        <div class="btns" style="margin:0 auto">
          <button class="btn primary" data-a="one">Unlock & play level ${n + 1}</button>
          <div class="row"><button class="btn" data-a="five">Unlock next 5</button><button class="btn" data-a="ten">Unlock next 10</button></div>
          <button class="btn ghost" data-a="back">Cancel</button>
        </div></div>`,
      {
        one: () => this.a.unlockTo(n, true),
        five: () => this.a.unlockTo(n + 4, false),
        ten: () => this.a.unlockTo(n + 9, false),
        back: () => this.levels(save),
      },
    );
  }

  endless(save: SaveData) {
    const run = save.endless;
    const today = dailySeed().slice(6);
    const daily = save.dailyBest?.day === today ? save.dailyBest : undefined;
    const fmt = (b?: { score: number; stage: number }) => (b ? `best ${b.score.toLocaleString()} · stage ${b.stage}` : 'no run yet');
    this.show(
      'endless',
      `<div class="panel"><h2>Endless</h2>
        <p class="sub">Stages roll straight into each other — one life, the score carries over. Pop marbles to earn 🪙 coins. Beat the serpent (every 5 stages) for a free boost and a small trader, and the boss (every 10) for a free charm and the full shop.</p>
        <div class="btns" style="margin:0 auto">
          ${run ? `<button class="btn gold" data-a="cont">Continue run<small>${run.daily ? 'Daily' : 'Random'} · stage ${run.stage + 1} · ${run.runScore.toLocaleString()} pts</small></button>` : ''}
          <button class="btn primary" data-a="random">Random run<small>${fmt(save.endlessBest)}</small></button>
          <button class="btn" data-a="daily">Daily run<small>Same stages for everyone today · ${fmt(daily)}</small></button>
          <button class="btn" data-a="collection">Collection &amp; goals<small>${save.meta?.unlocked.length ?? STARTER_ITEMS.length} of ${Object.keys(ITEMS).length} items · ${UNLOCKS.filter((u) => save.meta?.unlocked.includes(u.id)).length} of ${UNLOCKS.length} goals</small></button>
          <button class="btn ghost" data-a="back">Back</button>
        </div>
        ${run ? '<p class="sub" style="font-size:12px;margin-top:10px">Starting a new run ends the one in progress.</p>' : ''}</div>`,
      {
        collection: () => this.a.collection(),
        cont: () => this.a.continueEndless(),
        random: () => this.a.endless(false),
        daily: () => this.a.endless(true),
        back: () => this.title(save),
      },
    );
  }

  /**
   * Endless, between stages: what you just did, the run so far, and what's next. A natural
   * place to take a break — Menu saves the run and Continue comes back here.
   */
  stageClear(o: {
    last: StageSummary;
    runScore: number;
    coins: number;
    daily: boolean;
    next: { stage: number; name: string; meta: LevelMeta; ace: number };
    items: ItemId[];
    onNext: () => void;
    onMenu: () => void;
  }) {
    const l = o.last;
    const src: [string, string][] = [
      ['pops', 'pops'],
      ['combos', 'combos'],
      ['floating', 'coins shot'],
      ['gems', 'gems'],
      ['ace', 'ace time'],
      ['clean', 'clean clear'],
      ['boss', 'boss'],
    ];
    const by = src.filter(([k]) => (l.coinsBy[k] ?? 0) > 0).map(([k, name]) => `<span>${name} +${l.coinsBy[k]}</span>`).join('');
    const n = o.next;
    const kind = n.meta.boss === 'boss' ? '<b class="warn">Boss fight</b>' : n.meta.boss === 'mini' ? '<b class="warn">Mini-boss: the serpent</b>' : '';
    const notes = [kind, n.meta.twin ? 'two chains' : '', ...n.meta.mutators.map((m) => `<b>${MUTATOR_INFO[m].name}</b>: ${MUTATOR_INFO[m].desc}`), `ace time ${mm2(n.ace)}`].filter(Boolean);
    this.show(
      'stage-clear',
      `<div class="panel solid stage-clear">
        <h2>Stage ${l.stage + 1} clear!</h2>
        <p class="sub">${o.daily ? 'Daily run' : 'Endless run'}</p>
        <div class="sc-row">
          <div><small>Stage score</small><b>${l.score.toLocaleString()}</b></div>
          <div><small>Run score</small><b>${o.runScore.toLocaleString()}</b></div>
          <div><small>Coins</small><b>🪙 ${o.coins.toLocaleString()}</b></div>
        </div>
        <p class="sc-coins">+${l.coins.toLocaleString()} coins this stage${by ? `<span class="sc-by">${by}</span>` : ''}</p>
        <p class="sc-time">${mm2(l.seconds)}${l.ace ? ' · <b class="ace">Ace time!</b>' : ''}</p>
        <div class="sc-next">
          <small>Up next</small>
          <b>Stage ${n.stage + 1} · ${n.name} ${badges(n.meta)}</b>
          <span>${notes.join(' · ')}</span>
          ${o.items.length ? `<span class="sc-items">${o.items.map((id) => `<span title="${ITEMS[id].name}: ${ITEMS[id].desc}">${ITEMS[id].icon}</span>`).join('')}</span>` : ''}
        </div>
        <div class="btns" style="margin:0 auto">
          <button class="btn primary" data-a="next">Next stage ▶</button>
          <button class="btn ghost" data-a="menu">Take a break · Menu</button>
        </div>
      </div>`,
      { next: () => o.onNext(), menu: () => o.onMenu() },
    );
    (this.root.querySelector('[data-a=next]') as HTMLElement | null)?.focus();
  }

  /** Endless: a stage was lost. Retry it for half your coins, or end the run. */
  retry(o: { stage: number; coins: number; cost: number; can: boolean; onRetry: () => void; onEnd: () => void }) {
    this.show(
      'retry',
      `<div class="panel solid">
        <h2>Swallowed!</h2>
        <p class="sub">Stage ${o.stage} lost. You have 🪙 ${o.coins.toLocaleString()}.</p>
        ${
          o.can
            ? `<p class="sub">Retry this stage for <b>half your coins</b>. You keep your charms and boosts.</p>`
            : `<p class="sub">A retry costs half your coins, and at least 🪙 ${o.cost.toLocaleString()}. Not enough this time.</p>`
        }
        <div class="btns" style="margin:0 auto">
          <button class="btn primary" data-a="retry" ${o.can ? '' : 'disabled'}>Retry stage ${o.stage} · 🪙 ${o.cost.toLocaleString()}</button>
          <button class="btn" data-a="end">End run</button>
        </div>
      </div>`,
      { retry: () => o.can && o.onRetry(), end: () => o.onEnd() },
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
      level.boss === 'boss' ? '<b>Boss fight</b>' : level.boss === 'mini' ? '<b>Mini-boss</b>: the skull serpent' : '',
      `ace time ${mm2(level.ace)}`,
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
        ${run ? '' : `<button class="btn ghost" data-a="skip">Skip to level ${level.index + 2} →</button>`}
      </div></div>`,
      {
        skip: () => this.a.unlockTo(level.index + 1, true),
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
        <h2>${won ? (level.bossFight?.kind === 'serpent' ? 'Serpent slain!' : level.bossFight ? 'Boss defeated!' : 'Level clear!') : 'Swallowed!'}</h2>
        <p class="sub">Level ${level.index + 1} · ${level.name}</p>
        ${won ? `<div class="stars">${starHtml}</div>` : ''}
        ${!won && tip ? `<div class="tip">💡 ${tip}</div>` : ''}
        <div class="big-score" id="res-score">0</div>
        ${won && st.bonus ? `<div class="bonus-rows"><div>Track bonus <b>+${st.bonus.sweep.toLocaleString()}</b></div><div class="${st.bonus.ace ? 'ace' : 'miss'}">${st.bonus.ace ? `Ace time! <b>+${st.bonus.ace.toLocaleString()}</b>` : `Ace time ${mm2(level.ace)} <b>missed</b>`}</div>${s.coins ? `<div>Coins <b>${s.coins} × ${TUNING.coinValue}</b></div>` : ''}</div>` : ''}
        <div class="stats">
          <div>Time <b>${mm}</b></div><div>Best <b>${best.toLocaleString()}</b></div>
          <div>Max combo <b>×${s.maxCombo + 1}</b></div><div>Best chain <b>${s.maxStreak}</b></div>
          <div>Gap shots <b>${s.gapShots}</b></div><div>Accuracy <b>${s.shots ? Math.round(((s.shots - s.misses) / s.shots) * 100) : 0}%</b></div>
          ${level.bossFight ? `<div>Direct hits <b>${s.bossHits}</b></div><div>Boss health <b>${st.boss?.hp ?? 0}/${st.boss?.max ?? 0}</b></div>` : ''}
          <div>Power-ups <b>${s.powers}</b></div><div>Nearest the skull <b>${Math.min(100, Math.round(peak * 100))}%</b></div>
        </div>
        <div class="btns" style="margin:0 auto">
          ${won ? '<button class="btn primary" data-a="next">Next level</button>' : '<button class="btn primary" data-a="restart">Try again</button>'}
          <div class="row"><button class="btn" data-a="${won ? 'restart' : 'quit'}">${won ? 'Replay' : 'Menu'}</button><button class="btn" data-a="levels">Levels</button></div>
          ${won ? '' : `<button class="btn ghost" data-a="skip">Skip to level ${level.index + 2} →</button>`}
        </div>
      </div>`,
      {
        skip: () => this.a.unlockTo(level.index + 1, true),
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
            ? `<div class="setting col"><label>Touch aiming<small id="aim-hint">${AIM_HINTS[s.touchAim]}</small></label><div class="seg seg3">${(['drag', 'aimtap', 'tap', 'pad'] as const).map((m) => `<button data-a="aim" data-v="${m}" class="${s.touchAim === m ? 'on' : ''}">${AIM_LABELS[m]}</button>`).join('')}</div></div>`
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
          s.touchAim = el.dataset.v as 'drag' | 'aimtap' | 'tap' | 'pad';
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
        ${row(4, 4, 'Lightning', 'Strikes every marble of its colour on the board — on every track.')}
        ${row(5, 2, 'Wild', 'Your next marble turns rainbow: it takes the colour of whichever neighbour makes the longer run.')}
        ${row(6, 0, 'Scorpion', `A scorpion runs back from the skull and eats the ${TUNING.scorpionEats} marbles closest to it.`)}
        ${row(7, 2, 'Colour Cloud', '<i>From level ' + (INTRO.colorCloud + 1) + '.</i> The 4 marbles on each side take its colour, so the gap snaps shut into a big combo.')}
        ${row(8, 4, 'Black Hole', `<i>From level ${INTRO.blackHole + 1}.</i> A vortex opens in the chain and swallows up to ${TUNING.holeEats} marbles around it, one by one.`)}
        ${row(9, 0, 'Magnet', `<i>From level ${INTRO.magnet + 1}.</i> For ${TUNING.magnetTime}s your shots curve toward the nearest marble of their colour.`)}
        <h3 style="margin-top:14px">Special marbles</h3>
        <div class="tips">
          <b>💎 Gem</b> (from level ${INTRO.gem + 1}): pop it for +${TUNING.gemScore} points.<br>
          <b>🛡️ Armored</b> (from level ${INTRO.armor + 1}): takes two matches — the first only cracks the steel band.<br>
          <b>🦎 Chameleon</b> (from level ${INTRO.chameleon + 1}): a rainbow ring means it changes colour every ${TUNING.chameleonEvery}s.
        </div>
        <div class="tips">
          <b>Combos:</b> when a gap's two ends match, they snap together and pop again.<br>
          <b>Gap shot:</b> shoot through a gap in the chain for bonus points.<br>
          <b>Chain bonus:</b> 5+ popping shots in a row.<br>
          <b>Bonus coins:</b> shoot a floating coin before it vanishes for +${TUNING.coinValue}.<br>
          <b>Level end:</b> a light runs down the empty track — points for every bit the chain never reached, plus <b>+${TUNING.aceBonus}</b> for beating the ace time.<br>
          <b>Boss fights</b> (every 10th level): your character slides along a rail and shoots straight across${coarse ? ' — <b>drag anywhere</b> to slide, press the <b>FIRE</b> button to shoot (hold it to keep firing), tap your character to swap' : ''}. Every marble you pop hurts the boss; a shot through a gap that hits it does ${TUNING.bossDirectHit}. Watch the hands: the target follows you while one winds up, then locks — step out before the rock lands.<br>
          <b>Mini-bosses</b> (levels 5, 15, 25…): a serpent lives in the skull pit and spits marbles onto the front of the chain. Popped marbles hurt it. Shots into its mouth get swallowed and spat back, unless you hit the target ring while it rears up to spit. That chokes it: big damage and 1-2 power-ups along the chain. Slay it to clear the level.<br>
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
        <div class="pw"><span>Bomb</span><span>blasts nearby marbles</span><span>Slow</span><span>slows the chain</span><span>Reverse</span><span>rolls the chain back</span><span>Lightning</span><span>pops every marble of its colour</span><span>Wild</span><span>next shot matches anything</span><span>Scorpion</span><span>eats the 10 front marbles</span><span>Colour Cloud</span><span>sets up a big combo</span><span>Black Hole</span><span>swallows nearby marbles</span><span>Magnet</span><span>shots curve to their colour</span></div>
        <p style="font-size:14px">Shoot <b>gold coins</b> for bonus points. Every 10th level is a <b>boss fight</b>: slide along your rail, pop marbles to hurt the boss, dodge its rocks.</p>
        <p style="color:var(--muted);font-size:13px">Pop a power-up marble as part of a match to trigger it. Keep the chain far from the skull for more stars.</p>
        <div class="btns" style="margin:12px auto 0"><button class="btn primary" data-a="back">Got it</button><button class="btn ghost" data-a="pw">Power-ups in detail →</button></div></div>`,
      { back, pw: () => this.powerups(() => this.help(back), 'Back') },
    );
  }

  /** An item as a compact card. `price` 0 = free. */
  private card(id: ItemId, o: { price?: number; action?: string; disabled?: boolean; hold?: string; luckyColor?: number; picked?: boolean } = {}) {
    const d = ITEMS[id];
    const desc = id === 'luckyColor' && o.luckyColor !== undefined ? `${PALETTE_NAMES[o.luckyColor]} pays triple coins` : d.desc;
    const price = o.price === undefined ? '' : o.price === 0 ? '<span class="price free">FREE</span>' : `<span class="price">🪙 ${o.price.toLocaleString()}</span>`;
    return `<div class="item-card ${d.kind} ${o.disabled ? 'off' : ''} ${o.picked ? 'picked' : ''}">
      <button class="item-main" ${o.action && !o.disabled ? `data-a="${o.action}" data-id="${id}"` : 'disabled'}>
        <span class="item-ico">${d.icon}</span><b>${d.name}</b><span class="item-desc">${desc}</span>${price}
      </button>${o.picked ? '<span class="tag got">✓ picked</span>' : (o.hold ?? '')}</div>`;
  }

  /** Owned charms and live boosts as one compact strip of 6 slots. */
  private owned(eco: RunEco, stage: number, mode: 'view' | 'sell' | 'replace-charm' | 'replace-boost') {
    const live = eco.boosts.filter((b) => b.until > stage);
    const slot = (kind: string, inner: string, title = '') => `<span class="slot ${kind}" title="${title}">${inner}</span>`;
    const charms = Array.from({ length: CHARM_SLOTS }, (_, i) => {
      const c = eco.charms[i];
      if (!c) return slot('charm empty', 'empty charm');
      const d = ITEMS[c.id];
      const act =
        mode === 'sell' ? `<button class="mini-btn" data-a="sell" data-i="${i}">sell +${Math.floor(c.paid / 2)}</button>` : mode === 'replace-charm' ? `<button class="mini-btn warn" data-a="replace" data-i="${i}">replace</button>` : '';
      return slot('charm', `<span class="slot-name">${d.icon} ${d.name}</span>${act}`, d.desc);
    }).join('');
    const boosts = Array.from({ length: BOOST_SLOTS }, (_, i) => {
      const b = live[i];
      if (!b) return slot('boost empty', 'empty boost');
      const d = ITEMS[b.id];
      const act = mode === 'replace-boost' ? `<button class="mini-btn warn" data-a="replace" data-i="${i}">replace</button>` : `<small>→ stage ${b.until + 1}</small>`;
      return slot('boost', `<span class="slot-name">${d.icon} ${d.name}</span>${act}`, d.desc);
    }).join('');
    return `<div class="owned"><div class="owned-col"><h3>Your charms</h3>${charms}</div><div class="owned-col"><h3>Your boosts</h3>${boosts}</div></div>`;
  }

  /**
   * A free pick: tap a card to choose it (tap another to change your mind), then confirm, or skip.
   * A full row asks which item to replace.
   */
  pick(o: { title: string; sub: string; eco: RunEco; stage: number; ids: ItemId[]; onPick: (id: ItemId | null, replace?: number) => void }) {
    let picked: ItemId | null = null;
    const render = (choosing: ItemId | null) => {
      const kind = choosing ? ITEMS[choosing].kind : null;
      const html = choosing
        ? `<div class="panel wide fit"><h2>No room</h2><p class="sub">Your ${kind}s are full. Pick one to replace with <b>${ITEMS[choosing].icon} ${ITEMS[choosing].name}</b>${kind === 'charm' ? ' (a bought charm sells for half)' : ''}.</p>
            ${this.owned(o.eco, o.stage, kind === 'charm' ? 'replace-charm' : 'replace-boost')}
            <div class="fit-actions"><button class="btn ghost" data-a="cancel">Back</button></div></div>`
        : `<div class="panel wide fit"><h2>${o.title}</h2><p class="sub">${o.sub}</p>
            <div class="cards">${o.ids.map((id) => this.card(id, { price: 0, action: 'take', luckyColor: o.eco.luckyColor, picked: id === picked })).join('')}</div>
            ${this.owned(o.eco, o.stage, 'view')}
            <div class="fit-actions row"><button class="btn ghost" data-a="skip">Skip</button>${picked ? `<button class="btn primary" data-a="confirm">Take ${ITEMS[picked].icon} ${ITEMS[picked].name} ▶</button>` : ''}</div></div>`;
      this.show('pick', html, {
        take: (el) => {
          const id = el.dataset.id as ItemId;
          picked = picked === id ? null : id;
          render(null);
        },
        confirm: () => {
          const id = picked!;
          const full = ITEMS[id].kind === 'charm' ? o.eco.charms.length >= CHARM_SLOTS : o.eco.boosts.filter((b) => b.until > o.stage).length >= BOOST_SLOTS;
          if (full) render(id);
          else o.onPick(id);
        },
        replace: (el) => o.onPick(choosing, Number(el.dataset.i)),
        cancel: () => render(null),
        skip: () => o.onPick(null),
      }, 'fit-screen');
    };
    render(null);
  }

  /** The shop after a boss, laid out to fit one screen. Re-renders after every action. */
  shop(api: ShopApi) {
    let replacing: ItemId | null = null;
    let msg = '';
    const fail = (f: Fail | null) => (f === 'coins' ? 'Not enough coins.' : f === 'slots' ? 'No free slot.' : f === 'owned' ? 'You already have that.' : '');
    const render = () => {
      const eco = api.eco;
      const offers = api.offers();
      const next = api.stage + 1;
      const boss = bossStageFor(next);
      const liveBoosts = eco.boosts.filter((b) => b.until > api.stage).length;
      const charmCard = (id: ItemId, reserved = false) => {
        const price = priceAt(id, api.stage);
        const hold = reserved ? '<span class="tag">held for you</span>' : eco.reserved ? '' : `<button class="mini-btn hold" data-a="hold" data-id="${id}" ${eco.coins < RESERVE_COST ? 'disabled' : ''}>hold · 🪙${RESERVE_COST}</button>`;
        const refund = eco.charms.length >= CHARM_SLOTS ? Math.max(...eco.charms.map((c) => Math.floor(c.paid / 2))) : 0;
        return this.card(id, { price, action: 'buy', disabled: eco.coins + refund < price, hold, luckyColor: eco.luckyColor });
      };
      const charms = [...(offers.reserved ? [charmCard(offers.reserved, true)] : []), ...offers.charms.map((id) => charmCard(id))];
      const boosts = offers.boosts.map((id) => this.card(id, { price: priceAt(id, api.stage), action: 'buy', disabled: eco.coins < priceAt(id, api.stage) || liveBoosts >= BOOST_SLOTS }));
      const html = replacing
        ? `<div class="panel wide fit"><h2>Replace a charm</h2><p class="sub">Your charms are full. Pick one to give up for <b>${ITEMS[replacing].icon} ${ITEMS[replacing].name}</b>. It sells for half of what you paid.</p>
            ${this.owned(eco, api.stage, 'replace-charm')}
            <div class="fit-actions"><button class="btn ghost" data-a="cancel">Back to shop</button></div></div>`
        : `<div class="panel wide fit shop">
            <div class="shop-head"><h2>Shop</h2><span class="coins-big">🪙 ${eco.coins.toLocaleString()}</span></div>
            <p class="sub">Next world: stages ${next + 1}–${boss + 1}. Boosts last until its boss is beaten.</p>
            ${msg ? `<p class="shop-msg">${msg}</p>` : ''}
            <div class="shop-body">
              <div class="shop-offers">
                <h3>Charms <small>kept</small></h3>
                <div class="cards">${charms.join('') || '<p class="sub">Nothing left to offer.</p>'}</div>
                <h3>Boosts <small>next world only</small></h3>
                <div class="cards">${boosts.join('') || '<p class="sub">Nothing left to offer.</p>'}</div>
              </div>
              <div class="shop-side">
                ${this.owned(eco, api.stage, 'sell')}
                <div class="fit-actions row"><button class="btn" data-a="reroll" ${eco.coins < rerollCost(eco) ? 'disabled' : ''}>New offers · 🪙${rerollCost(eco)}</button><button class="btn primary" data-a="go">Continue ▶</button></div>
              </div>
            </div>
          </div>`;
      this.show(
        'shop',
        html,
        {
          buy: (el) => {
            const id = el.dataset.id as ItemId;
            if (ITEMS[id].kind === 'charm' && eco.charms.length >= CHARM_SLOTS) {
              replacing = id;
              return render();
            }
            msg = fail(api.buy(id));
            render();
          },
          replace: (el) => {
            msg = fail(api.buy(replacing!, Number(el.dataset.i)));
            replacing = null;
            render();
          },
          cancel: () => {
            replacing = null;
            render();
          },
          sell: (el) => {
            api.sell(Number(el.dataset.i));
            msg = '';
            render();
          },
          hold: (el) => {
            msg = fail(api.reserve(el.dataset.id as ItemId));
            render();
          },
          reroll: () => {
            msg = fail(api.reroll());
            render();
          },
          go: () => api.done(),
        },
        'fit-screen',
      );
    };
    render();
  }

  /**
   * After a serpent: take one free boost and shop a small trader (2 boosts + 1 charm, shop
   * prices, no rerolls) on a single screen. Re-renders after every action.
   */
  trader(api: TraderApi) {
    let replacing: { id: ItemId; free: boolean } | null = null;
    // The free boost is only chosen here; it is taken when you press Continue, so you can change your mind.
    let picked: ItemId | null = null;
    let msg = '';
    const fail = (f: Fail | null) => (f === 'coins' ? 'Not enough coins.' : f === 'slots' ? 'No free slot.' : f === 'owned' ? 'You already have that.' : '');
    const render = () => {
      const { eco, visit } = api;
      const boss = bossStageFor(api.stage + 1);
      const liveBoosts = eco.boosts.filter((b) => b.until > api.stage).length;
      const freeCards = visit.free
        .map((id) => {
          if (visit.took) return this.card(id, { price: 0, disabled: true, hold: id === visit.took ? '<span class="tag got">✓ yours</span>' : '' });
          return this.card(id, { price: 0, action: 'take', luckyColor: eco.luckyColor, picked: id === picked });
        })
        .join('');
      const buyCards = visit.buy
        .map((id) => {
          if (visit.bought.includes(id)) return this.card(id, { disabled: true, hold: '<span class="tag got">✓ bought</span>' });
          const price = priceAt(id, api.stage);
          const charm = ITEMS[id].kind === 'charm';
          const refund = charm && eco.charms.length >= CHARM_SLOTS ? Math.max(...eco.charms.map((c) => Math.floor(c.paid / 2))) : 0;
          const off = charm ? eco.coins + refund < price : eco.coins < price || liveBoosts >= BOOST_SLOTS;
          return this.card(id, { price, action: 'buy', disabled: off, luckyColor: eco.luckyColor });
        })
        .join('');
      const html = replacing
        ? `<div class="panel wide fit"><h2>No room</h2><p class="sub">Your ${ITEMS[replacing.id].kind}s are full. Pick one to replace with <b>${ITEMS[replacing.id].icon} ${ITEMS[replacing.id].name}</b>${ITEMS[replacing.id].kind === 'charm' ? ' (a bought charm sells for half)' : ''}.</p>
            ${this.owned(eco, api.stage, ITEMS[replacing.id].kind === 'charm' ? 'replace-charm' : 'replace-boost')}
            <div class="fit-actions"><button class="btn ghost" data-a="cancel">Back</button></div></div>`
        : `<div class="panel wide fit shop trader">
            <div class="shop-head"><h2>Serpent slain!</h2><span class="coins-big">🪙 ${eco.coins.toLocaleString()}</span></div>
            <p class="sub">Take a free boost and see what the trader has. Boosts last until this world's boss (stage ${boss + 1}).</p>
            ${msg ? `<p class="shop-msg">${msg}</p>` : ''}
            <div class="shop-body">
              <div class="shop-offers">
                <h3>Free boost <small>${visit.took ? 'taken' : picked ? 'yours when you continue' : 'pick one'}</small></h3>
                <div class="cards">${freeCards || '<p class="sub">Nothing left to offer.</p>'}</div>
                <h3>Trader <small>a taste of the shop</small></h3>
                <div class="cards">${buyCards || '<p class="sub">Nothing left to offer.</p>'}</div>
              </div>
              <div class="shop-side">
                ${this.owned(eco, api.stage, 'view')}
                <div class="fit-actions row"><button class="btn primary" data-a="go">${visit.took || !visit.free.length ? 'Continue ▶' : picked ? `Take ${ITEMS[picked].icon} ${ITEMS[picked].name} ▶` : 'Continue without a boost ▶'}</button></div>
              </div>
            </div>
          </div>`;
      this.show(
        'trader',
        html,
        {
          take: (el) => {
            const id = el.dataset.id as ItemId;
            picked = picked === id ? null : id;
            msg = '';
            render();
          },
          buy: (el) => {
            const id = el.dataset.id as ItemId;
            if (ITEMS[id].kind === 'charm' && eco.charms.length >= CHARM_SLOTS) {
              replacing = { id, free: false };
              return render();
            }
            msg = fail(api.buy(id));
            render();
          },
          replace: (el) => {
            const r = replacing!;
            msg = fail(r.free ? api.take(r.id, Number(el.dataset.i)) : api.buy(r.id, Number(el.dataset.i)));
            replacing = null;
            if (r.free && !msg) return api.done();
            render();
          },
          cancel: () => {
            replacing = null;
            render();
          },
          go: () => {
            if (picked && !visit.took) {
              if (liveBoosts >= BOOST_SLOTS) {
                replacing = { id: picked, free: true };
                return render();
              }
              msg = fail(api.take(picked));
              if (msg) return render();
            }
            api.done();
          },
        },
        'fit-screen',
      );
    };
    render();
  }

  /** Every item as a small tile; tap one to read what it does. Locked ones show their unlock hint. */
  collection(meta: MetaProgress, back: () => void) {
    const ids = Object.keys(ITEMS) as ItemId[];
    const tile = (id: ItemId) => {
      const d = ITEMS[id];
      return meta.unlocked.includes(id)
        ? `<button class="col-tile ${d.kind}" data-a="info" data-id="${id}"><span class="item-ico">${d.icon}</span><b>${d.name}</b></button>`
        : `<button class="col-tile locked" data-a="info" data-id="${id}"><span class="item-ico">🔒</span><b>???</b></button>`;
    };
    const info = (id: ItemId) => {
      const d = ITEMS[id];
      if (meta.unlocked.includes(id)) return `<b>${d.icon} ${d.name}</b> · ${d.kind === 'charm' ? 'Charm, kept' : 'Boost, one world'} · ${d.desc}`;
      return `<b>🔒 Locked</b> · ${UNLOCKS.find((u) => u.id === id)?.hint ?? ''}`;
    };
    const n = ids.filter((id) => meta.unlocked.includes(id)).length;
    this.show(
      'collection',
      `<div class="panel wide fit"><h2>Collection</h2><p class="sub">${n} of ${ids.length} unlocked. Locked items join the shop when you earn them.</p>
        <div class="col-grid">${ids.map(tile).join('')}</div>
        <p class="col-info" id="col-info">Tap an item to see what it does.</p>
        <div class="fit-actions row"><button class="btn gold" data-a="goals">Goals<small>${UNLOCKS.filter((u) => meta.unlocked.includes(u.id)).length} of ${UNLOCKS.length} done</small></button><button class="btn primary" data-a="back">Back</button></div></div>`,
      {
        goals: () => this.goals(meta, () => this.collection(meta, back)),
        info: (el) => {
          document.querySelectorAll('.col-tile.on').forEach((t) => t.classList.remove('on'));
          el.classList.add('on');
          $('col-info').innerHTML = info(el.dataset.id as ItemId);
        },
        back,
      },
      'fit-screen',
    );
  }

  /** Every unlock goal with its best progress so far. Done goals show the item they unlocked. */
  goals(meta: MetaProgress, back: () => void) {
    const row = (u: (typeof UNLOCKS)[number]) => {
      const done = meta.unlocked.includes(u.id);
      const v = done ? u.target : Math.min(meta.best?.[u.id] ?? 0, u.target);
      const d = ITEMS[u.id];
      const count = u.target === 1 ? (done ? '✓' : '') : `${v.toLocaleString()}/${u.target.toLocaleString()}`;
      return `<div class="goal${done ? ' done' : ''}"><span class="goal-ico">${done ? d.icon : '🔒'}</span>
        <div class="goal-main"><span class="goal-hint">${u.hint}</span>${done ? `<small>Unlocked ${d.name}</small>` : ''}
          <div class="goal-bar"><i style="transform:scaleX(${v / u.target})"></i></div></div>
        <b class="goal-n">${done && u.target > 1 ? '✓' : count}</b></div>`;
    };
    const n = UNLOCKS.filter((u) => meta.unlocked.includes(u.id)).length;
    this.show(
      'goals',
      `<div class="panel wide fit"><h2>Goals</h2><p class="sub">${n} of ${UNLOCKS.length} done. Each one adds a new item to the Endless shop. Bars show your best so far.</p>
        <div class="goal-grid">${UNLOCKS.map(row).join('')}</div>
        <div class="fit-actions"><button class="btn primary" data-a="back">Back</button></div></div>`,
      { back },
      'fit-screen',
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
  private lastAce = '';
  private lastCoins = '';
  private lastFf: boolean | null = null;
  private lastGun = [-1, -1];
  updateHud(st: GameState, level: Level, run: EndlessRun | null = null) {
    $('hud-level').textContent = `${run ? 'Stage' : 'Level'} ${level.index + 1}`;
    $('hud-name').textContent = level.boss === 'boss' ? `BOSS · ${level.name}` : level.boss === 'mini' ? `MINI-BOSS · ${level.name}` : level.name;
    const score = st.score + (run?.runScore ?? 0);
    const pr = progress(st, level);
    // Boss fights: the bar is the boss's health, draining.
    $('hud-bar').style.transform = `scaleX(${st.boss ? st.boss.hp / st.boss.max : pr.bar})`;
    const bar = $('hud-bar').parentElement!;
    bar.classList.toggle('full', st.barFull);
    bar.classList.toggle('boss', !!st.boss);
    $('hud-bar-label').textContent = st.boss ? (st.boss.dead ? 'DEFEATED!' : `${level.bossFight?.kind === 'serpent' ? 'SERPENT' : 'BOSS'} ${st.boss.hp}`) : st.barFull ? 'CLEAR!' : 'ZUMA';
    // Ace time: counts down, then shows the result once the level is won.
    const left = level.ace - st.tick / TICK_HZ;
    const [cls, text] = st.bonus
      ? st.bonus.ace ? ['got', 'ACE TIME!'] : ['missed', 'ACE MISSED']
      : left <= 0 ? ['missed', 'ACE MISSED'] : [left <= 10 ? 'close' : '', `ACE ${mm2(Math.ceil(left))}`];
    if (cls + text !== this.lastAce) {
      this.lastAce = cls + text;
      const el = $('hud-ace');
      el.className = `ace-chip ${cls}`;
      el.textContent = text;
    }
    // Expedition: coins (banked + this stage) and the items in effect
    const eco = run?.eco;
    const coinKey = eco ? `${eco.coins + st.coinsEarned.total}|${activeItems(eco, level.index).join(',')}` : '';
    if (coinKey !== this.lastCoins) {
      this.lastCoins = coinKey;
      $('hud-coins').textContent = eco ? `🪙 ${(eco.coins + st.coinsEarned.total).toLocaleString()}` : '';
      $('hud-items').innerHTML = eco ? activeItems(eco, level.index).map((id) => `<span title="${ITEMS[id].name}: ${ITEMS[id].desc}">${ITEMS[id].icon}</span>`).join('') : '';
    }
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
    if (st.ff !== this.lastFf) {
      this.lastFf = st.ff;
      $('btn-ff').classList.toggle('on', st.ff);
      $('btn-ff').setAttribute('aria-pressed', String(st.ff));
    }
    // BOMB (-2) = a Pocket Bomb shot
    const cur = st.gun.b & 1 ? BOMB : st.gun.w & 1 ? WILD : st.gun.cur;
    const nxt = st.gun.b & 2 ? BOMB : st.gun.w & 2 ? WILD : st.gun.next;
    if (cur !== this.lastGun[0] || nxt !== this.lastGun[1]) {
      this.lastGun = [cur, nxt];
      for (const [a, b] of [['swap-cur', 'swap-next'], ['next-cur', 'next-next']]) {
        $(a).setAttribute('style', marbleCss(cur));
        $(b).setAttribute('style', marbleCss(nxt));
      }
      $('fire-cur').setAttribute('style', marbleCss(cur));
    }
    const pw: [Power, number, number][] = [];
    if (st.slowT > 0) pw.push([2, st.slowT, Math.max(st.slowT, TUNING.slowTime * st.mods.slowTimeMul)]);
    if (st.revT > 0) pw.push([3, st.revT, Math.max(st.revT, TUNING.reverseTime * st.mods.reverseTimeMul)]);
    if (st.magnetT > 0) pw.push([9, st.magnetT, TUNING.magnetTime]);
    const key = pw.map((p) => `${p[0]}:${Math.ceil(p[1] * 4)}`).join(',');
    if (key !== this.lastPowers) {
      this.lastPowers = key;
      $('hud-powers').innerHTML = pw
        .map(([p, t, max]) => {
          const c = 2 * Math.PI * 22;
          const col = p === 2 ? '#7fbfff' : p === 9 ? '#ff7a88' : '#ffc850';
          return `<div class="power${t < 1.5 ? ' ending' : ''}" style="--pc:${col}"><svg class="ring" viewBox="0 0 50 50"><circle cx="25" cy="25" r="22" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="4"/><circle cx="25" cy="25" r="22" fill="none" stroke="${col}" stroke-width="4" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - t / max)}" stroke-linecap="round"/></svg><span class="lbl">${POWER_NAMES[p]}</span><b class="sec">${Math.ceil(t)}</b></div>`;
        })
        .join('');
    }
  }

  resetHud() {
    this.lastGun = [-1, -1];
    this.lastScore = -1;
    // Not '' (the key for "nothing showing"), so the next update always redraws.
    this.lastPowers = '-';
    this.lastFf = null;
    this.lastAce = '-';
    this.lastCoins = '-';
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

const AIM_LABELS = { drag: 'Drag & release', aimtap: 'Aim + tap', tap: 'Tap', pad: 'Trackpad' } as const;
const AIM_HINTS = {
  drag: 'Drag to aim, lift to shoot · press and hold to keep shooting',
  aimtap: 'Drag to aim, tap to shoot (hold to keep shooting) — iPhone vibrates on every shot',
  tap: 'Tap where you want to shoot · hold and slide to keep shooting',
  pad: 'Drag anywhere to nudge the crosshair (finer than your finger, never covers the target), tap to shoot · hold to keep shooting',
} as const;

function mm2(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

export interface LevelMeta {
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
