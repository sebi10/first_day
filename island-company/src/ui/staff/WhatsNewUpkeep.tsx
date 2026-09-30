// G0's What's new panel (stage 2, v5): the builder's warranty, the service upgrade (on a live island: what it got
// with this update), and renovations, in each seat's words. It rides in the version-keyed shell (../whatsnew.tsx)
// after stage 2's map panels, once per island and seat on this device. An island that hasn't played yet (week 1 or
// earlier) doesn't see it: it meets these at the Harbor.
import { GEN_UPGRADE } from '../../sim/checkdata';
import { RENO, WARRANTY } from '../../sim/data';
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

/** the panel for this seat on this island ([] on a new island's first week) */
export function whatsNewUpkeepPanels(s: IslandState, role: Role): WhatsNewPanel[] {
  // (review round 3: an island before tier 3 is 10+ weeks from any of this: one line in the map's "Also in this update")
  if (s.week <= 1 || s.tier < 3) return [];
  const elec = s.players.elec?.name ?? 'the electrician';
  const fin = s.players.fin?.name ?? 'the analyst';
  // a live island at the Harbor or the Resort got the service upgrade with this update (migrate.ts step 9)
  const grid = s.assets.find((a) => a.kind === 'grid');
  const gen = s.assets.find((a) => a.kind === 'generator');
  const got = s.stats.g0From !== undefined;
  const seat: Record<Role, preact.ComponentChildren> = {
    mech: <>A house closed for its renovation takes no guests: fewer passengers on your flights for those weeks.</>,
    elec: (
      <>
        When the builders finish a renovation, its <b>permit final</b> lands on your list: your final prep (the panel directory, the labels, the clearances, the breakers against their wire), then the county inspector passes it. The house earns nothing until it passes (a code notice already open on it is the same visit), and a hazard open on it has to be made safe first.
      </>
    ),
    fin: (
      <>
        <b>Renovate</b> a worn house from the Staff desk or its sheet: the case shows the package, the weeks closed, the rent lost, how long it stays open renovated against left as it is, and whether the rent pays it back. It's capex: your house sheets keep it apart from repairs.
      </>
    ),
  };
  return [
    {
      title: 'Buildings that last',
      body: (
        <>
          <P>
            From the Harbor (tier {WARRANTY.fromTier}), new buildings come with a <b>builder's warranty</b>: for {WARRANTY.weeks} weeks they lose {WARRANTY.decay} a week untouched instead of the usual. Guests' wear, storms and incidents still hit them.
          </P>
          <UL
            items={[
              <>
                <b>The service upgrade:</b> at the Harbor a new feeder goes in and the utility sets a new pad-mount transformer, and at the Resort a bigger standby set with {GEN_UPGRADE.words}. Both start in the new buildings' condition, under warranty.
              </>,
              got ? (
                <>
                  <b>Your island got it with this update</b> (week {s.stats.g0From}): the grid{s.tier >= 5 && gen ? ' and the generator' : ''} at 80 or better, under warranty to week {grid?.warrantyUntil ?? s.week + WARRANTY.weeks} (the grid is at {Math.round(grid?.health ?? 0)}
                  {s.tier >= 5 && gen ? `, the generator at ${Math.round(gen.health)}` : ''} now). Your Harbor and Resort buildings keep what's left of their warranty from the week they went up.
                </>
              ) : s.tier >= WARRANTY.fromTier ? (
                <>Your island got it when its Harbor went up{grid?.warrantyUntil !== undefined ? `: the grid's warranty runs to week ${grid.warrantyUntil}` : ''}.</>
              ) : (
                <>Your island gets it when its Harbor goes up.</>
              ),
              <>
                <b>Renovations</b> ({role === 'fin' ? 'yours' : `${fin}'s`}, from tier {RENO.fromTier}): a house at {RENO.maxHealth} or below. The builders do the carpentry, roofing and finishes with it closed; it opens again at {RENO.health} with a {RENO.warranty}-week warranty once it passes the county's final ({role === 'elec' ? 'your' : `${elec}'s`} final prep). One per house every {RENO.cooldown} weeks.
              </>,
              seat[role],
            ]}
          />
        </>
      ),
    },
  ];
}
