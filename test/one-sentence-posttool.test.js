// Offline check of the PostToolUse hook: cadence, subagent filtering, and both
// suppression paths.
//
//   node test/one-sentence-posttool.test.js
//
// Runs against a throwaway CLAUDE_CONFIG_DIR, so it never touches the state of
// a live session.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const hook = path.join(__dirname, '..', 'hooks', 'one-sentence-posttool.js');
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-sentence-test-'));
const stateDir = path.join(configDir, 'one-sentence');
const sid = 'TESTSESSION1';
const f = (ext) => path.join(stateDir, sid + ext);

fs.mkdirSync(stateDir, { recursive: true });

// The hook tells a subagent call from a main-thread one by its transcript path:
// the main thread writes to <session>.jsonl, a subagent to
// <session>/subagents/agent-*.jsonl.
const MAIN_TRANSCRIPT = path.join(configDir, 'projects', 'proj', sid + '.jsonl');
const SUB_TRANSCRIPT = path.join(configDir, 'projects', 'proj', sid, 'subagents', 'agent-abc123.jsonl');

function run(transcript) {
  const out = execFileSync('node', [hook], {
    input: JSON.stringify({
      session_id: sid,
      tool_name: 'Bash',
      transcript_path: transcript || MAIN_TRANSCRIPT,
    }),
    env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: configDir }),
  }).toString();
  return out.includes('ONE-SENTENCE MODE is still active');
}

function sweep(n, transcript) {
  const hits = [];
  for (let i = 1; i <= n; i++) if (run(transcript)) hits.push(i);
  return hits;
}

function reset() {
  fs.writeFileSync(f('.tc'), '0');
}

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}`
    + (ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) + '\n');
}

// Cadence: first at 3, then every 5th, all the way to the end of the turn.
fs.writeFileSync(f('.state'), 'on');
reset();
check('cadence over 40 tool calls', sweep(40), [3, 8, 13, 18, 23, 28, 33, 38]);

// Subagents run under the parent's session_id, so an unfiltered 72-call agent
// would push the parent past every injection point.
reset();
check('subagent calls never inject', sweep(30, SUB_TRANSCRIPT), []);
check('subagent calls never count', fs.readFileSync(f('.tc'), 'utf8').trim(), '0');
check('parent cadence intact after subagent', sweep(10), [3, 8]);

// A turn where the user asked for detail must not be nagged.
reset();
fs.writeFileSync(f('.expand'), '1');
check('expand marker suppresses', sweep(12), []);
fs.unlinkSync(f('.expand'));

// Mode off means silent.
fs.writeFileSync(f('.state'), 'off');
reset();
check('mode off suppresses', sweep(12), []);

// No state file at all (mode never switched on) means silent.
fs.unlinkSync(f('.state'));
reset();
check('no state file suppresses', sweep(12), []);

// A short turn never reaches the first injection point.
fs.writeFileSync(f('.state'), 'on');
reset();
check('two-call turn stays quiet', sweep(2), []);

fs.rmSync(configDir, { recursive: true, force: true });
process.stdout.write(failures === 0 ? 'ALL PASS\n' : `${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
