// The Money tab (docs/JOBFLOW.md 14.3, 14.4): the cash card (cash, spendable,
// committed, payable; 12 weeks of week-end cash, revenue against its budget and
// cash out; runway), where it went (by group, category, trade and asset; capex
// against opex), the stock card (inventory, stock built vs used, cash tied up
// and its capital cost, fill rate, waits, bins, the fast and slow movers), the
// trades' work budgets and the standing limit, overhead and payroll. Readable
// in passing: one big number per card, one chart, a few chips; tap for more.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ROLE_LABEL } from '../../sim/data';
import { budgetCap } from '../../sim/engine';
import type { OpsRole } from '../../sim/types';
import { ROLE_TINT } from '../theme';
import type { Ctl } from '../useIsland';
import { BarRows, Columns, Legend, Line, Table, VIZ } from './charts';
import { GROUPS, moneyVM, standingLimit, usd, wkWords, type FamRowVM, type MoneyVM, type SpendGroup } from './model';
import './purchasing.css';

const GROUP_COLOR: Record<SpendGroup, string> = { jobs: VIZ.one, capex: VIZ.two, other: VIZ.three, fixed: VIZ.ctx };
/** the stack, bottom up: the fixed costs as the gray context, then what the analyst steers */
const STACK: SpendGroup[] = ['fixed', 'jobs', 'capex', 'other'];
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const signed = (n: number) => (n > 0 ? `+${usd(n)}` : usd(n));

function Toggle({ on, set, label }: { on: boolean; set(v: boolean): void; label: string }) {
  return (
    <button class="pd-link" onClick={() => set(!on)} aria-pressed={on}>
      {on ? 'Chart' : label}
    </button>
  );
}

function CashCard({ m }: { m: MoneyVM }) {
  const [table, setTable] = useState(false);
  const w = m.weeks;
  return (
    <div class="card pd-sec">
      <div class="row spread">
        <h3>Cash</h3>
        <Toggle on={table} set={setTable} label="Table" />
      </div>
      <div class="col" style={{ gap: 2 }}>
        <span class="hero-num">{usd(m.cash)}</span>
        <div class="money-line">
          <span>Spendable {usd(m.spendable)}</span>
          <span class="pd-muted">committed {usd(m.committed)}</span>
          <span class="pd-muted">payable next run {usd(m.payable)}</span>
          {m.credit > 0 && <span class="pd-muted">store credit {usd(m.credit)}</span>}
        </div>
      </div>
      {table ? (
        <Table head={['Week', 'Revenue', 'Budget', 'Cash out', 'Cash']} rows={w.map((x) => [x.w, usd(x.rev), x.budget ? usd(x.budget) : '—', usd(x.out), usd(x.cash)])} />
      ) : w.length ? (
        <>
          <Line points={w.map((x) => x.cash)} labels={w.map((x) => `Week ${x.w} cash`)} label="Week-end cash, the last 12 weeks" format={usd} refLine={Math.min(...w.map((x) => x.cash)) < 8000 ? { v: 2000, text: 'freeze $2,000' } : undefined} />
          <Columns
            label="Revenue and cash out a week, the last 12 weeks"
            cols={w.map((x) => ({
              key: String(x.w),
              label: String(x.w),
              up: [{ v: x.rev, color: VIZ.one, name: 'Revenue' }],
              down: [{ v: x.out, color: VIZ.two, name: 'Cash out' }],
              ...(x.budget ? { tick: x.budget } : {}),
              read: `${wkWords(m.week, x.w)}: revenue ${usd(x.rev)}${x.budget ? ` (budget ${usd(x.budget)})` : ''} · out ${usd(x.out)} · net ${signed(x.rev - x.out)}`,
            }))}
          />
          <Legend
            items={[
              { color: VIZ.one, name: 'Revenue' },
              { color: VIZ.two, name: 'Cash out' },
              { color: 'var(--ink)', name: 'Revenue budget', line: true },
            ]}
          />
        </>
      ) : (
        <span class="pd-empty">The first week's numbers land when week 1 resolves.</span>
      )}
      <div class="pd-chips">
        <span class={`chip ${m.runway.weeks < 2 ? 'rust' : 'sea'}`}>Runway {m.runway.weeks} wk</span>
        <span class="chip">Forecast revenue {usd(m.forecast)} of {usd(m.budgetNow)}</span>
        {m.budgets.map((b) => (
          <span key={b.role} class={`chip ${b.spent > b.of ? 'amber' : ''}`}>
            {b.role === 'mech' ? 'Mech' : 'Elec'} budget {usd(b.spent)}/{usd(b.of)}
          </span>
        ))}
      </div>
      <span class="pd-note">
        Runway: the weeks spendable cash covers overhead, payroll and insurance{m.runway.loan ? ' and the loan' : ''} ({usd(m.runway.weekly)} a week) with no revenue.
      </span>
    </div>
  );
}

function WhereItWent({ ctl }: { ctl: Ctl }) {
  const [long, setLong] = useState(false);
  const [table, setTable] = useState(false);
  const m = moneyVM(ctl.s, long ? 12 : 4);
  const weeks = m.weeks.slice(long ? -12 : -4);
  return (
    <div class="card pd-sec">
      <div class="row spread">
        <h3>Where it went</h3>
        <span class="row" style={{ gap: 0 }}>
          <button class="pd-link" onClick={() => setLong(!long)} aria-pressed={long}>
            {long ? 'Show 4 weeks' : 'Show 12 weeks'}
          </button>
          <Toggle on={table} set={setTable} label="Table" />
        </span>
      </div>
      {table ? (
        <Table head={['Week', ...STACK.map((k) => GROUPS.find((g) => g.k === k)!.label.split(' (')[0]), 'Total']} rows={weeks.map((x) => [x.w, ...STACK.map((k) => usd(x.groups[k])), usd(x.out)])} />
      ) : weeks.length ? (
        <Columns
          label={`Cash out by group, the last ${weeks.length} weeks`}
          height={110}
          cols={weeks.map((x) => ({
            key: String(x.w),
            label: `wk ${x.w}`,
            up: STACK.map((k) => ({ v: x.groups[k], color: GROUP_COLOR[k], name: k })),
            read: `${wkWords(m.week, x.w)}: ${usd(x.out)} out · jobs and stock ${usd(x.groups.jobs)} · capex ${usd(x.groups.capex)} · fixed ${usd(x.groups.fixed)} · other ${usd(x.groups.other)}`,
          }))}
        />
      ) : null}
      <Legend items={[...STACK].reverse().map((k) => ({ color: GROUP_COLOR[k], name: GROUPS.find((g) => g.k === k)!.label, value: usd(m.where.groups.find((g) => g.k === k)!.usd) }))} />
      <div class="money-line">
        <span>Capex {usd(m.where.capex)}</span>
        <span>Opex {usd(m.where.opex)}</span>
        <span class="pd-muted">
          over {m.where.weeks} week{m.where.weeks === 1 ? '' : 's'}
        </span>
      </div>
      <BarRows rows={m.where.cats.map((c) => ({ key: c.k, label: c.label, value: c.usd, text: usd(c.usd) }))} />
      <div class="divider" />
      <span class="label">By trade</span>
      <BarRows
        rows={m.where.trades.map((t) => ({
          key: t.k,
          label: (
            <span>
              {t.k !== 'build' && <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: ROLE_TINT[t.k as 'mech' | 'elec' | 'fin'], marginRight: 6 }} />}
              {t.label}
            </span>
          ),
          value: t.usd,
          text: usd(t.usd),
        }))}
      />
      {m.where.assets.length > 0 && (
        <>
          <span class="label">Top assets, 13 weeks (parts used and labour)</span>
          <BarRows rows={m.where.assets.map((a) => ({ key: a.name, label: a.name, value: a.usd, text: usd(a.usd) }))} />
        </>
      )}
    </div>
  );
}

function Movers({ title, rows, onOpen, slow }: { title: string; rows: FamRowVM[]; onOpen(fam: string): void; slow?: boolean }) {
  if (!rows.length) return null;
  return (
    <div class="col" style={{ gap: 0 }}>
      <span class="label">{title}</span>
      <BarRows
        rows={rows.map((r) => ({
          key: r.fam,
          label: (
            <span>
              {r.label} <span class="pd-muted">· {slow ? r.sinceText : `${r.used} used`}</span>
            </span>
          ),
          value: slow ? r.value : r.valueMoved,
          text: slow ? `${usd(r.value)} on shelf` : `${usd(r.valueMoved)} moved`,
          onClick: () => onOpen(r.fam),
        }))}
      />
    </div>
  );
}

function StockCard({ m, onFamily }: { m: MoneyVM; onFamily(fam: string): void }) {
  const st = m.stock;
  const [table, setTable] = useState(false);
  return (
    <div class="card pd-sec">
      <div class="row spread">
        <h3>Stock</h3>
        <Toggle on={table} set={setTable} label="Table" />
      </div>
      <div class="pd-kv">
        <div>
          <div class="k">Inventory</div>
          <div class="val num">{usd(st.inv)}</div>
          <div class="s">
            bins {st.bins}/{st.binsTotal}
          </div>
        </div>
        <div>
          <div class="k">Cash tied up</div>
          <div class="val num">{usd(st.tiedUp)}</div>
          <div class="s">stock + open POs · ~{usd(st.capital)}/wk of capital</div>
        </div>
        <div>
          <div class="k">Fill rate, 8 wk</div>
          <div class="val num">{pct(st.fill)}</div>
          <div class="s">of planned parts' value, off the shelf</div>
        </div>
        <div>
          <div class="k">Waiting on parts</div>
          <div class="val num">{st.waits}</div>
          <div class="s">{st.waits === 1 ? 'job-week' : 'job-weeks'}, the last 8 weeks</div>
        </div>
      </div>
      {table ? (
        <Table head={['Week', 'Received', 'Used']} rows={st.builtUsed.map((x) => [x.w, usd(x.built), usd(x.used)])} />
      ) : st.builtUsed.length ? (
        <>
          <Columns
            label="Stock built and used a week, the last 12 weeks"
            height={96}
            cols={st.builtUsed.map((x) => ({
              key: String(x.w),
              label: String(x.w),
              up: [{ v: x.built, color: VIZ.one, name: 'Received' }],
              down: [{ v: x.used, color: VIZ.two, name: 'Used' }],
              read: `${wkWords(m.week, x.w)}: received ${usd(x.built)} · used ${usd(x.used)}`,
            }))}
          />
          <Legend
            items={[
              { color: VIZ.one, name: 'Received into stock' },
              { color: VIZ.two, name: 'Used on jobs' },
            ]}
          />
        </>
      ) : null}
      <Movers title="Fast movers · parts and materials" rows={st.fast.parts} onOpen={onFamily} />
      <Movers title="Fast movers · consumables" rows={st.fast.consumables} onOpen={onFamily} />
      <Movers title="Slow and dead · parts and materials" rows={st.slow.parts} onOpen={onFamily} slow />
      <Movers title="Slow and dead · consumables" rows={st.slow.consumables} onOpen={onFamily} slow />
      {!st.fast.parts.length && !st.slow.parts.length && <span class="pd-note">Classes start after 8 weeks of ledger: until then the planner shows use counts.</span>}
    </div>
  );
}

function Slider({ label, value, max, step, disabled, onCommit, note }: { label: string; value: number; max: number; step: number; disabled: boolean; onCommit(v: number): void; note: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div class="col" style={{ gap: 0 }}>
      <div class="row spread">
        <b>{label}</b>
        <b class="num">{usd(v)}/wk</b>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={v}
        disabled={disabled}
        aria-label={label}
        onInput={(e) => setV(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      />
      <span class="pd-note">{note}</span>
    </div>
  );
}

function Budgets({ ctl }: { ctl: Ctl }) {
  const { s } = ctl;
  const cap = s.receivership > 0 ? 300 : budgetCap(s);
  return (
    <div class="card pd-sec">
      <h3>Work budgets and the standing limit</h3>
      {(['mech', 'elec'] as OpsRole[]).map((r) => (
        <Slider
          key={r}
          label={`${ROLE_LABEL[r]} work budget`}
          value={s.autoBudget[r]}
          max={cap}
          step={50}
          disabled={false}
          onCommit={(amount) => void ctl.dispatch({ t: 'setBudget', role: r, amount })}
          note={`Used ${usd(s.autoSpent[r])} this week. A job whose parts are all on the shelf goes ahead on it, no card; safety work may run past it.`}
        />
      ))}
      <Slider
        label="Standing limit"
        value={standingLimit(s)}
        max={5000}
        step={50}
        disabled={false}
        onCommit={(amount) => void ctl.dispatch({ t: 'setStanding', amount })}
        note="After you end your turn, cards and requests that come in go through at the resolve up to this much a week, most urgent first. Set it to $0 to hold everything for you."
      />
    </div>
  );
}

function Fixed({ m }: { m: MoneyVM }) {
  return (
    <div class="card pd-sec">
      <div class="row spread">
        <h3>Overhead and payroll</h3>
        <b class="num">{usd(m.fixed)}/wk</b>
      </div>
      <div class="pd-lines">
        {m.overhead.lines.map((l) => (
          <div class="pd-line" key={l.label}>
            <span>{l.label}</span>
            <span class="v">{usd(l.usd)}</span>
          </div>
        ))}
        <div class="pd-line total">
          <span>Overhead</span>
          <span class="v">{usd(m.overhead.total)}</span>
        </div>
        {m.payroll.lines.map((l) => (
          <div class="pd-line" key={l.label}>
            <span>{l.label}</span>
            <span class="v">{usd(l.usd)}</span>
          </div>
        ))}
        <div class="pd-line total">
          <span>Payroll (the Staff tab)</span>
          <span class="v">{usd(m.payroll.total)}</span>
        </div>
      </div>
      <span class="pd-note">Each a weekly cost to the company, paid when the week resolves.</span>
    </div>
  );
}

export function Money({ ctl, onFamily, children }: { ctl: Ctl; onFamily(fam: string): void; children?: ComponentChildren }) {
  const m = moneyVM(ctl.s);
  return (
    <div class="pd-sec">
      <CashCard m={m} />
      <WhereItWent ctl={ctl} />
      <StockCard m={m} onFamily={onFamily} />
      <Budgets ctl={ctl} />
      {children}
      <Fixed m={m} />
    </div>
  );
}
