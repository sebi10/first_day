// Search: the Manual / Reference step's task search, the airplane's IPC and the
// supply catalog (docs/JOBFLOW.md 6). Pure and deterministic, no DOM: the UI,
// the bots and the tests share it. Indexes are derived (never stored): static
// ones once per module, an airplane's IPC per airplane state in an LRU of 12.
import { ataTitle, figuresFor, planeModel, plantRows, pmaParts, type AnyAta, type Ata, type IpcRow } from './aircraft';
import { causeOf, findingOf, fixesOf, needsOf, siteOf, symptomOf, symptomText } from './alerts';
import { islandAircraft } from './chain';
import { effectivePn, judgeSlot, stdPickFor } from './flow';
import { allItems, itemById } from './items';
import { taskById, tasksFor, type Task } from './tasks';
import type { Alert, Asset, IslandState, Item, ItemCat, ItemId, ItemTrade, OpsRole, TaskId } from './types';

export type Doc = {
  /** TaskId, ItemId, or `${pn}@${fig}.${item}` for an IPC row */
  id: string;
  kind: 'task' | 'ipc' | 'item';
  /** "32-40-02 Main brake linings: replacement" · "066-19600 LINING, HEAVY DUTY (METALLIC)" · "Dual-function receptacle 20 A, TR" */
  title: string;
  /** "IPC Fig 12 item 21A · EFF C · UPA 2 · SUPSDS 066-19500" · "NEC 406.4(D)(3), 406.4(D)(4)" · "20 A · TR · AFCI + GFCI" */
  sub: string;
  chapter: string;
  /** everything searchable */
  text: string;
  /** normalized P/N (upper case, no spaces or dashes) */
  pn?: string;
  /** print order: figure order, then catalog order */
  order: number;
  ref: { task?: TaskId; item?: ItemId; ata?: AnyAta; fig?: number; row?: string; eff?: string; applies?: boolean; supsdBy?: { pn: string; code: 1 | 2 | 3 }; np?: boolean; alt?: boolean; ea?: string; tag?: string; pma?: boolean };
};

type DocIx = { title: Set<string>; text: Set<string> };
export type Index = {
  key: string;
  docs: Doc[];
  /** token -> doc indices (title and text) */
  post: Map<string, number[]>;
  /** vocabulary by frequency, most frequent first */
  vocab: [string, number][];
  chapters: { chapter: string; n: number }[];
  /** per doc: its title and text tokens */
  toks: DocIx[];
};

// ---------------------------------------------------------------------------
// Tokens

/** a P/N token: letters, digits, dashes, slashes, with at least one digit */
const PN_RE = /[a-z0-9]+(?:[-/.][a-z0-9]+)+/g;
const normPn = (x: string) => x.toUpperCase().replace(/[\s\-/.]/g, '');

function stem(w: string): string {
  if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !/\d/.test(w)) return w.slice(0, -1);
  return w;
}

/** lower case; split on spaces and punctuation, but keep a P/N token whole (and add it without dashes); strip a trailing plural */
export function tokenize(text: string, _trade?: OpsRole): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (w: string) => {
    if (!w || seen.has(w)) return;
    seen.add(w);
    out.push(w);
  };
  for (const m of t.matchAll(PN_RE)) {
    const whole = m[0];
    if (/\d/.test(whole)) {
      add(whole);
      add(whole.replace(/[-/.]/g, ''));
    } else {
      // a hyphenated word: whole, joined, and its parts (each without a trailing plural)
      add(stem(whole));
      add(stem(whole.replace(/[-/.]/g, '')));
      for (const p of whole.split(/[-/.]/)) if (p.length >= 2) add(stem(p));
    }
  }
  for (const m of t.matchAll(/[a-z0-9]+/g)) {
    const w = m[0];
    if (w.length < 2 && !/\d/.test(w)) continue;
    add(stem(w));
  }
  return out;
}

/** synonyms by trade, expanded at index time (a doc that says `lining` is found by `pads`) */
const SYN: Record<OpsRole | 'build', [string, string[]][]> = {
  mech: [
    ['pad', ['lining']],
    ['alt', ['alternator']],
    ['gen', ['generator', 'starter-generator']],
    ['genny', ['generator']],
    ['com', ['transceiver']],
    ['radio', ['transceiver']],
    ['oring', ['o-ring']],
    ['o ring', ['o-ring']],
    ['tyre', ['tire']],
    ['prop', ['propeller']],
    ['5606', ['mil-prf-5606']],
    ['red oil', ['mil-prf-5606']],
    ['wire', ['safety']],
    ['oil filter', ['filter']],
    ['lockwire', ['safety']],
  ],
  elec: [
    ['outlet', ['receptacle']],
    ['plug-in', ['receptacle']],
    ['gfi', ['gfci']],
    ['afi', ['afci']],
    ['df', ['dual-function']],
    ['dual function', ['dual-function']],
    ['romex', ['nm-b']],
    ['pipe', ['conduit']],
    ['j-box', ['box']],
    ['junction', ['box']],
    ['ats', ['transfer']],
    ['megger', ['insulation']],
    ['hot tub', ['spa']],
    ['three-way', ['3-way']],
    ['3 way', ['3-way']],
    ['tingle', ['bonding', 'ground']],
    ['shock', ['bonding', 'ground']],
    ['water heater', ['heater', 'element']],
  ],
  build: [],
};

/** index-time expansion: add a synonym's own words to a doc that says what it means */
function expand(tokens: string[], trade: OpsRole | 'build'): string[] {
  const have = new Set(tokens);
  const out = [...tokens];
  for (const [key, targets] of SYN[trade]) {
    const t = targets.flatMap((x) => tokenize(x));
    if (!t.some((x) => have.has(x))) continue;
    for (const k of tokenize(key)) if (!have.has(k)) {
      have.add(k);
      out.push(k);
    }
  }
  return out;
}

export function buildIndex(key: string, docs: Doc[], trade: OpsRole | 'build' = 'mech'): Index {
  const post = new Map<string, number[]>();
  const freq = new Map<string, number>();
  const toks: DocIx[] = [];
  const chapters = new Map<string, number>();
  docs.forEach((d, i) => {
    const title = new Set(tokenize(d.title, trade as OpsRole));
    const text = new Set(expand([...title, ...tokenize(`${d.sub} ${d.text}`, trade as OpsRole)], trade));
    toks.push({ title, text });
    for (const t of text) {
      (post.get(t) ?? post.set(t, []).get(t)!).push(i);
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    chapters.set(d.chapter, (chapters.get(d.chapter) ?? 0) + 1);
  });
  const vocab = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return { key, docs, post, vocab, chapters: [...chapters.entries()].map(([chapter, n]) => ({ chapter, n })), toks };
}

/** one edit away (tokens of 5+ characters) */
function oneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export type Hit = { doc: Doc; score: number; matched: string[] };

/**
 * Score a doc for query tokens q1..qn: per token the best of an exact P/N 12, a
 * P/N substring (4+ characters) 8, an exact title token 3, a title prefix 2, an
 * exact text token 1.5, a text prefix 1, one edit away (5+ characters) 0.6;
 * summed. A token that matched nothing leaves the sum x 0.35. Plus `boost`.
 * Ties: print order, then id.
 */
export function search(ix: Index, q: string, o: { limit?: number; chapter?: string; boost?: (d: Doc) => number } = {}): Hit[] {
  const qt = tokenize(q);
  const limit = o.limit ?? 20;
  if (!qt.length) {
    if (!o.chapter) return [];
    return ix.docs
      .map((doc) => ({ doc, score: o.boost?.(doc) ?? 0, matched: [] as string[] }))
      .filter((h) => h.doc.chapter === o.chapter)
      .sort((a, b) => b.score - a.score || a.doc.order - b.doc.order || (a.doc.id < b.doc.id ? -1 : 1))
      .slice(0, limit);
  }
  // candidate docs: postings of the tokens, their prefixes and near misses, and P/N substrings
  const per: Map<number, number>[] = qt.map(() => new Map());
  const note = (k: number, i: number, sc: number) => {
    const m = per[k];
    if ((m.get(i) ?? 0) < sc) m.set(i, sc);
  };
  qt.forEach((t, k) => {
    const np = normPn(t);
    if (/\d/.test(t) && np.length >= 2) {
      ix.docs.forEach((d, i) => {
        if (!d.pn) return;
        if (d.pn === np) note(k, i, 12);
        else if (np.length >= 4 && d.pn.includes(np)) note(k, i, 8);
      });
    }
    for (const [word] of ix.vocab) {
      const exact = word === t;
      const prefix = !exact && word.startsWith(t) && t.length >= 2;
      const near = !exact && !prefix && t.length >= 5 && oneEdit(word, t);
      if (!exact && !prefix && !near) continue;
      for (const i of ix.post.get(word) ?? []) {
        const inTitle = ix.toks[i].title.has(word);
        const sc = exact ? (inTitle ? 3 : 1.5) : prefix ? (inTitle ? 2 : 1) : 0.6;
        note(k, i, sc);
      }
    }
  });
  const scores = new Map<number, { score: number; matched: string[] }>();
  per.forEach((m, k) => {
    for (const [i, sc] of m) {
      const cur = scores.get(i) ?? { score: 0, matched: [] };
      cur.score += sc;
      cur.matched.push(qt[k]);
      scores.set(i, cur);
    }
  });
  const hits: Hit[] = [];
  for (const [i, v] of scores) {
    const doc = ix.docs[i];
    if (o.chapter && doc.chapter !== o.chapter) continue;
    const full = v.matched.length === qt.length;
    hits.push({ doc, score: (full ? v.score : v.score * 0.35) + (o.boost?.(doc) ?? 0), matched: v.matched });
  }
  hits.sort((a, b) => b.score - a.score || a.doc.order - b.doc.order || (a.doc.id < b.doc.id ? -1 : 1));
  return hits.slice(0, limit);
}

/** autocomplete chips: the 6 most frequent vocabulary tokens starting with the prefix (2+ characters typed), P/Ns last */
export function complete(ix: Index, prefix: string, n = 6): string[] {
  const p = prefix.trim().toLowerCase();
  if (p.length < 2) return [];
  const words = ix.vocab.filter(([w]) => w.startsWith(p) && w !== p);
  const plain = words.filter(([w]) => !/\d/.test(w)).map(([w]) => w);
  const pns = words.filter(([w]) => /\d/.test(w) && w.includes('-')).map(([w]) => w);
  return [...plain, ...pns].slice(0, n);
}

// ---------------------------------------------------------------------------
// The three indexes

const TASK_ORDER = new Map<string, number>();
function taskDocs(tasks: Task[]): Doc[] {
  return tasks.map((t, i) => ({
    id: t.id,
    kind: 'task',
    title: `${t.no} ${t.title}`,
    sub: [t.book === 'REF' ? 'Code & procedure reference' : t.book === 'GSM' ? 'Generator service manual' : t.book === 'AFM' ? 'Flight manual' : 'Maintenance manual', t.nec?.length ? `NEC ${t.nec.join(', ')}` : '', t.kind ? '' : 'reference only']
      .filter(Boolean)
      .join(' · '),
    chapter: t.chapter,
    text: [t.short, ...t.keywords, ...(t.nec ?? []), t.summary ?? '', ...(t.steps ?? [])].join(' '),
    order: TASK_ORDER.get(t.id) ?? i,
    ref: { task: t.id },
  }));
}

const manualMemo = new Map<string, Index>();
/** the manual set an asset's trade searches: the model's AMM and AFM, the generator manual, or the code reference */
export function manualIndex(s: IslandState | null, asset: Pick<Asset, 'kind' | 'model'>, role: OpsRole): Index {
  const key = `${role}|${asset.kind === 'plane' ? planeModel(asset.model) : asset.model}`;
  const hit = manualMemo.get(key);
  if (hit) return hit;
  const tasks = tasksFor(s, asset, role).slice().sort((a, b) => (a.no < b.no ? -1 : a.no > b.no ? 1 : 0));
  tasks.forEach((t, i) => TASK_ORDER.set(t.id, i));
  const ix = buildIndex(key, taskDocs(tasks), role);
  manualMemo.set(key, ix);
  return ix;
}

const effText = (row: IpcRow) => (row.eff ? `EFF ${row.eff}` : 'EFF ALL');
const upaText = (row: IpcRow) => `UPA ${typeof row.upa === 'number' ? row.upa : row.upa}`;

/** the airplane indexes: by seed, asset and the EAs on it (an EA adds its ICA part as a normal row), least recently used out first */
const ipcMemo = new Map<string, Index>();
export function ipcIndex(s: Pick<IslandState, 'seed' | 'eas'>, asset: Pick<Asset, 'id' | 'model'>): Index {
  const eas = (s.eas ?? []).filter((e) => e.assetId === asset.id);
  const key = `${s.seed}|${asset.id}|${eas.map((e) => `${e.ata}:${e.tag}:${e.pn}`).join(',')}`;
  const hit = ipcMemo.get(key);
  if (hit) {
    ipcMemo.delete(key);
    ipcMemo.set(key, hit);
    return hit;
  }
  if (ipcMemo.size >= 12) ipcMemo.delete(ipcMemo.keys().next().value!);
  const ac = islandAircraft(s.seed, asset);
  const docs: Doc[] = [];
  let order = 0;
  for (const fig of figuresFor(ac)) {
    const chapter = `Fig ${fig.fig} · ${fig.ata} ${ataTitle(fig.ata)}`;
    for (const row of fig.rows) {
      const it = itemById(row.pn);
      docs.push({
        id: `${row.pn}@${fig.fig}.${row.item}`,
        kind: 'ipc',
        title: `${row.pn} ${row.nomen}`,
        sub: [`IPC Fig ${fig.fig} item ${row.item}`, effText(row), upaText(row), ...row.notes].join(' · '),
        chapter,
        text: [row.text, ...(it?.tags ?? []), row.tag ?? ''].join(' '),
        pn: normPn(row.pn),
        order: order++,
        ref: {
          ...(it && !row.np && row.indent >= 1 ? { item: row.pn } : {}),
          ata: fig.ata,
          fig: fig.fig,
          row: row.item,
          eff: row.eff,
          applies: row.applies,
          ...(row.supsdBy ? { supsdBy: row.supsdBy } : {}),
          ...(row.np ? { np: true } : {}),
          ...(row.alt ? { alt: true } : {}),
          ...(row.tag ? { tag: row.tag } : {}),
        },
      });
    }
  }
  // an alteration's ICA part, once engineering has authorized it for this airplane: a normal row
  for (const e of eas) {
    const row = plantRows(ac.model, e.ata as Ata).find((x) => x.pn === e.pn);
    const it = itemById(e.pn);
    docs.push({
      id: `${e.pn}@${e.ea}`,
      kind: 'ipc',
      title: `${e.pn} ${row?.nomen ?? it?.nomen ?? 'PART'}`,
      sub: [`${e.ea} · ${it?.ica ?? 'STC holder'}`, row ? upaText(row) : ''].filter(Boolean).join(' · '),
      chapter: `Fig ${figuresFor(ac).find((f) => f.ata === e.ata)?.fig ?? ''} · ${e.ata} ${ataTitle(e.ata as AnyAta)}`,
      text: [row?.text ?? '', ...(it?.tags ?? []), e.tag, 'ica', 'ea', 'engineering'].join(' '),
      pn: normPn(e.pn),
      order: order++,
      ref: { item: e.pn, ata: e.ata as AnyAta, ea: e.ea, applies: true, tag: e.tag },
    });
  }
  // FAA-PMA parts with the holder's eligibility (a legal replacement for the IPC part)
  for (const p of pmaParts(ac.model)) {
    const it = itemById(p.pn);
    if (!it) continue;
    docs.push({
      id: `${p.pn}@PMA`,
      kind: 'ipc',
      title: `${p.pn} ${it.nomen}`,
      sub: `FAA-PMA · replaces ${p.replaces} · ${p.eligibility}`,
      chapter: `Fig ${figuresFor(ac).find((f) => f.ata === p.ata)?.fig ?? ''} · ${p.ata} ${ataTitle(p.ata)}`,
      text: [it.nomen, ...it.tags, p.tag, 'pma', p.holder].join(' '),
      pn: normPn(p.pn),
      order: order++,
      ref: { item: p.pn, ata: p.ata, pma: true, tag: p.tag },
    });
  }
  const ix = buildIndex(key, docs, 'mech');
  ipcMemo.set(key, ix);
  return ix;
}

export const CAT_LABEL: Record<ItemCat, string> = {
  wheels: 'Wheels',
  brakes: 'Brakes',
  tires: 'Tires and tubes',
  prop: 'Propeller',
  hydraulic: 'Hydraulic',
  avionics: 'Avionics',
  dcpower: 'DC power',
  engine: 'Engine and oil',
  airframe: 'Airframe',
  hardware: 'Hardware and tools',
  fluids: 'Fluids and oils',
  generator: 'Generator',
  repair: 'Repair lots',
  wire: 'Wire (THHN/THWN-2)',
  cable: 'Cable (NM-B, UF-B)',
  breakers: 'Breakers',
  devices: 'Devices',
  boxes: 'Boxes and covers',
  conduit: 'Conduit and fittings',
  connectors: 'Connectors and splices',
  grounding: 'Grounding and bonding',
  equipment: 'Equipment',
  lots: 'Job lots',
  tools: 'Tools',
  site: 'Site work',
};

/** the catalog's spec line for an item: "20 A · TR · AFCI + GFCI" */
export function specLine(x: Item): string {
  const sp = x.spec;
  const out: string[] = [];
  if (sp) {
    if (sp.amps) out.push(`${sp.amps} A${sp.poles === 2 ? ' 2-pole' : ''}`);
    if (sp.awg) out.push(`${sp.awg} AWG${sp.conductors && sp.conductors > 1 ? `/${sp.conductors}` : ''}`);
    if (sp.tr) out.push('TR');
    if (sp.wr) out.push('WR');
    if (sp.df) out.push('AFCI + GFCI');
    else if (sp.afci) out.push('AFCI');
    else if (sp.gfci) out.push('GFCI');
    if (sp.single) out.push('single');
    if (sp.inUse) out.push('in-use');
    if (sp.volume) out.push(`${sp.volume} cu in`);
    if (sp.size) out.push(`${sp.size} in`);
    if (sp.fitting) out.push(sp.fitting === 'raintight' ? 'raintight' : 'set-screw');
    if (sp.burial !== undefined && sp.device === 'splice') out.push(sp.burial ? 'direct burial' : 'not for burial');
  }
  if (x.nec?.length && x.trade === 'elec') out.push(`NEC ${x.nec.slice(0, 2).join(', ')}`);
  return out.join(' · ');
}

const supplyMemo = new Map<ItemTrade, Index>();
/** the supply catalog a trade buys from (mech: shop consumables, lines, tools and every plane's parts; elec: materials, lots and tools; build: materials) */
export function supplyIndex(trade: ItemTrade): Index {
  const hit = supplyMemo.get(trade);
  if (hit) return hit;
  const items = allItems().filter((x) => x.trade === trade);
  const docs: Doc[] = items.map((x, i) => ({
    id: x.id,
    kind: 'item',
    title: x.trade === 'mech' ? `${x.pn} ${x.nomen}` : x.nomen,
    sub: [x.trade === 'mech' ? (x.models ? x.models.join(', ') : 'shop-wide') : x.pn, specLine(x)].filter(Boolean).join(' · '),
    chapter: CAT_LABEL[x.cat],
    text: [x.pn, x.nomen, ...x.tags, ...(x.nec ?? []), x.ica ?? '', x.pma ? 'pma' : ''].join(' '),
    pn: normPn(x.pn),
    order: i,
    ref: { item: x.id },
  }));
  const ix = buildIndex(`supply|${trade}`, docs, trade === 'build' ? 'build' : trade);
  supplyMemo.set(trade, ix);
  return ix;
}

// ---------------------------------------------------------------------------
// What each tier shows (6.4)

/**
 * The teaching tiers' help for an alert: keyword chips from the symptom and the
 * finding (tiers 0-2), the likely task and the right rows (tiers 0-1). Built
 * from the cause's own fix and pick, so a hint never recommends what the
 * install or receiving would reject. Nothing at tier 3+.
 */
export function hintsFor(s: IslandState, a: Alert, tier: number): { chips: string[]; tasks: TaskId[]; items: ItemId[] } {
  if (tier >= 3) return { chips: [], tasks: [], items: [] };
  const fixes = fixesOf(s, a);
  const task = fixes[0] ? taskById(fixes[0]) : undefined;
  const words = new Set(tokenize(`${symptomText(s, a)} ${findingOf(s, a, 3).text}`));
  const chips: string[] = [];
  if (task) {
    const num = task.book === 'REF' ? task.no.toLowerCase() : task.no.slice(0, 5);
    const kw = task.keywords.filter((k) => words.has(k) || words.has(tokenize(k)[0] ?? ''));
    for (const k of [...kw, ...task.keywords]) if (!chips.includes(k) && chips.length < 2) chips.push(k);
    chips.push(num);
  } else {
    const sym = symptomOf(a);
    for (const w of tokenize(typeof sym?.text === 'string' ? sym.text : '')) if (w.length > 3 && chips.length < 3) chips.push(w);
  }
  if (tier >= 2) return { chips, tasks: [], items: [] };
  const items = task && causeOf(a) ? stdPickFor(s, a, task).map((l) => l.item) : [];
  return { chips, tasks: task ? [task.id] : [], items };
}

/**
 * A result row's badges for this airplane. Tiers 0-2: "◀ this airplane", the
 * supersession to order (INTCHG 1 or 2) or the code-3 set warning, "not
 * effective", "NP", "ALT", and "Altered: research the records" on an assembly an
 * alteration replaced; every one built from judgeSlot, so none recommends a P/N
 * the install would reject. Tier 3+: only what the book prints.
 */
export function rowBadges(s: IslandState, asset: Pick<Asset, 'id' | 'model' | 'kind'>, d: Doc, tier: number): string[] {
  if (d.kind === 'item') {
    const x = d.ref.item ? itemById(d.ref.item) : undefined;
    if (!x) return [];
    if (tier >= 3 || x.trade !== 'elec') return x.spec ? [specLine(x)] : [];
    const out: string[] = [];
    const sp = x.spec ?? {};
    if (sp.amps && sp.device === 'receptacle') out.push(`for ${sp.amps} A circuits`);
    if (sp.device === 'receptacle' && !sp.tr) out.push('not TR: TR is required in dwellings (406.12)');
    if (sp.df) out.push('AFCI + GFCI: kitchen and laundry replacements');
    if (sp.device === 'cover' && !sp.inUse) out.push('not an in-use cover (406.9(B)(1))');
    if (sp.fitting === 'setscrew') out.push('set-screw: dry locations only (358.42)');
    if (sp.device === 'splice' && !sp.burial) out.push('not listed for direct burial (300.5(E))');
    return out;
  }
  if (d.kind !== 'ipc' || asset.kind !== 'plane') return [];
  if (tier >= 3) {
    const out: string[] = [];
    if (d.ref.eff) out.push(`EFF ${d.ref.eff}`);
    if (d.ref.supsdBy) out.push(`SUPSD BY ${d.ref.supsdBy.pn} (INTCHG ${d.ref.supsdBy.code})`);
    if (d.ref.np) out.push('NP');
    if (d.ref.alt) out.push('ALT');
    if (d.ref.ea) out.push(d.ref.ea);
    if (d.ref.pma) out.push('PMA');
    return out;
  }
  const pn = d.id.split('@')[0];
  const ac = islandAircraft(s.seed, asset);
  if (d.ref.np) {
    const next = /ITEM (-?\d+A?)/.exec(d.sub)?.[1];
    return [next ? `NP: order item ${next}${next.endsWith('A') ? '' : ' or its A row'}` : 'NP: order the next higher assembly'];
  }
  const tag = d.ref.tag;
  const ata = d.ref.ata;
  if (!tag || !ata) return [];
  const c = judgeSlot(s, asset, ata, tag, pn);
  const out: string[] = [];
  if (c.ok && !c.unapproved) {
    const eff = effectivePn(ac, ata, tag);
    if (pn === eff) out.push('◀ this airplane');
    else if (d.ref.alt) out.push('ALT: a legal alternate');
    else if (d.ref.pma) out.push('PMA: a legal replacement');
    else if (d.ref.ea) out.push(`${d.ref.ea}: approved for this airplane`);
    // a part in force that the book supersedes new for old: order the new P/N (it is legal here)
    if (d.ref.supsdBy && d.ref.supsdBy.code !== 3 && judgeSlot(s, asset, ata, tag, d.ref.supsdBy.pn).ok) out.push(`SUPSD: order ${d.ref.supsdBy.pn} (INTCHG ${d.ref.supsdBy.code})`);
    if (d.ref.supsdBy?.code === 3) out.push(`SUPSD BY ${d.ref.supsdBy.pn} only as the SB set: this airplane takes ${pn}`);
  } else if (c.unapproved) out.push('ICA part: needs an engineering authorization');
  else if (c.why === 'displaced') out.push('Altered: not in this airplane’s IPC. Research the records');
  else if (c.why === 'noteff') out.push(/S\/N/.test(c.text) ? `not effective for S/N ${ac.serial}` : 'not effective for this airplane’s SB status');
  return out;
}

/** the likely-mark: is this task one of the alert's hints (tiers 0-1) */
export const likely = (s: IslandState, a: Alert, taskId: TaskId, tier: number) => tier <= 1 && hintsFor(s, a, tier).tasks.includes(taskId);

/** convenience: the needs and the site for a pick screen */
export const pickContext = (s: IslandState, a: Alert) => ({ needs: needsOf(s, a), site: siteOf(s, a) });
