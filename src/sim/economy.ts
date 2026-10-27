// Expedition economy: coins, owned charms and boosts, the seeded shop, and free picks.
// Plain JSON state (RunEco) + pure functions, shared by the game and the headless simulator.
//
// A world is 10 stages: a mini-boss at stage index 4, 14, 24… and a boss at 9, 19, 29….
// After a mini-boss you pick 1 of 2 boosts for free; after a boss you pick 1 of 3 charms
// for free, then the shop opens. Boosts run out when the next boss is beaten.

import { bossKind } from './levelgen';
import { ITEMS, type ItemId, type Mods, modsFor } from './items';
import type { GameState } from './game';
import { hash32, Rng } from './rng';

export const CHARM_SLOTS = 3;
export const BOOST_SLOTS = 3;
export const SHOP_OFFERS = 3;
export const REROLL_COST = 50;
export const REROLL_STEP = 25;
export const RESERVE_COST = 50;

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
}

export function newEco(): RunEco {
  return { coins: 0, charms: [], boosts: [], lifeWorld: -1, luckyColor: 0, reserved: null, rerolls: 0 };
}

export const worldOf = (stage: number) => Math.floor(stage / 10);
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

// ------------------------------------------------------------------ actions

export type Fail = 'coins' | 'slots' | 'owned';

/**
 * Gain an item after winning `stage` (bought, or free when `free`). A full charm row needs
 * `replace` (index of the charm to give up; it sells for half of what was paid).
 */
export function gain(eco: RunEco, id: ItemId, seed: string, stage: number, opts: { free?: boolean; replace?: number } = {}): Fail | null {
  const def = ITEMS[id];
  const price = opts.free ? 0 : def.price;
  if (owns(eco, id, stage)) return 'owned';
  if (def.kind === 'boost') {
    if (eco.boosts.filter((b) => b.until > stage).length >= BOOST_SLOTS) return 'slots';
    if (eco.coins < price) return 'coins';
    eco.coins -= price;
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

/** Leaving the shop: rerolls reset for the next one. */
export function closeShop(eco: RunEco) {
  eco.rerolls = 0;
}
