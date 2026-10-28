// Run-economy screens: the free pick after a boss, the shop, and the serpent trader, plus
// the item card and owned-items strip they share. Split out of ui.ts; each screen draws
// through UI.show and re-renders itself after every action.

import { ITEMS, type ItemId } from '../sim/items';
import { BOOST_SLOTS, bossStageFor, CHARM_SLOTS, type Fail, priceAt, RESERVE_COST, rerollCost, type RunEco } from '../sim/economy';
import type { TraderVisit } from './save';

/** UI.show: put a screen up with its action handlers. */
export type ShowFn = (name: string, html: string, handlers: Record<string, (el: HTMLElement) => void>, cls?: string) => void;

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
  /** Was this bought on this visit (so it can be handed back)? */
  canUndo(id: ItemId): boolean;
  /** Hand back a purchase for a full refund (until Continue). */
  unbuy(id: ItemId): void;
  done(): void;
}

const PALETTE_NAMES = ['Red', 'Yellow', 'Green', 'Blue', 'Purple', 'White'];

/** Shop and trader messages for a failed purchase. */
function failMessage(f: Fail | null): string {
  return f === 'coins' ? 'Not enough coins.' : f === 'slots' ? 'No free slot.' : f === 'owned' ? 'You already have that.' : '';
}

/** With every charm slot full, buying a charm sells one back: the most it can refund. */
function bestCharmRefund(eco: RunEco): number {
  return eco.charms.length >= CHARM_SLOTS ? Math.max(...eco.charms.map((c) => Math.floor(c.paid / 2))) : 0;
}

/** An item as a compact card. `price` 0 = free. */
function card(id: ItemId, o: { price?: number; action?: string; disabled?: boolean; hold?: string; luckyColor?: number; picked?: boolean | string } = {}) {
  const d = ITEMS[id];
  const desc = id === 'luckyColor' && o.luckyColor !== undefined ? `${PALETTE_NAMES[o.luckyColor]} pays triple coins` : d.desc;
  const price = o.price === undefined ? '' : o.price === 0 ? '<span class="price free">FREE</span>' : `<span class="price">🪙 ${o.price.toLocaleString()}</span>`;
  return `<div class="item-card ${d.kind} ${o.disabled ? 'off' : ''} ${o.picked ? 'picked' : ''}">
    <button class="item-main" ${o.action && !o.disabled ? `data-a="${o.action}" data-id="${id}"` : 'disabled'}>
      <span class="item-ico">${d.icon}</span><b>${d.name}</b><span class="item-desc">${desc}</span>${price}
    </button>${o.picked ? `<span class="tag got">${o.picked === true ? '✓ picked' : o.picked}</span>` : (o.hold ?? '')}</div>`;
}

/** Owned charms and live boosts as one compact strip of 6 slots. */
function owned(eco: RunEco, stage: number, mode: 'view' | 'sell' | 'replace-charm' | 'replace-boost') {
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

/** The row for `id` is full: choose an owned item to give up. Its buttons fire `replace` (data-i) and `cancel`. */
function replaceScreen(eco: RunEco, stage: number, id: ItemId, text: { title?: string; sub?: string; back?: string } = {}) {
  const d = ITEMS[id];
  const sub = text.sub ?? `Your ${d.kind}s are full. Pick one to replace with <b>${d.icon} ${d.name}</b>${d.kind === 'charm' ? ' (a bought charm sells for half)' : ''}.`;
  return `<div class="panel wide fit"><h2>${text.title ?? 'No room'}</h2><p class="sub">${sub}</p>
          ${owned(eco, stage, d.kind === 'charm' ? 'replace-charm' : 'replace-boost')}
          <div class="fit-actions"><button class="btn ghost" data-a="cancel">${text.back ?? 'Back'}</button></div></div>`;
}

/**
 * A free pick: tap a card to choose it (tap another to change your mind), then confirm, or skip.
 * A full row asks which item to replace.
 */
export function pickScreen(show: ShowFn, o: { title: string; sub: string; eco: RunEco; stage: number; ids: ItemId[]; onPick: (id: ItemId | null, replace?: number) => void }) {
  let picked: ItemId | null = null;
  const render = (choosing: ItemId | null) => {
    const html = choosing
      ? replaceScreen(o.eco, o.stage, choosing)
      : `<div class="panel wide fit"><h2>${o.title}</h2><p class="sub">${o.sub}</p>
          <div class="cards">${o.ids.map((id) => card(id, { price: 0, action: 'take', luckyColor: o.eco.luckyColor, picked: id === picked })).join('')}</div>
          ${owned(o.eco, o.stage, 'view')}
          <div class="fit-actions row"><button class="btn ghost" data-a="skip">Skip</button>${picked ? `<button class="btn primary" data-a="confirm">Take ${ITEMS[picked].icon} ${ITEMS[picked].name} ▶</button>` : ''}</div></div>`;
    show('pick', html, {
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
export function shopScreen(show: ShowFn, api: ShopApi) {
  let replacing: ItemId | null = null;
  let msg = '';
  const render = () => {
    const eco = api.eco;
    const offers = api.offers();
    const next = api.stage + 1;
    const boss = bossStageFor(next);
    const liveBoosts = eco.boosts.filter((b) => b.until > api.stage).length;
    const charmCard = (id: ItemId, reserved = false) => {
      const price = priceAt(id, api.stage);
      const hold = reserved ? '<span class="tag">held for you</span>' : eco.reserved ? '' : `<button class="mini-btn hold" data-a="hold" data-id="${id}" ${eco.coins < RESERVE_COST ? 'disabled' : ''}>hold · 🪙${RESERVE_COST}</button>`;
      const refund = bestCharmRefund(eco);
      return card(id, { price, action: 'buy', disabled: eco.coins + refund < price, hold, luckyColor: eco.luckyColor });
    };
    const charms = [...(offers.reserved ? [charmCard(offers.reserved, true)] : []), ...offers.charms.map((id) => charmCard(id))];
    const boosts = offers.boosts.map((id) => card(id, { price: priceAt(id, api.stage), action: 'buy', disabled: eco.coins < priceAt(id, api.stage) || liveBoosts >= BOOST_SLOTS }));
    const html = replacing
      ? replaceScreen(eco, api.stage, replacing, {
          title: 'Replace a charm',
          sub: `Your charms are full. Pick one to give up for <b>${ITEMS[replacing].icon} ${ITEMS[replacing].name}</b>. It sells for half of what you paid.`,
          back: 'Back to shop',
        })
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
              ${owned(eco, api.stage, 'sell')}
              <div class="fit-actions row"><button class="btn" data-a="reroll" ${eco.coins < rerollCost(eco) ? 'disabled' : ''}>New offers · 🪙${rerollCost(eco)}</button><button class="btn primary" data-a="go">Continue ▶</button></div>
            </div>
          </div>
        </div>`;
    show(
      'shop',
      html,
      {
        buy: (el) => {
          const id = el.dataset.id as ItemId;
          if (ITEMS[id].kind === 'charm' && eco.charms.length >= CHARM_SLOTS) {
            replacing = id;
            return render();
          }
          msg = failMessage(api.buy(id));
          render();
        },
        replace: (el) => {
          msg = failMessage(api.buy(replacing!, Number(el.dataset.i)));
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
          msg = failMessage(api.reserve(el.dataset.id as ItemId));
          render();
        },
        reroll: () => {
          msg = failMessage(api.reroll());
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
export function traderScreen(show: ShowFn, api: TraderApi) {
  let replacing: { id: ItemId; free: boolean } | null = null;
  // The free boost is only chosen here; it is taken when you press Continue, so you can change your mind.
  let picked: ItemId | null = null;
  let msg = '';
  const render = () => {
    const { eco, visit } = api;
    const boss = bossStageFor(api.stage + 1);
    const liveBoosts = eco.boosts.filter((b) => b.until > api.stage).length;
    const freeCards = visit.free
      .map((id) => {
        if (visit.took) return card(id, { price: 0, disabled: true, hold: id === visit.took ? '<span class="tag got">✓ yours</span>' : '' });
        return card(id, { price: 0, action: 'take', luckyColor: eco.luckyColor, picked: id === picked });
      })
      .join('');
    const buyCards = visit.buy
      .map((id) => {
        const price = priceAt(id, api.stage);
        if (visit.bought.includes(id))
          return api.canUndo(id) ? card(id, { price, action: 'unbuy', picked: '✓ bought · tap to undo' }) : card(id, { disabled: true, hold: '<span class="tag got">✓ bought</span>' });
        const charm = ITEMS[id].kind === 'charm';
        const refund = charm ? bestCharmRefund(eco) : 0;
        const off = charm ? eco.coins + refund < price : eco.coins < price || liveBoosts >= BOOST_SLOTS;
        return card(id, { price, action: 'buy', disabled: off, luckyColor: eco.luckyColor });
      })
      .join('');
    const html = replacing
      ? replaceScreen(eco, api.stage, replacing.id)
      : `<div class="panel wide fit shop trader">
          <div class="shop-head"><h2>Serpent slain!</h2><span class="coins-big">🪙 ${eco.coins.toLocaleString()}</span></div>
          <p class="sub">Take a free boost and see what the trader has. Boosts last until this world's boss (stage ${boss + 1}).</p>
          ${msg ? `<p class="shop-msg">${msg}</p>` : ''}
          <div class="shop-body">
            <div class="shop-offers">
              <h3>Free boost <small>${visit.took ? 'taken' : picked ? 'yours when you continue' : 'pick one'}</small></h3>
              <div class="cards">${freeCards || '<p class="sub">Nothing left to offer.</p>'}</div>
              <h3>Trader <small>change your mind until you continue</small></h3>
              <div class="cards">${buyCards || '<p class="sub">Nothing left to offer.</p>'}</div>
            </div>
            <div class="shop-side">
              ${owned(eco, api.stage, 'view')}
              <div class="fit-actions row"><button class="btn primary" data-a="go">${visit.took || !visit.free.length ? 'Continue ▶' : picked ? `Take ${ITEMS[picked].icon} ${ITEMS[picked].name} ▶` : 'Continue without a boost ▶'}</button></div>
            </div>
          </div>
        </div>`;
    show(
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
          msg = failMessage(api.buy(id));
          render();
        },
        unbuy: (el) => {
          api.unbuy(el.dataset.id as ItemId);
          msg = '';
          render();
        },
        replace: (el) => {
          const r = replacing!;
          msg = failMessage(r.free ? api.take(r.id, Number(el.dataset.i)) : api.buy(r.id, Number(el.dataset.i)));
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
            msg = failMessage(api.take(picked));
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
