// Stage 2's What's new panels (docs/EXPANSION.md 9.5; package C). The shell is
// ../whatsnew.tsx (package A): home.tsx mounts it keyed by the release's version,
// once per island and seat on this device, after the job flow's own What's new.
//   1. Explore the map: two fingers to move and zoom, double-tap, the presets, ⤢ Explore.
//   2. Tap anything: what your seat sees and can do there.
//   3. Your quick check (the techs; "from tier 2" on a newer island) and Report a problem (from week 3).
//   4. What else changed, in plain words.
// A new island's week 1 shows only panel 1.
import { CHECK } from '../../sim/checks';
import { REPORT } from '../../sim/data';
import type { IslandState, Role } from '../../sim/types';
import type { WhatsNewPanel } from '../whatsnew';

const P = ({ children }: { children: preact.ComponentChildren }) => <p style={{ margin: '0 0 8px', lineHeight: 1.45 }}>{children}</p>;
const UL = ({ items }: { items: preact.ComponentChildren[] }) => (
  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.4 }}>
    {items.map((x, i) => (
      <li key={i}>{x}</li>
    ))}
  </ul>
);

const SEAT_TAP: Record<Role, preact.ComponentChildren[]> = {
  mech: [
    <>
      <b>A plane:</b> airworthiness, the next 100-hr, MEL placards, its logbook and the cart on it. Ground it, write it up, or open its alerts.
    </>,
    <>
      <b>The hangar:</b> its power, the reports holding you up, the carts on charge.
    </>,
    <>
      <b>A house or the grid:</b> what the electrician should know. Tell them in two taps.
    </>,
  ],
  elec: [
    <>
      <b>A house:</b> rentable or why not, the inspection date, hazards and tags, its panel schedule.
    </>,
    <>
      <b>The grid:</b> what it feeds, the generator, the breaker schedule. <b>The generator:</b> the transfer switch and its fuel.
    </>,
    <>
      <b>A plane:</b> an electrical check the mechanic asked of you. Or tell the mechanic what you saw.
    </>,
  ],
  fin: [
    <>
      <b>A plane:</b> what it earns this week, 13 weeks of repairs, its pilot, and its card: approve it right there.
    </>,
    <>
      <b>A house:</b> its booking and the nightly rate, stepped from the sheet with this week's effect.
    </>,
    <>
      <b>A staff figure:</b> hire this week's candidate for that job. <b>The office:</b> cash and runway.
    </>,
  ],
};

/** the panels for this seat on this island (a new island's week 1: only what applies then) */
export function whatsNewMapPanels(s: IslandState, role: Role): WhatsNewPanel[] {
  const map: WhatsNewPanel = {
    title: 'Explore the island',
    body: (
      <>
        <P>The map is yours to move around now, not only your own corner.</P>
        <UL
          items={[
            <>
              <b>Two fingers</b> to move and zoom (on a computer: Ctrl + scroll, and drag). <b>Double-tap</b> to zoom in.
            </>,
            <>
              <b>The chips</b> jump to your zone, the build site or the whole island.
            </>,
            <>
              <b>⤢ Explore</b> opens it full screen.
            </>,
          ]}
        />
      </>
    ),
  };
  if (s.week <= 1) return [map];
  const tap: WhatsNewPanel = {
    title: 'Tap anything',
    body: (
      <>
        <P>Everything on the island opens a sheet, and what it shows depends on your job:</P>
        <UL items={SEAT_TAP[role]} />
      </>
    ),
  };
  const tech = role !== 'fin';
  const checkWords =
    role === 'mech'
      ? 'Once a week, walk round a plane (or the generator): every zone in one view. Write up the one that looks wrong, or call it all serviceable.'
      : 'Once a week, IR-scan the grid or the generator under load, or meter-check a house with a 12 A load on every circuit. Write up the one that reads wrong, or call it all normal.';
  const checks: WhatsNewPanel = {
    title: tech ? 'Your quick check · Report a problem' : 'Report a problem',
    body: (
      <>
        {tech && (
          <P>
            {checkWords} Catch wear early and the job is on your list sooner, and one tier easier. A wrong call is a write-up you close on site.
            {s.tier < CHECK.fromTier ? ` It opens at tier ${CHECK.fromTier}.` : ''}
          </P>
        )}
        <P>
          <b>Report a problem</b> on {role === 'mech' ? 'a house or the grid' : role === 'elec' ? 'a plane' : 'a plane, a house or the grid'}: it lands on that trade's alert list, in your name. One a week each, and each trade receives at most one a week.
          {s.week < REPORT.fromWeek ? ` It opens in week ${REPORT.fromWeek}.` : ''} For the hangar, the office or anything else, message them from its sheet.
        </P>
      </>
    ),
  };
  const more: WhatsNewPanel = {
    title: 'Also in this update',
    body: (
      <UL
        items={[
          'Your island carries on where it was: jobs, stock, cash and crew are all as you left them.',
          tech ? 'A quick check never tells you on the spot whether you were right: the closer look at Investigate does.' : 'A quick check is the techs’ own call: the review says what they wrote up, never whether it was right.',
          'A walkaround write-up on a plane is an airworthiness item: close it before its due week, or the plane stays on the ground.',
        ]}
      />
    ),
  };
  return [map, tap, checks, more];
}
