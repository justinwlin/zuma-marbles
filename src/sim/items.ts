// Charms and boosts for Expedition runs. An owned loadout resolves to one Mods object,
// which is the only thing the simulation reads. Neutral mods = the game as it plays today.

export type ItemKind = 'charm' | 'boost';

export type ItemId =
  // Boosts: strong, last until the next boss is beaten
  | 'slowpoke'
  | 'extraLife'
  | 'powerSurge'
  | 'pocketBomb'
  | 'longFuse'
  | 'snakeCharmer'
  | 'bossBreaker'
  // Charms: kept until replaced
  | 'shockwave'
  | 'bomber'
  | 'quickDraw'
  | 'rainbow'
  | 'scout'
  | 'luckyColor'
  | 'comboKing'
  | 'daredevil'
  | 'lightningRod'
  | 'scavenger';

export interface ItemDef {
  id: ItemId;
  kind: ItemKind;
  name: string;
  icon: string;
  desc: string;
  price: number;
  /** In the shop pool from the start (otherwise unlocked by an achievement). */
  starter: boolean;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  slowpoke: { id: 'slowpoke', kind: 'boost', name: 'Slowpoke', icon: '🐢', desc: 'Chains roll 20% slower', price: 600, starter: true },
  extraLife: { id: 'extraLife', kind: 'boost', name: 'Extra Life', icon: '❤️', desc: 'Once per world, a chain reaching the skull is pushed back instead', price: 700, starter: false },
  powerSurge: { id: 'powerSurge', kind: 'boost', name: 'Power Surge', icon: '⚡', desc: 'Power-ups appear twice as often', price: 450, starter: true },
  pocketBomb: { id: 'pocketBomb', kind: 'boost', name: 'Pocket Bomb', icon: '💣', desc: 'Start every level with a Bomb shot loaded', price: 500, starter: true },
  longFuse: { id: 'longFuse', kind: 'boost', name: 'Long Fuse', icon: '⏳', desc: 'Power marbles last twice as long', price: 400, starter: true },
  snakeCharmer: { id: 'snakeCharmer', kind: 'boost', name: 'Snake Charmer', icon: '🐍', desc: "The serpent's rear-up lasts 1 s longer; choking it drops 2 extra power-ups", price: 400, starter: false },
  bossBreaker: { id: 'bossBreaker', kind: 'boost', name: 'Boss Breaker', icon: '🔨', desc: 'Direct hits on bosses do double damage', price: 500, starter: false },
  shockwave: { id: 'shockwave', kind: 'charm', name: 'Shockwave', icon: '💥', desc: 'Matches of 5+ also pop the marble on each side', price: 750, starter: true },
  bomber: { id: 'bomber', kind: 'charm', name: 'Bomber', icon: '🧨', desc: 'Bombs blast 50% wider', price: 650, starter: true },
  quickDraw: { id: 'quickDraw', kind: 'charm', name: 'Quick Draw', icon: '🏹', desc: 'Your shots fly 25% faster', price: 600, starter: true },
  rainbow: { id: 'rainbow', kind: 'charm', name: 'Rainbow', icon: '🌈', desc: 'Every 15th shot is Wild', price: 850, starter: true },
  scout: { id: 'scout', kind: 'charm', name: 'Colour Scout', icon: '🔭', desc: 'See the marble after next', price: 500, starter: true },
  luckyColor: { id: 'luckyColor', kind: 'charm', name: 'Lucky Colour', icon: '🍀', desc: 'Your lucky colour pays triple coins', price: 700, starter: false },
  comboKing: { id: 'comboKing', kind: 'charm', name: 'Combo King', icon: '👑', desc: 'Combos pay double coins', price: 800, starter: false },
  daredevil: { id: 'daredevil', kind: 'charm', name: 'Daredevil', icon: '🔥', desc: 'Pops with the chain past 75% of the track pay double coins', price: 700, starter: false },
  lightningRod: { id: 'lightningRod', kind: 'charm', name: 'Lightning Rod', icon: '🌩️', desc: 'Lightning also strikes a second colour, in the front half of the chain', price: 1000, starter: false },
  scavenger: { id: 'scavenger', kind: 'charm', name: 'Scavenger', icon: '🪙', desc: 'Floating coins appear twice as often', price: 600, starter: false },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const STARTER_ITEMS: ItemId[] = ITEM_IDS.filter((id) => ITEMS[id].starter);

export interface Mods {
  speedMul: number;
  powerChanceMul: number;
  powerLifeMul: number;
  bombRadiusMul: number;
  shotSpeedMul: number;
  /** Every Nth shot is Wild (0 = off). */
  wildEvery: number;
  /** Show the marble after next. */
  scout: boolean;
  /** Start the level with a Bomb shot loaded. */
  pocketBomb: boolean;
  /** Rescues left this level (Extra Life). */
  lives: number;
  shockwave: boolean;
  lightningRod: boolean;
  coinSpawnMul: number;
  serpentWindupAdd: number;
  chokeExtra: number;
  bossDirectMul: number;
  comboCoinMul: number;
  dangerCoinMul: number;
  /** Lucky Colour's colour (-1 = off). */
  luckyColor: number;
}

export const NO_MODS: Mods = {
  speedMul: 1,
  powerChanceMul: 1,
  powerLifeMul: 1,
  bombRadiusMul: 1,
  shotSpeedMul: 1,
  wildEvery: 0,
  scout: false,
  pocketBomb: false,
  lives: 0,
  shockwave: false,
  lightningRod: false,
  coinSpawnMul: 1,
  serpentWindupAdd: 0,
  chokeExtra: 0,
  bossDirectMul: 1,
  comboCoinMul: 1,
  dangerCoinMul: 1,
  luckyColor: -1,
};

/** Resolve owned items into mods. `luckyColor` is the colour rolled when Lucky Colour was gained. */
export function modsFor(items: readonly ItemId[], opts: { luckyColor?: number; lifeSpent?: boolean } = {}): Mods {
  const m: Mods = { ...NO_MODS };
  for (const id of items) {
    switch (id) {
      case 'slowpoke': m.speedMul = 0.8; break;
      case 'extraLife': m.lives = opts.lifeSpent ? 0 : 1; break;
      case 'powerSurge': m.powerChanceMul = 2; break;
      case 'pocketBomb': m.pocketBomb = true; break;
      case 'longFuse': m.powerLifeMul = 2; break;
      case 'snakeCharmer': m.serpentWindupAdd = 1; m.chokeExtra = 2; break;
      case 'bossBreaker': m.bossDirectMul = 2; break;
      case 'shockwave': m.shockwave = true; break;
      case 'bomber': m.bombRadiusMul = 1.5; break;
      case 'quickDraw': m.shotSpeedMul = 1.25; break;
      case 'rainbow': m.wildEvery = 15; break;
      case 'scout': m.scout = true; break;
      case 'luckyColor': m.luckyColor = opts.luckyColor ?? 0; break;
      case 'comboKing': m.comboCoinMul = 2; break;
      case 'daredevil': m.dangerCoinMul = 2; break;
      case 'lightningRod': m.lightningRod = true; break;
      case 'scavenger': m.coinSpawnMul = 2; break;
    }
  }
  return m;
}

/** Coins: what each source pays. */
export const COINS = {
  pop: 1,
  comboStep: 5,
  floating: 25,
  ace: 50,
  clean: 50,
  boss: 100,
  /** Daredevil's threshold: head past this fraction of the track. */
  dangerFrac: 0.75,
  /** Lucky Colour multiplier. */
  lucky: 3,
};

export type CoinSource = 'pops' | 'combos' | 'floating' | 'ace' | 'clean' | 'boss';
export interface CoinLedger {
  total: number;
  by: Record<CoinSource, number>;
}
export function emptyLedger(): CoinLedger {
  return { total: 0, by: { pops: 0, combos: 0, floating: 0, ace: 0, clean: 0, boss: 0 } };
}
