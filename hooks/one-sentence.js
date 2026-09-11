#!/usr/bin/env node
// one-sentence — UserPromptSubmit hook.
//
// The SKILL.md text is injected once, when the skill loads. Three turns later
// the model is still holding it in principle but has stopped acting on it,
// because every subsequent turn carries fresh task context and nothing
// re-asserts the style. That drift is the entire bug this hook exists to fix:
// it re-injects a short directive on EVERY user prompt for as long as the mode
// is on, so the rule is never more than one turn old in the model's attention.
//
// Contract (Claude Code UserPromptSubmit):
//   stdin  — JSON { session_id, prompt, cwd, transcript_path }
//   stdout — JSON { hookSpecificOutput: { hookEventName, additionalContext } }
//   exit   — always 0. A non-zero hook is surfaced to the user as an error on a
//            turn that has nothing wrong with it.

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const stateDir = path.join(claudeDir, 'one-sentence');

// The directive re-sent every turn. Deliberately short: it competes for
// attention with the real task, and a long re-injection is both expensive and
// easier for the model to skim past than three imperative lines.
const REINFORCEMENT = [
  'ONE-SENTENCE MODE ACTIVE. Answer in ONE sentence; two only if the question genuinely has two parts. Hard cap 40 words of prose.',
  'Cut: preamble, restating the question, recapping what you just did, summarising what you just said, and any "let me know if / want me to" offer.',
  'Prose only counts: code blocks, command output, file contents, and a table or list the user asked for are exempt — write the sentence, then emit the artifact, never withhold it.',
  'Pick the ONE claim that changes what the user does next and let the rest go unsaid; they will ask if they want it.',
  'Uncertainty, disagreement, and warnings are content, not padding — keep those in the sentence.',
  'EXCEPTION — action lists: when the user must DO a sequence of steps, write the sentence, then list the steps immediately, every step 10 words or fewer, imperative, no sub-bullets and no commentary around the list.',
].join(' ');

// An explicit ask to expand suspends the limit for exactly one turn. Without
// this the model faces a rule it cannot obey (the user asked for detail, the
// hook says one sentence) and resolves the conflict by dropping the rule
// wholesale — which is the drift, arriving by a different road.
const EXPAND_NOTICE =
  'The user explicitly asked for detail this turn, so one-sentence mode is suspended for THIS REPLY ONLY. '
  + 'Answer at the length the question deserves, then return to one sentence on the very next turn without being told.';

const COMPRESS_NOTICE =
  'The prompt is only the trigger, with no new question attached: do not treat it as a new request. '
  + 'Take your own previous reply and compress it to one sentence, and send only that sentence.';

// Slash forms. `/1s` is an alias the skill documents; the harness resolves
// slash commands by skill name, so the hook is what actually makes it work.
const ON_SLASH = /^\/(?:one-sentence(?::one-sentence)?|1s)\b/;
const OFF_SLASH = /^\/(?:one-sentence(?::one-sentence)?|1s)\s+(?:off|stop|end)\b/;

// Natural-language activation. Matched against the whole prompt, not the head,
// because "that was way too long" arrives mid-sentence far more often than it
// arrives as an opening.
const ON_PHRASES = [
  /\bone[- ]sentence\b/,
  /\b(?:be|keep it|stay)\s+(?:brief|concise|short|terse)\b/,
  /\bkeep (?:it|your (?:answers?|replies)) short\b/,
  /\b(?:too|way too) (?:long|wordy|verbose|padded)\b/,
  /\bstop (?:waffling|rambling|padding)\b/,
  /\bno (?:fluff|filler|preamble|waffle)\b/,
  /\bjust answer\b/,
  /\btl;?dr\b/,
];

const OFF_PHRASES = [
  /\b(?:stop|disable|turn off|cancel) one[- ]sentence\b/,
  /\bnormal mode\b/,
  /\b(?:be|you can be) (?:verbose|detailed|thorough) again\b/,
  /\bfull (?:answers?|length|detail) again\b/,
];

// One-turn expansion. "why?" is included because it is the shortest real
// request for reasoning in the language, and answering it in one sentence is
// usually a non-answer.
const EXPAND_PHRASES = [
  /\bexplain\b/,
  /\bin detail\b/,
  /\bgo (?:into detail|deep|deeper)\b/,
  /\bwalk me through\b/,
  /\belaborate\b/,
  /\blong version\b/,
  /\bmore detail\b/,
  /\bwrite (?:up|me) (?:a|the) (?:doc|report|summary|readme|plan)\b/,
  /\bwhy\?$/,
];

// Session ids come from the harness, but they are still used to build a path.
// Anything outside this alphabet is refused rather than sanitised: a rejected
// id degrades to machine-wide state, while a sanitised one could collide two
// sessions onto a single file.
function validSessionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

function statePath(sessionId) {
  return path.join(stateDir, (sessionId || 'default') + '.state');
}

// Reads are defensive on purpose: this value is about to steer what gets
// injected into model context, and a symlinked or oversized state file must
// produce "no mode" rather than arbitrary bytes.
function readState(sessionId) {
  try {
    const p = statePath(sessionId);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > 32) return null;
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw === 'on' || raw === 'off' ? raw : null;
  } catch (e) {
    return null;
  }
}

function writeState(sessionId, value) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath(sessionId), value, 'utf8');
  } catch (e) {
    // A state write that fails costs this session's persistence, nothing more.
  }
}

// State files accumulate one per session forever otherwise. Cheap sweep, run
// only on activation so the ordinary turn stays a single read.
function sweepOldState() {
  try {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(stateDir)) {
      const p = path.join(stateDir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch (e) {
    // Nothing to sweep, or no permission to. Neither is worth a message.
  }
}

// The Stop hook needs to know that THIS turn was an explicit detail request,
// or it would block the long answer the user just asked for. A file is the only
// channel between the two hooks.
function setExpandMarker(sessionId) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, (sessionId || 'default') + '.expand'), '1', 'utf8');
  } catch (e) {
    // Worst case the Stop hook blocks a reply that was allowed to be long.
  }
}

function clearExpandMarker(sessionId) {
  try {
    fs.unlinkSync(path.join(stateDir, (sessionId || 'default') + '.expand'));
  } catch (e) {
    // Not present is the normal case.
  }
}

function matchesAny(patterns, text) {
  return patterns.some((re) => re.test(text));
}

function handle(raw) {
  if (handled) return;
  handled = true;
  try {
    const data = JSON.parse(raw);
    const sessionId = validSessionId(data.session_id);
    const prompt = (data.prompt || '').trim().toLowerCase().replace(/\s+/g, ' ');

    let state = readState(sessionId);

    // Order matters: the off forms are strict subsets of the on forms, so an
    // on-check that ran first would swallow "/1s off" as an activation.
    if (OFF_SLASH.test(prompt) || matchesAny(OFF_PHRASES, prompt)) {
      writeState(sessionId, 'off');
      return;
    }

    if (ON_SLASH.test(prompt) || matchesAny(ON_PHRASES, prompt)) {
      if (state !== 'on') sweepOldState();
      writeState(sessionId, 'on');
      state = 'on';
    }

    if (state !== 'on') return;

    // A bare trigger is a request to compress the PREVIOUS reply, not a new
    // question — without this the model answers the trigger itself.
    const bareTrigger = /^\/(?:one-sentence(?::one-sentence)?|1s)\s*$/.test(prompt);

    const parts = [];
    if (matchesAny(EXPAND_PHRASES, prompt)) {
      setExpandMarker(sessionId);
      parts.push(EXPAND_NOTICE);
    } else {
      clearExpandMarker(sessionId);
      if (bareTrigger) parts.push(COMPRESS_NOTICE);
      parts.push(REINFORCEMENT);
    }

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: parts.join('\n\n'),
      },
    }));
  } catch (e) {
    // Silent: a hook that reports its own parse failures turns one bad payload
    // into an error on every prompt.
  }
}

let input = '';
// The payload can complete on a data chunk AND then fire 'end'; without this
// guard the directive is written to stdout twice and the host parses garbage.
let handled = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  // A partial payload throws here; wait for the rest.
  try { JSON.parse(input); } catch (e) { return; }
  handle(input);
  // The host can be slow to close its write end on Windows, which would leave
  // this process idle until the hook timeout fires on a turn whose work is
  // already done. unref drops the handle without closing the fd.
  process.stdin.pause();
  try { process.stdin.unref(); } catch (e) {}
});
process.stdin.on('end', () => handle(input));
process.stdin.on('error', () => process.exit(0));
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => process.exit(0));
}
