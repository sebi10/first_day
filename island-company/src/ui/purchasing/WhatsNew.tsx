// What's new for the analyst (docs/JOBFLOW.md 17.5): a one-time sheet of three
// panels on the first open of the desk after the job flow came in: approvals,
// stock and needs, money and staff. Only on an island that was played before the
// job flow (a new island starts with it: nothing is new). Remembered per island
// in this browser (a per-viewer convenience; every access guarded).
import { useState } from 'preact/hooks';
import { Btn, Sheet } from '../kit';
import './purchasing.css';

const KEY = (island: string) => `ic.whatsnew.jobflow.fin.${island}`;

function seen(island: string): boolean {
  try {
    return localStorage.getItem(KEY(island)) === '1';
  } catch {
    return true;
  }
}

const PANELS: { title: string; lines: string[] }[] = [
  {
    title: 'Cards carry real parts now',
    lines: [
      'A tech finds the task in the manual and the parts in the IPC or the catalog. What’s on the shelf is pulled; what isn’t comes to you as a card: the labour, the lines from stock, the lines to buy.',
      'Pick the supplier (OEM or the broker; the supply house or online) and the freight: scheduled rides the week’s carrier, the AOG boat is $350 for when a grounded plane or a closed house can’t wait.',
      'Requests for stock and tools come in a queue: tick them and approve together. Nothing locks when you end your turn: late cards go through tonight up to your standing limit.',
    ],
  },
  {
    title: 'Stock ahead of the alerts',
    lines: [
      'The Stock tab ranks every family of parts by how often it moved (fast, steady, slow, dead) and by value moved (A, B, C), with turnover and days of supply.',
      'Give a line a min/max and the stores refill it at the resolve. Every stocked line holds one of your bins: dead stock costs you a bin and ties up cash.',
      'Needs lists the alerts nobody has planned. It names no part: the tech’s plan does. Nudge them early so the parts come in time.',
    ],
  },
  {
    title: 'Money, budgets and staff',
    lines: [
      'Money shows cash beside what’s spendable, committed and payable; revenue against budget; where the cash went (jobs and stock, capex, overhead and payroll); what the stock ties up.',
      'Each trade’s work budget lets in-stock jobs go ahead without a card. Bills are paid a week after delivery, after the three-way match.',
      'The Staff tab is the island’s payroll: pilots, housekeepers and builders. Hiring is your call.',
    ],
  },
];

export function WhatsNew({ island, since }: { island: string; since: number }) {
  const [open, setOpen] = useState(() => since > 1 && !seen(island));
  const [i, setI] = useState(0);
  const close = () => {
    try {
      localStorage.setItem(KEY(island), '1');
    } catch {
      /* private mode: it shows again next time */
    }
    setOpen(false);
  };
  const p = PANELS[i];
  return (
    <Sheet open={open} onClose={close} label="What's new on the desk">
      <div class="col wn-panel" style={{ gap: 12 }}>
        <span class="chip ink" style={{ alignSelf: 'flex-start' }}>
          What's new · {i + 1} of {PANELS.length}
        </span>
        <h2>{p.title}</h2>
        <ul>
          {p.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div class="wn-dots" aria-hidden="true">
          {PANELS.map((_, k) => (
            <i key={k} class={k === i ? 'on' : ''} />
          ))}
        </div>
        <div class="pd-actions">
          {i > 0 ? (
            <Btn kind="ghost" onClick={() => setI(i - 1)}>
              Back
            </Btn>
          ) : (
            <Btn kind="ghost" onClick={close}>
              Skip
            </Btn>
          )}
          {i < PANELS.length - 1 ? <Btn onClick={() => setI(i + 1)}>Next ▸</Btn> : <Btn onClick={close}>Got it</Btn>}
        </div>
      </div>
    </Sheet>
  );
}
