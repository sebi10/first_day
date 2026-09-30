// The commit-message check (scripts/check-commits.ts, HANDOFF §6.4 item 7): the pure part. The trailer here is a
// stand-in; the real one comes from the deployer's session (TRAILER), never from the repo.
import { describe, expect, it } from 'vitest';
import { messageProblems, modelWord } from '../scripts/check-commits';

const T = 'Co-Authored-By: Claude Example 1.0 <noreply@anthropic.com>';
const ok = `Subject line\n\nA body that says what changed.\n\n${T}\n`;

describe('the commit-message check', () => {
  it('passes a message that ends with the trailer, trailing blank lines or not', () => {
    expect(messageProblems(ok, T)).toEqual([]);
    expect(messageProblems(`${ok}\n\n`, T)).toEqual([]);
    expect(messageProblems(`Merge x: y\n\n${T}`, T)).toEqual([]);
  });

  it("fails git's leftover conflict block after the trailer (a46bd49's message before round 2)", () => {
    const p = messageProblems(`Merge expansion-spec\n\n${T}\n\n# Conflicts:\n#\tisland-company/docs/DECISIONS.md\n`, T);
    expect(p[0]).toMatch(/isn't the last line: after it comes "# Conflicts:"/);
    expect(p.filter((x) => x.startsWith('a git comment line'))).toHaveLength(2);
  });

  it('fails a session line after the trailer and a different attribution trailer (abda756)', () => {
    const other = 'Co-Authored-By: Claude Other 9 <noreply@anthropic.com>';
    const p = messageProblems(`Handoff\n\nBody.\n\n${other}\nClaude-Session: https://claude.ai/code/session_x\n`, T);
    expect(p).toContain("no trailer: the last line isn't the required one");
    expect(p).toContain(`another attribution trailer: "${other}"`);
    expect(messageProblems(`Handoff\n\n${T}\nClaude-Session: https://claude.ai/code/session_x\n`, T)[0]).toMatch(/after it comes "Claude-Session/);
  });

  it("fails the model's name anywhere but the trailer; a file called CLAUDE.md or a run #12 is fine", () => {
    expect(modelWord(T)).toBe('Example');
    expect(messageProblems(`Tuned by example 1.0\n\n${T}\n`, T)).toEqual(['names the model outside the trailer: "Tuned by example 1.0"']);
    expect(messageProblems(`Docs\n\nCLAUDE.md and HANDOFF §4.3; deploy run #12.\n#12 went live.\n\n${T}\n`, T)).toEqual([]);
  });

  it('fails a missing trailer and a trailer that is only close', () => {
    expect(messageProblems('Subject\n\nBody\n', T)).toHaveLength(1);
    expect(messageProblems(`Subject\n\n${T.replace('Co-Authored-By', 'Co-authored-by')}\n`, T)[0]).toMatch(/^no trailer/);
  });
});
