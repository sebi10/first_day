// The commit-message check (HANDOFF §6.4 item 7), run before a deploy push. From island-company/:
//
//   git fetch origin
//   TRAILER='<the Co-Authored-By line your session is configured with>' npx tsx scripts/check-commits.ts [base]
//
// base is the deploy branch as the remote has it (default origin/claude/jolly-keller-gy5hs4). It checks every
// commit the push would publish (base..HEAD, merges included). Each message must:
//   - end with TRAILER, exactly, as its last line (nothing after it: no session line, no leftover conflict block)
//   - hold no git comment line ("# Conflicts:", "#\t<file>"): those are what git's editor strips, left in by mistake
//   - name no model outside that last line: no second attribution trailer, and not the model TRAILER names
// and base must already be in HEAD, or the push isn't a fast-forward (merge it --no-ff first, §6.4 item 8).
//
// Commits already on the remote aren't in base..HEAD: pushed history is never rewritten, so there's nothing to
// fix there. An unpushed commit that fails can be reworded with an identical tree (§6.4 item 7). Exit 1 on any
// problem. The model's name lives only in TRAILER, never in this file.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ATTRIBUTION = /^Co-Authored-By:\s.*<noreply@anthropic\.com>\s*$/i;
const GIT_COMMENT = /^#([ \t]|$)/;

/** The model's own name in the trailer: "Co-Authored-By: Claude <Name> <version> <email>" → "<Name>" (null if none). */
export function modelWord(trailer: string): string | null {
  const m = /^Co-Authored-By:\s+(.+?)\s+<[^>]+>$/i.exec(trailer.trim());
  const words = m ? m[1].split(/\s+/) : [];
  const w = words.length > 1 ? words[1] : null;
  return w && /^[a-z]{3,}$/i.test(w) ? w : null;
}

/** What's wrong with one commit message against the required trailer line: [] when it passes. */
export function messageProblems(message: string, trailer: string): string[] {
  const want = trailer.trim();
  const lines = message.replace(/\s+$/, '').split('\n');
  const last = lines.length - 1;
  const problems: string[] = [];
  if (lines[last] !== want) {
    const at = lines.lastIndexOf(want);
    const after = lines.slice(at + 1).find((l) => l.trim()) ?? '';
    problems.push(at < 0 ? "no trailer: the last line isn't the required one" : `the trailer isn't the last line: after it comes "${after.replace(/\t/g, '\\t')}"`);
  }
  const word = modelWord(want);
  const named = word ? new RegExp(`\\b${word}\\b`, 'i') : null;
  lines.forEach((line, i) => {
    if (i === last && line === want) return;
    if (GIT_COMMENT.test(line)) problems.push(`a git comment line left in: "${line.replace(/\t/g, '\\t')}"`);
    else if (ATTRIBUTION.test(line) && line !== want) problems.push(`another attribution trailer: "${line}"`);
    else if (named?.test(line) && line !== want) problems.push(`names the model outside the trailer: "${line.trim()}"`);
  });
  return problems;
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 });

function main() {
  const trailer = process.env.TRAILER?.trim();
  if (!trailer || !ATTRIBUTION.test(trailer)) {
    console.error('TRAILER must be the Co-Authored-By line your session is configured with (… <noreply@anthropic.com>).');
    process.exit(2);
  }
  const base = process.argv[2] ?? 'origin/claude/jolly-keller-gy5hs4';
  const baseSha = git('rev-parse', '--verify', `${base}^{commit}`).trim();
  let fastForward = true;
  try {
    git('merge-base', '--is-ancestor', baseSha, 'HEAD');
  } catch {
    fastForward = false;
  }
  const shas = git('rev-list', '--reverse', `${baseSha}..HEAD`).split('\n').filter(Boolean);
  let bad = 0;
  for (const sha of shas) {
    const raw = git('cat-file', 'commit', sha);
    const message = raw.slice(raw.indexOf('\n\n') + 2);
    const problems = messageProblems(message, trailer);
    if (!problems.length) continue;
    bad++;
    const pushed = git('branch', '-r', '--contains', sha).split('\n').map((s) => s.trim()).filter(Boolean);
    console.log(`FAIL ${sha.slice(0, 7)} ${message.split('\n')[0]}${pushed.length ? `  (already on ${pushed.join(', ')}: can't be reworded)` : ''}`);
    for (const p of problems) console.log(`     - ${p}`);
  }
  if (!fastForward) console.log(`FAIL ${base} (${baseSha.slice(0, 7)}) isn't in HEAD: merge it --no-ff first (HANDOFF §6.4 item 8)`);
  console.log(`${shas.length} commit(s) in ${base}..HEAD, ${bad} failing${fastForward ? '' : ', and the push is not a fast-forward'}.`);
  process.exit(bad || !fastForward ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
