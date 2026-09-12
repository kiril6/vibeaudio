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

// 17. Cache Is Version-Scoped
// Regression: an unversioned cache meant synth changes never reached upgraders.
console.log("17. Testing Versioned Audio Cache...");
assert.ok(CACHE_DIR.endsWith(`v${require("../package.json").version}`), "cache dir must be keyed by package version");
console.log(`   ✓ Cache is scoped to v${require("../package.json").version}.`);

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
assert.ok(/--genre zen/.test(afterInstall.hooks.UserPromptSubmit[0].hooks[0].command), "reinstall must update settings");

const { removed } = uninstallHooks(hookSettings);
const afterUninstall = JSON.parse(fs.readFileSync(hookSettings, "utf8"));
fs.unlinkSync(hookSettings);
assert.strictEqual(removed, 2, "both hooks must be removed");
assert.deepStrictEqual(afterUninstall.hooks.Stop, [foreignHook], "uninstall must leave foreign hooks untouched");
assert.strictEqual(afterUninstall.hooks.UserPromptSubmit, undefined, "emptied events must be dropped");
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
assert.strictEqual(hooksAlreadyCover(["gemini"], coverFile), false, "a tool without hooks keeps the wrapper");

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

  const fullPath = audioPath("jazz", 2, 42, 1);
  const quietPath = audioPath("jazz", 2, 42, 0.25);
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
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-bin-"));
    fs.writeFileSync(path.join(binDir, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
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
    const withHooks = await promptInteractive({ hooksInstalled: false });
    assert.deepStrictEqual(withHooks.cmd, ["claude"], "first entry must be the one installed tool");
    assert.strictEqual(withHooks.installHooks, true, "the hooks branch must report itself");
    assert.strictEqual(withHooks.reactive, true, "reactive must be selectable from the menu");
    assert.strictEqual(withHooks.genre, "lofi");
    assert.strictEqual(withHooks.volume, 0.4);
    assert.strictEqual(hooksRun.pending(), 0, "the hooks branch asks all five questions");

    // Claude Code -> this session only -> lofi -> Normal, and no reactive step
    const wrapperRun = drive(["1", "2", "1", "1", "2"]);
    const withWrapper = await promptInteractive({ hooksInstalled: false });
    assert.strictEqual(withWrapper.installHooks, false, "the wrapper branch must not install");
    assert.strictEqual(withWrapper.reactive, false, "reactive is meaningless without hooks");
    assert.strictEqual(wrapperRun.pending(), 1, "the wrapper branch must not ask the reactive question");

    // With hooks installed, option 1 launches without asking anything else:
    // a genre and volume the hooks ignore must not be collected at all.
    const installedRun = drive(["1", "1", "1", "1", "1"]);
    const withInstalled = await promptInteractive({ hooksInstalled: true });
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
      assert.strictEqual(removed, 3, `${id}: uninstall must remove all three of our hooks`);
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
    assert.strictEqual(await runTool({ nothing: true }), "2", "an unrecognised payload falls back to the middle");

    fs.rmSync(home, { recursive: true, force: true });
    console.log("   ✓ Both tool-name spellings reach the tier map.");
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

  console.log("\n\x1b[32mAll 35 tests passed successfully!\x1b[0m");
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err.message}`);
  process.exit(1);
});
