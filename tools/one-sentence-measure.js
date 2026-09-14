#!/usr/bin/env node
// one-sentence — effect measurement.
//
// Walks every transcript in ~/.claude/projects, keeps the ones where the mode
// was ever active, and scores the final assistant message of each turn the way
// the Stop hook scores it. This is the acceptance test for the whole feature:
// "the hook fired" proves mechanism, this proves effect.
//
// BASELINE, measured 2026-09-14, before the PostToolUse hook existed:
//   14 sessions, 149 scored turns, 52 Stop-hook blocks (35% of turns produced a
//   double render), 20 replies still over prose budget after the rewrite,
//   3 replies that passed only because lists and headings are exempt.
//   Length spread: 102 turns <=40 words, 26 at 41-80, 4 at 81-160,
//   13 at 161-320, 4 over 320.
//
// Re-run after a few real one-sentence sessions and compare `blocks/turns`.
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

const S = { sessions: 0, turns: 0, blocks: 0, overProse: 0, overTotal: 0, exemptionPass: 0 };
const spread = {};

for (const file of transcripts()) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
  if (!text.includes('ONE-SENTENCE MODE ACTIVE')) continue;
  S.sessions++;

  let active = false;
  let last = null;

  const flush = () => {
    if (last === null) return;
    S.turns++;
    const p = prose(last);
    const a = total(last);
    if (p > 55) S.overProse++;
    if (a > 55) S.overTotal++;
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
    if (line.includes('that reply is over budget')) S.blocks++;

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

const rate = S.turns ? ((S.blocks / S.turns) * 100).toFixed(1) : '0.0';
console.log(S);
console.log('word spread:', spread);
console.log(`block rate: ${S.blocks}/${S.turns} turns = ${rate}%   (baseline 52/149 = 34.9%)`);
