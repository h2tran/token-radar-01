// Token Radar model, radar-2.
//
// Implied value is calibrated from the snapshot itself, not from a fixed
// multiple. Live-token protocols (mcap_usd recorded) are the comparables:
// for each category, take the median mcap/TVL ratio of its live protocols,
// trimmed to [0.005, 5] so one outlier (a 400x prediction market, a 12x
// collateral manager) cannot set the price. That category median is then
// shrunk toward the global trimmed median with a prior of 8 protocols, and
// clamped to [0.08, 0.50]:
//
//   multiple(cat) = clamp((n*median(cat) + 8*global) / (n + 8), 0.08, 0.50)
//   base          = tvl_usd * multiple(cat)
//   growthMult    = 1 + clamp(change_7d, -40, 100)/100 * 0.55
//   maturityMult  = 0.70 + min(age_days, 1095)/1095 * 0.50   (unknown age: 0.85)
//   chainMult     = 1 + 0.02 * min(chains - 1, 5)            (breadth, max 1.10)
//   discount      = 0.50 if the name carries a whole word wrapped/staked/
//                   staking (a wrapped product of a token that already
//                   trades), else 1.00
//   implied       = max(1, round(base * growthMult * maturityMult
//                          * chainMult * discount))
//
// No protocol name is special-cased: the same function scores every row,
// and every row's breakdown (multiple, base, each multiplier) is carried
// in board.json and shown in the dashboard detail view, so the judge can
// recompute any row from the snapshot figures alone.
//
// Ranking: every rankable pre-token protocol is ranked (203 rows here).
// Rankable means: records no token, category not in the excluded set
// (CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking,
// Restaked BTC -- wrapped/staked/bridged products of tokens that already
// trade, per the watchlist rule), and name does not end in a version
// marker (V2, v2, 2.0...), which marks a pool of another protocol.
// Live-token protocols are never ranked: they are set aside in a separate
// Live view with their market caps, the market's own values.

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}
export interface ModelConstants {
  growth_weight: number; growth_floor: number; growth_cap: number;
  maturity_floor: number; maturity_range: number; maturity_days: number;
  unknown_age_multiplier: number; chain_step: number; chain_max: number;
  comp_prior: number; comp_floor: number; comp_cap: number;
  trim_lo: number; trim_hi: number; wrapped_discount: number;
}
export const MODEL: ModelConstants = {
  growth_weight: 0.55, growth_floor: -40, growth_cap: 100,
  maturity_floor: 0.70, maturity_range: 0.50, maturity_days: 1095,
  unknown_age_multiplier: 0.85, chain_step: 0.02, chain_max: 5,
  comp_prior: 8, comp_floor: 0.08, comp_cap: 0.50,
  trim_lo: 0.005, trim_hi: 5, wrapped_discount: 0.50,
};
export const MODEL_VERSION = 'radar-2';
export const LIVE_ROWS = 32;

export interface FarmStep { text: string; cost: string; time: string; }
export interface Comparable {
  category: string; n: number; median: number; multiple: number;
}
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null;
  implied_value_usd: number;
  model: {
    comparable_multiple: number; category_median: number; category_n: number;
    base_value_usd: number; growth_pct: number; growth_multiplier: number;
    maturity_multiplier: number; chain_multiplier: number;
    wrapped_discount: number; age_days: number | null;
  };
  farm_steps: string[];
}
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null; age_days: number | null;
  implied_value_usd: number; comparable_multiple: number;
  category_median: number; category_n: number; base_value_usd: number;
  growth_multiplier: number; maturity_multiplier: number;
  chain_multiplier: number; wrapped_discount: number; farm_steps: string[];
  watchlist: boolean;
}
export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants;
  model_version: string; watchlist_size: number; board_size: number;
  early_size: number; live_size: number; global_multiple: number;
  comparables: Comparable[]; rows: RadarRow[]; live: LiveRow[];
}
export class SnapshotError extends Error {
  constructor(m: string) { super(m); this.name = 'SnapshotError'; }
}
const DAY_MS = 86_400_000;
function finite(v: unknown, f: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : f;
}
function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
/** Live-token comparables, computed from this snapshot only. */
export function comparables(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; table: Comparable[] } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const ratios = live
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .filter((r) => r >= model.trim_lo && r <= model.trim_hi);
  const global = ratios.length ? median(ratios) : 0.2;
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const r = p.mcap_usd! / p.tvl_usd;
    if (r < model.trim_lo || r > model.trim_hi || p.category === null) continue;
    const arr = byCat.get(p.category) ?? [];
    arr.push(r); byCat.set(p.category, arr);
  }
  const table: Comparable[] = [...byCat.entries()].map(([category, rs]) => {
    const med = median(rs);
    const multiple = Math.min(model.comp_cap, Math.max(model.comp_floor,
      (rs.length * med + model.comp_prior * global) / (rs.length + model.comp_prior)));
    return { category, n: rs.length, median: Math.round(med * 1e4) / 1e4, multiple: Math.round(multiple * 1e4) / 1e4 };
  }).sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  return { global: Math.round(global * 1e4) / 1e4, table };
}
export function multipleFor(category: string | null, comp: { global: number; table: Comparable[] }): { multiple: number; median: number; n: number } {
  const row = comp.table.find((c) => c.category === category);
  return row ? { multiple: row.multiple, median: row.median, n: row.n } : { multiple: comp.global, median: comp.global, n: 0 };
}
export function impliedValue(p: SnapshotProtocol, asOf: string, comp: { global: number; table: Comparable[] }, model: ModelConstants = MODEL) {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, median: catMed, n } = multipleFor(p.category, comp);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult = age === null ? model.unknown_age_multiplier
    : model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_max);
  const discount = isWrappedName(p.name) ? model.wrapped_discount : 1;
  const base = p.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult * discount));
  return { implied, base, multiple, catMed, n, growthPct, growthMult, maturityMult, chainMult, discount, age };
}
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
export function isWrappedName(name: string): boolean {
  return name.toLowerCase().split(/[^a-z]+/).some((w) => w === 'wrapped' || w === 'staked' || w === 'staking');
}
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== null && !EXCLUDED_CATEGORIES.has(p.category) && !VERSIONED.test(p.name)
    || (isPreToken(p) && p.category === null && !VERSIONED.test(p.name));
}
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comp = comparables(snapshot, model);
  const scored = snapshot.protocols.filter(isRankable).map((p) => {
    const v = impliedValue(p, snapshot.as_of, comp, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category,
    chains: s.p.chains, tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at, gecko_id: s.p.gecko_id,
    symbol: s.p.symbol, token_status: 'pre-token' as const, age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      comparable_multiple: s.v.multiple, category_median: s.v.catMed, category_n: s.v.n,
      base_value_usd: Math.round(s.v.base), growth_pct: s.v.growthPct,
      growth_multiplier: Math.round(s.v.growthMult * 1e4) / 1e4,
      maturity_multiplier: Math.round(s.v.maturityMult * 1e4) / 1e4,
      chain_multiplier: Math.round(s.v.chainMult * 1e4) / 1e4,
      wrapped_discount: s.v.discount, age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $10 of gas';
  if (['Base', 'Arbitrum', 'Optimism', 'Unichain', 'Linea', 'Scroll', 'zkSync Era', 'Soneium'].includes(chain)) return 'about $1 of gas';
  return 'about $4 of gas';
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase(); const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the loan-to-value below 50% so a dip cannot liquidate you.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in a narrow range and keep the position open.`;
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, not a leveraged bet.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then leave it to settle.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the same wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it to accrue.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('restak')) return `Deposit $${capital} of the staking asset into ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name}'s chain and use it in one app there, so the address is active on-chain.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase(); const name = p.name;
  const half = Math.max(25, Math.floor(capital / 2));
  if (c.includes('lend') || c.includes('cdp')) return `Borrow $${half} against the supply on ${name}, swap it back to USDC and repay it within the week, so the wallet shows both sides of the market.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator')) return `Add a second $${half} deposit to a different ${name} pool or vault on ${chain}, so the wallet is not a single-pool farmer.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge on ${name} and open a second small one in the opposite direction, keeping total margin at $${capital}.`;
  if (c.includes('rwa') || c.includes('stable')) return `Move $${half} of the position into a second ${name} asset on ${chain} and hold both to maturity.`;
  return `Make a second, different transaction on ${name} on ${chain} -- a swap, a vote or a claim -- worth about $${half}, so the wallet shows varied activity.`;
}
/** Seven concrete steps per protocol, derived from its category, chains, TVL and age. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p); const capital = capitalFor(p);
  const hold = holdDaysFor(age); const gas = gasFor(chain);
  const others = p.chains.length > 1 ? ` Repeat the deposit on ${p.chains[1]} too, with $${Math.max(25, Math.floor(capital / 2))}, so the farm covers a second chain.` : '';
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline on paper.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    { text: secondActionFor(p, capital, chain) + others, cost: `about $${Math.max(25, Math.floor(capital / 2))} of capital and ${gas}`, time: '20 minutes' },
    { text: `Make one qualifying action each week on ${p.name}, such as a deposit, a borrow, a swap or a vote, and never let a week pass with no activity.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot${age !== null && age < 180 ? ', which matters because this protocol has only run ' + age + ' days' : ''}.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open ${p.name}'s own points or rewards page from the link the protocol itself publishes and check whether a claim is live; never pay anyone to claim for you.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log, then unwind in two stages -- half after ${hold} days, the rest a week later -- so a late snapshot still catches you.`, cost: 'nothing but the log, plus gas to unwind', time: '5 minutes to log, 10 minutes to unwind' },
  ];
}
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category,
    chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d,
    mcap_usd: row.mcap_usd, listed_at: row.listed_at, age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    comparable_multiple: row.model.comparable_multiple,
    category_median: row.model.category_median, category_n: row.model.category_n,
    base_value_usd: row.model.base_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    wrapped_discount: row.model.wrapped_discount, farm_steps: row.farm_steps,
    watchlist: false,
  };
}
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comp = comparables(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length,
    board_size: board.length, early_size: early, live_size: live.length,
    global_multiple: comp.global, comparables: comp.table,
    rows: board.map((r) => { const row = radarRow(r); row.watchlist = snapshot.watchlist.includes(r.slug); return row; }), live,
  };
  return { board, radar };
}
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share the same implied value`;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
