#!/usr/bin/env node
// one-sentence — Stop hook.
//
// The UserPromptSubmit reminder is advice, and advice loses. At the end of a
// long agentic run the final message arrives thousands of tokens and dozens of
// tool calls after the reminder was injected, with the active task's own
// reporting contract pulling the other way — so the wrap-up comes out as a wall
// of text even though the rule was re-stated on that very turn.
//
// This hook reads the finished reply and blocks it once if the prose is over
// budget, which turns the rule into a gate. A gate cannot lose an argument with
// the model's attention.
//
// Contract (Claude Code Stop):
//   stdin  — JSON { session_id, transcript_path, stop_hook_active, cwd }
//   stdout — JSON { decision: "block", reason } to send the reply back for a
//            rewrite, or nothing to let it through.
//   exit   — always 0.

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const stateDir = path.join(claudeDir, 'one-sentence');

// 40 words is the rule; this blocks at 55. The gap is deliberate — a hard gate
// on the exact number would fire on replies that are essentially compliant, and
// a hook that punishes near-misses gets uninstalled. This is here for the
// 300-word wrap-up, not for a 43-word answer.
const WORD_LIMIT = 55;

// Only the tail is parsed: transcripts run to megabytes and the last assistant
// message is always at the end.
const TAIL_BYTES = 512 * 1024;

const REASON = [
  'ONE-SENTENCE MODE: that reply is over budget — rewrite it before sending.',
  'Keep the end-of-task recap, but compress it to ONE sentence (two only if there are genuinely two parts), under 40 words.',
  'Pick the single claim that changes what the user does next: what now works, plus the one caveat if there is one.',
  'If the user has steps to perform, follow the sentence with a list, each step 10 words or fewer.',
  'Drop the section headings, the evidence tally, the time breakdown, and anything they can ask for. Send only the compressed version.',
].join(' ');

function validSessionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

function readState(sessionId) {
  try {
    const p = path.join(stateDir, (sessionId || 'default') + '.state');
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > 32) return null;
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw === 'on' || raw === 'off' ? raw : null;
  } catch (e) {
    return null;
  }
}

// The companion prompt hook drops this marker on a turn where the user asked
// for detail. Blocking that reply would contradict what they just asked for, so
// the marker is consumed here and the reply goes through untouched.
function takeExpandMarker(sessionId) {
  const p = path.join(stateDir, (sessionId || 'default') + '.expand');
  try {
    if (!fs.lstatSync(p).isFile()) return false;
    fs.unlinkSync(p);
    return true;
  } catch (e) {
    return false;
  }
}

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    // A partial first line is unparseable JSON; drop it rather than let the
    // per-line try/catch swallow a line that might have been the one we want.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

// Returns the text of the final assistant message, or null.
function lastAssistantText(transcriptPath) {
  let lines;
  try {
    lines = readTail(transcriptPath).split('\n');
  } catch (e) {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch (e) { continue; }
    if (row.type !== 'assistant') continue;
    const content = row.message && row.message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    // An assistant turn that only made tool calls has no text. That is not the
    // final reply, so keep walking back rather than treating it as a 0-word
    // pass — otherwise every tool-using turn would skip the check.
    if (text) return text;
    if (content.some((b) => b && b.type === 'tool_use')) return null;
  }
  return null;
}

// Counts only prose. Code, output, tables, and lists are exempt by the skill's
// own rules, and counting them would block exactly the replies that are shaped
// correctly.
function proseWordCount(text) {
  const withoutFences = text.replace(/```[\s\S]*?(?:```|$)/g, '');
  let words = 0;
  for (const raw of withoutFences.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(?:[-*+]|\d+[.)])\s/.test(line)) continue; // list item
    if (line.startsWith('|') || line.startsWith('>')) continue; // table, quote
    if (/^#{1,6}\s/.test(line)) continue; // heading
    if (/^\s*$/.test(line)) continue;
    words += line.split(/\s+/).filter(Boolean).length;
  }
  return words;
}

function handle(raw) {
  try {
    const data = JSON.parse(raw);

    // Set when this Stop already blocked once. Without this check a reply that
    // stays over budget would be sent back forever.
    if (data.stop_hook_active) return;

    const sessionId = validSessionId(data.session_id);
    if (readState(sessionId) !== 'on') return;
    if (takeExpandMarker(sessionId)) return;
    if (!data.transcript_path) return;

    const text = lastAssistantText(data.transcript_path);
    if (!text) return;
    if (proseWordCount(text) <= WORD_LIMIT) return;

    process.stdout.write(JSON.stringify({ decision: 'block', reason: REASON }));
  } catch (e) {
    // Silent: a Stop hook that throws would surface an error on a turn whose
    // only fault is that this check could not run.
  }
}

let input = '';
let handled = false;
function once(raw) {
  if (handled) return;
  handled = true;
  handle(raw);
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  try { JSON.parse(input); } catch (e) { return; }
  once(input);
  process.stdin.pause();
  try { process.stdin.unref(); } catch (e) {}
});
process.stdin.on('end', () => once(input));
process.stdin.on('error', () => process.exit(0));
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => process.exit(0));
}
