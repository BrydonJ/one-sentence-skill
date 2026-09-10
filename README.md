# one-sentence

A [Claude Code](https://claude.com/claude-code) skill that holds every reply to one sentence — two only when the question genuinely has two parts — with no preamble, no summary, and no follow-up offer.

## The problem it actually solves

Asking for brevity works for a turn or two. Then a hard question arrives, the pull to be thorough wins, and by turn four you are back to paragraphs without any decision having been made to go back. You re-ask for brevity, and the cycle repeats.

That drift is the bug. A skill file alone cannot fix it, because `SKILL.md` is injected once when the skill loads and nothing re-asserts it afterwards. So this repo ships two halves:

- **`skills/one-sentence/SKILL.md`** — the rule and the reasoning behind it: what counts as prose, how to pick the one claim that matters, what to delete first, and why honesty is never the thing that gets cut.
- **`hooks/one-sentence.js`** — a `UserPromptSubmit` hook that re-injects a short directive on *every* prompt for as long as the mode is on, so the rule is never more than one turn old in the model's attention.

The hook is the enforcement; the skill file is the reasoning. Install both.

## What the style actually is

- **One sentence per reply**, under 30 words, hard cap 40. Two sentences only when the user asked two things.
- **Selection over compression.** Say the one claim that changes your next action; a 90-word run-on chained with semicolons breaks the rule just as badly as four short sentences, because the cost is reading time, not full stops.
- **Artifacts are exempt.** Code blocks, command output, file contents, diffs, and any table or list you asked for are not prose and never get withheld to protect the sentence count.
- **Action lists get listed.** When you have to *do* a sequence of steps, the sentence comes first and the steps follow immediately, 10 words or fewer each — brevity should not hide the work in prose.
- **Honesty is protected.** Uncertainty, disagreement, and warnings are content, not padding — they are what a thoughtless brevity rule cuts first.
- **One escape hatch.** Say "explain", "in detail", "walk me through it", or a bare "why?" and you get a full answer, then it returns to one sentence on the next turn automatically.

## Install

Requires Node (already present if you run Claude Code).

```bash
git clone https://github.com/BrydonJ/one-sentence-skill.git
cd one-sentence-skill
node install.js
```

That copies `SKILL.md` to `~/.claude/skills/one-sentence/`, copies the hook to `~/.claude/hooks/`, and registers the hook under `UserPromptSubmit` in `~/.claude/settings.json` (backing the file up first). It is idempotent — re-running updates the existing entry rather than adding a second one.

```bash
node install.js --dry-run    # show what would change, touch nothing
node install.js --uninstall  # unregister and delete the hook, keep the skill folder
```

**Restart Claude Code afterwards.** Hooks are read at startup, so a session that was already open will not pick it up. Confirm with `/hooks`.

Honours `CLAUDE_CONFIG_DIR` if you keep your config somewhere other than `~/.claude`.

## Use

```
/one-sentence
```

Sent on its own with no question attached, it compresses your *previous* reply to one sentence. Attached to a question, it answers that question in one sentence. `/1s` is the short form — the hook is what makes that alias work, since the harness resolves slash commands by skill name.

It also switches on by itself when you ask for short, brief, terse, or no-fluff answers, or complain that a reply was too long.

Turn it off with `/1s off`, "stop one-sentence", or "normal mode". State is per session, so a new session starts clean.

## Examples

> **How do I undo my last git commit but keep the changes?**
> `git reset --soft HEAD~1`.

> **Is the deploy script broken?**
> Yes — line 40 references `$BUILD_DIR` before it is set, so the rsync copies nothing.

> **Did the migration work, and is the index still there?**
> Migration applied clean on all 14 tables. The index is gone — `20260910_add_users` drops and never recreates it.

Terse is not thin: one sentence is enough room for a specific claim, a reason, and a number.

## Notes

- The phrase "one sentence" is itself an activation trigger, so discussing this skill in a session switches it on. That is usually what you want and occasionally surprising while editing it.
- If you also run a style plugin that injects on `UserPromptSubmit` (caveman, for instance), both fire every turn and stack. They do not conflict — one governs length, the other register — but you are paying for two injections.
- The hook fails silently by design and always exits 0. A style hook should never turn a working turn into an error.

## License

MIT — see [LICENSE](LICENSE).
