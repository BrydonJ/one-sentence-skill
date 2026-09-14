# one-sentence

One sentence per reply. Two only if you asked two things.

A [Claude Code](https://claude.com/claude-code) skill, plus the three hooks that stop it drifting back to paragraphs by turn four.

## Before / after

**"Is the deploy script broken?"**

> Before — Great question! I took a look at the deploy script and there are a few things worth flagging. The main issue appears to be around line 40, where `$BUILD_DIR` is referenced. Looking at the surrounding code, this variable is set later in the file, on line 52, which means that at the point rsync runs it will be empty. In practice this means the rsync command expands to a no-op and silently copies nothing. There are also a couple of minor style issues I noticed. Let me know if you'd like me to fix this!

> After — Yes, line 40 references `$BUILD_DIR` before it is set on line 52, so the rsync copies nothing.

**"Did the tests pass?"**

> Before — I ran the full test suite for you. Here's a summary of what happened: out of 401 tests, 400 passed successfully. There is one failure in `auth.spec.ts`, specifically the token expiry test...

> After — 400/401 pass; `auth.spec.ts` fails on token expiry.

**"How do I install this?"** — steps stay a list, capped at 10 words each

> After — Clone it and run the installer; no restart needed.
> 1. Clone the repo.
> 2. Run `node install.js`.
> 3. Confirm with `/hooks`.

## Install

```bash
git clone https://github.com/BrydonJ/one-sentence-skill.git
cd one-sentence-skill
node install.js   # --dry-run to preview, --uninstall to remove
```

Claude Code picks the hooks up without a restart. `node test/one-sentence-posttool.test.js` checks the cadence hook against a throwaway config dir.

## Use

`/one-sentence` or `/1s` to start. `/1s off` or "normal mode" to stop.

`/1s` needs `commands/1s.md` on disk — the installer puts it there, because the harness matches slash commands to skill names and would otherwise answer `/1s` with "command not found".

On its own it compresses your *last* reply; attached to a question it answers in one sentence. It also self-triggers on "be brief", "too long", "tl;dr".

Say "explain" or "in detail" for a full answer — it returns to one sentence next turn.

## Why the hook

`SKILL.md` is injected once. Nothing re-asserts it, so the model drifts back to paragraphs within a few turns — the exact thing you installed it to prevent.

`hooks/one-sentence.js` re-injects the rule on every prompt while the mode is on.

`hooks/one-sentence-posttool.js` closes the distance. A reminder injected at prompt-submit still loses on the last message of a long agentic run, dozens of tool calls later, where the wrap-up instinct is strongest and nothing sits between the final tool result and the reply. This hook re-states a one-line version after the 3rd tool call of a turn and every 5th after that, for as long as the turn runs. Subagents share the parent's session id, so their calls are skipped — otherwise one 70-call agent would burn through every injection point and the hook would go quiet on exactly the turns it exists for.

`hooks/one-sentence-stop.js` is the gate behind it. It reads the finished reply and sends it back once if the prose runs over — lists, code, and output do not count, and an explicit "explain" is exempt. Note that `Stop` cannot retract what already rendered: a block shows the long reply *and* the rewrite under it, which is why the PostToolUse hook exists to make blocks rare rather than to make them stricter.

Measured across 14 real sessions before the PostToolUse hook: 52 of 149 replies in this mode (35%) were over budget on the first pass. `tools/one-sentence-measure.js` re-runs that count against your own transcripts.

## Rules it holds to

- Under 30 words, hard cap 40.
- Code, output, and lists you asked for are exempt — never withheld.
- Uncertainty and warnings stay in; they are content, not padding.
- Action lists get listed, 10 words per step.

## Notes

Saying "one sentence" turns it on. Stacks with other `UserPromptSubmit` style hooks. Fails silent, always exits 0.

The PostToolUse re-assert costs about 70 tokens each time it fires, so roughly 550 on a long turn — less than one blocked wall-of-text and its rewrite.

MIT — see [LICENSE](LICENSE).
