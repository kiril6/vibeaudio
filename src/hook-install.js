/** Installing and removing hooks, plugin files, /vibe commands and agent skills. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { CLI_ENTRY } = require("./hook-core");
const { claudeConfigDir, codexHome, geminiDir, qwenHome, TARGETS, target } = require("./hook-targets");

/**
 * The hook command is a string the agent hands to a shell, so every path in it
 * has to survive that shell. Double quotes do not: `$` and a backtick expand
 * inside them and a `"` ends the quote outright, so installing from a path
 * like /tmp/dollar$dir wrote a command the shell quietly rewrote into a
 * different one - and the install reported success. A hook that fails on every
 * prompt while claiming to be installed is the exact failure
 * ephemeralInstallReason() exists to prevent.
 *
 * POSIX gets single quotes, which expand nothing, plus the one escape a single
 * quote itself needs. Windows keeps double quotes: cmd expands neither `$` nor
 * a backtick, and `"` is not legal in a Windows path to begin with.
 */
function shellQuote(value) {
  if (process.platform === "win32") return `"${value}"`;
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * Genre and volume are deliberately NOT written into the command line.
 *
 * They used to be, and that is what made "change the genre" mean "re-run the
 * installer": a value frozen into seven hook entries at install time, which no
 * later `vibe --genre jazz` and no exported variable could reach. Each hook
 * fires as a fresh process and parses its own arguments, so leaving them out
 * means it reads the saved config (see loadConfig() in player.js) on every
 * prompt - and a genre change lands on the next one, with nothing reinstalled.
 *
 * `--reactive` stays, because it is not a setting the hook reads: it decides
 * which hooks exist at all, and the PreToolUse entry is written or removed to
 * match. A daemon respawned by a resume has to know it too.
 */
function hookCommand(flag, genre, volume, reactive = false) {
  const base = `${shellQuote(process.execPath)} ${shellQuote(CLI_ENTRY)} ${flag}`;
  if (!reactive) return base;
  return flag === "--hook-start" || flag === "--hook-resume" ? `${base} --reactive` : base;
}

const VIBE_HOOK_FLAG = /--hook-(start|stop|tool|wait|resume|end)\b/;

function isVibeHook(entry, id = "claude") {
  return target(id)
    .commands(entry)
    .some((c) => typeof c === "string" && VIBE_HOOK_FLAG.test(c));
}

function setHook(hooks, event, command, id) {
  // Replacing our own entries keeps repeat installs idempotent and leaves
  // every other tool's hooks untouched. Appending rather than prepending also
  // keeps the existing entries at their original index, which is what Codex
  // keys its per-hook trust records by.
  const kept = (hooks[event] || []).filter((entry) => !isVibeHook(entry, id));
  kept.push(target(id).entry(command, event));
  hooks[event] = kept;
}

/**
 * The object holding a target's events inside its config file: `hooks` for
 * every agent but Antigravity, whose file is a map of named hooks and keeps
 * ours under a name of their own (`hooksKey`).
 */
function hooksKey(t) {
  return (t && t.hooksKey) || "hooks";
}

function hooksOf(settings, t) {
  return settings ? settings[hooksKey(t)] : undefined;
}

/** [event, entries] for every event in a hooks object, skipping settings keys. */
function hookEntries(hooks, t) {
  const configKeys = (t && t.configKeys) || [];
  return Object.entries(hooks || {}).filter(([key]) => !configKeys.includes(key));
}

function readVibeEntryCount(file, id) {
  try {
    const { settings } = loadSettings(file, target(id));
    return hookEntries(hooksOf(settings, target(id)), target(id)).reduce(
      (n, [, entries]) => n + entries.filter((e) => isVibeHook(e, id)).length,
      0
    );
  } catch (e) {
    return 0; // Unreadable: the delete below still cleans it up.
  }
}

/** True when --install-hooks has already written our entries for Claude Code. */
function userHooksInstalled(file = null, id = "claude") {
  return readVibeEntryCount(file || TARGETS[id].file(), id) > 0;
}

function loadSettings(file, t = null) {
  if (!fs.existsSync(file)) return { settings: t ? t.seed() : {}, raw: null };
  const raw = fs.readFileSync(file, "utf8");

  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}) — refusing to overwrite it.`);
  }

  // Valid JSON in the wrong shape used to reach the callers and fail there as
  // "entries.filter is not a function", which tells the user nothing about
  // their own file. Checked here because install, uninstall and the entry
  // count all come through this function.
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`${file} does not contain a JSON object — refusing to overwrite it.`);
  }
  const key = hooksKey(t);
  if (settings[key] !== undefined) {
    if (settings[key] === null || typeof settings[key] !== "object" || Array.isArray(settings[key])) {
      throw new Error(`${file} has a "${key}" key that is not an object — refusing to overwrite it.`);
    }
    for (const [event, entries] of hookEntries(settings[key], t)) {
      if (!Array.isArray(entries)) {
        throw new Error(
          `${file} has ${key}.${event} as ${Array.isArray(entries) ? "an array" : typeof entries}, ` +
          `not an array of entries — refusing to overwrite it.`
        );
      }
    }
  }

  return { settings, raw };
}

/**
 * Hooks record an absolute path to this CLI, so installing from a throwaway
 * `npx` checkout writes a path npm will eventually evict — leaving every
 * prompt firing a hook that silently fails. Refuse rather than plant that.
 */
function ephemeralInstallReason(entry = CLI_ENTRY) {
  const dir = entry.split(path.sep);
  if (dir.includes("_npx")) return "npx";
  if (dir.includes(".npm-cache") || dir.includes("_cacache")) return "npm cache";
  return null;
}

/**
 * `dryRun` computes the result without touching the disk - no directory, no
 * backup, no write - and returns it with the file's current contents, so the
 * caller can show exactly what would change in a file that belongs to the user.
 */
function installHooks(genre = "lofi", volume = 0.4, file = null, { reactive = false, id = "claude", dryRun = false } = {}) {
  const t = target(id);
  file = file || t.file();
  const ephemeral = ephemeralInstallReason();
  if (ephemeral) {
    throw new Error(
      `refusing to install hooks from a temporary ${ephemeral} checkout — the path ` +
      `(${CLI_ENTRY}) is deleted when the cache is cleared, which would leave Claude Code ` +
      `running a broken hook on every prompt.\n\n` +
      `Install it for real first, then re-run:\n\n` +
      `  npm i -g github:kiril6/vibeaudio\n  vibe --install-hooks\n`
    );
  }

  const { settings, raw } = loadSettings(file, t);
  if (!dryRun) fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  // Only worth backing up a file that holds someone else's config. A dedicated
  // target's file is ours alone, so a backup of it would just be a copy of our
  // own last install, left behind after the uninstall deletes the original.
  //
  // Written once and never overwritten: the second --install-hooks reads a
  // file that already contains our entries, so re-backing up would replace the
  // user's actual pre-VibeAudio config with a copy of our own last install -
  // while uninstall goes on calling it "your pre-VibeAudio config backup".
  // The first one is the only one that is true.
  if (raw !== null && !t.dedicated) {
    const backupFile = `${file}.vibeaudio.bak`;
    if (!fs.existsSync(backupFile)) {
      if (!dryRun) fs.writeFileSync(backupFile, raw);
      backup = backupFile;
    }
  }

  const ev = t.events;
  // Reactive needs a pre-tool event we can listen on without deciding for the
  // agent; where there is none (Antigravity) it is off, not carried as a flag
  // that does nothing and that --status would then report.
  reactive = reactive && Boolean(ev.tool);
  const key = hooksKey(t);
  settings[key] = settings[key] || {};
  const hooks = settings[key];
  setHook(hooks, ev.start, hookCommand("--hook-start", genre, volume, reactive), id);
  setHook(hooks, ev.stop, hookCommand("--hook-stop", genre, volume), id);

  // Only reactive mode needs per-tool-call signalling.
  if (reactive) {
    setHook(hooks, ev.tool, hookCommand("--hook-tool", genre, volume), id);
  } else if (ev.tool && hooks[ev.tool]) {
    const kept = hooks[ev.tool].filter((entry) => !isVibeHook(entry, id));
    if (kept.length) hooks[ev.tool] = kept;
    else delete hooks[ev.tool];
  }

  for (const event of ev.wait || []) {
    setHook(hooks, event, hookCommand("--hook-wait", genre, volume), id);
  }
  // The agent awaits a resume before the next tool's permission check, so a
  // resume can never land after the next wait.
  // ponytail: one ~40ms node start per tool call; a shell-side existence
  // check on the waiting file would skip it if that ever shows.
  for (const event of ev.resume || []) {
    setHook(hooks, event, hookCommand("--hook-resume", genre, volume, reactive), id);
  }
  if (ev.failure) setHook(hooks, ev.failure, hookCommand("--hook-stop", genre, volume), id);
  if (ev.end) setHook(hooks, ev.end, hookCommand("--hook-end", genre, volume), id);
  // An interrupt ends the turn the same silent way a closed session does.
  if (ev.interrupt) setHook(hooks, ev.interrupt, hookCommand("--hook-end", genre, volume), id);

  const after = `${JSON.stringify(settings, null, 2)}\n`;
  if (!dryRun) fs.writeFileSync(file, after);
  return { file, backup, reactive, id, name: t.name, note: t.note || null, events: ev, before: raw, after, dryRun };
}

/**
 * `/vibe` inside Claude Code: a command file, not a hook - it asks the model to
 * run the CLI, so mute, stop and genre changes need no second terminal. The
 * marker is how install and uninstall tell our file from a user's own vibe.md,
 * which neither may overwrite or delete.
 */
const SLASH_MARK = "<!-- vibeaudio:slash-command -->";

function slashCommandFile() {
  return path.join(claudeConfigDir(), "commands", "vibe.md");
}

// The optional in-app mod (mods/vibe). Claude Code records installed plugins by name in this file.
function modInstalled(file = path.join(claudeConfigDir(), "plugins", "installed_plugins.json")) {
  try { return fs.readFileSync(file, "utf8").includes("vibeaudio-mod"); } catch { return false; }
}

const CONTROL_DESCRIPTION = "Control VibeAudio - status, mute, unmute, stop, or change genre or volume";

function slashCommandText() {
  return `---
description: ${CONTROL_DESCRIPTION}
argument-hint: "[status | mute [minutes] | unmute | stop | genre <name> | volume <5-100> | music on|off | notify on|off | speak off|auto|always | calls on|off]"
---
${SLASH_MARK}
Control VibeAudio, the focus music that plays while you work, for the user.
Arguments: \`$ARGUMENTS\`

Run the one matching command with the Bash tool, then report the result in a
single short sentence. Do nothing else.

${controlCommands()}`;
}

/**
 * The same commands as /vibe, as a user skill for the agents whose in-session
 * commands are skills. Neither substitutes `$ARGUMENTS` (Codex injects
 * SKILL.md verbatim; Antigravity expands it as a slash command), so the body
 * names where the arguments are instead. What keeps the model from muting on
 * its own is each agent's own switch: `allow_implicit_invocation: false` in
 * Codex's agents/openai.yaml, `disable-model-invocation` in Antigravity's
 * front matter.
 *
 * `$vibe` in Codex (#27), next to its hooks.json; `/vibe` in Antigravity
 * (#28), in its global customization root `~/.gemini/config/skills`.
 */
const SKILL_MARK = "<!-- vibeaudio:skill -->";
const CODEX_SKILL_POLICY = "policy:\n  allow_implicit_invocation: false\n";

// Gemini CLI and Qwen Code (#28) take a TOML command, not a skill folder. They
// substitute `{{args}}` themselves, so the body can name the arguments exactly.
const TOML_MARK = "# vibeaudio:skill";

function tomlCommandText() {
  const body = `Control VibeAudio, the focus music that plays while you work, for the user.
Arguments: {{args}}

Run the one matching command in the shell, then report the result in a
single short sentence. Do nothing else.

${controlCommands()}`;
  const escaped = body.replace(/\\/g, "\\\\").replace(/"""/g, '""\\"');
  return `${TOML_MARK}\ndescription = ${JSON.stringify(CONTROL_DESCRIPTION)}\nprompt = """\n${escaped}"""\n`;
}

const AGENT_SKILLS = {
  codex: {
    name: "$vibe",
    dir: () => path.join(codexHome(), "skills", "vibe"),
    file: "SKILL.md",
    mark: SKILL_MARK,
    frontMatter: "",
    extra: { [path.join("agents", "openai.yaml")]: CODEX_SKILL_POLICY },
  },
  antigravity: {
    name: "/vibe",
    dir: () => path.join(os.homedir(), ".gemini", "config", "skills", "vibe"),
    file: "SKILL.md",
    mark: SKILL_MARK,
    frontMatter: "disable-model-invocation: true\n",
    extra: {},
  },
  gemini: {
    name: "/vibe",
    dir: () => path.join(geminiDir(), "commands"),
    file: "vibe.toml",
    mark: TOML_MARK,
    text: tomlCommandText,
    extra: {},
  },
  qwen: {
    name: "/vibe",
    dir: () => path.join(qwenHome(), "commands"),
    file: "vibe.toml",
    mark: TOML_MARK,
    text: tomlCommandText,
    extra: {},
  },
};

function agentSkillText(id) {
  const s = AGENT_SKILLS[id];
  if (s.text) return s.text();
  return `---
name: vibe
description: ${CONTROL_DESCRIPTION}
${s.frontMatter}---
${SKILL_MARK}
Control VibeAudio, the focus music that plays while you work, for the user.
The arguments are the words after \`${s.name}\` in the user's message.

Run the one matching command in the shell, then report the result in a
single short sentence. Do nothing else.

${controlCommands()}`;
}

// A SKILL.md without our mark is the user's own and is neither replaced nor removed.
function ourSkill(file, mark) {
  return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(mark);
}

function installAgentSkill(id, { dir = AGENT_SKILLS[id].dir(), dryRun = false } = {}) {
  const file = path.join(dir, AGENT_SKILLS[id].file);
  if (fs.existsSync(file) && !ourSkill(file, AGENT_SKILLS[id].mark)) {
    return { file, installed: false, reason: "a vibe skill that is not ours is already there" };
  }
  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, agentSkillText(id));
    for (const [rel, text] of Object.entries(AGENT_SKILLS[id].extra)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
  }
  return { file, installed: true };
}

// Removes our files, then the folders only if nothing else was put in them.
function uninstallAgentSkill(id, { dir = AGENT_SKILLS[id].dir() } = {}) {
  const file = path.join(dir, AGENT_SKILLS[id].file);
  if (!ourSkill(file, AGENT_SKILLS[id].mark)) return false;
  fs.rmSync(file, { force: true });
  const dirs = new Set();
  for (const [rel, text] of Object.entries(AGENT_SKILLS[id].extra)) {
    const f = path.join(dir, rel);
    try { if (fs.readFileSync(f, "utf8") === text) fs.rmSync(f); } catch {}
    dirs.add(path.dirname(f));
  }
  for (const d of [...dirs, dir]) {
    try { fs.rmdirSync(d); } catch {}
  }
  return true;
}

function controlCommands() {
  const cli = `${shellQuote(process.execPath)} ${shellQuote(CLI_ENTRY)}`;
  return `- no arguments, or \`status\`: \`${cli} --status\`
- \`mute\` or \`mute <minutes>\`: \`${cli} --mute <minutes>\`
- \`unmute\`: \`${cli} --unmute\`
- \`stop\`: \`${cli} --stop\`
- \`genre <name>\`: \`${cli} --genre <name>\`
- \`volume <5-100>\`: \`${cli} --volume <n>\`
- \`music on|off\`: \`${cli} --music <on|off>\` (off keeps the chimes)
- \`notify on|off\`: \`${cli} --notify\` or \`${cli} --no-notify\`
- \`speak off|auto|always\`: \`${cli} --no-speak\`, \`${cli} --speak\` or \`${cli} --speak-always\`
- \`calls on|off\`: \`${cli} --mute-on-calls\` or \`${cli} --no-mute-on-calls\`
  These save the user's default and reach the hooks on the next prompt - there
  is nothing to reinstall, so do not run --install-hooks for these.
  Genres: lofi, synthwave, 8bit, electronic, jazz, zen, piano, drone, rain, ocean, fireplace, wind, stream, house, dubtechno, shoegaze, gamelan, musicbox, rainpiano, random.

For anything else, show the user the list above instead of running a command.
`;
}

function installSlashCommand({ file = slashCommandFile(), dryRun = false } = {}) {
  if (fs.existsSync(file) && !fs.readFileSync(file, "utf8").includes(SLASH_MARK)) {
    return { file, installed: false, reason: "a vibe.md that is not ours is already there" };
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, slashCommandText());
  }
  return { file, installed: true };
}

function uninstallSlashCommand({ file = slashCommandFile() } = {}) {
  if (!fs.existsSync(file) || !fs.readFileSync(file, "utf8").includes(SLASH_MARK)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

function uninstallHooks(file = null, { id = "claude" } = {}) {
  const t = target(id);
  file = file || t.file();
  if (!fs.existsSync(file)) return { file, removed: 0, id };

  // Our own file has nothing of the user's in it, so removing our entries
  // would just leave an empty husk in a directory the tool scans.
  if (t.dedicated) {
    const removed = readVibeEntryCount(file, id);
    fs.rmSync(file, { force: true });
    return { file, removed, id };
  }

  const { settings } = loadSettings(file, t);
  const key = hooksKey(t);
  const hooks = settings[key];
  if (!hooks) return { file, removed: 0, id };

  let removed = 0;
  for (const [event, entries] of hookEntries(hooks, t)) {
    const kept = entries.filter((entry) => !isVibeHook(entry, id));
    removed += entries.length - kept.length;

    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }

  if (Object.keys(hooks).length === 0) delete settings[key];
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { file, removed, id };
}


module.exports = { shellQuote, hookCommand, VIBE_HOOK_FLAG, isVibeHook, setHook, hooksKey, hooksOf, hookEntries, readVibeEntryCount, userHooksInstalled, loadSettings, ephemeralInstallReason, installHooks, SLASH_MARK, slashCommandFile, modInstalled, CONTROL_DESCRIPTION, slashCommandText, SKILL_MARK, CODEX_SKILL_POLICY, TOML_MARK, tomlCommandText, AGENT_SKILLS, agentSkillText, ourSkill, installAgentSkill, uninstallAgentSkill, controlCommands, installSlashCommand, uninstallSlashCommand, uninstallHooks };
