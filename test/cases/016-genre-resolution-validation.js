const { assert, TEST_DIR, resolveGenre, isKnownGenre, AVAILABLE_GENRES, CACHE_DIR } = require("../helpers");

(async () => {
// 16. Genre Aliases, Validation & Random Resolution
console.log("16. Testing Genre Resolution & Validation...");

const genreAliases = {
  lofi: ["lo-fi", "lofi-hiphop", "chill", "chillhop", "study"],
  "8bit": ["chiptune", "chip", "nes", "gameboy", "retro"],
  synthwave: ["retrowave", "outrun", "80s"],
  electronic: ["downtempo", "techno", "edm"],
  jazz: ["bossa", "swing", "lounge"],
  zen: ["ambient", "calm", "meditation"],
  drone: ["noise", "focus", "hum", "whitenoise", "white-noise"],
  piano: ["sparse", "satie", "keys", "minimal"],
  rain: ["storm", "drizzle"],
  ocean: ["waves", "sea", "surf"],
  fireplace: ["fire", "hearth", "campfire"],
  wind: ["breeze"],
  stream: ["creek", "river"],
  house: ["deep-house"],
  dubtechno: ["dub", "dub-techno"],
  musicbox: ["music-box"],
  rainpiano: ["rain-and-piano", "rain-piano"]
};
for (const [canonical, aliases] of Object.entries(genreAliases)) {
  for (const alias of aliases) {
    assert.strictEqual(resolveGenre(alias), canonical, `${alias} must resolve to ${canonical}`);
    assert.strictEqual(isKnownGenre(alias), true, `${alias} must be accepted as a known genre`);
  }
}
assert.strictEqual(resolveGenre("BOSSA"), "jazz", "genre matching is case-insensitive");
assert.ok(AVAILABLE_GENRES.includes(resolveGenre("random")), "random must resolve to a real genre");
assert.strictEqual(isKnownGenre("nonsense"), false, "unknown genres must be rejected");
assert.strictEqual(isKnownGenre("zen"), true);
console.log("   ✓ Genre aliases, casing, random resolution and validation behave correctly.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
