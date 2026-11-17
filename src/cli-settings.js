/** Saving settings (--genre, --volume, --here ...) and inheriting what old hook installs pinned. */

const chimefile = require("./chimefile");
const { isKnownGenre, normalizeVolume, saveConfig, saveProjectConfig } = require("./player");
const { readVibeHooks } = require("./cli-status");



/**
 * `vibe --genre jazz` with no command after it. That used to open the launcher
 * menu, which then asked for a genre and used its own answer - the most
 * natural way to phrase the request did something else entirely, and the
 * README had to warn about it. It saves the default instead.
 */
function saveDefaults(typed, hereOnly = false, live = null) {
  const patch = {};
  if (typed.genre !== undefined) patch.genre = typed.genre;
  if (typed.volume !== undefined) patch.volume = Math.round(typed.volume * 100);
  if (typed.chimeVolume !== undefined) patch.chimeVolume = Math.round(typed.chimeVolume * 100);
  if (typed.grace !== undefined) patch.grace = typed.grace;
  if (typed.music !== undefined) patch.music = typed.music;

  const { CONFIG_FILE, loadConfig: load, projectSettings: projectOf } = require("./player");
  if (typed.chimes) {
    // A file that would not play is refused now, not discovered when the chime is missing.
    for (const [kind, value] of Object.entries(typed.chimes)) {
      const problem = value && chimefile.readChimeWav(chimefile.expandChimePath(value)).error;
      if (problem) {
        console.error(`\x1b[31m[vibeaudio] ${kind} chime: ${problem} - nothing saved.\x1b[0m`);
        process.exit(1);
      }
    }
    // The map is saved whole under one key, so merge into what this scope already has.
    const current = (hereOnly ? projectOf(load()) : load()).chimes;
    const chimes = { ...(current && typeof current === "object" ? current : {}), ...typed.chimes };
    for (const kind of Object.keys(chimes)) if (chimes[kind] === null) delete chimes[kind];
    patch.chimes = Object.keys(chimes).length ? chimes : null;
  }
  if (hereOnly) saveProjectConfig(patch);
  else saveConfig(patch);

  const label = {
    genre: (v) => `genre ${v}`,
    volume: (v) => `volume ${v}%`,
    chimeVolume: (v) => `chime volume ${v}%`,
    grace: (v) => `grace ${v}ms`,
    music: (v) => `music ${v ? "on" : "off"}`,
    chimes: () => Object.entries(typed.chimes).map(([k, v]) => `${k} chime ${v || "default"}`).join(", ")
  };
  const changed = Object.keys(patch).map((k) => label[k](patch[k])).join(", ");
  const where = hereOnly ? ` for ${process.cwd()}` : "";
  console.log(`\x1b[32m✔ Saved: ${changed}${where}\x1b[0m \x1b[90m(${CONFIG_FILE})\x1b[0m`);
  console.log(`  Applies to the wrapper, your agent hooks and MCP — on the next prompt.`);
  if (hereOnly) console.log(`  \x1b[90mThis directory and everything under it. Drop --here to change the default everywhere.\x1b[0m`);

  // Music already in the air is the one thing this does not reach, and
  // silence about it reads as the setting having done nothing at all.
  const hooks = require("./hooks");
  const playing = hooks.daemonPlaying();
  // A project's own settings do not say what the music in the air should be, so --here leaves it be.
  const retuned = live && !hereOnly && (patch.genre !== undefined || patch.music !== undefined)
    && hooks.applyLiveMusic(live.genre, live.volume, { music: live.music, follow: live.follow });
  if (retuned) {
    console.log(`  \x1b[90mThe music playing now changed with it.\x1b[0m`);
  } else if (playing && patch.genre && playing.genre && playing.genre !== patch.genre) {
    console.log(`  \x1b[90m${playing.genre} is still playing — vibe --stop cuts it short.\x1b[0m`);
  }
  if (!retuned && playing && patch.music === false) {
    console.log(`  \x1b[90m${playing.genre || "The music"} is still playing — vibe --stop cuts it short.\x1b[0m`);
  }
  if (patch.music === false) {
    console.log(`  \x1b[90mSignals only: chimes, banners, --events and --report work as before.\x1b[0m`);
  }
  if (playing && playing.follows && patch.volume !== undefined) {
    console.log(`  \x1b[90mThe music playing now follows the new volume within a second.\x1b[0m`);
  }

  // An install from before the settings moved out of the hook command line
  // still carries its own genre, and a flag beats this file. Saying nothing
  // would leave the user with a saved default that audibly does nothing.
  const pinned = pinnedHookSettings();
  if (pinned.length) {
    console.log(
      `\n\x1b[33m  ${pinned.join(", ")}: hooks installed by an older version pin their own settings.\x1b[0m\n` +
      `  Run \x1b[1mvibe --install-hooks\x1b[0m once to have them follow this file instead.`
    );
  }
  if (typed.genre !== undefined) console.log(`\n  Audition it: vibe --preview ${typed.genre}`);
  console.log();
}

/**
 * Hook targets whose installed entries still carry a baked --genre/--volume.
 */
/**
 * What an install from before the config file pinned, for the first of `ids`
 * that pinned anything.
 *
 * A reinstall is how a user moves off that older scheme, and it must not be
 * the moment their music changes: the settings frozen into those entries are
 * the ones they have actually been listening to, and the config file may hold
 * nothing but an untouched default. Adopted only for what the user did not
 * type on this command line - naming a genre still means that genre.
 */
function pinnedSettingsFor(ids) {
  const hooks = require("./hooks");
  const genres = new Set();
  const volumes = new Set();

  for (const id of ids) {
    const t = hooks.TARGETS[id];
    if (!t) continue;
    for (const { command } of readVibeHooks(t.file(), t)) {
      const genre = /--genre (\S+)/.exec(command);
      const volume = /--volume (\d+)/.exec(command);
      if (genre && isKnownGenre(genre[1])) genres.add(genre[1]);
      if (volume) volumes.add(normalizeVolume(volume[1], null));
    }
  }

  // Only when they agree. The saved config is one value for the machine, so
  // two agents pinned to different genres have no single answer to inherit -
  // and taking whichever was found first would let an untouched install for
  // some other tool silently overwrite the genre the user actually chose.
  return {
    genre: genres.size === 1 ? [...genres][0] : null,
    volume: volumes.size === 1 ? [...volumes][0] : null
  };
}

function pinnedHookSettings() {
  const hooks = require("./hooks");
  const names = [];
  for (const id of Object.keys(hooks.TARGETS)) {
    const t = hooks.TARGETS[id];
    if (readVibeHooks(t.file(), t).some(({ command }) => /--genre |--volume /.test(command))) {
      names.push(t.name);
    }
  }
  return names;
}


module.exports = { saveDefaults, pinnedSettingsFor, pinnedHookSettings };
