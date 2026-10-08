import type { Paise } from '@storefront/contracts';
import type { ConsumingAction } from './actions';
import type { EffectiveLine } from './pricing-line';
import { matchesSelector } from './selector';

export interface BundleCandidate<P> {
  promotion: P;
  action: ConsumingAction;
}

export interface LineUnits {
  lineIndex: number;
  units: number;
}

export interface BundleApplication<P> {
  promotion: P;
  savings: Paise;
  lineUnits: LineUnits[];
}

export interface OptimizerOptions {
  /** Hard cap on search nodes; keeps results deterministic for identical carts. */
  nodeBudget?: number;
  /** Safety valve against pathological carts; only consulted every 1024 nodes. */
  timeBudgetMs?: number;
  maxApplicationsPerPromotion?: number;
}

export interface OptimizerResult<P> {
  applications: BundleApplication<P>[];
  savings: Paise;
  greedyApplications: BundleApplication<P>[];
  greedySavings: Paise;
  strategy: 'branch-and-bound' | 'greedy-fallback';
  nodesExplored: number;
}

interface UnitClass {
  price: Paise;
  lines: number[];
  count: number;
}

interface Application {
  offer: number;
  cons: Array<[cls: number, count: number]>;
  savings: Paise;
  ubWeight: number;
}

const DEFAULTS = { nodeBudget: 50_000, timeBudgetMs: 250, maxApplicationsPerPromotion: 2_000 };

/**
 * Chooses non-overlapping applications of unit-consuming offers (bundles, mix-and-match, buy-x-get-y)
 * that maximise total savings — weighted set packing, which greedy "biggest offer first" gets wrong.
 *
 * Units with identical price and identical offer eligibility are interchangeable, so the search runs
 * over unit classes. Branch-and-bound picks the lowest non-empty class and either uses one of its
 * units in some application or retires the class entirely. Pruning uses a per-unit savings bound and
 * a dominance memo keyed by the remaining-quantity vector. The greedy plan seeds the incumbent, so
 * exhausting the budget still returns a plan at least as good as greedy.
 */
export function optimizeBundles<P>(
  lines: readonly EffectiveLine[],
  offers: readonly BundleCandidate<P>[],
  options: OptimizerOptions = {},
): OptimizerResult<P> {
  const { nodeBudget, timeBudgetMs, maxApplicationsPerPromotion } = { ...DEFAULTS, ...options };
  const slotsByOffer = offers.map(o => o.action.slots());

  const classIndex = new Map<string, number>();
  const rawClasses: Array<UnitClass & { tags: Set<string> }> = [];
  lines.forEach((line, lineIndex) => {
    const tags: string[] = [];
    slotsByOffer.forEach((slots, i) => slots.forEach((slot, j) => matchesSelector(slot.selector, line) && tags.push(`${i}.${j}`)));
    if (!tags.length || line.qty <= 0) return;
    const key = `${tags.join('|')}@${line.effectiveUnitPrice}`;
    let k = classIndex.get(key);
    if (k === undefined) {
      k = rawClasses.length;
      classIndex.set(key, k);
      rawClasses.push({ price: line.effectiveUnitPrice, lines: [], count: 0, tags: new Set(tags) });
    }
    rawClasses[k].lines.push(lineIndex);
    rawClasses[k].count += line.qty;
  });

  let truncated = false;
  const rawApps: Array<Omit<Application, 'ubWeight'>> = [];
  offers.forEach((offer, i) => {
    const produced = enumerateApplications(rawClasses, slotsByOffer[i], i, offer.action, maxApplicationsPerPromotion);
    truncated ||= produced.truncated;
    for (const app of produced.apps) rawApps.push({ offer: i, cons: app.cons, savings: app.savings });
  });

  const rhoRaw = rawClasses.map(() => 0);
  for (const app of rawApps) {
    const size = app.cons.reduce((s, [, c]) => s + c, 0);
    for (const [k] of app.cons) rhoRaw[k] = Math.max(rhoRaw[k], app.savings / size);
  }

  // Branch on the most valuable classes first so good incumbents appear early.
  const order = rawClasses
    .map((_, k) => k)
    .filter(k => rhoRaw[k] > 0)
    .sort((a, b) => rhoRaw[b] - rhoRaw[a] || rawClasses[b].price - rawClasses[a].price || a - b);
  const remap = new Map(order.map((k, idx) => [k, idx]));
  const classes = order.map(k => rawClasses[k]);
  const rho = order.map(k => rhoRaw[k]);
  const K = classes.length;

  const apps: Application[] = rawApps
    .map(a => {
      const cons = a.cons.map(([k, c]) => [remap.get(k)!, c] as [number, number]).sort((x, y) => x[0] - y[0]);
      return { offer: a.offer, cons, savings: a.savings, ubWeight: cons.reduce((s, [k, c]) => s + c * rho[k], 0) };
    })
    .sort((a, b) => b.savings - a.savings || a.offer - b.offer);
  const appsByClass: number[][] = classes.map(() => []);
  apps.forEach((app, idx) => app.cons.forEach(([k]) => appsByClass[k].push(idx)));

  const state = classes.map(c => c.count);
  const feasible = (a: Application) => a.cons.every(([k, c]) => state[k] >= c);
  const take = (a: Application, sign: 1 | -1) => a.cons.forEach(([k, c]) => (state[k] -= sign * c));

  const greedyPath: number[] = [];
  let greedySavings = 0;
  for (let progressed = true; progressed;) {
    progressed = false;
    const idx = apps.findIndex(feasible);
    if (idx >= 0) {
      take(apps[idx], 1);
      greedyPath.push(idx);
      greedySavings += apps[idx].savings;
      progressed = true;
    }
  }
  greedyPath.forEach(idx => take(apps[idx], -1));

  let best = greedySavings;
  let bestPath = [...greedyPath];
  let nodes = 0;
  let aborted = false;
  const deadline = performance.now() + timeBudgetMs;
  const seen = new Map<string, number>();
  const path: number[] = [];

  const dfs = (acc: number, from: number, ub: number): void => {
    if (++nodes > nodeBudget || ((nodes & 1023) === 0 && performance.now() > deadline)) {
      aborted = true;
      return;
    }
    if (acc > best) {
      best = acc;
      bestPath = [...path];
    }
    let k = from;
    while (k < K && state[k] === 0) k++;
    if (k === K) return;
    if (acc + ub < best + 1 - 1e-6) return;
    const key = state.join(',');
    const prev = seen.get(key);
    if (prev !== undefined && prev >= acc) return;
    seen.set(key, acc);

    for (const idx of appsByClass[k]) {
      const app = apps[idx];
      if (!feasible(app)) continue;
      take(app, 1);
      path.push(idx);
      dfs(acc + app.savings, k, ub - app.ubWeight);
      path.pop();
      take(app, -1);
      if (aborted) return;
    }
    const held = state[k];
    state[k] = 0;
    dfs(acc, k + 1, ub - held * rho[k]);
    state[k] = held;
  };
  if (K > 0)
    dfs(
      0,
      0,
      state.reduce((s, n, k) => s + n * rho[k], 0),
    );

  const materialize = (planPath: number[]): BundleApplication<P>[] => {
    const remaining = new Map<number, number>();
    lines.forEach((l, i) => remaining.set(i, l.qty));
    return planPath.map(idx => {
      const app = apps[idx];
      const units = new Map<number, number>();
      for (const [k, count] of app.cons) {
        let need = count;
        for (const lineIndex of classes[k].lines) {
          const avail = remaining.get(lineIndex)!;
          const used = Math.min(avail, need);
          if (!used) continue;
          remaining.set(lineIndex, avail - used);
          units.set(lineIndex, (units.get(lineIndex) ?? 0) + used);
          need -= used;
          if (!need) break;
        }
      }
      return {
        promotion: offers[app.offer].promotion,
        savings: app.savings,
        lineUnits: [...units].map(([lineIndex, u]) => ({ lineIndex, units: u })).sort((a, b) => a.lineIndex - b.lineIndex),
      };
    });
  };

  return {
    applications: materialize(bestPath),
    savings: best,
    greedyApplications: materialize(greedyPath),
    greedySavings,
    strategy: aborted || truncated ? 'greedy-fallback' : 'branch-and-bound',
    nodesExplored: nodes,
  };
}

/** Every distinct way one application of an offer can draw units from the available classes. */
function enumerateApplications(
  classes: ReadonlyArray<UnitClass & { tags: Set<string> }>,
  slots: ReadonlyArray<{ qty: number }>,
  offerIndex: number,
  action: ConsumingAction,
  cap: number,
): { apps: Array<{ cons: Array<[number, number]>; savings: Paise }>; truncated: boolean } {
  const eligible = slots.map((_, j) =>
    classes
      .map((c, k) => ({ c, k }))
      .filter(({ c }) => c.tags.has(`${offerIndex}.${j}`))
      .sort((a, b) => b.c.price - a.c.price || a.k - b.k)
      .map(({ k }) => k),
  );
  const used = classes.map(() => 0);
  const prices: Paise[] = [];
  const out = new Map<string, { cons: Array<[number, number]>; savings: Paise }>();
  let leaves = 0;
  let truncated = false;
  const leafCap = cap * 5;

  const fill = (slot: number, pos: number, need: number): void => {
    if (truncated) return;
    if (need === 0) {
      if (slot + 1 < slots.length) return fill(slot + 1, 0, slots[slot + 1].qty);
      if (++leaves > leafCap || out.size >= cap) {
        truncated = true;
        return;
      }
      const cons = used.flatMap((c, k) => (c > 0 ? [[k, c] as [number, number]] : []));
      const key = cons.map(([k, c]) => `${k}x${c}`).join(',');
      if (out.has(key)) return;
      const savings = action.savings(prices);
      if (savings > 0) out.set(key, { cons, savings });
      return;
    }
    const list = eligible[slot];
    if (pos >= list.length) return;
    const k = list[pos];
    const maxTake = Math.min(need, classes[k].count - used[k]);
    for (let c = maxTake; c >= 0; c--) {
      used[k] += c;
      for (let n = 0; n < c; n++) prices.push(classes[k].price);
      fill(slot, pos + 1, need - c);
      prices.length -= c;
      used[k] -= c;
    }
  };
  if (slots.length) fill(0, 0, slots[0].qty);
  return { apps: [...out.values()], truncated };
}
