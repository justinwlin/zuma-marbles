// Headless Expedition: the bot plays stage after stage, earns coins, takes free picks and
// shops with a policy, until it loses. Uses the same economy, item and unlock code as the
// game, so the numbers describe what players actually get.

import { checkUnlocks, LevelTracker, type MetaProgress, newMeta } from './achievements';
import { type BotOptions, playLevel } from './bot';
import { activeItems, afterStage, priceAt, bossPicks, closeShop, gain, miniPicks, modsForStage, newEco, rerollCost, reroll, type RunEco, settleStage, shopOffers, worldOf } from './economy';
import { createGame } from './game';
import { ITEMS, type ItemId } from './items';
import { generateLevel } from './levelgen';

/** How the simulated player spends. */
export type Policy = 'none' | 'greedy' | 'random';

/** Rough value order the greedy policy buys and picks by (best first). */
export const PRIORITY: ItemId[] = [
  'extraLife', 'slowpoke', 'shockwave', 'rainbow', 'lightningRod', 'bomber', 'powerSurge', 'comboKing',
  'deepFreeze', 'quickDraw', 'bossBreaker', 'longFuse', 'rewinder', 'hungryScorpion', 'doubleWild', 'luckyColor', 'daredevil', 'pocketBomb', 'scavenger', 'scout', 'snakeCharmer',
];
const rank = (id: ItemId) => PRIORITY.indexOf(id);

export interface StageLog {
  stage: number;
  won: boolean;
  seconds: number;
  coins: number;
  items: ItemId[];
}

export interface ExpeditionResult {
  seed: string;
  /** Stages cleared before losing (or the cap). */
  cleared: number;
  /** Coins earned per world (index = world). */
  coinsByWorld: number[];
  bought: ItemId[];
  picked: ItemId[];
  unlocks: ItemId[];
  /** Coins left right after each shop (unspent surplus). */
  afterShop: number[];
  log: StageLog[];
  eco: RunEco;
}

export interface ExpeditionOpts {
  seed: string;
  bot: BotOptions;
  policy: Policy;
  /** Lifetime progress (mutated: unlocks persist across runs if the caller reuses it). */
  meta?: MetaProgress;
  maxStages?: number;
}

export function runExpedition(o: ExpeditionOpts): ExpeditionResult {
  const meta = o.meta ?? newMeta();
  const eco = newEco();
  const res: ExpeditionResult = { seed: o.seed, cleared: 0, coinsByWorld: [], bought: [], picked: [], unlocks: [], afterShop: [], log: [], eco };
  const max = o.maxStages ?? 60;
  let choice = 0; // deterministic counter for the random policy
  const pickOf = (opts: ItemId[]) => {
    if (!opts.length) return null;
    if (o.policy === 'random') return opts[choice++ % opts.length];
    return opts.slice().sort((a, b) => rank(a) - rank(b))[0];
  };
  for (let stage = 0; stage < max; stage++) {
    const level = generateLevel(o.seed, stage);
    const st = createGame(level, modsForStage(eco, stage));
    const tracker = new LevelTracker();
    const r = playLevel(st, level, o.bot, 600, (ev) => tracker.feed(ev));
    const won = r.outcome === 'won';
    settleStage(eco, st, stage, won);
    const w = worldOf(stage);
    res.coinsByWorld[w] = (res.coinsByWorld[w] ?? 0) + st.coinsEarned.total;
    res.unlocks.push(...checkUnlocks(meta, tracker, level, { won, peakDanger: r.peakDanger }));
    res.log.push({ stage, won, seconds: r.seconds, coins: st.coinsEarned.total, items: activeItems(eco, stage) });
    if (!won) break;
    res.cleared = stage + 1;
    if (o.policy === 'none') continue;
    const after = afterStage(stage);
    if (after === 'mini') {
      const id = pickOf(miniPicks(eco, o.seed, stage, meta.unlocked));
      if (id && !gain(eco, id, o.seed, stage, { free: true })) res.picked.push(id);
    } else if (after === 'boss') {
      const free = pickOf(bossPicks(eco, o.seed, stage, meta.unlocked));
      if (free) {
        const replace = worstCharm(eco);
        if (!gain(eco, free, o.seed, stage, { free: true, replace: eco.charms.length >= 3 && rank(free) < rank(eco.charms[replace].id) ? replace : undefined })) res.picked.push(free);
      }
      shop(eco, o, stage, meta.unlocked, res, () => choice++);
      res.afterShop.push(eco.coins);
    }
  }
  return res;
}

function worstCharm(eco: RunEco): number {
  let k = 0;
  eco.charms.forEach((c, i) => {
    if (rank(c.id) > rank(eco.charms[k].id)) k = i;
  });
  return k;
}

/** Spend in the shop: buy offers best-first while affordable; reroll once if rich. */
function shop(eco: RunEco, o: ExpeditionOpts, stage: number, unlocked: ItemId[], res: ExpeditionResult, next: () => number) {
  for (let pass = 0; pass < 2; pass++) {
    const offers = shopOffers(eco, o.seed, stage, unlocked);
    let list = [...offers.charms, ...offers.boosts];
    if (o.policy === 'random' && list.length) {
      const k = next() % list.length;
      list = [...list.slice(k), ...list.slice(0, k)];
    } else list.sort((a, b) => rank(a) - rank(b));
    for (const id of list) {
      if (eco.coins < priceAt(id, stage)) continue;
      let replace: number | undefined;
      if (ITEMS[id].kind === 'charm' && eco.charms.length >= 3) {
        const k = worstCharm(eco);
        if (rank(id) >= rank(eco.charms[k].id)) continue;
        replace = k;
      }
      if (!gain(eco, id, o.seed, stage, { replace })) res.bought.push(id);
    }
    if (o.policy !== 'greedy' || eco.coins < rerollCost(eco) + 400 || reroll(eco)) break;
  }
  closeShop(eco);
}
