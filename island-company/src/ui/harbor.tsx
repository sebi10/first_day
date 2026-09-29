// "The Harbor: keeping it standing" (review round 1 of A0): a one-time sheet when tier 4 arrives, and on the first
// open after this build on an island already at tier 4 or 5 (their rules switched at the next resolve with no
// notice). The late game's rules in the words of docs/ONBOARDING.md 10a. Remembered per island and seat on this device
// (localStorage, guarded: a per-viewer convenience, like What's new).
import { useState } from 'preact/hooks';
import { GOAL, LATE, RENO, WARRANTY } from '../sim/data';
import { carriedStreak, creditsStreak } from '../sim/econ';
import { STAFF } from '../sim/staff';
import type { IslandState, Role } from '../sim/types';
import { local, nameOf } from './flow/words';
import { Btn, Sheet, usd } from './kit';

export const harborKey = (island: string, role: string) => `ic.a0.harbor.${island}.${role}`;

export function harborLines(s: IslandState): { title: string; body: string }[] {
  const elec = nameOf(s, 'elec');
  const fin = nameOf(s, 'fin');
  // a live island's streak from before the update is kept (the release gate): say so where the rule is said
  const carried = GOAL.rule === 'streak' && carriedStreak(s) ? ` Your streak from before this update counts: ${Math.min(8, creditsStreak(s, s.week))}/8. Once it ends, only Resort weeks count.` : '';
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
    // (held back for stage 1: STAFF.helper.enabled, the owner's call; the sheet says it only when it plays)
    ...(STAFF.helper.enabled
      ? [
          {
            title: "An electrician's helper",
            body: `${fin} can hire one on the Staff desk: at the resolve they put in ${elec}'s planned receptacle, GFCI and 3-way switch swaps and the generator's circuit test, if ${elec} ended the turn with them ready, ${usd(STAFF.wage.helper)} a week at skill 3. Never in a week ${elec} is away (nobody supervises them). The diagnosis and the plan, a hazard and its fix, code prep, the grid's feed and repairs stay ${elec}'s.`,
          },
        ]
      : []),
    // G0: the upkeep structure (the builder's warranty, the service upgrade) and the analyst's renovations
    ...(WARRANTY.fromTier <= LATE.fromTier
      ? [
          {
            title: 'New buildings last',
            body: `From here new buildings come with a builder's warranty: ${WARRANTY.weeks} weeks at ${WARRANTY.decay} a week untouched (guests' wear, storms and incidents still hit them). The Harbor's new transformer and feeder and the Resort's bigger standby set come in the new buildings' condition, under the same warranty.`,
          },
        ]
      : []),
    {
      title: 'Renovations',
      body: `${fin} can renovate a house at ${RENO.maxHealth} or below from the Staff desk or its sheet: a package paid when ordered plus materials; the builders close it for their two work units, and ${elec}'s permit final opens it at ${RENO.health} with a ${RENO.warranty}-week warranty. One per house every ${RENO.cooldown} weeks.`,
    },
    {
      title: 'The credits',
      body:
        GOAL.rule === 'quarter'
          ? `Two months on plan at the Resort (tier 5) beat the game: of the last ${GOAL.weeks} weeks counted there, ${GOAL.need} at ${GOAL.minGrade} or better and revenue at ${Math.round(GOAL.revShare * 100)}% of budget or more. A week on plan with a seat on autopilot doesn't count; one below plan does, and receivership starts the count again. Weeks at the Harbor are no head start.`
          : `Eight full-crew A weeks at the Resort (tier 5), none below A, beat the game. A week graded A with a seat on autopilot holds the streak without counting; a week below A resets it. Weeks at the Harbor are no head start.${carried}`,
    },
  ];
}

/** the Harbor sheet is still to show for this seat on this device (the stage-2 What's new waits for it) */
export const harborPending = (s: IslandState, role: Role) => s.tier >= LATE.fromTier && !local.get(harborKey(s.id, role));

export function HarborSheet({ s, role, hold, onDone }: { s: IslandState; role: Role; hold: boolean; onDone?: () => void }) {
  const key = harborKey(s.id, role);
  const [seen, setSeen] = useState(() => !!local.get(key));
  const done = () => {
    local.set(key, '1');
    setSeen(true);
    onDone?.();
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
