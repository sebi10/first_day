// 1080×1350 share card in the island's style, for the group chat.
import { ROLE_LABEL } from '../sim/data';
import type { IslandState, Role, WeekReport } from '../sim/types';
import { C, FONT } from './theme';

const GRADE_COLOR = { A: C.palm, B: C.sea, C: '#C9A86A', D: C.rust } as const;

export async function shareWeek(s: IslandState, r: WeekReport) {
  const W = 1080;
  const H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#FBF5E9');
  g.addColorStop(1, C.sand);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  // sea band + island silhouette
  x.fillStyle = C.sea;
  x.fillRect(0, 0, W, 360);
  x.fillStyle = C.sandDeep;
  x.beginPath();
  x.ellipse(W / 2, 380, 420, 120, 0, Math.PI, 0);
  x.fill();
  x.fillStyle = C.palm;
  for (const px of [260, 330, 760, 820]) {
    x.beginPath();
    x.moveTo(px, 300);
    x.lineTo(px - 40, 330);
    x.lineTo(px + 40, 330);
    x.fill();
  }
  const text = (t: string, px: number, py: number, size: number, weight = 800, color: string = C.ink, align: CanvasTextAlign = 'left') => {
    x.font = `${weight} ${size}px ${FONT}`;
    x.fillStyle = color;
    x.textAlign = align;
    x.fillText(t, px, py);
  };
  text(s.name, 80, 110, 64, 900, '#FBF5E9');
  text(`Week ${r.week} · board review`, 80, 170, 38, 700, '#FBF5E9');
  // grade
  x.fillStyle = GRADE_COLOR[r.grade];
  x.beginPath();
  x.arc(W / 2, 560, 150, 0, Math.PI * 2);
  x.fill();
  text(r.grade, W / 2, 625, 190, 900, '#FBF5E9', 'center');
  // three numbers
  const nums: [string, string][] = [
    [`$${r.revenue.toLocaleString('en-US')}`, `revenue · ${Math.round((r.revenue / r.budget) * 100)}% of budget`],
    [`${r.flightsFlown}/${r.flightsScheduled}`, 'on-time flights'],
    [`${r.incidents.length}`, `safety incidents${r.nearMisses ? ` · ${r.nearMisses} near-miss` : ''}`],
  ];
  nums.forEach(([v, l], i) => {
    const y = 820 + i * 110;
    text(v, 80, y, 64, 900);
    text(l, 80, y + 44, 30, 600, C.inkSoft);
  });
  (['mech', 'elec', 'fin'] as Role[]).forEach((role, i) => {
    const y = 1170 + i * 52;
    x.fillStyle = { mech: C.mech, elec: C.elec, fin: C.fin }[role];
    x.beginPath();
    x.arc(96, y - 12, 14, 0, Math.PI * 2);
    x.fill();
    text(`${s.players[role]?.name ?? ROLE_LABEL[role]}: ${r.mvp[role]}`, 124, y, 30, 700);
  });
  const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), 'image/png'));
  const file = new File([blob], `${s.name.replace(/\W+/g, '-')}-week-${r.week}.png`, { type: 'image/png' });
  const line = `${s.name} week ${r.week}: ${r.grade}. $${r.revenue.toLocaleString('en-US')} revenue, ${r.flightsFlown}/${r.flightsScheduled} flights, ${r.incidents.length} incidents.`;
  const nav = navigator as Navigator & { canShare?(d: ShareData): boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text: line });
      return;
    } catch {
      /* cancelled */
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function shareText(title: string, text: string, url?: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
    return true;
  } catch {
    return false;
  }
}
