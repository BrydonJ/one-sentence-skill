#!/usr/bin/env node
// one-sentence — effect measurement.
//
// Walks every transcript in ~/.claude/projects, keeps the ones where the mode
// was ever active, and scores the final assistant message of each turn the way
// the Stop hook scores it. This is the acceptance test for the whole feature:
// "the hook fired" proves mechanism, this proves effect.
//
// Two different failures, counted separately — conflating them is what made the
// first version of this tool useless:
//   blocked     the FIRST-pass reply was over budget and the Stop hook sent it
//               back. The user still saw it render, so this is the
//               double-render rate, not a success rate.
//   finalOver   the reply left standing at the end of the turn is STILL over
//               budget. This is what the user is left reading.
//
// Results are bucketed by which hooks existed when the session ran, because the
// three landed on different days and a mixed bucket cannot attribute anything:
//   prompt      UserPromptSubmit only        (from 2026-09-10 11:57)
//   +stop       Stop hook added              (from 2026-09-11 11:10)
//   +posttool   PostToolUse added            (from 2026-09-14 17:26)
//
// CORRECTED BASELINE, re-measured 2026-09-17. The numbers published here before
// that date counted 3x: every Stop block is written to the transcript three
// times (an attachment record, a meta user turn and a system record), and any
// line merely CONTAINING the reason string was counted — including this repo's
// own hook source echoed back through a `cat` in a tool result. The old
// "52/149 = 34.9% baseline" was an artifact of that; ignore it wherever it is
// still quoted.
//
//   node tools/one-sentence-measure.js

const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');

// Mirrors proseWordCount in one-sentence-stop.js. Kept in sync by hand; if that
// one changes, change this or the numbers stop being comparable.
function prose(text) {
  const withoutFences = text.replace(/```[\s\S]*?(?:```|$)/g, '');
  let words = 0;
  for (const raw of withoutFences.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(?:[-*+]|\d+[.)])\s/.test(line)) continue;
    if (line.startsWith('|') || line.startsWith('>')) continue;
    if (/^#{1,6}\s/.test(line)) continue;
    words += line.split(/\s+/).filter(Boolean).length;
  }
  return words;
}

function total(text) {
  return text.replace(/```[\s\S]*?(?:```|$)/g, '').split(/\s+/).filter(Boolean).length;
}

function transcripts() {
  const out = [];
  for (const dir of fs.readdirSync(root)) {
    const p = path.join(root, dir);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    for (const f of fs.readdirSync(p)) if (f.endsWith('.jsonl')) out.push(path.join(p, f));
  }
  return out;
}

// Hook landing times, from this repo's own git history. A session is attributed
// by when it started, not by which marker strings it happens to contain: a hook
// that was installed but never fired leaves no marker, so marker-sniffing
// silently files those sessions in the wrong bucket.
const ERAS = [
  { name: '+posttool', from: Date.parse('2026-09-14T17:26:38+02:00') },
  { name: '+stop', from: Date.parse('2026-09-11T11:10:19+02:00') },
  { name: 'prompt', from: Date.parse('2026-09-10T11:57:18+02:00') },
  { name: 'pre-hooks', from: 0 },
];

function newBucket() {
  return { sessions: 0, turns: 0, blocked: 0, finalOver: 0, exemptionPass: 0, spread: {} };
}

const buckets = new Map(ERAS.map((e) => [e.name, newBucket()]));

// The first timestamped record in the transcript. Anything unparseable falls
// through to the oldest era rather than being dropped, so the totals still add
// up to the number of sessions scanned.
function sessionStart(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"timestamp"')) continue;
    let row;
    try { row = JSON.parse(line); } catch (e) { continue; }
    const t = Date.parse(row.timestamp);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function eraOf(startedAt) {
  return ERAS.find((e) => startedAt >= e.from).name;
}

// A Stop block appears in the transcript three times over. This is the one
// record that corresponds 1:1 with a real block, and matching on the record's
// shape rather than on the string means the tool no longer counts its own
// source text when a session happened to read the hook file.
function isBlockRecord(row) {
  return row.type === 'user'
    && row.isMeta
    && typeof (row.message && row.message.content) === 'string'
    && row.message.content.includes('that reply is over budget');
}

for (const file of transcripts()) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
  if (!text.includes('ONE-SENTENCE MODE ACTIVE')) continue;
  const S = buckets.get(eraOf(sessionStart(text)));
  const spread = S.spread;
  S.sessions++;

  let active = false;
  let last = null;

  const flush = () => {
    if (last === null) return;
    S.turns++;
    const p = prose(last);
    const a = total(last);
    if (p > 55) S.finalOver++;
    // Passed the gate on prose alone while carrying a wall of bullets.
    if (p <= 55 && a > 80) S.exemptionPass++;
    const b = a <= 40 ? '0-40' : a <= 80 ? '41-80' : a <= 160 ? '81-160' : a <= 320 ? '161-320' : '320+';
    spread[b] = (spread[b] || 0) + 1;
    last = null;
  };

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch (e) { continue; }

    // The directive arrives as an attachment record, not a user message.
    if (line.includes('ONE-SENTENCE MODE ACTIVE')) active = true;
    if (isBlockRecord(row)) { S.blocked++; continue; }

    if (row.type === 'user' && !row.isMeta) {
      const c = row.message && row.message.content;
      const typed = typeof c === 'string' || (Array.isArray(c) && c.some((b) => b && b.type === 'text'));
      if (typed) flush();
      continue;
    }

    if (row.type === 'assistant' && active) {
      const c = row.message && row.message.content;
      if (!Array.isArray(c)) continue;
      const t = c.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();
      // A tool-only assistant turn is not the final reply of its turn.
      if (t) last = t;
      else if (c.some((b) => b && b.type === 'tool_use')) last = null;
    }
  }
  flush();
}

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0') + '%';

// Oldest first, so the effect of each hook reads down the page.
for (const era of [...ERAS].reverse()) {
  const S = buckets.get(era.name);
  if (!S.sessions) continue;
  console.log(`\n[${era.name}]  ${S.sessions} sessions, ${S.turns} turns`);
  console.log(`  blocked    ${S.blocked}/${S.turns} = ${pct(S.blocked, S.turns)}  (first pass over budget — user saw a double render)`);
  console.log(`  finalOver  ${S.finalOver}/${S.turns} = ${pct(S.finalOver, S.turns)}  (reply left standing is still over budget)`);
  console.log(`  exemptionPass ${S.exemptionPass}  (passed on prose alone while carrying a wall of list items)`);
  console.log('  word spread:', S.spread);
}

// Small buckets are the norm here — a week of real use is tens of sessions, not
// hundreds — so a swing of a few points between eras is noise, and the honest
// read is the direction of finalOver, not its exact value.
console.log('\nBuckets are small; read the direction of finalOver, not the decimal.');
