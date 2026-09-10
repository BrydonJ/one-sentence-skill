# one-sentence

One sentence per reply. Two only if you asked two things.

A [Claude Code](https://claude.com/claude-code) skill, plus the hook that stops it drifting back to paragraphs by turn four.

## Before / after

**"Is the deploy script broken?"**

> Before — Great question! I took a look at the deploy script and there are a few things worth flagging. The main issue appears to be around line 40, where `$BUILD_DIR` is referenced. Looking at the surrounding code, this variable is set later in the file, on line 52, which means that at the point rsync runs it will be empty. In practice this means the rsync command expands to a no-op and silently copies nothing. There are also a couple of minor style issues I noticed. Let me know if you'd like me to fix this!

> After — Yes, line 40 references `$BUILD_DIR` before it is set on line 52, so the rsync copies nothing.

**"Did the tests pass?"**

> Before — I ran the full test suite for you. Here's a summary of what happened: out of 401 tests, 400 passed successfully. There is one failure in `auth.spec.ts`, specifically the token expiry test...

> After — 400/401 pass; `auth.spec.ts` fails on token expiry.

**"How do I install this?"** — steps stay a list, capped at 10 words each

> After — Run the installer, then restart; hooks only load at startup.
> 1. Clone the repo.
> 2. Run `node install.js`.
> 3. Restart Claude Code.
> 4. Confirm with `/hooks`.

## Install

```bash
git clone https://github.com/BrydonJ/one-sentence-skill.git
cd one-sentence-skill
node install.js   # --dry-run to preview, --uninstall to remove
```

Restart Claude Code afterwards — hooks load at startup.

## Use

`/one-sentence` or `/1s` to start. `/1s off` or "normal mode" to stop.

`/1s` needs `commands/1s.md` on disk — the installer puts it there, because the harness matches slash commands to skill names and would otherwise answer `/1s` with "command not found".

On its own it compresses your *last* reply; attached to a question it answers in one sentence. It also self-triggers on "be brief", "too long", "tl;dr".

Say "explain" or "in detail" for a full answer — it returns to one sentence next turn.

## Why the hook

`SKILL.md` is injected once. Nothing re-asserts it, so the model drifts back to paragraphs within a few turns — the exact thing you installed it to prevent.

`hooks/one-sentence.js` re-injects the rule on every prompt while the mode is on. That is the whole fix.

## Rules it holds to

- Under 30 words, hard cap 40.
- Code, output, and lists you asked for are exempt — never withheld.
- Uncertainty and warnings stay in; they are content, not padding.
- Action lists get listed, 10 words per step.

## Notes

Saying "one sentence" turns it on. Stacks with other `UserPromptSubmit` style hooks. Fails silent, always exits 0.

MIT — see [LICENSE](LICENSE).
