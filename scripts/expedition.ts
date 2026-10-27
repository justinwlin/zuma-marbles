// Simulated Expeditions across all CPU cores: how far runs get, coins per world, what gets bought.
// Usage: npm run expedition -- [runs=48] [bot=good] [policies=none,greedy] [maxStages=40]
//   UNLOCK_ALL=1  start every run with every item unlocked (tests the full pool)
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { newMeta } from '../src/sim/achievements';
import { BOT_PRESETS } from '../src/sim/bot';
import { type ExpeditionResult, type Policy, runExpedition } from '../src/sim/expedition';
import { ITEM_IDS, ITEMS, type ItemId } from '../src/sim/items';

interface Job {
  seeds: string[];
  bot: string;
  policy: Policy;
  maxStages: number;
  unlockAll: boolean;
}

if (!isMainThread) {
  const job = workerData as Job;
  const out: ExpeditionResult[] = [];
  for (const seed of job.seeds) {
    const meta = newMeta();
    if (job.unlockAll) meta.unlocked = ITEM_IDS.slice();
    const r = runExpedition({ seed, bot: BOT_PRESETS[job.bot], policy: job.policy, meta, maxStages: job.maxStages });
    out.push({ ...r, log: r.log.filter((l) => l.stage === 10 || l.stage === 20) });
  }
  parentPort!.postMessage(out);
} else {
  const runs = Number(process.argv[2] ?? 48);
  const bot = process.argv[3] ?? 'good';
  const policies = (process.argv[4] ?? 'none,greedy').split(',') as Policy[];
  const maxStages = Number(process.argv[5] ?? 40);
  const unlockAll = !!process.env.UNLOCK_ALL;
  const workers = Math.max(1, Math.min(availableParallelism(), runs));
  const t0 = performance.now();

  const runPolicy = (policy: Policy) =>
    Promise.all(
      Array.from({ length: workers }, (_, w) => {
        const seeds = Array.from({ length: runs }, (_, i) => `endless-sim-${i}`).filter((_, i) => i % workers === w);
        return new Promise<ExpeditionResult[]>((resolve, reject) => {
          const wk = new Worker(new URL(import.meta.url), { workerData: { seeds, bot, policy, maxStages, unlockAll } satisfies Job, execArgv: ['--import', 'tsx'] });
          wk.once('message', resolve);
          wk.once('error', reject);
        });
      }),
    ).then((parts) => parts.flat());

  const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  console.log(`${runs} runs per policy · bot ${bot} · cap ${maxStages} stages · ${workers} workers${unlockAll ? ' · all items unlocked' : ''}\n`);
  for (const policy of policies) {
    const res = await runPolicy(policy);
    const cleared = res.map((r) => r.cleared);
    const w = (k: number) => res.filter((r) => r.coinsByWorld[k] !== undefined && r.cleared >= (k + 1) * 10).map((r) => r.coinsByWorld[k]);
    console.log(`── ${policy}`);
    console.log(`stages cleared   avg ${avg(cleared).toFixed(1)}  median ${pct(cleared, 0.5)}  p10 ${pct(cleared, 0.1)}  p90 ${pct(cleared, 0.9)}`);
    console.log(`reached world 2  ${Math.round((res.filter((r) => r.cleared >= 10).length / res.length) * 100)}%   world 3 ${Math.round((res.filter((r) => r.cleared >= 20).length / res.length) * 100)}%   world 4 ${Math.round((res.filter((r) => r.cleared >= 30).length / res.length) * 100)}%`);
    for (let k = 0; k < 3; k++) {
      const xs = w(k);
      if (xs.length) console.log(`coins world ${k + 1}    avg ${avg(xs).toFixed(0)}  p10 ${pct(xs, 0.1)}  p90 ${pct(xs, 0.9)}  (n=${xs.length})`);
    }
    if (policy !== 'none') {
      const count = (list: ItemId[]) => list.reduce<Record<string, number>>((m, id) => ((m[id] = (m[id] ?? 0) + 1), m), {});
      const bought = count(res.flatMap((r) => r.bought));
      const picked = count(res.flatMap((r) => r.picked));
      const ids = ITEM_IDS.filter((id) => bought[id] || picked[id]);
      console.log('items            ' + ids.map((id) => `${ITEMS[id].icon}${ITEMS[id].name} ${bought[id] ?? 0}b/${picked[id] ?? 0}p`).join('  '));
      const traded = count(res.flatMap((r) => r.traded));
      const visits = res.filter((r) => r.cleared >= 5).length;
      console.log(`trader           ${res.reduce((n, r) => n + r.traded.length, 0)} buys over ${visits} runs that beat a serpent  ` + Object.entries(traded).map(([id, n]) => `${ITEMS[id as ItemId].icon}${ITEMS[id as ItemId].name} ${n}`).join('  '));
      const un = count(res.flatMap((r) => r.unlocks));
      if (Object.keys(un).length) console.log('unlocked in run  ' + Object.entries(un).map(([id, n]) => `${ITEMS[id as ItemId].name} ${n}`).join('  '));
      for (let k = 0; k < 3; k++) {
        const xs = res.filter((r) => r.afterShop.length > k).map((r) => r.afterShop[k]);
        if (xs.length) console.log(`left after shop ${k + 1} avg ${avg(xs).toFixed(0)}  p90 ${pct(xs, 0.9)}  (n=${xs.length})`);
      }
      // Item impact: among runs that reached stage 10 (after the first shop), stages cleared with vs without it.
      const at10 = res.filter((r) => r.log.some((l) => l.stage === 10));
      const lift = ITEM_IDS.map((id) => {
        const w = at10.filter((r) => r.log.find((l) => l.stage === 10)!.items.includes(id)).map((r) => r.cleared);
        const wo = at10.filter((r) => !r.log.find((l) => l.stage === 10)!.items.includes(id)).map((r) => r.cleared);
        return { id, n: w.length, d: w.length >= 4 && wo.length >= 4 ? avg(w) - avg(wo) : NaN };
      }).filter((x) => !Number.isNaN(x.d)).sort((a, b) => b.d - a.d);
      console.log('impact at 10     ' + lift.map((x) => `${ITEMS[x.id].icon}${ITEMS[x.id].name} ${x.d >= 0 ? '+' : ''}${x.d.toFixed(1)} (n${x.n})`).join('  '));
    }
    console.log('');
  }
  console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
