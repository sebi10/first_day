// An alert that has a job: where it stands (the stage, whose move), the task,
// and each line's state (reserved, on order with its ETA, held with the
// document named, sent back); the card while it waits on the analyst; the stop
// with Repick; Start on a ready job; Drop the job.
import { useState } from 'preact/hooks';
import { SUPPLIERS } from '../../sim/data';
import { cardOf, flowStage, installCheck } from '../../sim/flow';
import { itemById } from '../../sim/items';
import { jobLines, onOrderFor, owned, reservedFor, toolComing } from '../../sim/stock';
import type { Action, Alert, IslandState, Order } from '../../sim/types';
import { ChainOrigin } from '../chain';
import { Btn, usd } from '../kit';
import { flowMove } from '../select';
import { lineWords, taskFor } from './steps';
import { landsWords, nameOf } from './words';

export type LineState = { item: string; qty: number; have: number; words: string; tone: 'ok' | 'coming' | 'none' | 'short' };

/** each of a job's lines, as it stands: on the shelf for it, on a PO (and when), held at receiving, sent back, requested */
export function jobLineStates(s: IslandState, o: Order): LineState[] {
  if (!o.flow || o.flow.wired) return [];
  const out: LineState[] = [];
  for (const l of jobLines(o)) {
    const have = reservedFor(s, o.id, l.item);
    const onPo = onOrderFor(s, o.id, l.item);
    const po = (s.pos ?? []).find((p) => (p.status === 'open' || p.status === 'held') && p.lines.some((x) => x.order === o.id && (x.as ?? x.item) === l.item && x.got === undefined && !x.back));
    const pl = po?.lines.find((x) => x.order === o.id && (x.as ?? x.item) === l.item);
    const back = (s.pos ?? []).flatMap((p) => p.lines.filter((x) => x.order === o.id && x.item === l.item && x.back))[0];
    const req = (s.reqs ?? []).find((r) => r.order === o.id && r.item === l.item && (r.status === 'open' || r.status === 'ordered'));
    let words: string;
    let tone: LineState['tone'];
    if (have >= l.qty) {
      words = 'reserved for it ✓';
      tone = 'ok';
    } else if (po && (po.status === 'held' || pl?.hold)) {
      words = `held at receiving: ${pl?.hold ?? 'paperwork'} (week ${po.hold ?? s.week + 1})`;
      tone = 'short';
    } else if (onPo > 0 && po) {
      words = `${have ? `${have} reserved · ` : ''}on ${po.id}, ${landsWords(s.week, po.eta)} · ${SUPPLIERS[po.vendor].short}${po.freight === 'aog' ? ', AOG boat' : ''}`;
      tone = 'coming';
    } else if (back) {
      words = `sent back at receiving: ${back.back}`;
      tone = 'none';
    } else if (req) {
      words = req.status === 'open' ? `requested from ${nameOf(s, 'fin')} (${req.id})` : `ordered (${req.po ?? req.id})`;
      tone = 'coming';
    } else if (o.status === 'pending') {
      words = have ? `${have} held for it · the rest on the card` : 'on the card: to buy';
      tone = 'short';
    } else {
      words = have ? `${have} of ${l.qty} on the shelf` : 'not on the shelf';
      tone = 'none';
    }
    out.push({ item: l.item, qty: l.qty, have, words, tone });
  }
  for (const tool of o.flow.tools) {
    const has = owned(s, tool);
    out.push({ item: tool, qty: 1, have: has ? 1 : 0, words: has ? 'tool: owned ✓' : toolComing(s, tool) ? 'tool: on order' : o.status === 'pending' ? 'tool: on the card (capex)' : 'tool: not owned', tone: has ? 'ok' : 'coming' });
  }
  return out;
}

export function JobView({
  s,
  a,
  o,
  run,
  onStart,
  onRepick,
  demo,
  ended,
}: {
  s: IslandState;
  a: Alert;
  o: Order;
  run(x: Action, done?: string): Promise<boolean>;
  onStart(o: Order): void;
  onRepick(research?: boolean): void;
  demo?: boolean;
  ended?: boolean;
}) {
  const [drop, setDrop] = useState(false);
  const t = o.flow ? taskFor(s, a, o.flow.task) : undefined;
  const stage = flowStage(s, a);
  const m = flowMove(s, a);
  const mine = m.who === a.role;
  const lines = jobLineStates(s, o);
  const card = o.status === 'pending' && o.flow ? cardOf(s, o) : null;
  const stop = o.flow?.stop;
  const check = o.status === 'ready' ? installCheck(s, o) : null;
  const who = m.who ? nameOf(s, m.who) : null;
  const open = o.status !== 'done' && o.status !== 'cancelled';
  // when the card's buys land: said once when they all come on the same resolve
  const etas = card ? [...new Set(card.toBuy.map((l) => l.eta))] : [];
  const oneEta = etas.length === 1 ? etas[0] : undefined;
  return (
    <div class="col jf-step" style={{ gap: 10 }}>
      <div class={`jf-stage ${mine ? 'mine' : ''} ${stage}`}>
        <b>{stage === 'done' ? 'Signed off' : stage === 'closed' ? 'Closed' : mine ? 'Your move' : who ? `${who}'s move` : 'In the works'}</b>
        {m.text && <span>{m.text.charAt(0).toUpperCase() + m.text.slice(1)}.</span>}
      </div>
      {t && (
        <div class="jf-taskline static">
          <span class="label">{a.repair ? 'Repair' : t.book === 'REF' ? 'Reference' : t.book}</span> <b>{t.no}</b> {o.title}
        </div>
      )}
      {o.flow?.wired && <div class="jf-note">{nameOf(s, 'elec')}'s check found the fault in the wiring and fixed it: no part. Inspect the splice, ops-check it and sign the airplane back into service.</div>}
      {stop && (
        <div class="jf-note warn">
          <b>Work stopped:</b> {stop}
        </div>
      )}
      {card && (
        <div class="card col jf-card" style={{ gap: 6 }}>
          <span class="label">The card with {nameOf(s, 'fin')}</span>
          {card.fromStock.length > 0 && <span>From stock: {card.fromStock.length} line{card.fromStock.length > 1 ? 's' : ''}, {usd(card.fromStock.reduce((n, l) => n + l.value, 0))}</span>}
          {card.toBuy.map((l) => (
            <span key={l.item}>
              To buy: {lineWords(l.item, l.qty)} · {usd(l.qty * l.unit)} · {SUPPLIERS[l.supplier].short}
              {oneEta === undefined ? ` · ${landsWords(s.week, l.eta)}` : ''}
            </span>
          ))}
          {oneEta !== undefined && <span class="label">Once approved, it {landsWords(s.week, oneEta)}.</span>}
          {card.tools.map((l) => (
            <span key={l.item}>
              Tool to buy: {itemById(l.item)?.nomen ?? l.item} · {usd(l.price)} (capex)
            </span>
          ))}
          <span>Labour {usd(card.labour)}</span>
          <b>Total {usd(card.total)}</b>
          {s.turns.fin?.ended && <span class="label">{nameOf(s, 'fin')} has ended the turn: it goes through tonight on the standing approval (up to the limit) unless deferred.</span>}
        </div>
      )}
      {!card && lines.length > 0 && (
        <div class="jf-lines" role="list">
          {lines.map((l) => (
            <div key={l.item} role="listitem" class="jf-line">
              <span class="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span class="jf-line-text">{itemById(l.item)?.kind === 'tool' ? itemById(l.item)!.nomen : lineWords(l.item, l.qty)}</span>
              </span>
              <span class={`jf-badge ${l.tone}`}>{l.words}</span>
            </div>
          ))}
        </div>
      )}
      <ChainOrigin s={s} o={o} me={a.role} />
      {o.status === 'done' && (
        <p class="muted" style={{ margin: 0 }}>
          {o.result?.blind ? `Signed off by ${nameOf(s, o.result.by)} in week ${o.result.week}. How good it was shows up later.` : o.result ? `Done in week ${o.result.week}: ${Math.round(o.result.score * 100)}%.` : 'Done.'}
        </p>
      )}
      {open && !demo && (
        <div class="col" style={{ gap: 8 }}>
          {o.status === 'ready' && !check && (
            <Btn block disabled={ended} onClick={() => onStart(o)}>
              Start ▸
            </Btn>
          )}
          {o.status === 'ready' && check && (
            <div class="jf-note warn">
              <b>At the start:</b> {check.stop}
            </div>
          )}
          {(stop || check) && o.flow?.stopResearch && (
            <Btn block kind="soft" disabled={ended} onClick={() => onRepick(true)}>
              Research the records ▸
            </Btn>
          )}
          {(stop || check) && (
            <Btn block kind={o.status === 'ready' && !check ? 'soft' : undefined} disabled={ended} onClick={() => onRepick()}>
              Repick ▸
            </Btn>
          )}
          {!stop && !check && !o.flow?.wired && !o.flow?.queued && stage !== 'research' && (
            <button class="jf-link" disabled={ended} onClick={() => onRepick()}>
              Change the pick
            </button>
          )}
          {!o.flow?.wired && (
            <button class="jf-link danger" disabled={ended} onClick={() => setDrop(!drop)}>
              Drop the job
            </button>
          )}
          {drop && (
            <div class="card col jf-ask" style={{ gap: 8 }}>
              <span>
                The alert goes back to open. Units reserved for it go back on the shelf; requests not ordered yet are cancelled.
                {o.approvedWeek !== undefined ? ' The labour already paid stays paid.' : ''}
              </span>
              <Btn block kind="ink" onClick={() => void run({ t: 'dropJob', role: a.role, order: o.id }, 'Job dropped: the alert is open again.').then(() => setDrop(false))}>
                Drop it
              </Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
