// Offline check of the UserPromptSubmit hook's trigger classification.
//
//   node test/one-sentence-trigger.test.js
//
// The case that matters is the bare trigger: it must carry the compress notice,
// or the model answers the trigger itself and reports on the skill's existence
// instead of repeating its previous reply. Trailing punctuation used to break
// that — `/1s?` was reaching the model as an ordinary prompt.
//
// Runs against a throwaway CLAUDE_CONFIG_DIR, so it never touches live state.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const hook = path.join(__dirname, '..', 'hooks', 'one-sentence.js');
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-sentence-trigger-'));

let failures = 0;

// Each prompt gets its own session id: state is per session, and reusing one
// would let an earlier `off` leak into the next case.
let n = 0;
function classify(prompt) {
  const out = execFileSync('node', [hook], {
    input: JSON.stringify({ session_id: 'TESTTRIGGER' + (n += 1), prompt }),
    env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: configDir }),
    encoding: 'utf8',
  });
  if (!out.trim()) return 'silent';
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
  if (ctx.includes('compress it to one sentence')) return 'compress';
  if (ctx.includes('suspended for THIS REPLY ONLY')) return 'expand';
  return 'reinforce';
}

function check(prompt, want) {
  const got = classify(prompt);
  const ok = got === want;
  if (!ok) failures += 1;
  process.stdout.write((ok ? 'ok   ' : 'FAIL ') + JSON.stringify(prompt) + ' -> ' + got + (ok ? '' : ' (want ' + want + ')') + '\n');
}

// Bare triggers, including every decorated form. `?` is not a question about
// the skill; it is the same condense command.
for (const p of ['/1s', '/1s?', '/1s ?', '/1s.', '/1s!', '/1s please', '/1s Please?',
                 '/one-sentence', '/one-sentence?', '/one-sentence.',
                 '/one-sentence:one-sentence', '/one-sentence:one-sentence?']) {
  check(p, 'compress');
}

// A trigger with real content attached is a question, not a condense command.
check('/1s what is 2+2', 'reinforce');
check('/one-sentence is the deploy broken?', 'reinforce');

// Off forms must not be read as activations, and must emit nothing.
check('/1s off', 'silent');
check('/one-sentence stop', 'silent');

// Natural-language activation still reinforces rather than compressing.
check('keep it brief from now on', 'reinforce');

// An explicit ask to expand wins over the trigger.
check('/1s explain how this works', 'expand');

fs.rmSync(configDir, { recursive: true, force: true });
process.stdout.write(failures === 0 ? '\nall passed\n' : '\n' + failures + ' failed\n');
process.exit(failures === 0 ? 0 : 1);
