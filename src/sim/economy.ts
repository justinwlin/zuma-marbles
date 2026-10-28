// Expedition economy: coins, owned charms and boosts, the seeded shop, and free picks.
// Plain JSON state (RunEco) + pure functions, shared by the game and the headless simulator.
//
// A world is 10 stages: a mini-boss at stage index 4, 14, 24… and a boss at 9, 19, 29….
// After a mini-boss you pick 1 of 2 boosts for free and can buy from a small trader
// (2 boosts + 1 charm, no rerolls); after a boss you pick 1 of 3 charms for free, then the
// full shop opens. Boosts run out when the next boss is beaten.

import { bossKind } from './levelgen';
import { ITEMS, type ItemId, type Mods, modsFor } from './items';
import type { GameState } from './game';
import { hash32, Rng } from './rng';

export const CHARM_SLOTS = 3;
export const BOOST_SLOTS = 3;
export const SHOP_OFFERS = 3;
/** The trader after a serpent: a smaller shop, same prices. */
export const TRADER_BOOSTS = 2;
export const TRADER_CHARMS = 1;
export const REROLL_COST = 50;
export const REROLL_STEP = 25;
export const RESERVE_COST = 50;
/** Shop prices rise 20% per world, tracking income (which grows as stages get longer). */
export const INFLATION = 0.2;

export interface Owned {
  id: ItemId;
  /** Coins paid (0 for free picks): selling refunds half. */
  paid: number;
}
export interface OwnedBoost extends Owned {
  /** Index of the boss stage whose defeat ends this boost. */
  until: number;
}

export interface RunEco {
  coins: number;
  charms: Owned[];
  boosts: OwnedBoost[];
  /** World index whose Extra Life rescue has been used (-1 = none). */
  lifeWorld: number;
  /** Lucky Colour's colour (rolled when the charm is gained). */
  luckyColor: number;
  /** Charm held for the next shop (Reserve). */
  reserved: ItemId | null;
  /** Rerolls bought in the current shop. */
  rerolls: number;
  /** Run totals for achievements (missing in runs saved by older versions). */
  aces?: number;
  earned?: number;
  boughtBoost?: boolean;
}

export function newEco(): RunEco {
  return { coins: 0, charms: [], boosts: [], lifeWorld: -1, luckyColor: 0, reserved: null, rerolls: 0, aces: 0, earned: 0, boughtBoost: false };
}

export const worldOf = (stage: number) => Math.floor(stage / 10);

/** Price in the shop after winning `stage` (rounded to 25). */
export function priceAt(id: ItemId, stage: number): number {
  return Math.round((ITEMS[id].price * (1 + INFLATION * worldOf(stage + 1))) / 25) * 25;
}
/** The boss stage that ends a world containing stage `s`. */
export const bossStageFor = (s: number) => s - (s % 10) + 9;

/** Items in effect while playing `stage`. */
export function activeItems(eco: RunEco, stage: number): ItemId[] {
  return [...eco.charms.map((c) => c.id), ...eco.boosts.filter((b) => b.until >= stage).map((b) => b.id)];
}

export function modsForStage(eco: RunEco, stage: number): Mods {
  return modsFor(activeItems(eco, stage), { luckyColor: eco.luckyColor, lifeSpent: eco.lifeWorld === worldOf(stage) });
}

/** After a stage: bank its coins, note a spent Extra Life, and end boosts when a boss falls. */
export function settleStage(eco: RunEco, st: GameState, stage: number, won: boolean) {
  eco.coins += st.coinsEarned.total;
  eco.earned = (eco.earned ?? 0) + st.coinsEarned.total;
  if (won && st.bonus?.ace) eco.aces = (eco.aces ?? 0) + 1;
  if (st.lives < st.mods.lives) eco.lifeWorld = worldOf(stage);
  if (won && bossKind(stage) === 'boss') eco.boosts = eco.boosts.filter((b) => b.until > stage);
}

/** What comes after winning `stage`: a free boost pick, a free charm pick + shop, or nothing. */
export function afterStage(stage: number): 'mini' | 'boss' | null {
  const k = bossKind(stage);
  return k === 'boss' ? 'boss' : k === 'mini' ? 'mini' : null;
}

// ------------------------------------------------------------------ offers

function rngFor(seed: string, stage: number, salt: string) {
  return new Rng(hash32(`${seed}|${stage}|${salt}`));
}

function draw(rng: Rng, pool: ItemId[], n: number): ItemId[] {
  const p = pool.slice();
  const out: ItemId[] = [];
  while (out.length < n && p.length) out.push(p.splice(Math.floor(rng.float() * p.length), 1)[0]);
  return out;
}

const owns = (eco: RunEco, id: ItemId, stage: number) => activeItems(eco, stage + 1).includes(id);

function pool(eco: RunEco, unlocked: readonly ItemId[], kind: 'charm' | 'boost', stage: number): ItemId[] {
  return unlocked.filter((id) => ITEMS[id].kind === kind && !owns(eco, id, stage) && id !== eco.reserved);
}

/** Free pick after a boss: 3 charms you don't own. */
export function bossPicks(eco: RunEco, seed: string, stage: number, unlocked: readonly ItemId[]): ItemId[] {
  return draw(rngFor(seed, stage, 'boss'), pool(eco, unlocked, 'charm', stage), 3);
}

/** Free pick after a mini-boss: 2 boosts you don't have. */
export function miniPicks(eco: RunEco, seed: string, stage: number, unlocked: readonly ItemId[]): ItemId[] {
  return draw(rngFor(seed, stage, 'mini'), pool(eco, unlocked, 'boost', stage), 2);
}

/** The shop after boss `stage`: 3 charms and 3 boosts, re-drawn on each reroll. */
export function shopOffers(eco: RunEco, seed: string, stage: number, unlocked: readonly ItemId[]) {
  const rng = rngFor(seed, stage, `shop${eco.rerolls}`);
  return { charms: draw(rng, pool(eco, unlocked, 'charm', stage), SHOP_OFFERS), boosts: draw(rng, pool(eco, unlocked, 'boost', stage), SHOP_OFFERS), reserved: eco.reserved };
}

/**
 * The trader after mini-boss `stage`, shown beside the free boost pick: 2 boosts (never the
 * free ones in `exclude`) and 1 charm, at the usual shop prices. Drawn once per serpent.
 */
export function traderOffers(eco: RunEco, seed: string, stage: number, unlocked: readonly ItemId[], exclude: readonly ItemId[] = []) {
  const rng = rngFor(seed, stage, 'trader');
  const boosts = draw(rng, pool(eco, unlocked, 'boost', stage).filter((id) => !exclude.includes(id)), TRADER_BOOSTS);
  const charms = draw(rng, pool(eco, unlocked, 'charm', stage), TRADER_CHARMS);
  return { boosts, charms };
}

// ------------------------------------------------------------------ actions

export type Fail = 'coins' | 'slots' | 'owned';

/**
 * Gain an item after winning `stage` (bought, or free when `free`). A full row needs `replace`:
 * the index of the charm (sells for half of what was paid) or live boost (no refund) to give up.
 */
export function gain(eco: RunEco, id: ItemId, seed: string, stage: number, opts: { free?: boolean; replace?: number } = {}): Fail | null {
  const def = ITEMS[id];
  const price = opts.free ? 0 : priceAt(id, stage);
  if (owns(eco, id, stage)) return 'owned';
  if (def.kind === 'boost') {
    const live = eco.boosts.filter((b) => b.until > stage);
    if (live.length >= BOOST_SLOTS) {
      // Full: only a swap (replace = index among the live boosts) makes room. Boosts don't refund.
      if (opts.replace === undefined || !live[opts.replace]) return 'slots';
      if (eco.coins < price) return 'coins';
      eco.boosts.splice(eco.boosts.indexOf(live[opts.replace]), 1);
    }
    if (eco.coins < price) return 'coins';
    eco.coins -= price;
    if (price > 0) eco.boughtBoost = true;
    eco.boosts.push({ id, paid: price, until: bossStageFor(stage + 1) });
    return null;
  }
  const full = eco.charms.length >= CHARM_SLOTS;
  if (full && (opts.replace === undefined || !eco.charms[opts.replace])) return 'slots';
  const refund = full ? Math.floor(eco.charms[opts.replace!].paid / 2) : 0;
  if (eco.coins + refund < price) return 'coins';
  if (full) eco.charms.splice(opts.replace!, 1);
  eco.coins += refund - price;
  eco.charms.push({ id, paid: price });
  if (id === 'luckyColor') eco.luckyColor = Math.floor(rngFor(seed, stage, 'lucky').float() * 4);
  if (eco.reserved === id) eco.reserved = null;
  return null;
}

/** What one purchase changed, so it can be undone exactly (the trader lets you change your mind until Continue). */
export interface Receipt {
  id: ItemId;
  /** Coins this purchase cost, net of any refund for a replaced charm. */
  spent: number;
  /** The item it replaced (a full row), and where it was. */
  replaced: { index: number; item: Owned | OwnedBoost } | null;
  prev: Pick<RunEco, 'luckyColor' | 'reserved' | 'boughtBoost'>;
}

/** gain() for a paid item, returning a receipt that undoBuy() can reverse. */
export function buyUndoable(eco: RunEco, id: ItemId, seed: string, stage: number, replace?: number): Fail | Receipt {
  const charm = ITEMS[id].kind === 'charm';
  const before = (charm ? eco.charms : eco.boosts).slice();
  const coins = eco.coins;
  const prev = { luckyColor: eco.luckyColor, reserved: eco.reserved, boughtBoost: eco.boughtBoost };
  const f = gain(eco, id, seed, stage, { replace });
  if (f) return f;
  const now: Owned[] = charm ? eco.charms : eco.boosts;
  const gone = before.findIndex((x) => !now.includes(x));
  return { id, spent: coins - eco.coins, replaced: gone >= 0 ? { index: gone, item: before[gone] } : null, prev };
}

/** Reverse a purchase: take the item back, refund what it cost, and restore anything it replaced. */
export function undoBuy(eco: RunEco, r: Receipt) {
  const list: Owned[] = ITEMS[r.id].kind === 'charm' ? eco.charms : eco.boosts;
  const i = list.findIndex((x) => x.id === r.id);
  if (i < 0) return;
  list.splice(i, 1);
  if (r.replaced) list.splice(Math.min(r.replaced.index, list.length), 0, r.replaced.item);
  eco.coins += r.spent;
  eco.luckyColor = r.prev.luckyColor;
  eco.reserved = r.prev.reserved;
  eco.boughtBoost = r.prev.boughtBoost;
}

export function sellCharm(eco: RunEco, index: number) {
  const c = eco.charms[index];
  if (!c) return;
  eco.coins += Math.floor(c.paid / 2);
  eco.charms.splice(index, 1);
}

export const rerollCost = (eco: RunEco) => REROLL_COST + REROLL_STEP * eco.rerolls;

export function reroll(eco: RunEco): Fail | null {
  const cost = rerollCost(eco);
  if (eco.coins < cost) return 'coins';
  eco.coins -= cost;
  eco.rerolls++;
  return null;
}

/** Hold a charm for the next shop. */
export function reserve(eco: RunEco, id: ItemId): Fail | null {
  if (eco.coins < RESERVE_COST) return 'coins';
  eco.coins -= RESERVE_COST;
  eco.reserved = id;
  return null;
}

// ------------------------------------------------------------------ retry

/** Retrying a lost stage costs half your coins, at least RETRY_MIN (so it's never free). */
export const RETRY_MIN = 100;
export const retryCost = (eco: RunEco) => Math.max(RETRY_MIN, Math.ceil(eco.coins / 2));
export const canRetry = (eco: RunEco) => eco.coins >= retryCost(eco);

/** Pay for a retry of the lost stage (coins earned in the failed attempt were never banked). */
export function payRetry(eco: RunEco): Fail | null {
  if (!canRetry(eco)) return 'coins';
  eco.coins -= retryCost(eco);
  return null;
}

/** Leaving the shop: rerolls reset for the next one. */
export function closeShop(eco: RunEco) {
  eco.rerolls = 0;
}
