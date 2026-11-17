/** --install-hooks / --uninstall-hooks: target resolution, dry-run plan, reports. */

const fs = require("fs");
const { loadConfig, saveConfig } = require("./player");
const { pinnedSettingsFor } = require("./cli-settings");

/**
 * Which agents to wire up. Auto-detection is the default because the honest
 * answer to "which of these do I have" lives on the user's disk, not in a
 * flag they have to know to pass; --tools is the override.
 */
function resolveTargets(explicit) {
  const hooks = require("./hooks");
  const known = Object.keys(hooks.TARGETS);

  // Absent is null; anything else was typed, empty string included. Testing
  // truthiness instead let `--tools ""` fall through to auto-detection and
  // install for every agent on the machine - the opposite of naming one.
  if (explicit !== null && explicit !== undefined) {
    const ids = explicit.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    // `--tools ""` or `--tools ,` names nothing, and silently installing
    // everywhere - or reporting success over an empty loop - is worse than
    // saying so.
    if (!ids.length) throw new Error(`--tools named no agent — expected one of: ${known.join(", ")}`);
    const bad = ids.filter((id) => !known.includes(id));
    if (bad.length) throw new Error(`unknown --tools value '${bad.join(", ")}' — expected: ${known.join(", ")}`);
    return ids;
  }

  const found = hooks.detectTargets();
  if (!found.length) {
    throw new Error(
      `no agent with a hook system found on this machine (looked for ${known.join(", ")}).\n` +
      `  Wrap the command instead: vibe <your-command>`
    );
  }
  return found;
}

/**
 * The one install path. Both --install-hooks and the menu's hooks branch call
 * this, so the two entry points can't drift in what they write or report.
 */
function installHookTargets(ids, genre, volume, reactive, dryRun = false, typed = {}) {
  const hooks = require("./hooks");

  // Migrating off a pinned install must not change what is playing: those
  // entries carry the settings the user has actually been hearing, while the
  // config file may not exist yet - so an untyped reinstall inherits from the
  // entries it is about to replace.
  //
  // A pin fills a gap and never overrides. Once a setting is saved, somebody
  // chose it, and a legacy pin left in some other agent's config is the older
  // fact of the two - without this, installing for every detected agent lets
  // four untouched installs outvote the genre the user picked a minute ago.
  const saved = loadConfig();
  const inherited = [];
  const gap = (key) => typed[key] === undefined && saved[key] === undefined;

  if (gap("genre") || gap("volume")) {
    const pinned = pinnedSettingsFor(ids);
    if (gap("genre") && pinned.genre && pinned.genre !== genre) {
      genre = pinned.genre;
      inherited.push(`genre ${genre}`);
    }
    if (gap("volume") && pinned.volume !== null && pinned.volume !== volume) {
      volume = pinned.volume;
      inherited.push(`volume ${Math.round(volume * 100)}%`);
    }
  }

  if (dryRun) console.log(`\x1b[1mDry run\x1b[0m — nothing below is written.\n`);
  if (inherited.length) {
    console.log(`\x1b[90mKeeping your current ${inherited.join(" and ")} — pass --genre/--volume to change it.\x1b[0m`);
  }

  // The hook entries no longer carry the genre and volume, so this is where
  // they live. Saved here rather than inside installHooks(), which stays a
  // pure config edit that tests can point at a throwaway file - the same
  // reason the slash command and stopDaemon() are driven from this layer.
  if (!dryRun) saveConfig({ genre, volume: Math.round(volume * 100) });

  for (const id of ids) {
    const result = hooks.installHooks(genre, volume, null, { reactive, id, dryRun });
    const { file, backup, name, note, events } = result;

    if (dryRun) {
      printHookPlan(result, hooks.TARGETS[id]);
    } else {
      console.log(`\x1b[32m✔ ${name} hooks installed in ${file}\x1b[0m`);
      if (backup) console.log(`  Previous config backed up to ${backup}`);
    }
    console.log(`  ${events.start.padEnd(19)}→ music starts (${genre} @ ${Math.round(volume * 100)}%)`);
    console.log(`  ${events.stop.padEnd(19)}→ music stops + success chime`);
    if (result.reactive) { // off for a target with no pre-tool event
      console.log(`  ${events.tool.padEnd(19)}→ intensity follows the tool in use (reactive mode)`);
    }
    if (events.wait) console.log(`  ${events.wait[0].padEnd(19)}→ music pauses + "your turn" chime`);
    if (events.resume) console.log(`  ${events.resume[0].padEnd(19)}→ music resumes once you've answered`);
    if (events.failure) console.log(`  ${events.failure.padEnd(19)}→ music stops + failure chime (API error)`);
    if (events.end) console.log(`  ${events.end.padEnd(19)}→ music stops if that session started it`);
    if (events.interrupt) console.log(`  ${events.interrupt.padEnd(19)}→ music stops silently when you interrupt`);

    if (id === "claude") {
      const slash = hooks.installSlashCommand({ dryRun });
      if (!slash.installed) console.log(`  \x1b[33m/vibe not installed: ${slash.reason} (${slash.file})\x1b[0m`);
      else console.log(`  ${"/vibe".padEnd(19)}→ ${dryRun ? "would write" : "control the music from inside Claude Code"} (${slash.file})`);
      if (!dryRun && !hooks.modInstalled()) console.log(`  \x1b[2mOptional: /plugin marketplace add kiril6/vibeaudio, then /plugin install vibeaudio-mod@vibeaudio - instant /vibeaudio controls, a pane and a band above the prompt.\x1b[0m`);
    }
    if (hooks.AGENT_SKILLS[id]) {
      const skillName = hooks.AGENT_SKILLS[id].name;
      const skill = hooks.installAgentSkill(id, { dryRun });
      if (!skill.installed) console.log(`  \x1b[33m${skillName} not installed: ${skill.reason} (${skill.file})\x1b[0m`);
      else console.log(`  ${skillName.padEnd(19)}→ ${dryRun ? "would write" : `control the music from inside ${name}`} (${skill.file})`);
    }
    // Codex will not run a hook it has not been told to trust, so saying
    // "done" without this would be reporting an install that isn't live yet.
    if (note) console.log(`  \x1b[33m${note}\x1b[0m`);
  }

  if (dryRun) {
    console.log(`\n  Run again without --dry-run to apply.\n`);
    return;
  }
  // These re-read their hook file per event rather than caching it at startup,
  // verified for each, so an open session picks this up on its next prompt.
  const live = ids.filter((id) => hooks.TARGETS[id].liveReload !== false).map((id) => hooks.TARGETS[id].name);
  if (live.length) console.log(`  ${live.join(", ")}: takes effect on your next prompt - no restart needed.`);
  console.log(`  \x1b[90mChange the sound any time with: vibe --genre <name> --volume <n> — no reinstall.\x1b[0m`);
  console.log(`  \x1b[90mCheck it with vibe --status · quiet for a call: vibe --mute · everything else: vibe --help\x1b[0m`);
  if (ids.length > 1) {
    console.log(`  \x1b[90mOne player is shared: whichever agent you prompt last owns the music.\x1b[0m`);
  }
  console.log(`  Remove them any time with: vibe --uninstall-hooks\n`);
}

/**
 * What --dry-run shows: for each event, whether our entry would be added,
 * changed, left as it is or removed - read from the file as it is now against
 * the result installHooks computed, so the preview cannot drift from the write.
 */
function printHookPlan({ file, backup, name, before, after, id }, t) {
  const hooks = require("./hooks");
  const ours = (text) => {
    const map = new Map();
    if (!text) return map;
    for (const [event, entries] of hooks.hookEntries(hooks.hooksOf(JSON.parse(text), t), t)) {
      const mine = entries.filter((e) => hooks.isVibeHook(e, id));
      if (mine.length) map.set(event, JSON.stringify(mine));
    }
    return map;
  };
  const was = ours(before);
  const will = ours(after);

  console.log(`\x1b[1m${name}\x1b[0m — would ${before === null ? "create" : "edit"} ${file}`);
  if (backup) console.log(`  would back up the current file to ${backup}`);
  for (const event of new Set([...was.keys(), ...will.keys()])) {
    const mark = !was.has(event) ? "\x1b[32m+ add   \x1b[0m"
      : !will.has(event) ? "\x1b[31m- remove\x1b[0m"
      : was.get(event) === will.get(event) ? "\x1b[90m= same  \x1b[0m" : "\x1b[33m~ change\x1b[0m";
    console.log(`  ${mark} ${event}`);
  }
  if (before !== null) console.log(`  \x1b[90mEverything else in the file stays as it is.\x1b[0m`);
}

/**
 * Sweeps every target, not just the detected ones - a hook left behind in a
 * config file of a tool that has since been removed is exactly the thing an
 * uninstall is supposed to clear.
 */
function uninstallHookTargets() {
  const hooks = require("./hooks");
  let total = 0;

  for (const id of Object.keys(hooks.TARGETS)) {
    const { file, removed } = hooks.uninstallHooks(null, { id });
    total += removed;
    if (removed > 0) {
      console.log(`\x1b[32m✔ Removed ${removed} VibeAudio hook(s) from ${file}\x1b[0m`);
      const backupFile = `${file}.vibeaudio.bak`;
      // The backup is the user's safety net, so point at it rather than
      // deleting it for them - but only when one actually exists.
      if (fs.existsSync(backupFile)) {
        console.log(`  Your pre-VibeAudio config backup is kept at ${backupFile}`);
      }
    }
  }

  if (hooks.uninstallSlashCommand()) console.log(`\x1b[32m✔ Removed the /vibe command from Claude Code\x1b[0m`);
  for (const [id, { name }] of Object.entries(hooks.AGENT_SKILLS)) {
    if (hooks.uninstallAgentSkill(id)) console.log(`\x1b[32m✔ Removed the ${name} skill from ${hooks.TARGETS[id].name}\x1b[0m`);
  }
  if (total === 0) console.log(`\x1b[90mNo VibeAudio hooks were installed.\x1b[0m`);

  // Nothing will ever send a stop event once the hooks are gone, so a daemon
  // left running would play on unsupervised until its 15-minute cap - and
  // `npm rm -g` right after this would take away the only thing that could
  // stop it. Done here rather than in uninstallHooks() so that function stays
  // a pure config edit for tests.
  if (hooks.stopDaemon({ reason: "uninstall" })) console.log(`  Stopped the background player that was still running.`);
}


module.exports = { resolveTargets, installHookTargets, printHookPlan, uninstallHookTargets };
