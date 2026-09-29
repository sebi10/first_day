// "The Harbor: keeping it standing" (review round 1 of A0): a one-time sheet when tier 4 arrives, and on the first
// open after this build on an island already at tier 4 or 5 (their rules switched at the next resolve with no
// notice). The late game's rules in the words of docs/ONBOARDING.md 10a. Remembered per island and seat on this device
// (localStorage, guarded: a per-viewer convenience, like What's new).
import { useState } from 'preact/hooks';
import { LATE } from '../sim/data';
import { STAFF } from '../sim/staff';
import type { IslandState, Role } from '../sim/types';
import { local, nameOf } from './flow/words';
import { Btn, Sheet, usd } from './kit';

export const harborKey = (island: string, role: string) => `ic.a0.harbor.${island}.${role}`;

export function harborLines(s: IslandState): { title: string; body: string }[] {
  const elec = nameOf(s, 'elec');
  const fin = nameOf(s, 'fin');
  return [
    {
      title: 'The grid comes first',
      body: `Under ${LATE.gridFirst} and at risk (the generator under 50, or a week's wear and a storm would take it under 40), the island feed is must-do work: its job goes to the top of ${elec}'s list, ahead of everything but a hazard or an airworthiness item due now, with a grid first chip. A code prep that reopens a closed house goes first while the grid holds at ${LATE.gridHold} or more. Under 40 the grid is down; if the generator is under 50 too, every house goes dark.`,
    },
    {
      title: 'Kept-up things wear slower',
      body: `A plane, a house, the grid or the generator at ${LATE.healthyDecay.at} or better loses ${LATE.healthyDecay.decay} a week when nobody works on it, not 5 (a kept-up airplane throws fewer knock-on squawks). The tick on each health bar marks ${LATE.healthyDecay.at}: the job that keeps something over it is worth more than the one that rescues it at 40.`,
    },
    {
      title: 'Fewer notices, lighter wear',
      body: `The Harbor's rental licence puts the island on the county's quarterly schedule: a code inspection every ${LATE.inspectionWeeks} weeks, not 8. A booked week wears a house ${LATE.houseWear}, not 2.`,
    },
    {
      title: "An electrician's helper",
      body: `${fin} can hire one on the Staff desk: they do ${elec}'s planned routine jobs at the resolve (outlets, GFCIs, switches, fixtures, the generator's circuit test; a hazard once it's made safe), ${usd(STAFF.wage.helper)} a week at skill 3. The diagnosis and the plan, making a hazard safe, code prep, the grid's feed and repairs stay ${elec}'s.`,
    },
    {
      title: 'The credits',
      body: 'Eight full-crew A weeks at the Resort (tier 5), none below A, beat the game. A week graded A with a seat on autopilot holds the streak without counting; a week below A resets it. Weeks at the Harbor are no head start.',
    },
  ];
}

export function HarborSheet({ s, role, hold }: { s: IslandState; role: Role; hold: boolean }) {
  const key = harborKey(s.id, role);
  const [seen, setSeen] = useState(() => !!local.get(key));
  const done = () => {
    local.set(key, '1');
    setSeen(true);
  };
  const open = s.tier >= LATE.fromTier && !seen && !hold;
  return (
    <Sheet open={open} onClose={done} label="The Harbor: keeping it standing">
      <div class="col" style={{ gap: 12 }}>
        <span class="label">Tier {LATE.fromTier} on · the rules that change</span>
        <h2>The Harbor: keeping it standing</h2>
        <span class="muted">Up to the Village the game is about getting there. From the Harbor it's about keeping it standing: six houses and more, the grid and the generator on one electrician.</span>
        {harborLines(s).map((l) => (
          <div class="col" key={l.title} style={{ gap: 2 }}>
            <b>{l.title}</b>
            <span>{l.body}</span>
          </div>
        ))}
        <Btn block onClick={done}>
          Got it
        </Btn>
      </div>
    </Sheet>
  );
}
