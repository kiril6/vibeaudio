const { assert, path, fs, TEST_DIR } = require("../helpers");

(async () => {
  // 27. Volume must work on backends that cannot attenuate
  // aplay and PowerShell's SoundPlayer take no volume argument, so --volume
  // used to be silently ignored there. The gain is baked into the PCM instead.
  console.log("27. Testing Baked Gain For Volume-less Backends...");
  const { bakedGain, applyGain, getAudioPath: audioPath } = require("../../src/player");

  assert.strictEqual(bakedGain({ volume: true }, 0.25), 1, "a backend with volume support attenuates itself");
  assert.strictEqual(bakedGain({ volume: false }, 0.25), 0.25, "a backend without it gets a pre-scaled file");
  assert.strictEqual(bakedGain(null, 0.25), 1, "no backend at all must not try to bake");
  assert.strictEqual(bakedGain({ volume: false }, 0.001), 0.05, "gain is floored, never silent by accident");

  // --preview must use the same baked-gain path as normal playback on
  // backends such as PowerShell SoundPlayer that have no volume argument.
  // Test the observable file choice rather than the implementation text.
  const { previewAudioFile } = require("../../src/cli");
  const previousVibeSeed = process.env.VIBE_SEED;
  const previewSeed = 424242027;
  process.env.VIBE_SEED = String(previewSeed);
  const previewDir = path.join(require("../../src/player").CACHE_DIR, `s${previewSeed}`);

  try {
    assert.ok(
      /loop_lofi_t2_g15\.wav$/.test(
        previewAudioFile("lofi", 0.15, { volume: false })
      ),
      "--preview must bake 15% gain on a volume-less backend"
    );

    assert.ok(
      /loop_lofi_t2_g75\.wav$/.test(
        previewAudioFile("lofi", 0.75, { volume: false })
      ),
      "--preview must bake the requested gain rather than a fixed preview gain"
    );

    assert.ok(
      /loop_lofi_t2\.wav$/.test(
        previewAudioFile("lofi", 0.15, { volume: true })
      ),
      "--preview must leave audio unscaled when the backend controls volume"
    );
  } finally {
    fs.rmSync(previewDir, { recursive: true, force: true });

    if (previousVibeSeed === undefined) {
      delete process.env.VIBE_SEED;
    } else {
      process.env.VIBE_SEED = previousVibeSeed;
    }
  }

  // Seed dirs land in the real ~/.vibeaudio/cache, and pruneSeedDirs keeps
  // only the three most recent - so a test that leaves one behind can evict
  // the cache of a project the user actually works in. Clean up after.
  const gainSeed = 42;
  const gainDir = path.join(require("../../src/player").CACHE_DIR, `s${gainSeed}`);

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


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
