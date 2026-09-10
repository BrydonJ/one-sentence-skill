#!/usr/bin/env node
// one-sentence installer.
//
//   node install.js              install skill + hook, register the hook
//   node install.js --uninstall  remove the hook registration and the hook file
//   node install.js --dry-run    print what would change, touch nothing
//
// The skill folder alone cannot hold the style: SKILL.md is injected once, and
// the model drifts back to paragraphs within a few turns. The UserPromptSubmit
// hook is what makes it stick, and hooks live in settings.json rather than in
// the skill folder — hence an installer instead of a `cp`.

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const uninstall = args.has('--uninstall');

const repoRoot = __dirname;
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const skillDest = path.join(claudeDir, 'skills', 'one-sentence');
const hookDest = path.join(claudeDir, 'hooks', 'one-sentence.js');
// `/1s` is not resolvable on its own: the harness matches slash commands to
// skill names, so without this file the short form errors with
// "command not found" and the prompt never reaches the model.
const commandDest = path.join(claudeDir, 'commands', '1s.md');
const settingsPath = path.join(claudeDir, 'settings.json');

// Forward slashes in the registered command on every platform: the hook string
// is embedded in JSON, and a Windows backslash path has to be double-escaped
// there, which is a reliable source of silently broken hook registrations.
const hookCommand = 'node "' + hookDest.replace(/\\/g, '/') + '"';

function log(msg) {
  process.stdout.write(msg + '\n');
}

function copyFile(from, to) {
  if (dryRun) return log('  would copy  ' + to);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  log('  copied      ' + to);
}

function readSettings() {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    // Overwriting a settings.json we failed to parse would destroy every other
    // setting in it, so stop instead.
    throw new Error('Could not parse ' + settingsPath + ' — fix or move it, then re-run. (' + e.message + ')');
  }
}

function writeSettings(settings, what) {
  if (dryRun) return log('  would write ' + settingsPath);
  if (fs.existsSync(settingsPath)) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backup = settingsPath + '.bak-' + stamp;
    fs.copyFileSync(settingsPath, backup);
    log('  backed up   ' + backup);
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  log('  ' + (what || 'updated     settings.json'));
}

// Matched on the script filename rather than the whole command string so a
// re-run after a path change still recognises its own previous entry instead of
// adding a second one that fires alongside the first.
function isOurs(entry) {
  return JSON.stringify(entry).includes('one-sentence.js');
}

function doInstall() {
  log('Installing one-sentence into ' + claudeDir);
  copyFile(path.join(repoRoot, 'skills', 'one-sentence', 'SKILL.md'), path.join(skillDest, 'SKILL.md'));
  copyFile(path.join(repoRoot, 'hooks', 'one-sentence.js'), hookDest);
  copyFile(path.join(repoRoot, 'commands', '1s.md'), commandDest);

  const settings = readSettings();
  const hooks = settings.hooks || (settings.hooks = {});
  const ups = hooks.UserPromptSubmit || (hooks.UserPromptSubmit = []);
  const existing = ups.findIndex(isOurs);
  const entry = {
    hooks: [{
      type: 'command',
      command: hookCommand,
      // Generous because Windows process startup with antivirus in the path is
      // an order of magnitude slower than the ~50ms of real work here.
      timeout: 15,
      statusMessage: 'one-sentence check...',
    }],
  };

  if (existing === -1) ups.push(entry);
  else ups[existing] = entry;
  writeSettings(settings, 'registered  UserPromptSubmit hook in settings.json');

  log('');
  log('Done. Restart Claude Code — hooks are read at startup, so the hook will');
  log('not fire in a session that was already open. Then type /one-sentence.');
}

function doUninstall() {
  log('Removing one-sentence hook from ' + claudeDir);
  const settings = readSettings();
  const ups = (settings.hooks && settings.hooks.UserPromptSubmit) || [];
  const kept = ups.filter((e) => !isOurs(e));
  if (kept.length === ups.length) {
    log('  no hook registration found');
  } else {
    settings.hooks.UserPromptSubmit = kept;
    if (kept.length === 0) delete settings.hooks.UserPromptSubmit;
    writeSettings(settings, 'unregistered UserPromptSubmit hook in settings.json');
  }
  for (const target of [hookDest, commandDest]) {
    if (!fs.existsSync(target)) continue;
    if (dryRun) log('  would delete ' + target);
    else { fs.unlinkSync(target); log('  deleted     ' + target); }
  }
  // The skill folder is left in place deliberately: removing the enforcement
  // is a much smaller decision than deleting a skill the user may have edited.
  log('');
  log('Skill folder left at ' + skillDest + ' — delete it by hand if you want it gone.');
}

try {
  if (dryRun) log('(dry run — nothing will be written)\n');
  if (uninstall) doUninstall();
  else doInstall();
} catch (e) {
  process.stderr.write('install failed: ' + e.message + '\n');
  process.exit(1);
}
