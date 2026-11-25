const { assert } = require("../helpers");

(async () => {
  // [90] No genre renders louder than the ones heard clean.
  //
  // synthwave, zen and piano sat at up to 1.6x jazz's RMS (0.188, 0.185 and
  // 0.145 against 0.121) with peaks well under full scale, and all three were
  // heard as static: sustained loud pads and bowls overload
  // the speaker, not the file. The same files at `afplay -v 0.65` (0.83 for
  // piano) were clean, so each got that trim (piano 0.80, to clear 24
  // seeds). The ceiling is the loudest of the genres nobody heard static in
  // (jazz tier 3, 0.121) plus a little room.
  // Melodic genres only: drone and rain are broadband noise beds (0.150 and
  // 0.141) and no static was reported in them; noise is not a sustained tone
  // pushing a speaker cone, so this ceiling says nothing about them.
  {
    console.log("\n\x1b[1m[90] Genres share one loudness ceiling\x1b[0m");
    const { generateLoop, SHUFFLE_GENRES } = require("../../src/player");
    const CEILING = 0.125;

    for (const genre of SHUFFLE_GENRES) {
      let loudest = 0;
      let where = "";
      for (const seed of [1, 7, 42]) {
        for (const tier of [1, 2, 3]) {
          for (const bar of [0, 1, 2]) {
            const wav = generateLoop(genre, tier, seed, bar);
            let sum = 0;
            let n = 0;
            for (let off = 44; off + 2 <= wav.length; off += 2) {
              const v = wav.readInt16LE(off) / 32768;
              sum += v * v;
              n++;
            }
            const rms = Math.sqrt(sum / n);
            if (rms > loudest) {
              loudest = rms;
              where = `seed ${seed} tier ${tier} bar ${bar}`;
            }
          }
        }
      }
      assert.ok(loudest <= CEILING, `${genre} renders at RMS ${loudest.toFixed(3)} (${where}), over the ${CEILING} ceiling`);
    }
    console.log("   ✓ Every melodic genre stays at or under the loudness the clean ones play at.");
  }
})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
