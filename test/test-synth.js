/**
 * Automated Verification Tests for VibeAudio
 */

const assert = require("assert");
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

console.log("\n\x1b[32mAll 12 tests passed successfully!\x1b[0m");
