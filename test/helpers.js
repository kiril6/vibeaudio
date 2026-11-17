/** Shared setup and helpers for the cases in test/cases/. Generated once, then edited by hand. */
const TEST_DIR = __dirname;
const { assert, os, REAL_CACHE_ROOT } = require("./setup");
const { noteToFreq, createWavBuffer } = require("../src/synth/generator");
const { generateLofiLoop } = require("../src/synth/lofi");
const { generateSynthwaveLoop } = require("../src/synth/synthwave");
const { generateChiptuneLoop } = require("../src/synth/chiptune");
const { generateElectronicLoop } = require("../src/synth/electronic");
const { generateZenLoop } = require("../src/synth/zen");
const { generateJazzLoop } = require("../src/synth/jazz");
const { generateChime } = require("../src/synth/chime");
const { parseArgs, windowsCommandNeedsShell } = require("../src/cli");

// A hung child must fail the suite by name, quickly. spawnSync waits forever by
// default, and a macOS/Node 18 CI job did exactly that three times, in three
// different tests, leaving only "the operation was canceled" after 15 minutes.
// Wrapped after src/ has loaded, so it only reaches the suite's own spawns and
// does not change what the code under test does. A call that sets its own
// timeout keeps it, and its caller decides what a timeout means.
{
  const cp = require("child_process");
  const realSpawnSync = cp.spawnSync;
  cp.spawnSync = (cmd, args, opts) => {
    const hasArgs = Array.isArray(args);
    const options = (hasArgs ? opts : args) || {};
    if (options.timeout) return realSpawnSync(cmd, ...(hasArgs ? [args] : []), options);
    const r = realSpawnSync(cmd, ...(hasArgs ? [args] : []), { ...options, timeout: 120000, killSignal: "SIGKILL" });
    if (r.error && r.error.code === "ETIMEDOUT") {
      throw new Error(`spawnSync hung for 120s and was killed: ${cmd} ${(hasArgs ? args : []).join(" ").slice(0, 200)}`);
    }
    return r;
  };
}

// The suite fakes `afplay` on PATH to see what plays; on macOS the real player
// is the AVAudioPlayer helper, which would walk straight past the fake. Test
// [59] is the one that exercises the helper itself.
process.env.VIBE_NO_FADE = "1";
process.env.VIBE_NO_STREAM = "1"; // Linux: the fake backends take a file, not a pipe (#16).

function sandboxPathWith(names) {
  const fs = require("fs");
  const path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-bin-"));
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  fs.writeFileSync(
    path.join(dir, "which"),
    `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`,
    { mode: 0o755 }
  );
  return dir;
}
const { TerminalHud } = require("../src/hud");
const tieredGenerators = {
  lofi: generateLofiLoop,
  synthwave: generateSynthwaveLoop,
  "8bit": generateChiptuneLoop,
  electronic: generateElectronicLoop,
  jazz: generateJazzLoop,
  zen: generateZenLoop
};
const { resolveGenre, isKnownGenre, AVAILABLE_GENRES, CACHE_DIR } = require("../src/player");
const fs = require("fs");
const path = require("path");
const { installHooks, uninstallHooks } = require("../src/hooks");
const { toolTier, installHooks: installHooksFn } = require("../src/hooks");
const { spawn } = require("child_process");
const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
const measure = (buf) => {
    let peak = 0;
    let sum = 0;
    let n = 0;
    for (let o = 44; o + 1 < buf.length; o += 2) {
      const v = buf.readInt16LE(o) / 32768;
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
      n++;
    }
    return { peak, rms: Math.sqrt(sum / n) };
  };
/**
 * Hook targets with no launcher entry, and why. A target here is one you
 * cannot start from a menu, not one nobody got round to adding - test [38]
 * exists so that distinction has to be made on purpose. Empty is the healthy
 * state: every agent VibeAudio can hook, it can also launch.
 */
const UNLAUNCHABLE_TARGETS = [];
module.exports = { UNLAUNCHABLE_TARGETS, noteToFreq, createWavBuffer, generateLofiLoop, generateSynthwaveLoop, generateChiptuneLoop, generateElectronicLoop, generateZenLoop, generateJazzLoop, generateChime, parseArgs, windowsCommandNeedsShell, assert, os, REAL_CACHE_ROOT, TEST_DIR, sandboxPathWith, TerminalHud, tieredGenerators, resolveGenre, isKnownGenre, AVAILABLE_GENRES, CACHE_DIR, fs, path, installHooks, uninstallHooks, toolTier, installHooksFn, spawn, CLI, measure };
