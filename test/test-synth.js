/**
 * Automated Verification Tests for VibeAudio
 */

const assert = require("assert");
const os = require("os");
const { noteToFreq, createWavBuffer } = require("../src/synth/generator");
const { generateLofiLoop } = require("../src/synth/lofi");
const { generateSynthwaveLoop } = require("../src/synth/synthwave");
const { generateChiptuneLoop } = require("../src/synth/chiptune");
const { generateElectronicLoop } = require("../src/synth/electronic");
const { generateZenLoop } = require("../src/synth/zen");
const { generateJazzLoop } = require("../src/synth/jazz");
const { generateChime } = require("../src/synth/chime");
const { parseArgs } = require("../src/cli");

/**
 * Hook targets with no launcher entry, and why. A target here is one you
 * cannot start from a menu, not one nobody got round to adding - test [38]
 * exists so that distinction has to be made on purpose. Empty is the healthy
 * state: every agent VibeAudio can hook, it can also launch.
 */
const UNLAUNCHABLE_TARGETS = [];

/**
 * A PATH containing only fake tools cannot answer `which`, so isInstalled()
 * fails for every candidate and a test meaning "exactly one tool is
 * discoverable" silently becomes "none are" - which still passes when the
 * expected winner is simply first in the list. Shipping a `which` that only
 * sees this directory makes the sandbox answer honestly.
 */
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

console.log("Running VibeAudio Verification Tests...\n");

// 1. Math and Note frequencies
console.log("1. Testing Note Frequencies...");
assert.strictEqual(Math.round(noteToFreq("A4")), 440, "A4 should be 440 Hz");
assert.strictEqual(Math.round(noteToFreq("C4")), 262, "C4 should be ~262 Hz");
assert.strictEqual(Math.round(noteToFreq("A5")), 880, "A5 should be 880 Hz");
console.log("   ✓ Note frequencies calculate correctly.");

// 2. WAV PCM Encoding
console.log("2. Testing WAV Header Encoding...");
const testBuffer = createWavBuffer({
  left: new Float64Array(100),
  right: new Float64Array(100)
});
assert.strictEqual(testBuffer.toString("ascii", 0, 4), "RIFF", "Header must be RIFF");
assert.strictEqual(testBuffer.toString("ascii", 8, 12), "WAVE", "Header must be WAVE");
assert.strictEqual(testBuffer.readUInt16LE(22), 2, "Stereo channel count must be 2");
assert.strictEqual(testBuffer.readUInt32LE(24), 44100, "Sample rate must be 44100");
assert.strictEqual(testBuffer.readUInt16LE(34), 16, "Bit depth must be 16-bit");
console.log("   ✓ WAV headers generate valid PCM data.");

// 3. Lo-Fi Engine
console.log("3. Testing Lo-Fi Generator...");
const lofiBuf = generateLofiLoop(1.0);
assert.ok(lofiBuf.length > 44, "Lo-Fi buffer must have audio content");
console.log(`   ✓ Lo-Fi engine generated ${lofiBuf.length} bytes.`);

// 4. Synthwave Engine
console.log("4. Testing Synthwave Generator...");
const synthBuf = generateSynthwaveLoop(1.0);
assert.ok(synthBuf.length > 44, "Synthwave buffer must have audio content");
console.log(`   ✓ Synthwave engine generated ${synthBuf.length} bytes.`);

// 5. Chiptune Engine
console.log("5. Testing 8-Bit Chiptune Generator...");
const chipBuf = generateChiptuneLoop(1.0);
assert.ok(chipBuf.length > 44, "Chiptune buffer must have audio content");
console.log(`   ✓ Chiptune engine generated ${chipBuf.length} bytes.`);

// 6. Melodic Electronic Engine
console.log("6. Testing Electronic Generator...");
const elecBuf = generateElectronicLoop(1.0);
assert.ok(elecBuf.length > 44, "Electronic buffer must have audio content");
console.log(`   ✓ Electronic engine generated ${elecBuf.length} bytes.`);

// 7. Midnight Jazz Engine
console.log("7. Testing Jazz Generator...");
const jazzBuf = generateJazzLoop(1.0);
assert.ok(jazzBuf.length > 44, "Jazz buffer must have audio content");
console.log(`   ✓ Jazz engine generated ${jazzBuf.length} bytes.`);

// 8. Zen Ambient Engine
console.log("8. Testing Zen Ambient Generator...");
const zenBuf = generateZenLoop(1.0);
assert.ok(zenBuf.length > 44, "Zen buffer must have audio content");
console.log(`   ✓ Zen engine generated ${zenBuf.length} bytes.`);

// 9. Outcome Chimes (Success vs Failure)
console.log("9. Testing Outcome Chimes (Success & Failure)...");
const { generateSuccessChime, generateFailureChime } = require("../src/synth/chime");
const successBuf = generateSuccessChime(1.0);
const failureBuf = generateFailureChime(1.0);
assert.ok(successBuf.length > 44, "Success chime must have audio content");
assert.ok(failureBuf.length > 44, "Failure chime must have audio content");
console.log(`   ✓ Success chime (${successBuf.length}b) and Failure chime (${failureBuf.length}b) generated.`);

// 10. Adaptive Escalation Tiers
console.log("10. Testing Adaptive Escalation Tiers...");
const tier1Buf = generateLofiLoop(1.0, 1);
const tier3Buf = generateLofiLoop(1.0, 3);
assert.ok(tier1Buf.length > 44, "Tier 1 loop must have content");
assert.ok(tier3Buf.length > 44, "Tier 3 loop must have content");
console.log("   ✓ Adaptive escalation tiers (Tier 1 Ambient -> Tier 3 Peak) generate successfully.");

// 11. Terminal HUD & Waveform
console.log("11. Testing Terminal HUD & Waveform...");
const { TerminalHud } = require("../src/hud");
const hud = new TerminalHud("synthwave");
assert.strictEqual(hud.genre, "synthwave");
console.log("   ✓ Terminal HUD initializes correctly.");

// 12. CLI Argument Parsing
console.log("12. Testing CLI Argument Parsing...");
const parsed = parseArgs(["node", "bin/vibeaudio.js", "-g", "synthwave", "-v", "65", "--no-chime", "--no-hud", "claude", "arg1"]);
assert.strictEqual(parsed.genre, "synthwave");
assert.strictEqual(parsed.volume, 0.65);
assert.strictEqual(parsed.noChime, true);
assert.strictEqual(parsed.noHud, true);
assert.deepStrictEqual(parsed.cmdArgs, ["claude", "arg1"]);
console.log("   ✓ CLI argument parser accurately processes flags, HUD, and child commands.");

// 13. Volume Presets & Independent Chime Volume
console.log("13. Testing Volume Presets & Independent Chime Volume...");
const quietParsed = parseArgs(["node", "bin/vibeaudio.js", "--quiet", "-cv", "70", "gemini"]);
assert.strictEqual(quietParsed.volume, 0.25, "--quiet should set volume to 0.25");
assert.strictEqual(quietParsed.chimeVolume, 0.70, "-cv should set chimeVolume to 0.70");

const whisperParsed = parseArgs(["node", "bin/vibeaudio.js", "--whisper", "claude"]);
assert.strictEqual(whisperParsed.volume, 0.15, "--whisper should set volume to 0.15");

const loudParsed = parseArgs(["node", "bin/vibeaudio.js", "--loud", "claude"]);
assert.strictEqual(loudParsed.volume, 0.75, "--loud should set volume to 0.75");
// Regression: MCP parsed volume itself and skipped the NaN guard, so
// VIBE_VOLUME=loud reached the player as NaN and afplay got `-v NaN`.
const { normalizeVolume } = require("../src/player");
assert.strictEqual(normalizeVolume("50", 0.4), 0.5, "string percent parses");
assert.strictEqual(normalizeVolume(50, 0.4), 0.5, "MCP sends a number, not a string");
assert.strictEqual(normalizeVolume("loud", 0.4), 0.4, "unparseable value must fall back, not yield NaN");
assert.strictEqual(normalizeVolume(undefined, 0.4), 0.4, "missing value falls back");
assert.strictEqual(normalizeVolume(undefined, null), null, "chime volume keeps its null default");
assert.strictEqual(normalizeVolume("200", 0.4), 1, "clamps to 100");
assert.strictEqual(normalizeVolume("-5", 0.4), 0.05, "clamps to the 5 floor");
console.log("   ✓ Volume presets (--whisper, --quiet, --loud) and --chime-volume work properly.");

// 14. Adaptive Escalation Is Audible In Every Genre
// Regression: chiptune/electronic/jazz/zen used to ignore the tier argument,
// so all three cached tier files were byte-identical.
console.log("14. Testing Tier Escalation Across All Genres...");

function rmsOf(wavBuf) {
  let sum = 0;
  let count = 0;
  for (let off = 44; off + 1 < wavBuf.length; off += 2) {
    const v = wavBuf.readInt16LE(off) / 32768;
    sum += v * v;
    count++;
  }
  return Math.sqrt(sum / count);
}

const tieredGenerators = {
  lofi: generateLofiLoop,
  synthwave: generateSynthwaveLoop,
  "8bit": generateChiptuneLoop,
  electronic: generateElectronicLoop,
  jazz: generateJazzLoop,
  zen: generateZenLoop
};

for (const [name, generate] of Object.entries(tieredGenerators)) {
  const buf1 = generate(3.0, 1);
  const buf2 = generate(3.0, 2);
  const buf3 = generate(3.0, 3);

  assert.ok(!buf1.equals(buf3), `${name}: tier 1 and tier 3 must not be identical audio`);
  assert.ok(!buf2.equals(buf3), `${name}: tier 2 and tier 3 must not be identical audio`);

  // Two genres dither with noise, so require a change far larger than dither
  // to prove the tier argument actually reshapes the arrangement.
  const rms1 = rmsOf(buf1);
  const rms3 = rmsOf(buf3);
  const delta = Math.abs(rms3 - rms1) / rms1;
  assert.ok(delta > 0.05, `${name}: tier 1 -> 3 must change level materially (got ${(delta * 100).toFixed(1)}%)`);
}
console.log(`   ✓ All ${Object.keys(tieredGenerators).length} genres render distinct audio per tier.`);

// 15. Model Context Protocol (MCP) Server Protocol
console.log("15. Testing MCP Server Protocol (JSON-RPC 2.0)...");
const { handleMessage, TOOLS } = require("../src/mcp");
const mockPlayer = {
  isPlaying: false,
  genre: "lofi",
  volume: 0.4,
  currentTier: 1,
  startTime: 0,
  start(g, v) { this.isPlaying = true; this.genre = g; this.volume = v; this.startTime = Date.now(); return true; },
  stop(opts) { const was = this.isPlaying; this.isPlaying = false; return was; }
};

// 15a. initialize
const initRes = handleMessage(mockPlayer, { id: 1, method: "initialize", params: {} });
assert.strictEqual(initRes.result.serverInfo.name, "vibeaudio");
assert.ok(initRes.result.capabilities.tools);
// Nothing fires MCP tools automatically, so the usage nudge is the only thing
// keeping the server from sitting idle. Losing it would be silent.
assert.ok(/vibe_play/.test(initRes.result.instructions || ""), "initialize must tell the model when to call vibe_play");
assert.ok(/vibe_stop/.test(initRes.result.instructions || ""), "initialize must tell the model to call vibe_stop");

// 15b. tools/list
const listRes = handleMessage(mockPlayer, { id: 2, method: "tools/list", params: {} });
assert.strictEqual(listRes.result.tools.length, 3);
assert.deepStrictEqual(listRes.result.tools.map(t => t.name), ["vibe_play", "vibe_stop", "vibe_status"]);

// 15c. tools/call -> vibe_play
const playRes = handleMessage(mockPlayer, {
  id: 3,
  method: "tools/call",
  params: { name: "vibe_play", arguments: { genre: "jazz", volume: 50 } }
});
assert.strictEqual(mockPlayer.isPlaying, true);
assert.strictEqual(mockPlayer.genre, "jazz");
assert.ok(playRes.result.content[0].text.includes("jazz"));

// 15d. tools/call -> vibe_status
const statusRes = handleMessage(mockPlayer, {
  id: 4,
  method: "tools/call",
  params: { name: "vibe_status", arguments: {} }
});
const statusData = JSON.parse(statusRes.result.content[0].text);
assert.strictEqual(statusData.isPlaying, true);
assert.strictEqual(statusData.genre, "jazz");

// 15e. tools/call -> vibe_stop
const stopRes = handleMessage(mockPlayer, {
  id: 5,
  method: "tools/call",
  params: { name: "vibe_stop", arguments: { outcome: "success" } }
});
assert.strictEqual(mockPlayer.isPlaying, false);
assert.ok(stopRes.result.content[0].text.includes("success"));
console.log("   ✓ MCP Server protocol (initialize, tools/list, vibe_play, vibe_status, vibe_stop) verified.");

// 16. Genre Aliases, Validation & Random Resolution
console.log("16. Testing Genre Resolution & Validation...");
const { resolveGenre, isKnownGenre, AVAILABLE_GENRES, CACHE_DIR } = require("../src/player");
assert.strictEqual(resolveGenre("chiptune"), "8bit", "aliases must map to canonical genre names");
assert.strictEqual(resolveGenre("BOSSA"), "jazz", "genre matching is case-insensitive");
assert.ok(AVAILABLE_GENRES.includes(resolveGenre("random")), "random must resolve to a real genre");
assert.strictEqual(isKnownGenre("nonsense"), false, "unknown genres must be rejected");
assert.strictEqual(isKnownGenre("zen"), true);
console.log("   ✓ Genre aliases, casing, random resolution and validation behave correctly.");

// 17. Cache Is Scoped To The Audio It Holds
// Regression: an unversioned cache meant synth changes never reached upgraders.
// Keying on the version alone did not fix that - it just moved the failure to
// "someone must remember to bump it", which went 0 for 40. The key now carries
// a hash of the generators as well; test 34d covers that half.
console.log("17. Testing Scoped Audio Cache...");
assert.ok(
  new RegExp(`v${require("../package.json").version.replace(/\./g, "\\.")}-[0-9a-f]{8}$`).test(CACHE_DIR),
  `cache dir must be keyed by version and synth hash, got ${CACHE_DIR}`
);
console.log(`   ✓ Cache is scoped to ${require("path").basename(CACHE_DIR)}.`);

// 18. WAV Duration Parsing (drives gapless loop scheduling)
console.log("18. Testing WAV Duration Parsing...");
const { wavDurationMs } = require("../src/player");
const fs = require("fs");
const path = require("path");
const tmpWav = path.join(os.tmpdir(), `vibeaudio-test-${process.pid}.wav`);
fs.writeFileSync(tmpWav, generateZenLoop(2.0, 2));
const measured = wavDurationMs(tmpWav);
fs.unlinkSync(tmpWav);
assert.ok(Math.abs(measured - 2000) < 50, `2s loop should measure ~2000ms, got ${measured}`);
console.log(`   ✓ WAV duration parsed as ${Math.round(measured)}ms for a 2s loop.`);

// 19. HUD Guards Against Unstarted And Repeated Stops
// Regression: cleanup ran twice on interrupt, printing the outcome line twice,
// and a never-started HUD reported a bogus multi-decade runtime.
console.log("19. Testing HUD Stop Guards...");
const unstartedHud = new TerminalHud("lofi");
unstartedHud.stop({ outcome: "success", code: 0 });
assert.strictEqual(unstartedHud.stopped, false, "a HUD that never started must not report an outcome");

const startedHud = new TerminalHud("lofi");
startedHud.start();
startedHud.stop({ outcome: "success", code: 0 });
assert.strictEqual(startedHud.stopped, true);
startedHud.stop({ outcome: "success", code: 0 });
assert.strictEqual(startedHud.timer, null, "repeated stops must stay inert");
console.log("   ✓ HUD ignores unstarted and duplicate stops.");

// 20. Custom Command Tokenizing
// Regression: the interactive "Custom command..." prompt split on whitespace,
// so quoted arguments were shredded into separate argv entries.
console.log("20. Testing Custom Command Tokenizing...");
const { tokenizeCommand } = require("../src/interactive");
assert.deepStrictEqual(tokenizeCommand("claude"), ["claude"]);
assert.deepStrictEqual(tokenizeCommand("  claude   --resume  "), ["claude", "--resume"]);
assert.deepStrictEqual(
  tokenizeCommand('claude --append-system-prompt "be brief"'),
  ["claude", "--append-system-prompt", "be brief"],
  "double-quoted arguments must stay one token"
);
assert.deepStrictEqual(tokenizeCommand("git commit -m 'two words'"), ["git", "commit", "-m", "two words"]);
assert.deepStrictEqual(tokenizeCommand(""), [], "empty input yields no tokens");
console.log("   ✓ Quoted arguments survive the custom-command prompt.");

// 21. Claude Code Hook Install / Uninstall
console.log("21. Testing Claude Code Hook Installation...");
const { installHooks, uninstallHooks } = require("../src/hooks");
const hookSettings = path.join(os.tmpdir(), `vibeaudio-hooks-${process.pid}.json`);
const foreignHook = { hooks: [{ type: "command", command: "echo other-tool", timeout: 30 }] };
fs.writeFileSync(hookSettings, JSON.stringify({ model: "opus", hooks: { Stop: [foreignHook] } }));

installHooks("jazz", 0.25, hookSettings);
installHooks("zen", 0.25, hookSettings); // installing twice must not duplicate

const afterInstall = JSON.parse(fs.readFileSync(hookSettings, "utf8"));
assert.strictEqual(afterInstall.model, "opus", "unrelated settings must be preserved");
assert.strictEqual(afterInstall.hooks.UserPromptSubmit.length, 1, "repeat installs must not duplicate hooks");
assert.strictEqual(afterInstall.hooks.Stop.length, 2, "another tool's hook must survive alongside ours");
assert.strictEqual(afterInstall.hooks.Stop[0].hooks[0].command, "echo other-tool");
// Genre and volume are deliberately absent from the command line: each hook
// reads the saved config when it fires, which is what lets `vibe --genre jazz`
// change installed hooks without reinstalling them.
assert.ok(
  !/--genre|--volume/.test(afterInstall.hooks.UserPromptSubmit[0].hooks[0].command),
  "hook commands must not pin genre or volume"
);

const { removed } = uninstallHooks(hookSettings);
const afterUninstall = JSON.parse(fs.readFileSync(hookSettings, "utf8"));
fs.unlinkSync(hookSettings);
// start, stop, and Claude's 2 wait + 3 resume + StopFailure + SessionEnd
assert.strictEqual(removed, 9, "all nine hooks must be removed");
assert.deepStrictEqual(afterUninstall.hooks.Stop, [foreignHook], "uninstall must leave foreign hooks untouched");
assert.strictEqual(afterUninstall.hooks.UserPromptSubmit, undefined, "emptied events must be dropped");
assert.strictEqual(afterUninstall.hooks.PermissionRequest, undefined, "the wait hook must go too");
console.log("   ✓ Hooks install idempotently, merge safely and uninstall cleanly.");

// 22. Seeded Arrangements: deterministic per project, varied across projects
console.log("22. Testing Seeded Arrangement Variation...");
const { projectSeed } = require("../src/player");

for (const [name, generate] of Object.entries(tieredGenerators)) {
  assert.ok(
    generate(3.0, 2, 1234).equals(generate(3.0, 2, 1234)),
    `${name}: the same seed must always render identical audio`
  );

  // Across seeds at least one arrangement must differ, or the seed is inert.
  const renders = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => generate(3.0, 2, s).toString("base64"));
  assert.ok(new Set(renders).size > 1, `${name}: different seeds must produce different arrangements`);
}
console.log("   ✓ Seeds are deterministic per project and varied across projects.");

assert.strictEqual(projectSeed("/a/repo"), projectSeed("/a/repo"), "a project's seed must be stable");
assert.notStrictEqual(projectSeed("/a/repo"), projectSeed("/b/repo"), "different projects must differ");

process.env.VIBE_SEED = "4242";
assert.strictEqual(projectSeed("/a/repo"), 4242, "VIBE_SEED must override the directory-derived seed");
delete process.env.VIBE_SEED;
console.log("   ✓ Project seeds are stable, distinct per directory and overridable.");

// 23. Reactive Mode: tool calls drive intensity
console.log("23. Testing Reactive Intensity Mapping...");
const { toolTier, installHooks: installHooksFn } = require("../src/hooks");
assert.strictEqual(toolTier("Read"), 1, "reading stays sparse");
assert.strictEqual(toolTier("Grep"), 1);
assert.strictEqual(toolTier("Edit"), 2, "edits bring in the groove");
assert.strictEqual(toolTier("Bash"), 3, "shelling out goes to peak");
assert.strictEqual(toolTier("SomeFutureTool"), 2, "unknown tools must not swing the mix");

const reactiveSettings = path.join(os.tmpdir(), `vibeaudio-reactive-${process.pid}.json`);
fs.writeFileSync(reactiveSettings, "{}");

installHooksFn("lofi", 0.4, reactiveSettings, { reactive: true });
const reactiveOn = JSON.parse(fs.readFileSync(reactiveSettings, "utf8"));
assert.ok(reactiveOn.hooks.PreToolUse, "reactive install must wire PreToolUse");
assert.ok(/--reactive/.test(reactiveOn.hooks.UserPromptSubmit[0].hooks[0].command));

// Reinstalling without --reactive must take the per-tool hook back out.
installHooksFn("lofi", 0.4, reactiveSettings, { reactive: false });
const reactiveOff = JSON.parse(fs.readFileSync(reactiveSettings, "utf8"));
fs.unlinkSync(reactiveSettings);
assert.strictEqual(reactiveOff.hooks.PreToolUse, undefined, "plain install must drop PreToolUse");
assert.ok(!/--reactive/.test(reactiveOff.hooks.UserPromptSubmit[0].hooks[0].command));
console.log("   ✓ Tool tiers map correctly and --reactive toggles PreToolUse cleanly.");

// 23b. Hooks must refuse to record a path npm will delete.
// Hook commands are absolute paths; one written from an npx checkout breaks
// silently on every prompt once the cache is cleared.
console.log("23b. Testing Ephemeral Install Guard...");
const { ephemeralInstallReason } = require("../src/hooks");
const sep = path.sep;
assert.strictEqual(
  ephemeralInstallReason(`${sep}home${sep}u${sep}.npm${sep}_npx${sep}a1b2${sep}node_modules${sep}vibeaudio${sep}bin${sep}vibeaudio.js`),
  "npx",
  "an npx checkout must be rejected"
);
assert.strictEqual(
  ephemeralInstallReason(`${sep}usr${sep}local${sep}lib${sep}node_modules${sep}vibeaudio${sep}bin${sep}vibeaudio.js`),
  null,
  "a real global install must be allowed"
);
assert.strictEqual(
  ephemeralInstallReason(`${sep}Users${sep}me${sep}src${sep}vibeaudio${sep}bin${sep}vibeaudio.js`),
  null,
  "a clone must be allowed"
);

// The guard runs before any mkdir/write, so a refusal cannot touch settings.
assert.ok(
  /ephemeralInstallReason\(\);?\s*\n\s*if \(ephemeral\)/.test(
    fs.readFileSync(path.join(__dirname, "..", "src", "hooks.js"), "utf8")
  ),
  "installHooks must check the guard first, before writing anything"
);
console.log("   ✓ Temporary npx checkouts are refused before settings are written.");

// 23c. The wrapper must stand down when hooks already cover Claude Code.
// Otherwise `vibe claude` layers a session-long stream over the hook daemon's.
console.log("23c. Testing Wrapper/Hook Overlap Guard...");
const { hooksAlreadyCover } = require("../src/cli");
const coverFile = path.join(os.tmpdir(), `vibeaudio-cover-${process.pid}.json`);

fs.writeFileSync(coverFile, "{}");
installHooksFn("lofi", 0.4, coverFile);
assert.strictEqual(hooksAlreadyCover(["claude"], coverFile), true, "wrapper must defer to installed hooks");
assert.strictEqual(
  hooksAlreadyCover(["/opt/homebrew/bin/claude"], coverFile), true,
  "an absolute path to claude must still be recognised"
);
assert.strictEqual(hooksAlreadyCover(["npm", "test"], coverFile), false, "other commands keep the wrapper");
assert.strictEqual(hooksAlreadyCover(["aider"], coverFile), false, "a tool without hooks keeps the wrapper");

uninstallHooks(coverFile);
assert.strictEqual(hooksAlreadyCover(["claude"], coverFile), false, "without hooks the wrapper takes over again");

fs.writeFileSync(coverFile, "{ not json");
assert.strictEqual(hooksAlreadyCover(["claude"], coverFile), false, "unreadable settings must not crash the wrapper");
fs.unlinkSync(coverFile);
console.log("   ✓ Wrapper defers to installed hooks and keeps working without them.");

// 24. Exit Codes Propagate (end-to-end)
// Regression: a signal-killed child reported code null, which was mapped to 0 -
// an aborted run claimed success and played the success chime.
console.log("24. Testing Exit Code Propagation (end-to-end)...");
const { spawn } = require("child_process");
const CLI = path.join(__dirname, "..", "bin", "vibeaudio.js");

// A grace window longer than the test keeps these runs completely silent.
function runCli(args, killAfterMs = null) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "--grace", "60000", "--no-hud", ...args], { stdio: "ignore" });
    if (killAfterMs !== null) setTimeout(() => child.kill("SIGINT"), killAfterMs);
    child.on("close", (code) => resolve(code));
  });
}

// Spawn node rather than sleep/true/false: those are Unix shell builtins the
// Windows CI job has no equivalent for, and node is by definition present.
// These two run through executeCommand, which spawns with shell:true on
// Windows - and Node does not quote args for cmd. Keep them free of spaces,
// quotes and parens, or cmd eats them. (NODE_HANG only runs on posix.)
const NODE_OK = [process.execPath, "-e", "0"];
const NODE_FAIL = [process.execPath, "-e", "process.exitCode=1"];
const NODE_HANG = [process.execPath, "-e", "setTimeout(() => {}, 30000)"];

(async () => {
  assert.strictEqual(await runCli(NODE_OK), 0, "successful command must exit 0");
  assert.strictEqual(await runCli(NODE_FAIL), 1, "failing command must propagate exit 1");
  if (process.platform === "win32") {
    // Windows has no POSIX signals; SIGINT to a detached child is not the
    // same mechanism, so the 130 mapping is a Unix-only guarantee.
    console.log("   ✓ Success (0) and failure (1) exit codes propagate (signal test skipped on Windows).");
  } else {
    assert.strictEqual(await runCli(NODE_HANG, 400), 130, "SIGINT must exit 130, not 0");
    console.log("   ✓ Success (0), failure (1) and interrupt (130) exit codes all propagate.");
  }

  // 25. A recycled pid must never be signalled
  // Regression: stopDaemon killed whatever pid the file named. A pid file
  // outlives a daemon that died without cleanup, and pids get recycled, so
  // that eventually SIGTERMs an unrelated process - on every prompt.
  //
  // hooks.js resolves PID_FILE from os.homedir() at require time, so the fake
  // home has to be set before the module loads: this runs in a child process
  // rather than reaching into the real ~/.vibeaudio.
  console.log("25. Testing Daemon PID Ownership Guard...");
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pid-"));
  const probe = `
    const fs = require("fs"), path = require("path");
    const { spawn } = require("child_process");
    const hooks = require(process.argv[1]);
    const stranger = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    fs.mkdirSync(path.dirname(hooks.PID_FILE), { recursive: true });
    fs.writeFileSync(hooks.PID_FILE, String(stranger.pid));
    const claimedKill = hooks.stopDaemon();
    setTimeout(() => {
      let alive = true;
      try { process.kill(stranger.pid, 0); } catch (e) { alive = false; }
      console.log(JSON.stringify({
        home: hooks.PID_FILE,
        isOurs: hooks.isOurDaemon(stranger.pid),
        claimedKill,
        strangerAlive: alive,
        pidFileCleared: !fs.existsSync(hooks.PID_FILE)
      }));
      stranger.kill();
      process.exit(0);
    }, 200);
  `;
  const probeOut = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["-e", probe, path.join(__dirname, "..", "src", "hooks.js")],
      { env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome }, stdio: ["ignore", "pipe", "inherit"] }
    );
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => resolve(JSON.parse(out)));
  });

  assert.ok(
    probeOut.home.startsWith(fakeHome),
    `the probe must operate on a throwaway home, not ${probeOut.home}`
  );
  assert.ok(probeOut.pidFileCleared, "the stale pid file is still cleared");

  // isOurDaemon trusts the pid on Windows for want of a cheap command-line
  // lookup, so the ownership guarantee itself is Unix-only.
  if (process.platform === "win32") {
    console.log("   ✓ Stale pid file cleared (ownership guard is Unix-only, skipped here).");
  } else {
    assert.strictEqual(probeOut.isOurs, false, "an unrelated process is not our daemon");
    assert.strictEqual(probeOut.claimedKill, false, "stopDaemon must not claim a kill it did not make");
    assert.ok(probeOut.strangerAlive, "stopDaemon must not kill a process that is not its daemon");
    console.log("   ✓ A stale pid file cannot make stopDaemon signal an unrelated process.");
  }

  fs.rmSync(fakeHome, { recursive: true, force: true });

  // 26. Command lookup must work off Unix too
  console.log("26. Testing Command Lookup...");
  const { isInstalled } = require("../src/interactive");
  assert.strictEqual(isInstalled("node"), true, "node is on PATH in any environment running this suite");
  assert.strictEqual(isInstalled("definitely-not-a-real-command-xyz"), false, "missing commands report false");
  console.log("   ✓ Tool detection resolves real commands and rejects missing ones.");

  // 27. Volume must work on backends that cannot attenuate
  // aplay and PowerShell's SoundPlayer take no volume argument, so --volume
  // used to be silently ignored there. The gain is baked into the PCM instead.
  console.log("27. Testing Baked Gain For Volume-less Backends...");
  const { bakedGain, applyGain, getAudioPath: audioPath } = require("../src/player");

  assert.strictEqual(bakedGain({ volume: true }, 0.25), 1, "a backend with volume support attenuates itself");
  assert.strictEqual(bakedGain({ volume: false }, 0.25), 0.25, "a backend without it gets a pre-scaled file");
  assert.strictEqual(bakedGain(null, 0.25), 1, "no backend at all must not try to bake");
  assert.strictEqual(bakedGain({ volume: false }, 0.001), 0.05, "gain is floored, never silent by accident");

  // Seed dirs land in the real ~/.vibeaudio/cache, and pruneSeedDirs keeps
  // only the three most recent - so a test that leaves one behind can evict
  // the cache of a project the user actually works in. Clean up after.
  const gainSeed = 42;
  const gainDir = path.join(require("../src/player").CACHE_DIR, `s${gainSeed}`);

  const fullPath = audioPath("jazz", 2, gainSeed, 1);
  const quietPath = audioPath("jazz", 2, gainSeed, 0.25);
  assert.notStrictEqual(fullPath, quietPath, "each gain needs its own cache entry");
  assert.ok(/_g25\.wav$/.test(quietPath), "the gain belongs in the filename");

  const rms = (file) => {
    const buf = fs.readFileSync(file);
    let sum = 0;
    let n = 0;
    for (let o = 44; o + 1 < buf.length; o += 2) {
      const s = buf.readInt16LE(o) / 32768;
      sum += s * s;
      n++;
    }
    return Math.sqrt(sum / n);
  };
  const ratio = rms(quietPath) / rms(fullPath);
  assert.ok(Math.abs(ratio - 0.25) < 0.005, `baked file must be 25% as loud, got ${ratio.toFixed(3)}`);

  // Rounding, not truncation: error stays within half an LSB.
  const flat = Buffer.alloc(48);
  flat.write("RIFF", 0);
  flat.writeInt16LE(1000, 44);
  flat.writeInt16LE(-1001, 46);
  applyGain(flat, 0.5);
  assert.strictEqual(flat.readInt16LE(44), 500, "positive samples scale");
  assert.strictEqual(flat.readInt16LE(46), -500, "negative samples round symmetrically (-500.5 -> -500)");
  assert.throws(() => applyGain(Buffer.alloc(8), 0.5), /canonical/, "a non-WAV buffer must be rejected, not silently mangled");

  fs.rmSync(gainDir, { recursive: true, force: true });
  console.log("   ✓ Volume is baked into the PCM when the player cannot attenuate.");

  // 28. The launcher menu must only offer reactive where it does something
  // --reactive is a hooks-only feature, so offering it on the wrapper branch
  // would be a control that silently does nothing.
  console.log("28. Testing Launcher Menu Flow...");
  if (process.platform === "win32") {
    console.log("   ✓ Skipped on Windows (needs a POSIX executable bit to fix menu order).");
  } else {
    const { promptInteractive } = require("../src/interactive");

    // Make exactly one tool discoverable, so the installed-first sort puts
    // Claude Code at position 1 no matter what the host has installed.
    const binDir = sandboxPathWith(["claude"]);
    const realPath = process.env.PATH;
    const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    process.env.PATH = binDir;

    // The menus paint themselves on stdout; keep that out of the test log.
    const realWrite = process.stdout.write.bind(process.stdout);
    const realLog = console.log;
    process.stdout.write = () => true;
    console.log = () => {};

    // Drive the menus by feeding the next key as soon as a menu subscribes,
    // which keeps this deterministic instead of racing timers.
    const drive = (keys) => {
      const queue = [...keys];
      const fake = new (require("events").EventEmitter)();
      Object.assign(fake, {
        isTTY: true,
        setRawMode() {},
        resume() {},
        pause() {},
        setEncoding() {}
      });
      const realOn = fake.on.bind(fake);
      fake.on = (event, fn) => {
        const out = realOn(event, fn);
        if (event === "data" && queue.length) setImmediate(() => fake.emit("data", queue.shift()));
        return out;
      };
      Object.defineProperty(process, "stdin", { value: fake, configurable: true });
      return { pending: () => queue.length };
    };

    // Claude Code -> hooks -> lofi -> Normal -> Reactive
    const hooksRun = drive(["1", "1", "1", "1", "2"]);
    const withHooks = await promptInteractive({ hooksInstalledFor: () => false });
    assert.deepStrictEqual(withHooks.cmd, ["claude"], "first entry must be the one installed tool");
    assert.strictEqual(withHooks.installHooks, true, "the hooks branch must report itself");
    assert.strictEqual(withHooks.reactive, true, "reactive must be selectable from the menu");
    assert.strictEqual(withHooks.genre, "lofi");
    assert.strictEqual(withHooks.volume, 0.4);
    assert.strictEqual(hooksRun.pending(), 0, "the hooks branch asks all five questions");

    // Claude Code -> this session only -> lofi -> Normal, and no reactive step
    const wrapperRun = drive(["1", "2", "1", "1", "2"]);
    const withWrapper = await promptInteractive({ hooksInstalledFor: () => false });
    assert.strictEqual(withWrapper.installHooks, false, "the wrapper branch must not install");
    assert.strictEqual(withWrapper.reactive, false, "reactive is meaningless without hooks");
    assert.strictEqual(wrapperRun.pending(), 1, "the wrapper branch must not ask the reactive question");

    // With hooks installed, option 1 launches without asking anything else:
    // a genre and volume the hooks ignore must not be collected at all.
    const installedRun = drive(["1", "1", "1", "1", "1"]);
    const withInstalled = await promptInteractive({ hooksInstalledFor: () => true });
    assert.strictEqual(withInstalled.installHooks, false, "launching must not reinstall");
    assert.strictEqual(withInstalled.genre, undefined, "no genre is collected when hooks own it");
    assert.strictEqual(withInstalled.volume, undefined, "no volume is collected when hooks own it");
    assert.strictEqual(installedRun.pending(), 3, "only the tool and the delivery question are asked");

    process.stdout.write = realWrite;
    console.log = realLog;
    process.env.PATH = realPath;
    Object.defineProperty(process, "stdin", realStdin);
    fs.rmSync(binDir, { recursive: true, force: true });
    console.log("   ✓ Reactive is offered on the hooks branch, withheld from the wrapper, and dead questions are skipped when hooks already own the music.");
  }

  // 29. Uninstalling must not strand a running player
  // Once the hooks are gone nothing sends Stop, and npm rm -g takes away the
  // only thing that could stop it - so the daemon would play to its 15min cap.
  console.log("29. Testing Uninstall Stops The Daemon...");
  if (process.platform === "win32") {
    console.log("   ✓ Skipped on Windows (daemon ownership check is Unix-only).");
  } else {
    const uninstallHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-uninst-"));
    const probeSrc = `
      const hooks = require(process.argv[1]);
      hooks.installHooks("lofi", 0.05, hooks.settingsPath());
      const pid = hooks.hookStart("lofi", 0.05);
      setTimeout(() => {
        require("child_process").execFileSync(process.execPath, [process.argv[2], "--uninstall-hooks"], { stdio: "ignore" });
        setTimeout(() => {
          let alive = true;
          try { process.kill(pid, 0); } catch (e) { alive = false; }
          console.log(JSON.stringify({ alive }));
          if (alive) { try { process.kill(pid, "SIGTERM"); } catch (e) {} }
          process.exit(0);
        }, 400);
      }, 700);
    `;
    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ["-e", probeSrc, path.join(__dirname, "..", "src", "hooks.js"), CLI],
        { env: { ...process.env, HOME: uninstallHome, USERPROFILE: uninstallHome }, stdio: ["ignore", "pipe", "inherit"] }
      );
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.on("close", () => resolve(JSON.parse(out)));
    });

    assert.strictEqual(result.alive, false, "--uninstall-hooks must stop the running daemon");
    fs.rmSync(uninstallHome, { recursive: true, force: true });
    console.log("   ✓ Uninstalling the hooks also stops the player they started.");
  }

  // 30. The drone genre must stay non-melodic and level-matched
  console.log("30. Testing Deep Drone Generator...");
  const { generateDroneLoop } = require("../src/synth/drone");
  const { generateJazzLoop: jazzRef } = require("../src/synth/jazz");

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

  const d1 = generateDroneLoop(7, 1, 42);
  const d2 = generateDroneLoop(7, 2, 42);
  const d3 = generateDroneLoop(7, 3, 42);

  assert.ok(!d1.equals(d2) && !d2.equals(d3), "every tier must render differently");
  assert.ok(!generateDroneLoop(7, 2, 7).equals(d2), "the seed must change the arrangement");
  assert.ok(generateDroneLoop(7, 2, 42).equals(d2), "generation stays deterministic");

  // Loud enough to hear, quiet enough to sit with the melodic genres, and
  // never clipping - a noise bed is the easiest thing in here to overdrive.
  const ref = measure(jazzRef(6.26, 2, 42));
  for (const [tier, buf] of [[1, d1], [2, d2], [3, d3]]) {
    const m = measure(buf);
    assert.ok(m.peak < 0.95, `tier ${tier} must not clip (peak ${m.peak.toFixed(3)})`);
    assert.ok(m.rms > 0.05 && m.rms < ref.rms * 1.6, `tier ${tier} must sit near the other genres (rms ${m.rms.toFixed(4)} vs jazz ${ref.rms.toFixed(4)})`);
  }
  assert.ok(measure(d1).rms < measure(d2).rms && measure(d2).rms < measure(d3).rms, "tiers must escalate in weight");

  // Both ends fade to silence, or the loop point clicks every 7 seconds.
  assert.ok(Math.abs(d2.readInt16LE(44)) < 33, "loop must start from silence");
  assert.ok(Math.abs(d2.readInt16LE(d2.length - 2)) < 33, "loop must end in silence");
  console.log("   ✓ Drone escalates, stays level-matched to the melodic genres and loops seamlessly.");

  // 31. VIBE_DISABLE must mute automatic playback without touching config
  console.log("31. Testing VIBE_DISABLE Mute Switch...");
  const { AudioPlayer, playbackDisabled } = require("../src/player");
  const realDisable = process.env.VIBE_DISABLE;

  delete process.env.VIBE_DISABLE;
  assert.strictEqual(playbackDisabled(), false, "silent by default would be a bad default");
  for (const on of ["1", "true", "yes", "on", "TRUE", " 1 "]) {
    process.env.VIBE_DISABLE = on;
    assert.strictEqual(playbackDisabled(), true, `${JSON.stringify(on)} must mute`);
  }
  for (const offValue of ["0", "false", "", "no"]) {
    process.env.VIBE_DISABLE = offValue;
    assert.strictEqual(playbackDisabled(), false, `${JSON.stringify(offValue)} must not mute`);
  }

  // The gate lives in start(), which every automatic path goes through.
  process.env.VIBE_DISABLE = "1";
  const muted = new AudioPlayer();
  assert.strictEqual(muted.start("lofi", 0.3), false, "start() must refuse while muted");
  assert.strictEqual(muted.isPlaying, false, "a muted player must not claim to be playing");
  assert.strictEqual(muted.stop({ playChime: true }), false, "nothing was playing, so nothing to stop");

  if (realDisable === undefined) delete process.env.VIBE_DISABLE;
  else process.env.VIBE_DISABLE = realDisable;
  console.log("   ✓ VIBE_DISABLE mutes automatic playback and leaves config alone.");

  // 32. --status and --stop must run clean on a machine with nothing set up
  console.log("32. Testing --status And --stop...");
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-status-"));
  const runFlag = (flag) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, flag], {
        env: { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome, VIBE_DISABLE: "" },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (out += c));
      child.on("close", (code) => resolve({ code, out }));
    });

  const status = await runFlag("--status");
  assert.strictEqual(status.code, 0, "--status must exit 0 with nothing installed");
  assert.ok(/not installed/.test(status.out), "--status must say when hooks are missing");
  assert.ok(/not running/.test(status.out), "--status must say when no player is running");

  const stopped = await runFlag("--stop");
  assert.strictEqual(stopped.code, 0, "--stop must exit 0 when nothing is playing");
  assert.ok(/Nothing was playing/.test(stopped.out), "--stop must say so rather than claim a kill");

  fs.rmSync(emptyHome, { recursive: true, force: true });
  console.log("   ✓ --status reports missing pieces and --stop is safe with nothing running.");

  // --- 33. Codex and Cursor get hooks in their own dialect ---
  console.log("\n\x1b[1m[33] Multi-agent hooks: Codex, Cursor and Grok file shapes\x1b[0m");
  {
    const { installHooks: install, uninstallHooks: remove, TARGETS } = require("../src/hooks");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-targets-"));

    // Each tool's file already holds someone else's hook, in that tool's own
    // shape - the install must merge into it, not flatten it.
    const existing = {
      codex: { hooks: { Stop: [{ hooks: [{ type: "command", command: "other-tool" }] }] } },
      cursor: { version: 1, hooks: { preToolUse: [{ command: "other-tool" }] } }
    };

    for (const id of ["codex", "cursor"]) {
      const file = path.join(dir, `${id}.json`);
      fs.writeFileSync(file, JSON.stringify(existing[id]));

      install("jazz", 0.3, file, { id, reactive: true });
      install("jazz", 0.3, file, { id, reactive: true }); // must stay idempotent
      const after = JSON.parse(fs.readFileSync(file, "utf8"));
      const ev = TARGETS[id].events;

      assert.ok(after.hooks[ev.start], `${id} must write its own prompt event (${ev.start})`);
      assert.ok(after.hooks[ev.stop], `${id} must write its own stop event (${ev.stop})`);
      assert.strictEqual(
        after.hooks[ev.start].length, 1,
        `${id}: installing twice must not duplicate the entry`
      );
      // Codex rejects unknown root keys outright; Cursor needs its version.
      assert.deepStrictEqual(
        Object.keys(after).sort(),
        id === "cursor" ? ["hooks", "version"] : ["hooks"],
        `${id}: the root object must keep exactly the keys that tool accepts`
      );
      // Codex keys its per-hook trust records by index, so ours must append.
      assert.ok(
        JSON.stringify(after.hooks[ev.tool][0]).includes("other-tool") ||
          JSON.stringify(after.hooks[ev.stop][0]).includes("other-tool"),
        `${id}: the pre-existing hook must stay at index 0`
      );

      const { removed } = remove(file, { id });
      // start, stop, tool - plus Codex's PermissionRequest wait and PostToolUse resume
      const expected = id === "codex" ? 5 : 3;
      assert.strictEqual(removed, expected, `${id}: uninstall must remove all ${expected} of our hooks`);
      assert.ok(
        JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))).includes("other-tool"),
        `${id}: uninstall must leave the other tool's hook alone`
      );
    }

    // Grok owns its whole file, so uninstall must delete it rather than leave
    // an empty husk in a directory Grok keeps scanning.
    {
      const grokFile = path.join(dir, "grok.json");
      install("jazz", 0.3, grokFile, { id: "grok", reactive: true });

      const after = JSON.parse(fs.readFileSync(grokFile, "utf8"));
      assert.deepStrictEqual(Object.keys(after), ["hooks"], "grok: root must hold hooks only");
      assert.ok(after.hooks.UserPromptSubmit && after.hooks.Stop, "grok must use Claude's event names");

      const { removed } = remove(grokFile, { id: "grok" });
      assert.strictEqual(removed, 3, "grok: uninstall must report all three hooks");
      assert.ok(!fs.existsSync(grokFile), "grok: uninstall must delete our file, not empty it");
    }

    fs.rmSync(dir, { recursive: true, force: true });
    console.log("   ✓ Codex and Cursor merge safely; Grok gets its own file and takes it with it.");
  }

  // --- 34. Shuffle stays musical ---
  console.log("\n\x1b[1m[34] Shuffle never lands on the no-melody genre\x1b[0m");
  {
    const { resolveGenre: resolve, SHUFFLE_GENRES, AVAILABLE_GENRES: ALL } = require("../src/player");

    assert.ok(!SHUFFLE_GENRES.includes("drone"), "drone must be out of the shuffle pool");
    assert.strictEqual(SHUFFLE_GENRES.length, ALL.length - 1, "shuffle must drop exactly one genre");

    const seen = new Set();
    for (let i = 0; i < 4000; i++) seen.add(resolve("random"));
    assert.ok(!seen.has("drone"), "random must never resolve to drone");
    // 4000 draws from 6 options: a genre missing here means the pool is wrong,
    // not that the dice were unkind (P(miss) is about 6 * 0.833^4000).
    assert.strictEqual(seen.size, SHUFFLE_GENRES.length, "shuffle must still reach every other genre");

    for (const name of ["drone", "noise", "focus"]) {
      assert.strictEqual(resolve(name), "drone", `${name} must still reach drone on purpose`);
    }
    console.log("   ✓ random stays musical; drone remains reachable by name and alias.");
  }

  // --- 34b. Grok spells the tool name differently ---
  console.log("\n\x1b[1m[34b] Reactive: both tool-name spellings\x1b[0m");
  {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-grokpayload-"));
    const runTool = (payload) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, "--hook-tool"], {
          env: { ...process.env, HOME: home, USERPROFILE: home },
          stdio: ["pipe", "ignore", "ignore"]
        });
        child.stdin.end(JSON.stringify(payload));
        child.on("close", () => resolve(fs.readFileSync(path.join(home, ".vibeaudio", "intensity"), "utf8")));
      });

    // Claude/Codex/Cursor send tool_name; Grok sends toolName. Both must land
    // on the same tier - reading one spelling would pin Grok to the fallback.
    assert.strictEqual(await runTool({ tool_name: "Bash" }), "3", "tool_name must be read");
    assert.strictEqual(await runTool({ toolName: "Bash" }), "3", "toolName (Grok) must be read");
    assert.strictEqual(await runTool({ toolName: "Read" }), "1", "Grok payloads must reach the full tier map");
    // `Task` was renamed to `Agent`; handing work to a subagent is the
    // heaviest thing in a turn and was landing on the fallback tier.
    assert.strictEqual(await runTool({ tool_name: "Agent" }), "3", "the subagent tool must be peak tier");
    assert.strictEqual(await runTool({ tool_name: "AskUserQuestion" }), "1", "waiting on the human is not work");
    // A third of real calls are MCP tools, which cannot be enumerated.
    assert.strictEqual(await runTool({ tool_name: "mcp__server__thing" }), "2", "MCP calls keep the middle tier");
    assert.strictEqual(await runTool({ nothing: true }), "2", "an unrecognised payload falls back to the middle");

    fs.rmSync(home, { recursive: true, force: true });
    console.log("   ✓ Both tool-name spellings reach the tier map.");
  }

  // --- 34c. The failure chime can actually be reached under hooks ---
  console.log("\n\x1b[1m[34c] Stop payload decides the chime\x1b[0m");
  {
    const { outcomeFromPayload, readPayload } = require("../src/hooks");

    // Cursor is the only agent that reports how the turn ended.
    assert.strictEqual(outcomeFromPayload('{"status":"error"}'), "failure", "error must chime failure");
    assert.strictEqual(outcomeFromPayload('{"status":"aborted"}'), "failure", "aborted must chime failure");
    assert.strictEqual(outcomeFromPayload('{"status":"ABORTED"}'), "failure", "status must be case-insensitive");
    assert.strictEqual(outcomeFromPayload('{"status":"completed"}'), "success", "completed must chime success");
    // Claude Code ends an API-error turn with StopFailure instead of Stop.
    assert.strictEqual(
      outcomeFromPayload('{"hook_event_name":"StopFailure","error":"rate_limit"}'), "failure",
      "StopFailure must chime failure"
    );

    // Claude Code and Codex send a Stop payload with no verdict in it. Calling
    // that a failure would invent one the agent never claimed.
    assert.strictEqual(outcomeFromPayload('{"stop_hook_active":false}'), "success", "a payload with no status is a success");
    assert.strictEqual(outcomeFromPayload(""), "success", "no payload at all is a success");
    assert.strictEqual(outcomeFromPayload("not json {"), "success", "malformed input must not throw");

    // A hook that blocks on stdin that never arrives would hang the agent.
    const started = Date.now();
    await new Promise((resolve) => readPayload(resolve, 80));
    assert.ok(Date.now() - started < 2000, "readPayload must give up rather than wait forever");

    console.log("   ✓ Cursor's status reaches the chime; the silent agents still report success.");
  }

  // --- 34d. The cache key is derived from the generators, not declared ---
  console.log("\n\x1b[1m[34d] Cache key tracks the synth sources\x1b[0m");
  {
    const { synthFingerprint, CACHE_DIR } = require("../src/player");
    const pkgVersion = require("../package.json").version;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-fp-"));
    const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);

    write("a.js", "const x = 1;");
    write("b.js", "const y = 2;");
    const base = synthFingerprint(dir);

    assert.strictEqual(synthFingerprint(dir), base, "the same sources must hash the same every time");
    assert.ok(/^[0-9a-f]{8}$/.test(base), `fingerprint must be 8 hex chars, got ${base}`);

    // The whole point: a changed generator must invalidate the cache without
    // anyone remembering to bump a version.
    write("a.js", "const x = 2;");
    assert.notStrictEqual(synthFingerprint(dir), base, "editing a generator must change the key");

    write("a.js", "const x = 1;");
    assert.strictEqual(synthFingerprint(dir), base, "reverting must restore the key, not just move it");

    // A new generator counts too, and a non-generator must not.
    write("c.js", "const z = 3;");
    assert.notStrictEqual(synthFingerprint(dir), base, "adding a generator must change the key");
    fs.rmSync(path.join(dir, "c.js"));
    write("notes.md", "# ignore me");
    assert.strictEqual(synthFingerprint(dir), base, "non-.js files must not affect the key");

    assert.ok(
      path.basename(CACHE_DIR).startsWith(`v${pkgVersion}-`),
      `the cache dir must carry the version and the hash, got ${path.basename(CACHE_DIR)}`
    );

    fs.rmSync(dir, { recursive: true, force: true });
    console.log("   ✓ Editing a generator invalidates the cache on its own.");
  }

  // --- 34e. The mute switch crosses process boundaries ---
  console.log("\n\x1b[1m[34e] Mute survives where an env var cannot\x1b[0m");
  {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-mute-"));
    const run = (args, env = {}) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, ...args], {
          env: { ...process.env, HOME: home, USERPROFILE: home, VIBE_DISABLE: "", ...env },
          stdio: ["ignore", "pipe", "pipe"]
        });
        let out = "";
        child.stdout.on("data", (c) => (out += c));
        child.stderr.on("data", (c) => (out += c));
        child.on("close", (code) => resolve({ code, out }));
      });

    const muted = await run(["--mute"]);
    assert.strictEqual(muted.code, 0, "--mute must exit 0");
    assert.ok(fs.existsSync(path.join(home, ".vibeaudio", "muted")), "--mute must leave a flag a later process can see");

    // The whole point: a hook inherits the agent's environment from launch
    // time, so a variable set afterwards never reaches it. A file does.
    const started = await run(["--hook-start", "--genre", "zen", "--volume", "5"]);
    assert.strictEqual(started.code, 0, "a muted hook-start must still exit cleanly");
    await new Promise((r) => setTimeout(r, 400));
    const pidFile = path.join(home, ".vibeaudio", "daemon.pid");
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
      let alive = true;
      try { process.kill(pid, 0); } catch (e) { alive = false; }
      assert.ok(!alive, "no daemon may survive while muted");
    }

    assert.ok(/Muted/.test((await run(["--status"])).out), "--status must say it is muted");

    // A mute you forget about is worse than no mute, so it expires by default.
    const { setMuted, muteState, DEFAULT_MUTE_MINUTES } = require("../src/player");
    assert.strictEqual(DEFAULT_MUTE_MINUTES, 60, "the default mute must be bounded, not forever");

    const bounded = await run(["--mute", "15"]);
    assert.ok(/15 more minutes/.test(bounded.out), "--mute <n> must report the window it set");
    assert.ok(/music returns on its own/.test(bounded.out), "the user must be told it ends by itself");

    const forever = await run(["--mute", "0"]);
    assert.ok(/indefinitely/.test(forever.out), "--mute 0 must be the explicit opt-in to forever");

    const unmuted = await run(["--unmute"]);
    assert.strictEqual(unmuted.code, 0, "--unmute must exit 0");
    assert.ok(!fs.existsSync(path.join(home, ".vibeaudio", "muted")), "--unmute must clear the flag");

    fs.rmSync(home, { recursive: true, force: true });

    // Expiry must be self-healing: whoever reads it next clears it, so an
    // expired mute can never sit there looking live.
    const own = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-expiry-"));
    const realHome = process.env.HOME;
    try {
      fs.writeFileSync(
        require("../src/player").MUTE_FILE,
        JSON.stringify({ since: new Date().toISOString(), until: Date.now() - 1000 })
      );
      assert.strictEqual(muteState(), null, "an expired mute must read as not muted");
      assert.ok(!fs.existsSync(require("../src/player").MUTE_FILE), "reading an expired mute must delete it");
      assert.ok(muteState() === null, "and stay deleted");
    } finally {
      setMuted(false);
      fs.rmSync(own, { recursive: true, force: true });
      process.env.HOME = realHome;
    }

    console.log("   ✓ Mute crosses process boundaries, and expires itself so it can't be forgotten.");
  }

  // --- 34f. A muted MCP server must not blame the audio stack ---
  console.log("\n\x1b[1m[34f] MCP reports a mute as a mute\x1b[0m");
  {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-mcpmute-"));
    const ask = (env) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, "--mcp"], {
          env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
          stdio: ["pipe", "pipe", "ignore"]
        });
        let out = "";
        child.stdout.on("data", (c) => (out += c));
        child.on("close", () => resolve(out));
        child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
        child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vibe_play","arguments":{"genre":"jazz","volume":5}}}\n');
        child.stdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"vibe_status","arguments":{}}}\n');
        child.stdin.end();
      });

    const pick = (out, wanted) => {
      for (const line of out.split("\n")) {
        let msg;
        try { msg = JSON.parse(line); } catch (e) { continue; }
        if (msg.id === wanted) return msg.result.content[0].text;
      }
      return "";
    };

    const muted = await ask({ VIBE_DISABLE: "1" });
    const playText = pick(muted, 2);
    // start() returns false for three unrelated reasons and the model repeats
    // whatever we say. Blaming the audio stack sends the user debugging afplay.
    assert.ok(/muted/i.test(playText), `vibe_play must name the mute, said: ${playText}`);
    assert.ok(
      !/no supported audio player/i.test(playText),
      "a deliberate mute must never be reported as a missing audio player"
    );
    assert.strictEqual(JSON.parse(pick(muted, 3)).muted, true, "vibe_status must expose the mute");

    fs.rmSync(home, { recursive: true, force: true });
    console.log("   ✓ A muted server says so, instead of blaming the user's sound setup.");
  }

  // --- 35. Sparse piano ---
  console.log("\n\x1b[1m[35] Sparse Piano Generator\x1b[0m");
  {
    const { generatePianoLoop } = require("../src/synth/piano");

    const level = (buf) => {
      let peak = 0, sum = 0, n = 0;
      for (let o = 44; o + 1 < buf.length; o += 2) {
        const v = buf.readInt16LE(o) / 32768;
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
        n++;
      }
      return { peak, rms: Math.sqrt(sum / n) };
    };

    const tiers = [1, 2, 3].map((t) => generatePianoLoop(7.6, t, 4242));

    assert.ok(
      generatePianoLoop(7.6, 2, 4242).equals(tiers[1]),
      "the same seed and tier must render byte-identical audio"
    );
    assert.ok(
      !tiers[0].equals(tiers[1]) && !tiers[1].equals(tiers[2]),
      "each tier must honour its argument - identical files would disable escalation"
    );

    let previous = 0;
    for (let i = 0; i < 3; i++) {
      const { peak, rms } = level(tiers[i]);
      // Volume is applied after this, so a hot render just clips earlier.
      assert.ok(peak < 0.95, `tier ${i + 1} must not clip (peak ${peak.toFixed(3)})`);
      // Level-matched to the rest: measured across 12 seeds this sits at
      // 0.056-0.138, between jazz (0.118 at tier 3) and drone (0.141).
      assert.ok(rms > 0.05 && rms < 0.15, `tier ${i + 1} rms ${rms.toFixed(4)} is off the house level`);
      assert.ok(rms > previous, `tier ${i + 1} must add weight over tier ${i}`);
      previous = rms;
    }

    // The loop is spawned again before the previous one ends, so the ends have
    // to be silent or every repeat clicks.
    const edges = [
      Math.abs(tiers[1].readInt16LE(44)),
      Math.abs(tiers[1].readInt16LE(tiers[1].length - 2))
    ];
    assert.ok(Math.max(...edges) < 32, "loop boundaries must fade to silence");

    console.log("   ✓ Piano is deterministic, escalates, stays level-matched and loops seamlessly.");
  }

  // 36. Regressions from the production review.
  {
    console.log("\n\x1b[1m[36] Production hardening regressions\x1b[0m");

    const { spawn, spawnSync } = require("child_process");
    const fs = require("fs");
    const path = require("path");
    const CLI = path.join(__dirname, "..", "bin", "vibeaudio.js");

    // a. A value flag with no value used to become the command, so the wrapper
    //    reported ENOENT on a program called `--genre`.
    for (const flag of ["--genre", "--volume", "--grace", "--seed", "--tools"]) {
      const r = spawnSync(process.execPath, [CLI, flag], { encoding: "utf8" });
      assert.strictEqual(r.status, 1, `${flag} with no value must exit 1`);
      assert.ok(/needs a value/.test(r.stderr), `${flag} must say what is missing`);
    }

    // b. --mcp was matched anywhere in argv, so it hijacked a wrapped command
    //    that happened to take the same flag.
    const wrapped = parseArgs(["node", "vibe", "npm", "test", "--mcp"]);
    assert.strictEqual(wrapped.mcp, false, "--mcp after the command belongs to the child");
    assert.deepStrictEqual(wrapped.cmdArgs, ["npm", "test", "--mcp"]);
    assert.strictEqual(parseArgs(["node", "vibe", "--mcp"]).mcp, true, "--mcp as a flag still starts the server");

    // b2. `--tools ""` is typed, not absent: it must name an agent, never fall
    //     through to auto-detection and install for every agent on the machine.
    //     HOME is redirected for these: this assertion exists because the bug
    //     installs hooks, so a regression must land in a throwaway directory
    //     rather than in whoever is running the suite.
    const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-home-"));
    for (const value of ["", ",", " , "]) {
      const r = spawnSync(process.execPath, [CLI, "--install-hooks", "--tools", value], {
        encoding: "utf8",
        env: { ...process.env, HOME: sandboxHome, USERPROFILE: sandboxHome }
      });
      assert.strictEqual(r.status, 1, `--tools '${value}' must refuse rather than auto-detect`);
      assert.ok(/named no agent/.test(r.stderr), `--tools '${value}' must say why`);
    }
    assert.deepStrictEqual(fs.readdirSync(sandboxHome), [], "refusing must write nothing at all");
    fs.rmSync(sandboxHome, { recursive: true, force: true });

    // b3. A mistyped flag must name itself, not be spawned as a program -
    //     `vibe --typo npm test` used to report `spawn --typo ENOENT`, an
    //     error about entirely the wrong thing. `--` stays the escape hatch.
    const typo = spawnSync(process.execPath, [CLI, "--typo", "npm", "test"], { encoding: "utf8" });
    assert.strictEqual(typo.status, 1, "an unknown option must exit 1");
    assert.ok(/Unknown option '--typo'/.test(typo.stderr), "and say which option it was");

    const dashed = parseArgs(["node", "vibe", "--grace", "0", "--", "--weird-binary", "-x"]);
    assert.deepStrictEqual(dashed.cmdArgs, ["--weird-binary", "-x"], "-- hands everything after it to the child");
    assert.strictEqual(dashed.grace, 0, "and flags before -- are still ours");

    // A command's own flags, after the command, are untouched.
    const passthrough = parseArgs(["node", "vibe", "npm", "test", "--verbose"]);
    assert.deepStrictEqual(passthrough.cmdArgs, ["npm", "test", "--verbose"]);

    // c. Every MCP request must leave with a response, including malformed
    //    ones - a throw used to leave the client blocked forever.
    const { handleMessage } = require("../src/mcp");
    const { AudioPlayer, AVAILABLE_GENRES } = require("../src/player");
    const idle = new AudioPlayer();
    assert.doesNotThrow(() => handleMessage(idle, { jsonrpc: "2.0", id: 7, method: "tools/call" }));
    const noParams = handleMessage(idle, { jsonrpc: "2.0", id: 7, method: "tools/call" });
    assert.strictEqual(noParams.id, 7, "a request with no params still gets its id back");
    assert.ok(noParams.error, "and an error rather than silence");

    // d. Cache writes are atomic. Several processes generating the same
    //    uncached ~1 MB loop at once must each end up with a whole file: the
    //    header's own byte count has to match what is on disk, which is
    //    exactly what a reader catching a half-written file would fail.
    //    Run concurrently on purpose - sequentially the second one just hits
    //    the cache and proves nothing.
    const seed = 20260912;
    const raceDir = path.join(require("../src/player").CACHE_DIR, `s${seed}`);
    fs.rmSync(raceDir, { recursive: true, force: true });

    const racer =
      `const p=require(${JSON.stringify(path.join(__dirname, "..", "src", "player"))});` +
      `const f=require("fs");const fp=p.getAudioPath("jazz",2,${seed});` +
      // Header data size vs. actual bytes: a torn file disagrees with itself.
      `const b=f.readFileSync(fp);process.stdout.write(JSON.stringify([b.length,b.readUInt32LE(40)+44]));`;

    // Six, not four: detection here is probabilistic - a racer only notices a
    // non-atomic write if it happens to read while one is in flight. Measured
    // at 4 racers it caught a deliberately non-atomic implementation in 9 runs
    // out of 10, so more racers is a cheap way to shrink that last tenth. The
    // leftover-tmp assertion below is the deterministic half of this test.
    const racers = await Promise.all(
      [0, 1, 2, 3, 4, 5].map(
        () =>
          new Promise((resolve, reject) => {
            const proc = spawn(process.execPath, ["-e", racer], { stdio: ["ignore", "pipe", "inherit"] });
            let out = "";
            proc.stdout.on("data", (c) => { out += c; });
            proc.on("error", reject);
            proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`racer exited ${code}`))));
          })
      )
    );

    for (const raw of racers) {
      const [onDisk, declared] = JSON.parse(raw);
      assert.ok(onDisk > 44, "a racer must not read a bare header");
      assert.strictEqual(onDisk, declared, "a racer read a WAV that disagrees with its own header");
      assert.strictEqual(onDisk, JSON.parse(racers[0])[0], "every racer must see the same file");
    }
    assert.strictEqual(
      fs.readdirSync(raceDir).filter((f) => f.endsWith(".tmp")).length, 0,
      "no temp file may be left behind"
    );
    fs.rmSync(raceDir, { recursive: true, force: true });

    // e. An unknown MCP genre falls back to lofi and says so, instead of
    //    reporting a genre nobody implements.
    assert.ok(!AVAILABLE_GENRES.includes("frobnicate"));

    // f. The HUD must not announce a chime that --no-chime suppressed.
    const { TerminalHud } = require("../src/hud");
    const hud = new TerminalHud("lofi");
    const written = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    const wasTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;
    process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
    try {
      hud.start();
      hud.stop({ outcome: "success", code: 0, chimed: false });
    } finally {
      process.stdout.write = realWrite;
      process.stdout.isTTY = wasTTY;
    }
    assert.ok(written.some((w) => /Done in/.test(w)), "the HUD still reports the run");
    assert.ok(!written.some((w) => /chime/i.test(w)), "but claims no chime it did not play");

    console.log("   ✓ Flags, MCP replies, cache writes and the HUD all tell the truth.");
  }

  // 37. The hook backup is the user's pre-VibeAudio config, not our last install.
  {
    console.log("\n\x1b[1m[37] Reinstall must not clobber the backup\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const hooks = require("../src/hooks");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-backup-"));
    const file = path.join(tmp, "settings.json");
    const original = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "someone-elses-hook" }] }] } }, null, 2);
    fs.writeFileSync(file, original);

    hooks.installHooks("jazz", 0.4, file, { id: "claude" });
    hooks.installHooks("zen", 0.25, file, { id: "claude" });

    const backup = JSON.parse(fs.readFileSync(`${file}.vibeaudio.bak`, "utf8"));
    const commands = Object.values(backup.hooks).flat().flatMap((e) => (e.hooks || []).map((h) => h.command));
    assert.deepStrictEqual(commands, ["someone-elses-hook"], "the backup must stay the pre-VibeAudio file");

    // And the live file still has the other tool's hook plus ours.
    const live = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(JSON.stringify(live).includes("someone-elses-hook"), "someone else's hook survives the install");
    assert.strictEqual(hooks.uninstallHooks(file, { id: "claude" }).removed, 9, "uninstall removes only ours");
    assert.ok(JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))).includes("someone-elses-hook"));

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("   ✓ The backup keeps naming the config it claims to be.");
  }

  // 38. The launcher list and the hook targets must not drift apart.
  {
    console.log("\n\x1b[1m[38] Launcher covers every hook target\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const { AI_TOOLS, hookTargetOf, promptInteractive } = require("../src/interactive");
    const { TARGETS } = require("../src/hooks");

    // a. Every id the menu names must be a real target. Grok was a complete
    //    hook target - own file, own events, its own row in the README - that
    //    the menu had no entry for at all.
    for (const tool of AI_TOOLS) {
      assert.doesNotThrow(() => hookTargetOf(tool), `${tool.name} names an unknown hook target`);
    }
    assert.throws(
      () => hookTargetOf({ name: "Bogus", hookTarget: "nope" }),
      /not one of/,
      "a typo'd target id must fail loudly rather than silently offer the wrapper"
    );

    // b. Every hook target must be reachable from the menu, or picking that
    //    agent offers the wrapper and nothing else.
    const menuTargets = AI_TOOLS.map(hookTargetOf).filter(Boolean);
    for (const id of Object.keys(TARGETS)) {
      assert.ok(
        menuTargets.includes(id) || UNLAUNCHABLE_TARGETS.includes(id),
        `hook target '${id}' has no launcher entry — add one, or list it in UNLAUNCHABLE_TARGETS with a reason`
      );
    }

    if (process.platform === "win32") {
      console.log("   ✓ List checks pass (menu drive skipped on Windows).");
    } else {
      // c. Drive the menu as a Grok user and confirm the hooks branch is
      //    offered at all, and that it reports the right target to install for.
      const binDir = sandboxPathWith(["grok"]);
      const realPath = process.env.PATH;
      const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
      const realWrite = process.stdout.write.bind(process.stdout);
      const realLog = console.log;
      process.env.PATH = binDir;
      process.stdout.write = () => true;
      console.log = () => {};

      const drive = (keys) => {
        const queue = [...keys];
        const fake = new (require("events").EventEmitter)();
        Object.assign(fake, { isTTY: true, setRawMode() {}, resume() {}, pause() {}, setEncoding() {} });
        const realOn = fake.on.bind(fake);
        fake.on = (event, fn) => {
          const out = realOn(event, fn);
          if (event === "data" && queue.length) setImmediate(() => fake.emit("data", queue.shift()));
          return out;
        };
        Object.defineProperty(process, "stdin", { value: fake, configurable: true });
      };

      let asked = null;
      try {
        // Grok is the only tool on PATH, so it sorts to position 1.
        // Grok -> hooks -> lofi -> Normal -> Steady
        drive(["1", "1", "1", "1", "1"]);
        const picked = await promptInteractive({
          hooksInstalledFor: (id) => { asked = id; return false; }
        });
        assert.deepStrictEqual(picked.cmd, ["grok"], "Grok must be selectable from the launcher");
        assert.strictEqual(picked.installHooks, true, "Grok must reach the hooks branch");
        assert.strictEqual(picked.hookTarget, "grok", "and install for Grok, not for Claude");
      } finally {
        process.stdout.write = realWrite;
        console.log = realLog;
        process.env.PATH = realPath;
        Object.defineProperty(process, "stdin", realStdin);
        fs.rmSync(binDir, { recursive: true, force: true });
      }

      // d. The "already installed?" question follows the picked tool. It used
      //    to be answered for Claude every time, so a Grok user with Grok
      //    hooks installed was told they had none.
      assert.strictEqual(asked, "grok", "hooksInstalledFor must be asked about the tool that was picked");

      console.log("   ✓ Grok is selectable, reaches hooks, and is asked about as itself.");
    }
  }

  // 39. A hook command has to survive the shell that runs it.
  {
    console.log("\n\x1b[1m[39] Hook commands survive hostile paths\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const { shellQuote, installHooks, uninstallHooks } = require("../src/hooks");

    if (process.platform === "win32") {
      assert.strictEqual(shellQuote("C:\\Program Files\\node.exe"), '"C:\\Program Files\\node.exe"');
      console.log("   ✓ Windows keeps cmd quoting (\" is not legal in a Windows path).");
    } else {
      // Double quotes let the shell rewrite the command: $ and ` expand, and a
      // " ends the quote. All three appear in legal POSIX paths.
      for (const [raw, quoted] of [
        ["/tmp/dollar$dir/x.js", "'/tmp/dollar$dir/x.js'"],
        ['/tmp/q"uote/x.js', `'/tmp/q"uote/x.js'`],
        ["/tmp/back`tick/x.js", "'/tmp/back`tick/x.js'"],
        ["/with space/x.js", "'/with space/x.js'"],
        ["/Users/O'Brien/x.js", "'/Users/O'\\''Brien/x.js'"]
      ]) {
        assert.strictEqual(shellQuote(raw), quoted, `shellQuote mangled ${raw}`);
      }

      // End to end: a real /bin/sh must run the command back and reach our CLI.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-sh-"));
      const file = path.join(dir, "settings.json");
      installHooks("lofi", 0.4, file, { id: "claude" });
      const command = JSON.parse(fs.readFileSync(file, "utf8"))
        .hooks.UserPromptSubmit[0].hooks[0].command;
      const ran = require("child_process").spawnSync("/bin/sh", ["-c", `${command} --version`], { encoding: "utf8" });
      assert.strictEqual(ran.status, 0, `a shell could not run the hook command: ${ran.stderr}`);
      assert.ok(/^\d+\.\d+\.\d+/.test(ran.stdout.trim()), "the hook command must reach our CLI");
      fs.rmSync(dir, { recursive: true, force: true });
      console.log("   ✓ $, backtick, quote and space all survive; a real shell runs the result.");
    }
  }

  // 40. Valid JSON in the wrong shape must name the key, not blame filter().
  {
    console.log("\n\x1b[1m[40] Malformed hook files fail legibly\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const hooks = require("../src/hooks");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-shape-"));
    const cases = [
      [{ hooks: { Stop: { type: "command" } } }, /hooks\.Stop as object, not an array/],
      [{ hooks: [] }, /"hooks" key that is not an object/],
      [[1, 2], /does not contain a JSON object/]
    ];

    for (const [body, expected] of cases) {
      const file = path.join(dir, `${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(file, JSON.stringify(body));
      const before = fs.readFileSync(file, "utf8");
      // Both directions: neither may throw a TypeError from deep inside, and
      // neither may touch a file it could not understand.
      assert.throws(() => hooks.installHooks("lofi", 0.4, file, { id: "claude" }), expected);
      assert.throws(() => hooks.uninstallHooks(file, { id: "claude" }), expected);
      assert.strictEqual(fs.readFileSync(file, "utf8"), before, "a file we refuse must be left alone");
    }

    fs.rmSync(dir, { recursive: true, force: true });
    console.log("   ✓ The error names the offending key, and the file is left untouched.");
  }

  // 41. Invariants CLAUDE.md calls load-bearing that nothing was enforcing.
  //     Found by mutation testing: each assertion below fails against the
  //     specific one-line regression it names.
  {
    console.log("\n\x1b[1m[41] Documented invariants, now enforced\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const CLI = path.join(__dirname, "..", "bin", "vibeaudio.js");

    // a. A hook must not outlive its work. Reading stdin resumes it, and a
    //    resumed stdin holds the event loop open by itself - so without the
    //    pause() in readPayload the hook sits there on EVERY turn until the
    //    agent times it out. Stdin is deliberately left open here: that is
    //    the case that hangs.
    //    Stdin is opened and deliberately never ended - spawnSync's `input`
    //    closes it for you, which makes the `end` event fire and hides the
    //    bug entirely. An agent holds the pipe open; that is the case that
    //    hangs, so it is the case to test.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-hook-"));
    const exitCode = await new Promise((resolve, reject) => {
      const child = require("child_process").spawn(process.execPath, [CLI, "--hook-stop"], {
        stdio: ["pipe", "ignore", "ignore"],
        env: { ...process.env, HOME: home, USERPROFILE: home, VIBE_DISABLE: "1" }
      });
      child.stdin.write('{"status":"completed"}');   // written, never ended
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve("HUNG");
      }, 6000);
      child.on("error", reject);
      child.on("close", (code) => { clearTimeout(timer); resolve(code); });
    });
    assert.notStrictEqual(exitCode, "HUNG", "--hook-stop hung: readPayload left stdin resumed");
    fs.rmSync(home, { recursive: true, force: true });

    // b. The intensity file must not carry one prompt's activity into the
    //    next: hookStart and hookStop both clear it. Both run in a child with
    //    HOME redirected - hookStart spawns a detached daemon, and hookStop
    //    consults every session on record, so in this process either would
    //    operate on the real ~/.vibeaudio: clobbering a live pid, or seeing the
    //    developer's own agent session as "another one still working".
    const startHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-start-"));
    const probe = path.join(startHome, "probe.js");
    fs.writeFileSync(probe, `
      const fs = require("fs"), path = require("path"), os = require("os");
      const file = path.join(os.homedir(), ".vibeaudio", "intensity");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "3");
      const hooks = require(${JSON.stringify(path.join(__dirname, "..", "src", "hooks"))});
      hooks.hookStop({ noChime: true });
      const stopCleared = !fs.existsSync(file);
      fs.writeFileSync(file, "3");
      hooks.hookStart("lofi", 0.4, {});
      console.log(JSON.stringify({ stopCleared, cleared: !fs.existsSync(file) }));
      hooks.stopDaemon();
      process.exit(0);
    `);
    const probeRun = require("child_process").spawnSync(process.execPath, [probe], {
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, HOME: startHome, USERPROFILE: startHome, VIBE_DISABLE: "1" }
    });
    assert.strictEqual(probeRun.status, 0, `intensity probe failed: ${probeRun.stderr}`);
    const probeOut = JSON.parse(probeRun.stdout.trim().split("\n").pop());
    assert.strictEqual(probeOut.stopCleared, true, "hookStop must clear the intensity file");
    assert.strictEqual(
      probeOut.cleared, true,
      "hookStart must clear the intensity file so the last prompt's activity cannot leak in"
    );
    fs.rmSync(startHome, { recursive: true, force: true });

    // c. cleanup() can be reached from the signal path and the close path, so
    //    the HUD's stop must be idempotent - without the guard it prints twice.
    const { TerminalHud } = require("../src/hud");
    const hud = new TerminalHud("lofi");
    const lines = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    const wasTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;
    process.stdout.write = (c) => { lines.push(String(c)); return true; };
    try {
      hud.start();
      hud.stop({ outcome: "success", code: 0, chimed: true });
      hud.stop({ outcome: "success", code: 0, chimed: true });
    } finally {
      process.stdout.write = realWrite;
      process.stdout.isTTY = wasTTY;
    }
    assert.strictEqual(
      lines.filter((l) => /Done in/.test(l)).length, 1,
      "a second hud.stop() must print nothing"
    );

    console.log("   ✓ The hook returns, the intensity file is cleared, the HUD prints once.");
  }

  // 42. The playback path itself, driven through a fake audio backend - so
  //     --no-chime and a genre switch are checked against what was actually
  //     spawned rather than against a return value.
  if (process.platform === "win32") {
    console.log("\n\x1b[1m[42] Playback path\x1b[0m\n   ✓ Skipped on Windows (needs a POSIX executable bit).");
  } else {
    console.log("\n\x1b[1m[42] Playback path, via a fake audio backend\x1b[0m");
    const fs = require("fs");
    const path = require("path");

    // A backend that records what it was asked to play instead of playing it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-play-"));
    const log = path.join(dir, "played.log");
    fs.writeFileSync(path.join(dir, "afplay"), `#!/bin/sh\necho "$@" >> ${log}\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "which"), `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`, { mode: 0o755 });

    // Run in a child: detectPlayer() caches at module scope, so the sandbox
    // PATH has to be in place before player.js is first required.
    const driver = path.join(dir, "drive.js");
    // spawn() is asynchronous, so each step needs a moment to actually reach
    // the backend before the next one tears it down - otherwise the fake is
    // SIGTERMed before it can record anything and the test fails on itself.
    fs.writeFileSync(driver, `
      const { AudioPlayer } = require(${JSON.stringify(path.join(__dirname, "..", "src", "player"))});
      const settle = () => new Promise((r) => setTimeout(r, 400));
      (async () => {
        const p = new AudioPlayer();
        const out = {};
        out.firstStart = p.start("jazz", 0.4);
        await settle();
        out.sameAgain  = p.start("jazz", 0.4);   // identical settings: no restart
        await settle();
        out.switched   = p.start("zen", 0.4);    // different genre: must restart
        await settle();
        out.genre      = p.genre;
        p.stop({ playChime: true, outcome: "success" });
        p.stop({ playChime: false });
        console.log(JSON.stringify(out));
        process.exit(0);
      })();
    `);

    const run = require("child_process").spawnSync(process.execPath, [driver], {
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, PATH: dir, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "" }
    });
    assert.strictEqual(run.status, 0, `driver failed: ${run.stderr}`);
    const out = JSON.parse(run.stdout.trim().split("\n").pop());

    assert.strictEqual(out.firstStart, true, "start() must report that it started");
    assert.strictEqual(out.sameAgain, false, "restarting with identical settings is a no-op");
    assert.strictEqual(out.switched, true, "a genre switch must restart, not be dropped");
    assert.strictEqual(out.genre, "zen", "and the player must be on the new genre");

    const played = fs.readFileSync(log, "utf8");
    assert.ok(/loop_jazz_/.test(played), "the jazz loop must actually reach the backend");
    assert.ok(/loop_zen_/.test(played), "and so must the genre we switched to");
    assert.ok(/chime_success/.test(played), "playChime:true must spawn the chime");

    // --no-chime, the other direction: nothing new may be played.
    fs.writeFileSync(log, "");
    const quiet = path.join(dir, "quiet.js");
    fs.writeFileSync(quiet, `
      const { AudioPlayer } = require(${JSON.stringify(path.join(__dirname, "..", "src", "player"))});
      (async () => {
        const p = new AudioPlayer();
        p.start("jazz", 0.4);
        await new Promise((r) => setTimeout(r, 400));
        p.stop({ playChime: false });
        process.exit(0);
      })();
    `);
    require("child_process").spawnSync(process.execPath, [quiet], {
      timeout: 20000,
      env: { ...process.env, PATH: dir, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "" }
    });
    assert.ok(!/chime/.test(fs.readFileSync(log, "utf8")), "playChime:false must spawn no chime at all");

    // --no-chime is decided in cli.js, not in AudioPlayer, so it only counts
    // if the wrapper itself is driven. Asserting on stop({playChime:false})
    // tests the wrong layer and passes while the flag is ignored.
    const CLI_BIN = path.join(__dirname, "..", "bin", "vibeaudio.js");
    const wrapper = (extra) => {
      fs.writeFileSync(log, "");
      require("child_process").spawnSync(
        process.execPath,
        [CLI_BIN, "--grace", "0", ...extra, process.execPath, "-e", "setTimeout(() => {}, 700)"],
        { timeout: 30000, stdio: "ignore", env: { ...process.env, PATH: dir, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "" } }
      );
      return fs.readFileSync(log, "utf8");
    };

    const withChime = wrapper([]);
    assert.ok(/loop_/.test(withChime), "the wrapper must start music once the grace window passes");
    assert.ok(/chime_success/.test(withChime), "a clean run past the grace window must chime");

    const noChime = wrapper(["--no-chime"]);
    assert.ok(/loop_/.test(noChime), "--no-chime silences the chime, not the music");
    assert.ok(!/chime/.test(noChime), "--no-chime must reach the chime decision in cli.js");

    fs.rmSync(dir, { recursive: true, force: true });
    console.log("   ✓ Loops and chimes reach the backend; a genre switch restarts; --no-chime is honoured end to end.");
  }

  // 43. Nothing pinned the actual audio, so an accidental change to a
  //     generator shipped silently - and the cache key, which hashes
  //     src/synth/, would dutifully deliver it to every user as though it
  //     were intended. One render per genre is enough to notice.
  //
  //     WHEN THIS FAILS AND THE CHANGE WAS DELIBERATE: listen to the genre
  //     first (`node bin/vibeaudio.js --clear-cache && node bin/vibeaudio.js
  //     --preview <genre>`), then paste the new hash in. Updating it without
  //     listening defeats the only check that hears anything at all.
  {
    console.log("\n\x1b[1m[43] Generator output is pinned\x1b[0m");
    const crypto = require("crypto");

    // All three tiers, not just one. Pinning tier 2 alone left every
    // tier-specific regression invisible whenever the broken value happened to
    // equal tier 2's - mutation testing caught exactly that: hard-coding
    // piano's note count to 4 (its tier-2 value) changed nothing at tier 2 and
    // sailed through, while silently flattening tiers 1 and 3.
    const GOLDEN = {
      lofi:         ["c6342ec4f12c", "9468d401ca94", "e017253dfaf0"],
      synthwave:    ["2cffc02140f9", "42eed792d353", "46a7e0526723"],
      "8bit":       ["fa3083b3a8db", "1435a0ec21d0", "ba0dd7225b96"],
      electronic:   ["873f83ea4f3b", "f542bda966bb", "a29af6b5bccd"],
      jazz:         ["fadaf4f52b75", "5cdbd8524d3d", "686fd1208d39"],
      zen:          ["0496cb273359", "2ea4a3da3d8a", "efb72a71fac0"],
      piano:        ["e12477cbde4c", "3e2e18d19203", "27e0f694c35f"],
      drone:        ["80d547b0bf48", "dfba6786efb4", "62c4918e156b"]
    };

    const RENDERERS = {
      lofi: (t) => generateLofiLoop(6.4, t, 1),
      synthwave: (t) => generateSynthwaveLoop(6.8, t, 1),
      "8bit": (t) => generateChiptuneLoop(7.5, t, 1),
      electronic: (t) => generateElectronicLoop(6.4, t, 1),
      jazz: (t) => generateJazzLoop(6.26, t, 1),
      zen: (t) => generateZenLoop(7.2, t, 1),
      piano: (t) => require("../src/synth/piano").generatePianoLoop(7.6, t, 1),
      drone: (t) => require("../src/synth/drone").generateDroneLoop(7.0, t, 1)
    };

    // Every genre the player can produce must be pinned, or a new one slips
    // in with no drift protection at all.
    const { AVAILABLE_GENRES } = require("../src/player");
    assert.deepStrictEqual(
      Object.keys(GOLDEN).sort(), [...AVAILABLE_GENRES].sort(),
      "every genre in AVAILABLE_GENRES needs a golden hash here"
    );

    for (const [genre, render] of Object.entries(RENDERERS)) {
      const hashes = [1, 2, 3].map((t) =>
        crypto.createHash("sha256").update(render(t)).digest("hex").slice(0, 12)
      );
      for (let i = 0; i < 3; i++) {
        assert.strictEqual(
          hashes[i], GOLDEN[genre][i],
          `${genre} tier ${i + 1} renders differently than it used to ` +
          `(${GOLDEN[genre][i]} -> ${hashes[i]}). If you meant to change it, listen to it and ` +
          `update the hash; if you did not, you just found a regression.`
        );
      }
      // A tier that stopped differing is escalation quietly switched off.
      assert.strictEqual(new Set(hashes).size, 3, `${genre} must render three distinct tiers`);
    }

    console.log("   ✓ All 8 genres × 3 tiers render exactly as pinned — audio drift now fails the suite.");
  }

  // 44. The Windows branch of the atomic write, proven on any platform.
  //
  //     Windows rename fails with EPERM when another process holds the
  //     destination open - the exact case the atomic write exists to handle -
  //     so a losing racer must treat "the destination is there" as success
  //     rather than throwing. That branch shipped broken and CI caught it on
  //     one cell out of nine: windows/node20 failed while windows/node18 and
  //     22 passed the same commit on timing luck. A platform-specific path
  //     that only a third of its own CI cells exercise needs a deterministic
  //     test, not a probabilistic one.
  //
  //     renameSync is stubbed to do what Windows does under the race: the
  //     winner's file appears, and our rename fails.
  {
    console.log("\n\x1b[1m[44] A losing racer uses the winner's file\x1b[0m");
    const fs = require("fs");
    const path = require("path");
    const player = require("../src/player");

    const seed = 44004400;
    const dir = path.join(player.CACHE_DIR, `s${seed}`);
    fs.rmSync(dir, { recursive: true, force: true });

    const realRename = fs.renameSync;
    const winner = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(64, 7)]);
    let sawRename = false;

    let produced;
    try {
      fs.renameSync = (from, to) => {
        sawRename = true;
        fs.writeFileSync(to, winner);          // the winner lands first...
        const err = new Error("EPERM: operation not permitted, rename");
        err.code = "EPERM";
        throw err;                              // ...and Windows refuses ours
      };
      produced = player.getAudioPath("jazz", 2, seed);
    } finally {
      fs.renameSync = realRename;
    }

    assert.ok(sawRename, "the stub must actually have been exercised");
    assert.ok(
      fs.readFileSync(produced).equals(winner),
      "the losing racer must hand back the winner's file, not throw"
    );
    assert.strictEqual(
      fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0,
      "and must still clean up its own temp file"
    );

    // The other direction: a rename failure with nothing at the destination is
    // a real error and must not be swallowed.
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.renameSync = () => {
        const err = new Error("ENOSPC: no space left on device");
        err.code = "ENOSPC";
        throw err;
      };
      assert.throws(
        () => player.getAudioPath("jazz", 2, seed + 1),
        /ENOSPC/,
        "a rename failure with no file at the destination must still throw"
      );
    } finally {
      fs.renameSync = realRename;
    }

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(player.CACHE_DIR, `s${seed + 1}`), { recursive: true, force: true });
    console.log("   ✓ EPERM with the file present is success; a real failure still throws.");
  }

  // 45. Blocked on the user: the music must stop saying "working".
  //
  //     Music that plays through a permission dialog tells someone in another
  //     window the agent is busy when it is stuck on them. PermissionRequest
  //     pauses and asks with its own chime; the approved tool's PostToolUse
  //     resumes. Driven through the real CLI and daemon against a fake backend,
  //     because each step's effect is a process or a file another process reads.
  {
    const fs = require("fs");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const hooks = require("../src/hooks");

    console.log("\n\x1b[1m[45] Waiting on the user pauses, asks, and resumes\x1b[0m");

    // Install shape - checkable everywhere.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-wait-"));
    const file = path.join(tmp, "settings.json");
    hooks.installHooks("jazz", 0.3, file, { id: "claude", reactive: true });
    const s = JSON.parse(fs.readFileSync(file, "utf8")).hooks;
    for (const event of ["PermissionRequest", "Elicitation"]) {
      const wait = s[event][0].hooks[0];
      assert.ok(/--hook-wait\b/.test(wait.command), `${event} must run --hook-wait`);
    }
    for (const event of ["PostToolUse", "PostToolUseFailure", "ElicitationResult"]) {
      const resume = s[event][0].hooks[0];
      // A resume respawns the daemon, so it has to carry --reactive - which
      // shapes which hooks exist - while genre and volume come from the config
      // file the respawned process reads for itself.
      assert.ok(/--hook-resume --reactive/.test(resume.command), `${event} must resume in the same mode`);
    }
    // The turns that never reach Stop.
    assert.ok(/--hook-stop\b/.test(s.StopFailure[0].hooks[0].command), "StopFailure must end the turn like Stop");
    assert.ok(/--hook-end\b/.test(s.SessionEnd[0].hooks[0].command), "SessionEnd must run --hook-end");
    for (const id of ["cursor", "grok"]) {
      const ev = hooks.TARGETS[id].events;
      assert.ok(!ev.wait && !ev.failure && !ev.end, `${id} has no verified waiting, failure or session-end event`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });

    if (process.platform === "win32") {
      console.log("   ✓ Install shape checked; daemon flow skipped on Windows (needs a POSIX executable bit).");
    } else {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-waitflow-"));
      const log = path.join(dir, "played.log");
      fs.writeFileSync(log, "");
      // The attention chime "plays" for 2s, so a hook that waits for it shows.
      fs.writeFileSync(path.join(dir, "afplay"), `#!/bin/sh\necho "$@" >> ${log}\ncase "$*" in *chime_attention*) sleep 2;; esac\nexit 0\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(dir, "which"), `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`, { mode: 0o755 });
      // ps must stay reachable: stopDaemon refuses to signal a pid it cannot verify.
      const env = { ...process.env, PATH: `${dir}:/bin:/usr/bin`, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "" };
      const cli = (args, payload = "") =>
        spawnSync(process.execPath, [CLI, ...args], { input: payload, env, timeout: 20000 });
      const state = path.join(dir, ".vibeaudio");
      const pidFile = path.join(state, "daemon.pid");
      const sessionPath = (id) => path.join(state, "sessions", `${id}.json`);
      const waitingFile = sessionPath("anon");
      // What a session is paused on: null while working, and no file once its turn ended.
      const waitingOn = (id = "anon") => (fs.existsSync(sessionPath(id)) ? JSON.parse(fs.readFileSync(sessionPath(id), "utf8")).waiting : undefined);
      const settle = async (what, check) => {
        for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
        assert.ok(check(), what);
      };
      const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
      const bash = JSON.stringify({ tool_name: "Bash" });

      try {
        // Nothing playing: a dialog after the turn ended has nobody to interrupt.
        cli(["--hook-wait"], bash);
        assert.ok(!/chime_attention/.test(fs.readFileSync(log, "utf8")), "no chime when no music was playing");
        assert.strictEqual(waitingOn(), undefined, "and no wait recorded");

        cli(["--hook-start", "--genre", "zen", "--volume", "5"]);
        await settle("the daemon must reach the backend", () => /loop_zen_/.test(fs.readFileSync(log, "utf8")));
        const firstPid = parseInt(fs.readFileSync(pidFile, "utf8"), 10);

        const waitStarted = Date.now();
        cli(["--hook-wait"], bash);
        assert.ok(Date.now() - waitStarted < 1500, "the wait hook must not hold the dialog back for the chime");
        await settle("the dialog must play the attention chime", () => /chime_attention/.test(fs.readFileSync(log, "utf8")));
        assert.ok(!/chime_success/.test(fs.readFileSync(log, "utf8")), "not the done chime");
        assert.ok(!fs.existsSync(pidFile), "the music must stop while waiting");
        await settle("the daemon must actually exit", () => !alive(firstPid));
        assert.strictEqual(waitingOn(), "Bash", "the wait must remember which tool it is for");

        // A different tool finishing (a parallel read) is not the approval.
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], JSON.stringify({ tool_name: "Read" }));
        assert.ok(!fs.existsSync(pidFile), "another tool's PostToolUse must not resume");

        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], bash);
        assert.ok(fs.existsSync(pidFile), "the approved tool's PostToolUse must resume the music");
        assert.strictEqual(waitingOn(), null, "and end the wait");
        const resumedPid = parseInt(fs.readFileSync(pidFile, "utf8"), 10);
        await settle("the resumed daemon must be running", () => alive(resumedPid));

        // Paused, then the turn ends with nothing resumed (a denied tool): it
        // still finished, so it still chimes done.
        cli(["--hook-wait"], bash);
        fs.writeFileSync(log, "");
        cli(["--hook-stop"], "{}");
        assert.ok(/chime_success/.test(fs.readFileSync(log, "utf8")), "a turn ending while paused must still chime done");
        assert.strictEqual(waitingOn(), undefined, "Stop must clear the wait");

        const start = (session) =>
          cli(["--hook-start", "--genre", "zen", "--volume", "5"], JSON.stringify({ session_id: session }));
        const playing = () => fs.existsSync(pidFile);

        // An MCP server asking for input is a wait too, ended by its own result.
        start("s1");
        const elicit = JSON.stringify({ session_id: "s1", hook_event_name: "Elicitation", mcp_server_name: "github" });
        cli(["--hook-wait"], elicit);
        assert.ok(!playing(), "an elicitation must pause the music");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], JSON.stringify({ session_id: "s1", hook_event_name: "ElicitationResult", mcp_server_name: "slack" }));
        assert.ok(!playing(), "another server's result is not the answer");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], JSON.stringify({ session_id: "s1", hook_event_name: "ElicitationResult", mcp_server_name: "github" }));
        assert.ok(playing(), "its ElicitationResult must resume it");

        // Copilot and Gemini announce the dialog as a Notification, among
        // others that are not waits, and name no tool - so any tool resumes.
        start("s1");
        await settle("s1's music must start", () => playing());
        cli(["--hook-wait"], JSON.stringify({ session_id: "s1", hook_event_name: "Notification", notification_type: "idle_prompt" }));
        assert.ok(playing(), "a notification that is not a dialog must not pause");
        cli(["--hook-wait"], JSON.stringify({ session_id: "s1", hook_event_name: "Notification", notification_type: "ToolPermission" }));
        assert.ok(!playing(), "Gemini's ToolPermission notification must pause");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], JSON.stringify({ session_id: "s1", tool_name: "run_shell_command" }));
        assert.ok(playing(), "a wait that named no tool resumes on whichever tool finishes");

        // An API error never reaches Stop; StopFailure is the only end.
        fs.writeFileSync(log, "");
        cli(["--hook-stop"], JSON.stringify({ session_id: "s1", hook_event_name: "StopFailure", error: "rate_limit" }));
        assert.ok(!playing(), "StopFailure must stop the music");
        assert.ok(/chime_failure/.test(fs.readFileSync(log, "utf8")), "and play the failure chime, not success");

        // Esc fires no hook at all - mid-reply nothing, mid-tool a plain
        // PostToolUse (both observed against the real binary). The transcript
        // entry is the only signal, so the daemon watches for it.
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const transcript = path.join(dir, "session.jsonl");
        const userText = (text) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n";
        const INTERRUPT = "[Request interrupted by user]";
        const turnPayload = (extra = {}) => JSON.stringify({ session_id: "s3", transcript_path: transcript, ...extra });
        const startTurn = async () => {
          fs.writeFileSync(log, "");
          cli(["--hook-start", "--genre", "zen", "--volume", "5"], turnPayload());
          await settle("the turn's music must start", () => /loop_zen_/.test(fs.readFileSync(log, "utf8")));
          return parseInt(fs.readFileSync(pidFile, "utf8"), 10);
        };

        // The previous turn ended interrupted: that entry predates this prompt.
        fs.writeFileSync(transcript, userText("earlier prompt") + userText(INTERRUPT));
        const turnPid = await startTurn();
        // Quoting the phrase is not interrupting - this conversation does it.
        fs.appendFileSync(transcript,
          JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: INTERRUPT }] } }) + "\n" +
          JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: INTERRUPT }] } }) + "\n");
        await sleep(1200);
        assert.ok(alive(turnPid), "an old interrupt, or a quote of the phrase, must not stop the music");

        // The entry can arrive split across two polls.
        const entry = userText("[Request interrupted by user for tool use]");
        fs.writeFileSync(log, "");
        fs.appendFileSync(transcript, entry.slice(0, 40));
        await sleep(1200);
        assert.ok(alive(turnPid), "half an entry is not an entry yet");
        fs.appendFileSync(transcript, entry.slice(40));
        await settle("Esc must stop the music", () => !alive(turnPid));
        assert.ok(!playing(), "and the interrupted daemon must clear its pid file");
        assert.ok(!/chime/.test(fs.readFileSync(log, "utf8")), "silently: an interrupt is never reported as done");

        // Esc during an approved tool still fires its PostToolUse. The resumed
        // daemon watches from the prompt, not from its own start, so it sees
        // the interrupt that came first and never plays.
        await startTurn();
        cli(["--hook-wait"], turnPayload({ tool_name: "Bash" }));
        fs.appendFileSync(transcript, userText(INTERRUPT));
        fs.writeFileSync(log, "");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], turnPayload({ tool_name: "Bash" }));
        await sleep(1500);
        assert.ok(!/loop_/.test(fs.readFileSync(log, "utf8")), "an interrupted approved tool must not bring the music back");

        // SessionEnd: only the session that started the music may stop it.
        start("s1");
        await settle("s1's music must start", () => playing());
        cli(["--hook-end"], JSON.stringify({ session_id: "s2", reason: "prompt_input_exit" }));
        assert.ok(playing(), "another session closing must not silence this one");
        cli(["--hook-end"], "{}");
        assert.ok(playing(), "an unidentified session must not stop it either");
        cli(["--hook-end"], JSON.stringify({ session_id: "s1", reason: "prompt_input_exit" }));
        assert.ok(!playing(), "the owning session ending must stop it");

        // Several sessions of one agent share the music: it plays while any of
        // them is working, and each still gets its own chime.
        const sid = (session, extra = {}) => JSON.stringify({ session_id: session, ...extra });
        const goStart = (session) => cli(["--hook-start", "--genre", "zen", "--volume", "5"], sid(session));
        cli(["--stop"]);

        goStart("A");
        await settle("A's music must start", () => playing());
        const aPid = parseInt(fs.readFileSync(pidFile, "utf8"), 10);
        goStart("B");
        assert.strictEqual(parseInt(fs.readFileSync(pidFile, "utf8"), 10), aPid, "a second session's prompt must not restart A's music");

        fs.writeFileSync(log, "");
        cli(["--hook-stop"], sid("B"));
        assert.ok(playing() && alive(aPid), "B finishing must not silence A, which is still working");
        assert.ok(/chime_success/.test(fs.readFileSync(log, "utf8")), "but B still gets its own done chime");

        cli(["--hook-wait"], sid("C", { tool_name: "Bash" }));
        assert.ok(playing(), "a session with no turn on record cannot pause the music");

        fs.writeFileSync(log, "");
        cli(["--hook-stop"], sid("A"));
        assert.ok(!playing(), "the last working session ending must stop the music");
        assert.ok(/chime_success/.test(fs.readFileSync(log, "utf8")), "with A's chime");
        await settle("the daemon must exit", () => !alive(aPid));

        // More sessions working, more of the same piece: tier 2 at the next loop
        // boundary once a second one starts, back down as it finishes.
        const waitFor = async (what, check, ms = 12000) => {
          for (let i = 0; i < ms / 100 && !check(); i++) await sleep(100);
          assert.ok(check(), what);
        };
        const logged = () => fs.readFileSync(log, "utf8");
        fs.writeFileSync(log, "");
        goStart("A");
        await waitFor("one session plays tier 1", () => /loop_zen_t1/.test(logged()));
        assert.ok(!/loop_zen_t[23]/.test(logged()), "a lone session stays at its time-based tier");
        goStart("B");
        await waitFor("a second working session raises the tier", () => /loop_zen_t2/.test(logged()));
        cli(["--hook-stop"], sid("B"));
        cli(["--hook-stop"], sid("A"));
        await settle("the daemon must stop", () => !playing());

        // A dialog pauses the music only when nobody else is working.
        goStart("A");
        goStart("B");
        cli(["--hook-wait"], sid("A", { tool_name: "Bash" }));
        assert.ok(playing(), "A's dialog must not pause the music while B works");
        assert.strictEqual(waitingOn("A"), "Bash");
        cli(["--hook-wait"], sid("B", { tool_name: "Read" }));
        assert.ok(!playing(), "every session waiting pauses it");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], sid("A", { tool_name: "Read" }));
        assert.ok(!playing(), "another session's tool finishing is not A's approval");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], sid("A", { tool_name: "Bash" }));
        assert.ok(playing(), "A's own approval resumes the music");
        cli(["--hook-end"], sid("A"));
        assert.ok(!playing(), "A closing leaves only B, which is waiting, so it stops");
        assert.strictEqual(waitingOn("B"), "Read", "and B's wait survives");

        // Esc in one session ends only that session's turn.
        const tA = path.join(dir, "a.jsonl");
        const tB = path.join(dir, "b.jsonl");
        fs.writeFileSync(tA, "");
        fs.writeFileSync(tB, "");
        cli(["--stop"]);
        cli(["--hook-start", "--genre", "zen", "--volume", "5"], sid("A", { transcript_path: tA }));
        cli(["--hook-start", "--genre", "zen", "--volume", "5"], sid("B", { transcript_path: tB }));
        await settle("the music must start", () => playing());
        const bothPid = parseInt(fs.readFileSync(pidFile, "utf8"), 10);
        fs.appendFileSync(tB, userText(INTERRUPT));
        await settle("B's Esc must end B's turn", () => waitingOn("B") === undefined);
        await sleep(800);
        assert.ok(alive(bothPid) && playing(), "A is still working, so the music carries on");
        fs.appendFileSync(tA, userText(INTERRUPT));
        await settle("A's Esc must end the music", () => !alive(bothPid));
        assert.ok(!playing(), "with both interrupted nothing is left to play");
      } finally {
        cli(["--stop"]);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      console.log("   ✓ Dialogs and elicitations pause and resume; API errors, Esc (via the transcript) and session end stop the music; several sessions share it and each keeps its own chime.");
    }
  }

  // 46. Gemini CLI, Copilot CLI and Qwen Code in their own dialects; a dry run
  //     that writes nothing; and /vibe, which must never touch a user's file.
  {
    const fs = require("fs");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const hooks = require("../src/hooks");
    console.log("\n\x1b[1m[46] Gemini, Copilot and Qwen hooks; --dry-run; /vibe\x1b[0m");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-agents-"));
    try {
      // Gemini keeps settings (not events) inside `hooks`; they must survive,
      // and must not be mistaken for a malformed event list.
      const gemini = path.join(dir, "gemini.json");
      fs.writeFileSync(gemini, JSON.stringify({ theme: "dark", hooks: { enabled: true, AfterTool: [{ hooks: [{ type: "command", command: "other-tool" }] }] } }));
      hooks.installHooks("zen", 0.3, gemini, { id: "gemini", reactive: true });
      const g = JSON.parse(fs.readFileSync(gemini, "utf8"));
      for (const event of ["BeforeAgent", "AfterAgent", "BeforeTool", "Notification", "AfterTool", "SessionEnd"]) {
        assert.ok(g.hooks[event], `gemini must write ${event}`);
      }
      const gEntry = g.hooks.BeforeAgent[0].hooks[0];
      assert.strictEqual(gEntry.timeout, 5000, "Gemini timeouts are milliseconds");
      assert.strictEqual(g.hooks.enabled, true, "Gemini's hooks.enabled setting must survive the install");
      assert.strictEqual(g.hooks.AfterTool[0].hooks[0].command, "other-tool", "another tool's AfterTool hook stays first");
      assert.strictEqual(hooks.uninstallHooks(gemini, { id: "gemini" }).removed, 6, "gemini: all six of ours removed");
      const gAfter = JSON.parse(fs.readFileSync(gemini, "utf8"));
      assert.deepStrictEqual(gAfter, { theme: "dark", hooks: { enabled: true, AfterTool: [{ hooks: [{ type: "command", command: "other-tool" }] }] } },
        "gemini: uninstall must leave exactly the user's settings behind");

      // Copilot: a file of our own, schema version, flat entries, PascalCase
      // events (which select the Claude-compatible payloads).
      const copilot = path.join(dir, "copilot", "hooks", "vibeaudio.json");
      hooks.installHooks("zen", 0.3, copilot, { id: "copilot" });
      const c = JSON.parse(fs.readFileSync(copilot, "utf8"));
      assert.deepStrictEqual(Object.keys(c).sort(), ["hooks", "version"], "copilot: root is version + hooks");
      assert.strictEqual(c.version, 1);
      assert.deepStrictEqual(Object.keys(c.hooks).sort(),
        ["Notification", "PostToolUse", "PostToolUseFailure", "SessionEnd", "Stop", "UserPromptSubmit"],
        "copilot: its verified events, and no PermissionRequest - that one fires without a prompt");
      assert.strictEqual(c.hooks.Stop[0].timeoutSec, 5, "copilot entries are flat, with timeoutSec");
      assert.strictEqual(hooks.uninstallHooks(copilot, { id: "copilot" }).removed, 6);
      assert.ok(!fs.existsSync(copilot), "copilot: uninstall deletes our file");

      const qwen = path.join(dir, "qwen.json");
      hooks.installHooks("zen", 0.3, qwen, { id: "qwen" });
      const q = JSON.parse(fs.readFileSync(qwen, "utf8"));
      for (const event of ["UserPromptSubmit", "Stop", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "StopFailure", "SessionEnd"]) {
        assert.ok(q.hooks[event], `qwen must write ${event}`);
      }
      assert.strictEqual(q.hooks.Stop[0].hooks[0].timeout, 5000, "Qwen timeouts are milliseconds");
      assert.strictEqual(hooks.uninstallHooks(qwen, { id: "qwen" }).removed, 7);

      // Dry run: the result is computed, nothing is written - not the file,
      // not its directory, not a backup.
      const existing = path.join(dir, "existing.json");
      const original = JSON.stringify({ model: "opus" });
      fs.writeFileSync(existing, original);
      const plan = hooks.installHooks("jazz", 0.4, existing, { id: "claude", dryRun: true });
      assert.strictEqual(fs.readFileSync(existing, "utf8"), original, "a dry run must not modify the file");
      assert.ok(!fs.existsSync(`${existing}.vibeaudio.bak`), "a dry run must not write a backup");
      assert.ok(plan.backup, "but it must say one would be written");
      assert.ok(JSON.parse(plan.after).hooks.UserPromptSubmit, "and return what would be written");
      const fresh = path.join(dir, "not-yet", "settings.json");
      hooks.installHooks("jazz", 0.4, fresh, { id: "claude", dryRun: true });
      assert.ok(!fs.existsSync(path.dirname(fresh)), "a dry run must not create directories");

      // End to end, through the flag, against a disposable HOME.
      const home = path.join(dir, "home");
      fs.mkdirSync(home);
      const run = spawnSync(process.execPath, [CLI, "--install-hooks", "--tools", "claude", "--dry-run"],
        { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8", timeout: 20000 });
      assert.strictEqual(run.status, 0, `--dry-run failed: ${run.stderr}`);
      assert.ok(/Dry run/.test(run.stdout) && /\+ add\s+\x1b\[0m UserPromptSubmit/.test(run.stdout), "--dry-run must list what it would add");
      assert.deepStrictEqual(fs.readdirSync(home), [], "--dry-run must leave HOME untouched, /vibe included");

      // /vibe: ours is replaced and removed; a user's own vibe.md is neither.
      const slash = path.join(dir, "commands", "vibe.md");
      assert.strictEqual(hooks.installSlashCommand({ file: slash }).installed, true);
      const text = fs.readFileSync(slash, "utf8");
      assert.ok(text.startsWith("---\n") && /--mute/.test(text) && text.includes(path.join(__dirname, "..", "bin", "vibeaudio.js")),
        "/vibe must be a command file that runs this CLI");
      assert.strictEqual(hooks.uninstallSlashCommand({ file: slash }), true);
      assert.ok(!fs.existsSync(slash));
      fs.writeFileSync(slash, "my own vibe command");
      assert.strictEqual(hooks.installSlashCommand({ file: slash }).installed, false, "a user's vibe.md must not be overwritten");
      assert.strictEqual(hooks.uninstallSlashCommand({ file: slash }), false, "nor deleted");
      assert.strictEqual(fs.readFileSync(slash, "utf8"), "my own vibe command");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log("   ✓ Three more dialects merge and uninstall cleanly; --dry-run writes nothing; /vibe spares a user's own file.");
  }

  // 47. Saved settings are the single source of truth
  {
    console.log("\n\x1b[1m[47] One place to set the genre\x1b[0m");
    const { spawnSync } = require("child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-config-"));
    try {
      const home = path.join(dir, "home");
      fs.mkdirSync(home);
      const configFile = path.join(home, ".vibeaudio", "config.json");
      // A child process, never process.env.HOME in this suite: player.js
      // resolves CONFIG_FILE from os.homedir() at require time, so an
      // in-process override would write to whoever is running the tests.
      const vibe = (args) => spawnSync(process.execPath, [CLI, ...args],
        { env: { ...process.env, HOME: home, USERPROFILE: home, VIBE_GENRE: "", VIBE_VOLUME: "" }, encoding: "utf8", timeout: 20000 });

      // Settings with no command to run are a request to change the default,
      // not to open the launcher - which is what used to happen.
      const saved = vibe(["--genre", "jazz", "--volume", "25"]);
      assert.strictEqual(saved.status, 0, `saving defaults failed: ${saved.stderr}`);
      assert.ok(/Saved: genre jazz, volume 25%/.test(saved.stdout), "a bare setting flag must save and say so");
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")), { genre: "jazz", volume: 25 });

      // Read back by the next process - this is what reaches an installed hook.
      const status = vibe(["--status"]);
      assert.ok(/genre\s+\x1b\[32mjazz/.test(status.stdout), "--status must report the saved genre");
      assert.ok(/volume\s+\x1b\[32m25%/.test(status.stdout), "--status must report the saved volume");

      // An export still wins: the file sits below the environment, as the
      // wrapper's users have always had it.
      const overridden = spawnSync(process.execPath, [CLI, "--status"],
        { env: { ...process.env, HOME: home, USERPROFILE: home, VIBE_GENRE: "zen" }, encoding: "utf8", timeout: 20000 });
      assert.ok(/genre\s+\x1b\[32mzen/.test(overridden.stdout), "VIBE_GENRE must beat the saved file");

      // Installing writes the settings it just reported, and pins nothing.
      const installed = vibe(["--genre", "piano", "--volume", "35", "--install-hooks", "--tools", "claude"]);
      assert.strictEqual(installed.status, 0, `install failed: ${installed.stderr}`);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "piano");
      const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
      for (const entries of Object.values(settings.hooks)) {
        for (const entry of entries) {
          for (const h of entry.hooks) {
            assert.ok(!/--genre|--volume/.test(h.command), `a hook must not pin settings: ${h.command}`);
          }
        }
      }

      // The whole point: changing it afterwards edits nothing in the agent's
      // config, and the installed hooks still pick it up.
      const before = fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8");
      vibe(["--genre", "drone"]);
      assert.strictEqual(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"), before,
        "a genre change must not touch the agent's settings file");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "drone");

      // A typo must not overwrite the default the user already had - the run
      // path still falls back to lofi, but a save refuses and changes nothing.
      const typo = vibe(["--genre", "nonsens"]);
      assert.strictEqual(typo.status, 1, "an unknown genre with nothing to run must fail");
      assert.ok(/nothing saved/.test(typo.stderr), "and must say it saved nothing");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "drone", "the saved genre must survive a typo");
      const typoRun = vibe(["--genre", "nonsens", process.execPath, "-e", "0"]);
      assert.strictEqual(typoRun.status, 0, "a typo must not take down a wrapped command");
      assert.ok(/falling back to lofi/.test(typoRun.stderr), "the run path still falls back");

      // --here saves for one directory and, crucially, for the subdirectories an
      // agent is actually launched from - an exact-match lookup would make the
      // setting vanish one `cd` deeper.
      const proj = path.join(dir, "repo");
      const deep = path.join(proj, "src", "inner");
      fs.mkdirSync(deep, { recursive: true });
      const inDir = (cwd, args) => spawnSync(process.execPath, [CLI, ...args],
        { cwd, env: { ...process.env, HOME: home, USERPROFILE: home, VIBE_GENRE: "", VIBE_VOLUME: "" }, encoding: "utf8", timeout: 20000 });

      assert.strictEqual(inDir(proj, ["--genre", "zen", "--here"]).status, 0);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).projects[fs.realpathSync(proj)], { genre: "zen" });
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "drone", "--here must leave the global default alone");
      assert.ok(/genre\s+\x1b\[32mzen/.test(inDir(deep, ["--status"]).stdout), "a subdirectory must inherit its project's genre");
      assert.ok(/genre\s+\x1b\[32mdrone/.test(vibe(["--status"]).stdout), "elsewhere still gets the global default");

      // Migrating off an older install must not change what is playing. Those
      // entries pin the settings the user has actually been hearing, while the
      // config file may hold nothing but a default they never chose - so an
      // untyped reinstall inherits from the entries it replaces. Reported live
      // as "installed lofi @ 40%" over somebody's synthwave, which is the one
      // moment a migration must not be silent.
      const claudeSettings = path.join(home, ".claude", "settings.json");
      const pinned = JSON.parse(fs.readFileSync(claudeSettings, "utf8"));
      for (const entries of Object.values(pinned.hooks)) {
        for (const entry of entries) {
          for (const h of entry.hooks) {
            if (/--hook-start|--hook-resume/.test(h.command)) h.command += " --genre synthwave --volume 25";
          }
        }
      }
      fs.writeFileSync(claudeSettings, JSON.stringify(pinned, null, 2));
      // The migration case is a user who never saved anything: the pin is the
      // only record of what they have been hearing.
      fs.rmSync(configFile, { force: true });

      const migrated = vibe(["--install-hooks", "--tools", "claude"]);
      assert.strictEqual(migrated.status, 0, `migration install failed: ${migrated.stderr}`);
      assert.ok(/Keeping your current genre synthwave and volume 25%/.test(migrated.stdout), "a migration must say what it kept");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "synthwave", "the pinned genre must survive the migration");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).volume, 25, "and the pinned volume with it");

      // Naming one still means naming it, and a saved setting is not a gap:
      // once synthwave is on record, the same pin must stop being consulted.
      fs.writeFileSync(claudeSettings, JSON.stringify(pinned, null, 2));
      assert.strictEqual(vibe(["--genre", "piano", "--install-hooks", "--tools", "claude"]).status, 0);
      const afterTyped = JSON.parse(fs.readFileSync(configFile, "utf8"));
      assert.strictEqual(afterTyped.genre, "piano", "an explicit genre must beat the pin");
      assert.strictEqual(afterTyped.volume, 25, "and the volume saved by the migration stands");

      // The bug this guards: four legacy installs agreeing on lofi must not
      // outvote the genre the user chose a minute ago.
      vibe(["--genre", "synthwave", "--volume", "25"]);
      const wouldOverride = vibe(["--install-hooks", "--tools", "claude"]);
      assert.ok(!/Keeping your current/.test(wouldOverride.stdout), "a pin must not override a saved setting");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "synthwave");

      // Two agents pinned to different genres have no single answer, and the
      // saved config is one value for the machine: inheriting whichever was
      // found first would let an untouched install for some other tool
      // overwrite the genre the user actually chose.
      const codexHooks = path.join(home, ".codex", "hooks.json");
      fs.mkdirSync(path.dirname(codexHooks), { recursive: true });
      fs.writeFileSync(codexHooks, JSON.stringify({
        hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node vibeaudio.js --hook-start --genre 8bit --volume 90" }] }] }
      }, null, 2));
      fs.writeFileSync(claudeSettings, JSON.stringify(pinned, null, 2));
      vibe(["--genre", "zen", "--volume", "55"]);
      const disagreeing = vibe(["--install-hooks", "--tools", "claude,codex"]);
      assert.strictEqual(disagreeing.status, 0, `install failed: ${disagreeing.stderr}`);
      assert.ok(!/Keeping your current/.test(disagreeing.stdout), "disagreeing pins must not be inherited");
      const afterDisagree = JSON.parse(fs.readFileSync(configFile, "utf8"));
      assert.strictEqual(afterDisagree.genre, "zen", "the user's own setting must survive disagreeing pins");
      assert.strictEqual(afterDisagree.volume, 55);

      // A command after the flags is still a command, not a save.
      vibe(["--genre", "drone"]);
      const wrapped = vibe(["--genre", "zen", process.execPath, "-e", "0"]);
      assert.strictEqual(wrapped.status, 0);
      assert.ok(!/Saved:/.test(wrapped.stdout), "flags before a command must not be saved");
      assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).genre, "drone", "and must not change the file");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log("   ✓ One file decides the genre; --here scopes it to a project tree; flags and exports still win; installed hooks follow it without a reinstall.");
  }

  // 48. Auditioning a genre from the menu
  if (process.platform === "win32") {
    console.log("\n\x1b[1m[48] Menu audition\x1b[0m\n   ✓ Skipped on Windows (needs a POSIX executable bit).");
  } else {
    console.log("\n\x1b[1m[48] Menu audition\x1b[0m");
    const { spawnSync } = require("child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-audition-"));
    try {
      // A fake backend that reports its own death. Counting live processes
      // with `ps` looked simpler and was wrong twice over: it is system-wide,
      // so this machine's real afplay - actual music, playing for reasons
      // that have nothing to do with the test - was counted too, and the
      // `ps | grep` pipeline matches its own command line. Asking the process
      // that gets killed to say so needs neither.
      const log = path.join(dir, "played.log");
      fs.writeFileSync(path.join(dir, "afplay"),
        `#!/bin/sh\ntrap 'echo "killed $*" >> ${log}; exit 0' TERM\necho "start $*" >> ${log}\nsleep 5 & wait\n`,
        { mode: 0o755 });
      fs.writeFileSync(path.join(dir, "which"), `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`, { mode: 0o755 });

      const home = path.join(dir, "home");
      fs.mkdirSync(home);
      const driver = path.join(dir, "drive.js");
      fs.writeFileSync(driver, `
        const { playPreview, stopPreview } = require(${JSON.stringify(path.join(__dirname, "..", "src", "interactive"))});
        const settle = () => new Promise((r) => setTimeout(r, 500));
        (async () => {
          playPreview("jazz");
          await settle();
          // A second press has to silence the first: one pair of speakers.
          playPreview("zen");
          await settle();
          stopPreview();
          await settle();
        })();
      `);

      // A pinned seed keeps this out of any real project's cache directory,
      // which pruneSeedDirs() would otherwise evict to make room for it.
      const SEED = "909090";
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, HOME: home, USERPROFILE: home, VIBE_DISABLE: "", VIBE_SEED: SEED };
      const out = spawnSync(process.execPath, [driver], { encoding: "utf8", env, timeout: 40000 });
      assert.strictEqual(out.status, 0, `audition driver failed: ${out.stderr}`);
      const played = fs.readFileSync(log, "utf8").trim().split("\n");

      const at = (re) => played.findIndex((l) => re.test(l));
      const startedJazz = at(/^start .*loop_jazz_t2/);
      const startedZen = at(/^start .*loop_zen_t2/);
      const killedJazz = at(/^killed .*loop_jazz_t2/);
      const killedZen = at(/^killed .*loop_zen_t2/);

      assert.ok(startedJazz === 0, `first press must play jazz, got ${played[0]}`);
      assert.ok(startedZen > startedJazz, `second press must play zen, got ${played.join(" | ")}`);
      // One pair of speakers: the second press has to silence the first, and
      // it has to happen before the second starts, not eventually.
      assert.ok(killedJazz > startedJazz && killedJazz < startedZen,
        `a second audition must stop the first, got ${played.join(" | ")}`);
      assert.ok(killedZen > startedZen, "leaving the menu must stop the audition");

      // A mute set for a call outranks a keypress, the same as it outranks a
      // hook: the point of --mute is that nothing surprises you mid-call.
      const muted = spawnSync(process.execPath, ["-e", `
        const { playPreview } = require(${JSON.stringify(path.join(__dirname, "..", "src", "interactive"))});
        playPreview("lofi");
      `], { encoding: "utf8", env: { ...env, VIBE_DISABLE: "1" }, timeout: 20000 });
      assert.strictEqual(muted.status, 0);
      const starts = fs.readFileSync(log, "utf8").trim().split("\n").filter((l) => l.startsWith("start"));
      assert.strictEqual(starts.length, 2, "a mute must keep the audition silent");
    } finally {
      // The whole sandbox, cache included: HOME points inside it, so nothing
      // here can evict the cache of a project the user actually works in.
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log("   ✓ p auditions the highlighted genre, replaces the last one, stops on exit, and honours a mute.");
  }

  // 49. Plucked notes start and end at zero
  {
    console.log("\n\x1b[1m[49] No click at a note onset\x1b[0m");
    const { pluckEnv } = require("../src/synth/generator");
    const step = 0.2727;

    // The bug this replaced: a bare Math.exp(-tNote * decay) is 1.0 the instant
    // tNote wraps to zero, so every note onset stepped the waveform - measured
    // at 0.13 full-scale in synthwave's bass, 3.7 times a second, and reported
    // as static that appeared when the music intensified (those layers only
    // exist from tier 2 up).
    assert.strictEqual(pluckEnv(0, step, 8.0), 0, "a note must start from silence");
    assert.strictEqual(pluckEnv(step, step, 8.0), 0, "and end at silence, so the next one cannot step");
    assert.ok(pluckEnv(0.01, step, 8.0) > 0.9, "but reach full level within ~10ms, or it stops being a pluck");
    assert.ok(pluckEnv(0.15, step, 8.0) < pluckEnv(0.05, step, 8.0), "and still decay in between");

    // Continuity end to end: no single step across a whole note may be large.
    let worst = 0;
    for (let i = 1; i <= 2000; i++) {
      const a = pluckEnv(((i - 1) / 2000) * step, step, 8.0);
      const b = pluckEnv((i / 2000) * step, step, 8.0);
      worst = Math.max(worst, Math.abs(b - a));
    }
    assert.ok(worst < 0.05, `envelope must be continuous, worst step was ${worst.toFixed(4)}`);

    // And the rendered result, since an envelope is only half the story - a
    // voice can reintroduce a click by resetting something else per note.
    // Thresholds are per genre because a waveform may legitimately have edges:
    // 8bit is pulse-based and drone is a noise bed, so both are excluded rather
    // than given a number that would only ever be wrong.
    const { generateLoop } = require("../src/player");
    const LIMITS = { synthwave: 0.08, electronic: 0.12, lofi: 0.06, jazz: 0.07, zen: 0.05, piano: 0.06 };
    for (const [genre, limit] of Object.entries(LIMITS)) {
      for (const tier of [1, 2, 3]) {
        const wav = generateLoop(genre, tier, 42);
        let prev = null, biggest = 0;
        // 16-bit stereo frames start at byte 44; left channel only.
        for (let off = 44; off + 4 <= wav.length; off += 4) {
          const v = wav.readInt16LE(off) / 32768;
          if (prev !== null) biggest = Math.max(biggest, Math.abs(v - prev));
          prev = v;
        }
        assert.ok(biggest <= limit,
          `${genre} tier ${tier} jumps ${biggest.toFixed(4)} in one sample (limit ${limit}) — a click at a note onset`);
      }
    }
    console.log("   ✓ Envelopes open and close at zero; no genre steps discontinuously at a note boundary.");
  }

  console.log("\n\x1b[32mAll 49 tests passed successfully!\x1b[0m");
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err.message}`);
  process.exit(1);
});
