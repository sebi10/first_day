// A small DOM for mounting the HTML puzzles (IPC lookup, logbook research)
// headless in node: elements built from innerHTML, simple selectors (tag,
// .class, [attr], [attr="v"], compounds and descendants), closest, classList,
// dataset, style, and events that capture and bubble. Layout is one fixed box.
// Canvas elements get a context that accepts every call and draws nothing.

type Listener = { f: (e: MiniEvent) => void; capture: boolean };
export type MiniEvent = {
  type: string;
  target: MiniEl;
  currentTarget: MiniEl | null;
  clientX: number;
  clientY: number;
  pointerId: number;
  key?: string;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
};

const VOID = new Set(['br', 'wbr', 'input', 'img', 'hr', 'meta', 'link', 'col', 'area', 'source']);
const RAW = new Set(['style', 'script', 'textarea']);
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e.toLowerCase()] ?? m)));
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

export class MiniText {
  parent: MiniEl | null = null;
  constructor(public text: string) {}
}

export const BOX = { width: 390, height: 640 };

/** a 2D context that takes any call and draws nothing */
function nullContext() {
  const st: Record<string | symbol, unknown> = { fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif', globalAlpha: 1 };
  const grad = { addColorStop() {} };
  return new Proxy(st, {
    get(t, k) {
      if (k === 'measureText') return (s: string) => ({ width: s.length * 6.5 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => grad;
      if (k === 'getLineDash') return () => [];
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

export class MiniEl {
  tagName: string;
  attrs = new Map<string, string>();
  children: (MiniEl | MiniText)[] = [];
  parent: MiniEl | null = null;
  listeners = new Map<string, Listener[]>();
  style: Record<string, string> & { setProperty(k: string, v: string): void } = Object.assign(Object.create(null), {
    setProperty(this: Record<string, string>, k: string, v: string) {
      this[k] = v;
    },
  });
  scrollTop = 0;
  value = '';
  width = 0;
  height = 0;
  private ctx: unknown;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  // ---- tree
  get parentElement() {
    return this.parent;
  }
  get elements(): MiniEl[] {
    return this.children.filter((c): c is MiniEl => c instanceof MiniEl);
  }
  get childElementCount() {
    return this.elements.length;
  }
  get firstElementChild() {
    return this.elements[0] ?? null;
  }
  appendChild<T extends MiniEl | MiniText>(c: T): T {
    if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c);
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs: (MiniEl | MiniText | string)[]) {
    for (const c of cs) this.appendChild(typeof c === 'string' ? new MiniText(c) : c);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
  }
  contains(o: MiniEl | null): boolean {
    for (let e = o; e; e = e.parent) if (e === this) return true;
    return false;
  }

  // ---- content
  get textContent(): string {
    return this.children.map((c) => (c instanceof MiniText ? c.text : c.textContent)).join('');
  }
  set textContent(v: string) {
    this.children = [];
    if (v) this.appendChild(new MiniText(String(v)));
  }
  get innerHTML(): string {
    return this.children
      .map((c) => {
        if (c instanceof MiniText) return RAW.has(this.tagName.toLowerCase()) ? c.text : escText(c.text);
        const tag = c.tagName.toLowerCase();
        const at = [...c.attrs].map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
        return VOID.has(tag) ? `<${tag}${at}>` : `<${tag}${at}>${c.innerHTML}</${tag}>`;
      })
      .join('');
  }
  set innerHTML(html: string) {
    this.children = [];
    parseInto(this, String(html));
  }

  // ---- attributes
  getAttribute(k: string) {
    return this.attrs.get(k.toLowerCase()) ?? null;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k.toLowerCase(), String(v));
  }
  hasAttribute(k: string) {
    return this.attrs.has(k.toLowerCase());
  }
  removeAttribute(k: string) {
    this.attrs.delete(k.toLowerCase());
  }
  get id() {
    return this.getAttribute('id') ?? '';
  }
  get className() {
    return this.getAttribute('class') ?? '';
  }
  set className(v: string) {
    this.setAttribute('class', v);
  }
  get disabled() {
    return this.hasAttribute('disabled');
  }
  set disabled(v: boolean) {
    if (v) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }
  get classList() {
    const get = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const put = (s: Set<string>) => (this.className = [...s].join(' '));
    return {
      contains: (c: string) => get().has(c),
      add: (...cs: string[]) => {
        const s = get();
        cs.forEach((c) => s.add(c));
        put(s);
      },
      remove: (...cs: string[]) => {
        const s = get();
        cs.forEach((c) => s.delete(c));
        put(s);
      },
      toggle: (c: string, force?: boolean) => {
        const s = get();
        const on = force ?? !s.has(c);
        if (on) s.add(c);
        else s.delete(c);
        put(s);
        return on;
      },
    };
  }
  get dataset(): Record<string, string | undefined> {
    const key = (k: string) => `data-${k.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`)}`;
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_t, k) => (typeof k === 'string' ? (this.attrs.get(key(k)) ?? undefined) : undefined),
      set: (_t, k, v) => {
        if (typeof k === 'string') this.attrs.set(key(k), String(v));
        return true;
      },
      deleteProperty: (_t, k) => {
        if (typeof k === 'string') this.attrs.delete(key(k));
        return true;
      },
    });
  }

  // ---- selectors
  matches(sel: string): boolean {
    return sel.split(',').some((one) => matchChain(this, chainOf(one.trim())));
  }
  closest(sel: string): MiniEl | null {
    for (let e: MiniEl | null = this; e; e = e.parent) if (e.matches(sel)) return e;
    return null;
  }
  querySelectorAll(sel: string): MiniEl[] {
    const out: MiniEl[] = [];
    const walk = (e: MiniEl) => {
      for (const c of e.elements) {
        if (c.matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): MiniEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  // ---- events
  addEventListener(type: string, f: (e: MiniEvent) => void, o?: boolean | { capture?: boolean }) {
    const capture = typeof o === 'boolean' ? o : !!o?.capture;
    (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)!).push({ f, capture });
  }
  removeEventListener(type: string, f: (e: MiniEvent) => void, o?: boolean | { capture?: boolean }) {
    const capture = typeof o === 'boolean' ? o : !!o?.capture;
    const l = this.listeners.get(type);
    if (l) this.listeners.set(type, l.filter((x) => x.f !== f || x.capture !== capture));
  }
  /** capture from the top, then bubble back up; a click on (or in) a disabled button goes nowhere */
  dispatch(type: string, init: Partial<Pick<MiniEvent, 'clientX' | 'clientY' | 'pointerId' | 'key'>> = {}): MiniEvent {
    let stopped = false;
    const ev: MiniEvent = {
      type,
      target: this,
      currentTarget: null,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      pointerId: init.pointerId ?? 1,
      key: init.key,
      defaultPrevented: false,
      preventDefault() {
        ev.defaultPrevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
    };
    if (type === 'click' && this.closest('button[disabled]')) return ev;
    const path: MiniEl[] = [];
    for (let e: MiniEl | null = this; e; e = e.parent) path.push(e);
    const run = (e: MiniEl, capture: boolean) => {
      ev.currentTarget = e;
      for (const l of [...(e.listeners.get(type) ?? [])]) if (l.capture === capture || e === this) l.f(ev);
    };
    for (const e of [...path].reverse().slice(0, -1)) {
      if (stopped) return ev;
      run(e, true);
    }
    if (!stopped) run(this, false);
    for (const e of path.slice(1)) {
      if (stopped) return ev;
      run(e, false);
    }
    return ev;
  }
  click() {
    return this.dispatch('click');
  }

  // ---- layout: one fixed box
  getBoundingClientRect() {
    return { left: 0, top: 0, x: 0, y: 0, width: BOX.width, height: BOX.height, right: BOX.width, bottom: BOX.height };
  }
  get offsetTop() {
    return 0;
  }
  get offsetLeft() {
    return 0;
  }
  get offsetWidth() {
    return BOX.width;
  }
  get offsetHeight() {
    return 0;
  }
  get clientWidth() {
    return BOX.width;
  }
  get clientHeight() {
    return BOX.height;
  }
  get scrollHeight() {
    return BOX.height;
  }
  scrollTo() {}
  scrollIntoView() {}
  focus() {}
  blur() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getContext() {
    return (this.ctx ??= nullContext());
  }
}

type Part = { tag?: string; id?: string; classes: string[]; attrs: [string, string | undefined][] };

function chainOf(sel: string): Part[] {
  const parts: Part[] = [];
  for (const one of sel.match(/(?:[^\s[\]]+|\[[^\]]*\])+/g) ?? []) {
    const p: Part = { classes: [], attrs: [] };
    const re = /^([a-zA-Z][\w-]*|\*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(one))) {
      if (m[1]) p.tag = m[1] === '*' ? undefined : m[1].toUpperCase();
      else if (m[2]) p.classes.push(m[2]);
      else if (m[3]) p.id = m[3];
      else if (m[4]) p.attrs.push([m[4].toLowerCase(), m[5] ?? m[6] ?? m[7]]);
    }
    parts.push(p);
  }
  return parts;
}

function matchPart(e: MiniEl, p: Part): boolean {
  if (p.tag && e.tagName !== p.tag) return false;
  if (p.id && e.id !== p.id) return false;
  if (p.classes.length) {
    const cl = e.classList;
    if (!p.classes.every((c) => cl.contains(c))) return false;
  }
  return p.attrs.every(([k, v]) => (v === undefined ? e.attrs.has(k) : e.attrs.get(k) === v));
}

function matchChain(e: MiniEl, chain: Part[]): boolean {
  if (!chain.length || !matchPart(e, chain[chain.length - 1])) return false;
  let i = chain.length - 2;
  for (let a = e.parent; a && i >= 0; a = a.parent) if (matchPart(a, chain[i])) i--;
  return i < 0;
}

function parseInto(root: MiniEl, html: string) {
  const stack: MiniEl[] = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  while (i < html.length) {
    if (html[i] !== '<') {
      const e = html.indexOf('<', i);
      const end = e < 0 ? html.length : e;
      top().appendChild(new MiniText(decode(html.slice(i, end))));
      i = end;
      continue;
    }
    if (html.startsWith('<!--', i)) {
      const e = html.indexOf('-->', i);
      i = e < 0 ? html.length : e + 3;
      continue;
    }
    if (html[i + 1] === '/') {
      const e = html.indexOf('>', i);
      const name = html.slice(i + 2, e).trim().toUpperCase();
      for (let k = stack.length - 1; k > 0; k--)
        if (stack[k].tagName === name) {
          stack.length = k;
          break;
        }
      i = e + 1;
      continue;
    }
    const open = /^<([a-zA-Z][\w-]*)/.exec(html.slice(i, i + 40));
    if (!open) {
      top().appendChild(new MiniText('<'));
      i++;
      continue;
    }
    const el = new MiniEl(open[1]);
    let j = i + open[0].length;
    let selfClose = false;
    for (;;) {
      while (/\s/.test(html[j] ?? '')) j++;
      if (j >= html.length) break;
      if (html[j] === '>') {
        j++;
        break;
      }
      if (html.startsWith('/>', j)) {
        j += 2;
        selfClose = true;
        break;
      }
      const name = /^[^\s=>/]+/.exec(html.slice(j))?.[0] ?? html[j];
      j += name.length;
      while (/\s/.test(html[j] ?? '')) j++;
      let val = '';
      if (html[j] === '=') {
        j++;
        while (/\s/.test(html[j] ?? '')) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          val = html.slice(j + 1, end);
          j = end + 1;
        } else {
          val = /^[^\s>]+/.exec(html.slice(j))?.[0] ?? '';
          j += val.length;
        }
      }
      el.attrs.set(name.toLowerCase(), decode(val));
    }
    top().appendChild(el);
    const tag = open[1].toLowerCase();
    if (RAW.has(tag)) {
      const close = html.indexOf(`</${tag}`, j);
      const end = close < 0 ? html.length : close;
      if (end > j) el.appendChild(new MiniText(html.slice(j, end)));
      const gt = html.indexOf('>', end);
      i = close < 0 ? html.length : gt + 1;
      continue;
    }
    if (!VOID.has(tag) && !selfClose) stack.push(el);
    i = j;
  }
}

/** the globals a DOM puzzle reaches for: document.createElement and a window with timers */
export function miniDocument() {
  return {
    createElement: (tag: string) => new MiniEl(tag),
    createTextNode: (t: string) => new MiniText(t),
  };
}

/** the visible text of an element, whitespace squeezed */
export const textOf = (e: MiniEl | null | undefined) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
