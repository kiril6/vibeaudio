const { fs, path, os, assert } = require("../helpers");
const { PcmStream } = require("../../src/pcm-stream");
const { createWavBuffer } = require("../../src/synth/generator");

async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

(async () => {
  console.log("\n\x1b[1m[86] PcmStream: fade-in, live volume, crossfade join, stop\x1b[0m");
  // [86] The Linux streaming path (#16) against a fake backend that records its stdin, so it
  // runs everywhere. Fails if the gain ramp, the overlap join or the kill is dropped.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pcm-"));
  const out = path.join(dir, "got.raw");
  const dumper = `process.stdin.pipe(require("fs").createWriteStream(${JSON.stringify(out)}));`;
  const backend = { cmd: process.execPath, stream: () => ["-e", dumper] };
  let low = 0;
  let dead = 0;
  const stream = new PcmStream(backend, { volume: 0.5, overlapMs: 100, onLow: () => low++, onDead: () => dead++ });
  const FRAME = 4; // 16-bit stereo
  const size = () => (fs.existsSync(out) ? fs.statSync(out).size : 0);
  const wav = () => {
    const dc = new Float32Array(44100).fill(0.25);
    return createWavBuffer({ left: dc, right: dc });
  };
  try {
    assert.ok(stream.append(wav()), "first bar accepted");
    const bar = 44100 - 4410; // One second less the held-back overlap.
    await until(() => size() >= bar * FRAME, "first bar written");
    assert.ok(low >= 1, "asks for the next bar once less than the lead is queued");

    stream.setVolume(1);
    assert.ok(stream.append(wav()), "second bar accepted");
    await until(() => size() >= 2 * bar * FRAME, "second bar written");
    await new Promise((r) => setTimeout(r, 150)); // Nothing more may arrive: the tail is held.
    assert.strictEqual(size(), 2 * bar * FRAME, "the last overlap is held for the next bar, not played");

    const raw = fs.readFileSync(out);
    const at = (frame) => raw.readInt16LE(frame * FRAME);
    const full = 0.25 * 32767;
    assert.strictEqual(at(0), 0, "starts from silence");
    assert.ok(Math.abs(at(Math.round(0.6 * 44100)) - full * 0.5) < full * 0.02, "reaches the volume after the 0.5 s fade-in");
    assert.ok(Math.abs(at(bar + 10) - 0.5 * 32767 * 0.5) < 32767 * 0.02, "the bars overlap-add through the join (twice a bar alone)");
    assert.ok(Math.abs(at(2 * bar - 1) - full) < full * 0.02, "a volume change ramps to its target");

    stream.kill();
    await until(() => stream.proc === null, "kill");
    assert.strictEqual(dead, 0, "a deliberate kill is not a dead player");
    console.log("   ✓ PcmStream fades in, ramps volume live, joins bars by overlap and stops on kill.");
  } finally {
    stream.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${e && e.message ? e.message : e}`);
  process.exit(1);
});
