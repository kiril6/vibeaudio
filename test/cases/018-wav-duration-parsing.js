const { os, generateZenLoop, assert, TEST_DIR, path, fs } = require("../helpers");

(async () => {
// 18. WAV Duration Parsing (drives gapless loop scheduling)
console.log("18. Testing WAV Duration Parsing...");
const { wavDurationMs } = require("../../src/player");


const tmpWav = path.join(os.tmpdir(), `vibeaudio-test-${process.pid}.wav`);
fs.writeFileSync(tmpWav, generateZenLoop(2.0, 2));
const measured = wavDurationMs(tmpWav);
fs.unlinkSync(tmpWav);
assert.ok(Math.abs(measured - 2000) < 50, `2s loop should measure ~2000ms, got ${measured}`);
console.log(`   ✓ WAV duration parsed as ${Math.round(measured)}ms for a 2s loop.`);


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
