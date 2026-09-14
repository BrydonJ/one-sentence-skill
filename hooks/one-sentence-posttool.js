#!/usr/bin/env node
// one-sentence — PostToolUse hook.
//
// Measured on 14 sessions of real transcripts: 52 of 149 replies made while the
// mode was on (35%) came out over budget on the first pass. The Stop hook
// caught them, but `decision: "block"` cannot retract a message that has
// already rendered — so the user sees the wall of text, then the compressed
// rewrite underneath it, and reads a working gate as drift.
//
// The cause is distance. The UserPromptSubmit directive is injected at the top
// of the turn; in an agentic run the final message is composed a dozen tool
// results later, with the task's own reporting pull in between. Nothing sat
// between the last tool result and the wrap-up.
//
// This hook fills that gap: it re-asserts a one-line version of the rule after
// the 3rd tool call of a turn and every 5th after that, so the rule is never
// far from the point where the reply is actually written. It is deliberately
// much shorter than the UserPromptSubmit reinforcement — here it competes with
// fresh tool output, and a long block gets skimmed.
//
// Contract (Claude Code PostToolUse):
//   stdin  — JSON { session_id, transcript_path, tool_name, cwd, ... }
//   stdout — JSON { hookSpecificOutput: { hookEventName, additionalContext } }
//   exit   — always 0.

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const stateDir = path.join(claudeDir, 'one-sentence');

// First injection point. Below this the UserPromptSubmit directive is still
// recent enough to hold, and injecting on call 1 of a two-call turn is noise.
const FIRST_AT = 3;
// Then every Nth. Every call would be token waste on a 40-call turn and trains
// the model to skim the block.
const EVERY = 5;

const DIRECTIVE =
  'ONE-SENTENCE MODE is still active for the final reply of this turn: ONE sentence, under 40 words, '
  + 'no headings, no section-by-section account of these tool calls, no recap of what you already said. '
  + 'If the user has steps to perform, write the sentence then the steps, each 10 words or fewer.';

// Subagents run under the PARENT's session_id — verified in the transcripts: a
// single cavecrew agent logged 72 tool calls against its parent session. Left
// unfiltered those calls would race the parent's counter past every injection
// point, so the hook would go silent on precisely the agentic turns it exists
// for. Their own transcript is what distinguishes them: the main thread writes
// to <session>.jsonl, a subagent to <session>/subagents/agent-*.jsonl. A
// subagent's report is not the reply the user reads, so it is neither counted
// nor nagged.
function isSubagentCall(transcriptPath) {
  return typeof transcriptPath === 'string'
    && /[\\/]subagents[\\/]/.test(transcriptPath);
}

function validSessionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

function statePath(sessionId, ext) {
  return path.join(stateDir, (sessionId || 'default') + ext);
}

// Same defensive read as the other two hooks: this value decides whether text
// is injected into model context, so anything unexpected means "no mode".
function readState(sessionId) {
  try {
    const p = statePath(sessionId, '.state');
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > 32) return null;
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw === 'on' || raw === 'off' ? raw : null;
  } catch (e) {
    return null;
  }
}

// The UserPromptSubmit hook drops this when the user asked for detail. Nagging
// for one sentence through a turn they explicitly asked to be long is the
// failure mode that makes people uninstall the thing.
function hasExpandMarker(sessionId) {
  try {
    return fs.lstatSync(statePath(sessionId, '.expand')).isFile();
  } catch (e) {
    return false;
  }
}

// Per-turn tool counter. UserPromptSubmit resets it to 0 at the top of every
// active turn; without that reset the count would run for the whole session and
// the injection cadence would be meaningless.
function bumpCount(sessionId) {
  const p = statePath(sessionId, '.tc');
  let n = 0;
  try {
    const st = fs.lstatSync(p);
    if (st.isFile() && st.size <= 16) {
      const parsed = parseInt(fs.readFileSync(p, 'utf8').trim(), 10);
      if (Number.isFinite(parsed) && parsed >= 0) n = parsed;
    }
  } catch (e) {
    // No counter yet — this is the first tool call since the reset.
  }
  n += 1;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(p, String(n), 'utf8');
  } catch (e) {
    // A failed write costs cadence accuracy on this turn, nothing more.
  }
  return n;
}

// No cap. A cap that expires mid-run restores the exact distance problem this
// hook exists to close, and the 60-call turns are the ones that produce the
// wall-of-text wrap-up. One injection per 5 calls is cheap enough to run to the
// end of any turn.
function shouldInject(n) {
  return n >= FIRST_AT && (n - FIRST_AT) % EVERY === 0;
}

let handled = false;

function handle(raw) {
  if (handled) return;
  handled = true;
  try {
    const data = JSON.parse(raw);
    if (isSubagentCall(data.transcript_path)) return;
    const sessionId = validSessionId(data.session_id);
    if (readState(sessionId) !== 'on') return;
    if (hasExpandMarker(sessionId)) return;
    if (!shouldInject(bumpCount(sessionId))) return;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: DIRECTIVE,
      },
    }));
  } catch (e) {
    // Silent: a hook that reports its own parse failures turns one bad payload
    // into an error on every tool call.
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  try { JSON.parse(input); } catch (e) { return; }
  handle(input);
  process.stdin.pause();
  try { process.stdin.unref(); } catch (e) {}
});
process.stdin.on('end', () => handle(input));
process.stdin.on('error', () => process.exit(0));
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => process.exit(0));
}
