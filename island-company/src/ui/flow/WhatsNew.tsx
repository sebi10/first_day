// What's new for the techs (docs/JOBFLOW.md 17.5): a one-time sheet of three
// panels on the first open after the update, on an island that was playing
// before the job flow (a new island's week 0 walks a scripted alert instead).
// Remembered per island and seat on this device (localStorage, guarded).
import { useState } from 'preact/hooks';
import type { OpsRole } from '../../sim/types';
import { Btn, Icon, Sheet } from '../kit';
import type { Ctl } from '../useIsland';
import { local, nameOf } from './words';

export const whatsNewKey = (island: string, role: string) => `ic.jf.new.${island}.${role}`;

export function WhatsNew({ ctl, role }: { ctl: Ctl; role: OpsRole }) {
  const { s } = ctl;
  const key = whatsNewKey(s.id, role);
  const [open, setOpen] = useState(() => (s.flowSince ?? 1) > 1 && s.week >= 1 && !local.get(key));
  const [page, setPage] = useState(0);
  const fin = nameOf(s, 'fin');
  const mech = role === 'mech';
  const done = () => {
    local.set(key, '1');
    setOpen(false);
  };
  const pages = [
    {
      icon: mech ? 'squawk' : 'guest',
      title: 'Work comes in as alerts',
      body: mech
        ? 'Pilot squawks, engine trends, wear limits, due items and ADs. Investigate first: it can be nothing (no fault found), an MEL item to placard, a unit for the electrician to meter, or a job.'
        : 'Guest complaints, utility readings, code notices and install take-offs. Investigate first: it can be nothing (no fault found), a hazard to make safe, or a job.',
    },
    {
      icon: 'board',
      title: mech ? 'Find it in the AMM, then the IPC' : 'Find it in the reference, then the catalog',
      body: mech
        ? "Search the AMM for the task that fixes it, then this airplane's own IPC for the part: EFF, SUPSD BY and NP as printed. Tiers 1-2 suggest; from tier 3 the book is all you get. Not in the IPC? Research the records."
        : 'Search the code and procedure reference for the fix and its NEC basis, then the supply catalog for the devices, wire and breakers the site needs. Tiers 1-2 suggest; from tier 3 the book is all you get.',
    },
    {
      icon: 'box',
      title: 'On the shelf: do it now',
      body: `Everything in stock and it's ready at once on your work budget. Anything missing goes to ${fin} as a card; ${fin} buys it and it lands at the resolve. The Stores chip shows the shelf, and Request asks for anything. A wrong part or task doesn't show now: it comes back later.`,
    },
  ];
  const p = pages[page];
  return (
    <Sheet open={open} onClose={done} label="What's new">
      <div class="col jf-new" style={{ gap: 12 }}>
        <span class="label">What's new · the job flow</span>
        <div class="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span class="jf-new-icon">
            <Icon name={p.icon} size={26} />
          </span>
          <span class="col" style={{ gap: 6 }}>
            <h2>{p.title}</h2>
            <span>{p.body}</span>
          </span>
        </div>
        <div class="row" style={{ gap: 6, justifyContent: 'center' }} aria-hidden="true">
          {pages.map((_, i) => (
            <i key={i} class={`jf-dot ${i === page ? 'on' : ''}`} />
          ))}
        </div>
        <div class="row" style={{ gap: 8 }}>
          <Btn kind="ghost" block onClick={done}>
            Skip
          </Btn>
          <Btn block onClick={() => (page < pages.length - 1 ? setPage(page + 1) : done())}>
            {page < pages.length - 1 ? 'Next' : 'Got it'}
          </Btn>
        </div>
      </div>
    </Sheet>
  );
}
