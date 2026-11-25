const { tieredGenerators, assert, TEST_DIR } = require("../helpers");

(async () => {
// 22. Seeded Arrangements: deterministic per project, varied across projects
console.log("22. Testing Seeded Arrangement Variation...");
const { projectSeed } = require("../../src/player");

for (const [name, generate] of Object.entries(tieredGenerators)) {
  assert.ok(
    generate(3.0, 2, 1234).equals(generate(3.0, 2, 1234)),
    `${name}: the same seed must always render identical audio`
  );

  // Across seeds the arrangements must actually spread out. "More than one
  // distinct" was the check here, and synthwave and 8bit passed it with three
  // arrangements for every project on earth (#4). 20 of 24 leaves room for a
  // chance collision in a finite space; three variants alone give 3.
  const renders = Array.from({ length: 24 }, (_, s) => generate(3.0, 2, s + 1).toString("base64"));
  const distinct = new Set(renders).size;
  assert.ok(distinct >= 20, `${name}: 24 seeds gave only ${distinct} distinct arrangements`);

  // Tier 1 too, which lofi, electronic and jazz collapsed to 3 because every
  // ornament they had sat behind a tier gate. Full-length loops, since some of
  // what varies at tier 1 (a later chord's voicing) lands after 3 s. Lower
  // floor: tier 1 has fewer layers, so fewer combinations to land on.
  const { generateLoop } = require("../../src/player");
  const firstTier = Array.from({ length: 24 }, (_, s) => generateLoop(name, 1, s + 1).toString("base64"));
  const distinctFirst = new Set(firstTier).size;
  assert.ok(distinctFirst >= 16, `${name}: 24 seeds gave only ${distinctFirst} distinct tier-1 arrangements`);
}
console.log("   ✓ Seeds are deterministic per project and varied across projects.");

assert.strictEqual(projectSeed("/a/repo"), projectSeed("/a/repo"), "a project's seed must be stable");
assert.notStrictEqual(projectSeed("/a/repo"), projectSeed("/b/repo"), "different projects must differ");

process.env.VIBE_SEED = "4242";
assert.strictEqual(projectSeed("/a/repo"), 4242, "VIBE_SEED must override the directory-derived seed");
delete process.env.VIBE_SEED;
console.log("   ✓ Project seeds are stable, distinct per directory and overridable.");


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
