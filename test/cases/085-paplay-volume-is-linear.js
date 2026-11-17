const { assert } = require("../helpers");
const { detectPlayer } = require("../../src/player");

(async () => {
  console.log("\n\x1b[1m[85] paplay volume is linear\x1b[0m");
  // [85] PulseAudio cubes --volume, so paplay must get the cube root of the
  // 0-1 volume (#6). Measured in a container: without it 15% was ~100x quieter than aplay.
  const dir = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "vibe-pa-"));
  try {
    if (process.platform === "win32") return console.log("   - skipped on Windows (no PATH scan of fake binary)");
    require("fs").writeFileSync(require("path").join(dir, "paplay"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const old = process.env.PATH;
    process.env.PATH = dir;
    const p = detectPlayer();
    process.env.PATH = old;
    assert.strictEqual(p.cmd, "paplay");
    const amp = (v) => (Number(p.args("f", v)[0].split("=")[1]) / 65536) ** 3;
    for (const v of [0.15, 0.4, 0.75, 1]) assert.ok(Math.abs(amp(v) - v) < 0.002, `volume ${v} -> amplitude ${amp(v)}`);
    assert.strictEqual(p.args("f", 0)[0], "--volume=0");
    console.log("   ✓ paplay amplitude equals the requested volume at 15/40/75/100%.");
  } finally {
    require("fs").rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
