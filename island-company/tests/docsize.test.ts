// The island is one Firestore document (1 MiB at most; our budget 150 KB): a
// year of play keeps it small. The ledger is bounded (26 weeks), alerts are
// pruned (closed ones kept 2 weeks, 40 at most), and closed POs and requisitions
// go after 2 weeks (docs/JOBFLOW.md 2.8, 9, 14.1).
import { describe, expect, it, vi } from 'vitest';
import { simulate, TEAMS } from '../src/sim/bots';
import { ALERTS, STOCK } from '../src/sim/data';

vi.setConfig({ testTimeout: 60000 });

describe('the doc size budget', () => {
  it('a 52-week three-friends island stays under 150 KB of JSON; the ledger holds 26 weeks at most, the alerts 40', () => {
    for (const seed of [1, 2]) {
      let ledger = 0;
      let alerts = 0;
      let biggest = 0;
      let pos = 0;
      let reqs = 0;
      const r = simulate(TEAMS['three friends'], 52, seed, (s) => {
        ledger = Math.max(ledger, s.ledger?.length ?? 0);
        alerts = Math.max(alerts, s.alerts?.length ?? 0);
        pos = Math.max(pos, s.pos?.length ?? 0);
        reqs = Math.max(reqs, s.reqs?.length ?? 0);
        biggest = Math.max(biggest, JSON.stringify(s).length);
      });
      expect(r.final.week).toBe(53);
      expect(biggest, `seed ${seed}`).toBeLessThan(150_000);
      expect(ledger).toBeLessThanOrEqual(STOCK.ledgerWeeks);
      expect(alerts).toBeLessThanOrEqual(ALERTS.cap);
      // purchasing is pruned too: no more than a few weeks of POs and requisitions
      expect(pos).toBeLessThan(60);
      expect(reqs).toBeLessThan(40);
    }
  }, 60_000);
});
