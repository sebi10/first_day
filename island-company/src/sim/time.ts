// Deadline math in the island creator's time zone (DST-safe via Intl).

function tzOffsetMs(utcMs: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** UTC ms of wall-clock y-m-d h:00 in tz */
export function zonedToUtc(y: number, m: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, 0, 0);
  let t = guess - tzOffsetMs(guess, tz);
  // second pass settles DST edges
  t = guess - tzOffsetMs(t, tz);
  return t;
}

function localYmd(utcMs: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, d] = f.format(new Date(utcMs)).split('-').map(Number);
  return { y, m, d };
}

/**
 * First `hour`:00 in `tz` that is at least `minGapH` hours after `from`.
 * Keeps every week at least 12 h long even if all three finish early.
 */
export function nextDeadline(from: number, tz: string, hour = 20, minGapH = 12): number {
  const earliest = from + minGapH * 3600_000;
  for (let dayShift = 0; dayShift < 4; dayShift++) {
    const { y, m, d } = localYmd(from + dayShift * 86400_000, tz);
    const t = zonedToUtc(y, m, d, hour, tz);
    if (t >= earliest) return t;
  }
  return earliest + 86400_000;
}

export function safeTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
