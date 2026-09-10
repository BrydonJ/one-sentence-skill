# one-sentence

A [Claude Code](https://claude.com/claude-code) skill that enforces a hard one-sentence limit on every reply: one sentence of prose, no preamble, no summary, no follow-up offer.

Most "be concise" instructions decay after two or three turns. This skill is written to survive that drift — it applies to every response for the rest of the conversation once it loads, not just the next one.

## What it does

- **One sentence per reply.** One terminal punctuation mark, under 30 words, hard stop at 40.
- **Selection over compression.** Picks the single claim that changes your next action and drops the rest, rather than cramming everything into one 90-word run-on.
- **Artifacts are exempt.** Code blocks, file contents, command output, and tables you asked for are not prose and are not counted — the rule kills padding, never the thing you asked for.
- **Honesty is protected.** Uncertainty, disagreement, and warnings count as content, not filler, so they survive the cut.
- **One escape hatch.** Ask to "explain" or "go into detail" and you get a full answer, then it returns to one sentence on the next turn automatically.

## Install

Copy the skill folder into your personal skills directory:

```bash
# macOS / Linux
git clone https://github.com/BrydonJ/one-sentence-skill.git
cp -r one-sentence-skill/skills/one-sentence ~/.claude/skills/
```

```powershell
# Windows (PowerShell)
git clone https://github.com/BrydonJ/one-sentence-skill.git
Copy-Item -Recurse one-sentence-skill\skills\one-sentence "$env:USERPROFILE\.claude\skills\"
```

For a single project instead of all of them, copy it to `.claude/skills/one-sentence/` inside that repo.

Restart the CLI and the skill shows up in the skills list.

## Use

Invoke it explicitly:

```
/one-sentence
```

Sent on its own with no question attached, it compresses the *previous* reply down to one sentence. Attached to a question, it answers that question in one sentence.

It also triggers on its own when you ask for short, brief, terse, or no-fluff answers, or when you complain that a reply was too long.

## Examples

> **How do I undo my last git commit but keep the changes?**
> `git reset --soft HEAD~1`.

> **Is the deploy script broken?**
> Yes — line 40 references `$BUILD_DIR` before it is set, so the rsync copies nothing.

> **Should I use Postgres or MongoDB for this?**
> Postgres, unless your data genuinely has no stable shape — which, given you just described a schema, it does.

Terse is not the same as thin: one sentence is enough room for a specific claim, a reason, and a number.

## License

MIT — see [LICENSE](LICENSE).
