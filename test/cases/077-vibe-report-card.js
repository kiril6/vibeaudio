const { path, assert, fs, os, parseArgs, TEST_DIR } = require("../helpers");

(async () => {
  // [77] vibe --report --card: the report as a postable image, totals only.
  {
    console.log("\n\x1b[1m[77] vibe --report --card\x1b[0m");
    const { spawnSync: run } = require("child_process");
    const { renderCard, writeCard } = require("../../src/card");
    const { summarize, formatDuration } = require("../../src/history");
    const cli = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const now = Date.now();
    const turns = [
      { at: now - 3600e3, project: "/secret/client-api", ms: 600000, blockedMs: 120000, outcome: "success" },
      { at: now - 7200e3, project: "/secret/client-api", ms: 300000, blockedMs: 0, outcome: "failure" },
      { at: now - 3 * 86400e3, project: "/oss/hidden-name", ms: 60000, blockedMs: 0, outcome: "success" }
    ];

    // The card says what --report says: both read summarize().
    const svg = renderCard(turns, 7, now);
    const s = summarize(turns);
    assert.ok(svg.includes(formatDuration(s.waited)), "the headline is the report's 'You waited'");
    assert.ok(svg.includes(`>${turns.length}</text>`) && svg.includes(formatDuration(s.longest.ms)), "turn count and longest turn are on the card");
    assert.ok(!/secret|client-api|hidden-name|\/oss/.test(svg), "a card is made to be shared: no project name or path may appear on it");
    const { TARGETS } = require("../../src/hooks");
    for (const t of Object.values(TARGETS)) assert.ok(svg.includes(`>${t.name}</text>`), `the card names ${t.name}, read from TARGETS so it cannot go stale`);
    assert.ok(svg.startsWith("<svg") && svg.includes("kiril6.github.io/vibeaudio") && svg.includes("npm i -g vibeaudio &amp;&amp; vibe --install-hooks"), "a self-contained SVG that says where it is from: the site and the install line");

    // The bars cover at most 14 days, so a longer window must say so rather than let the headline imply otherwise.
    assert.ok(!svg.includes("bars: last"), "a 7-day card needs no footnote");
    assert.ok(renderCard(turns, 30, now).includes("bars: last 14 days"), "a 30-day card says its bars cover 14 days");
    assert.ok(/>(Mon|Tue|Wed|Thu|Fri|Sat|Sun)</.test(svg), "bars carry unambiguous day names, not initials");

    // One fixed file, replaced each run: nothing accumulates.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-card-test-"));
    try {
      const first = writeCard(turns, 7, { now, dir });
      const second = writeCard(turns.slice(0, 1), 7, { now, dir });
      assert.strictEqual(first.svgPath, second.svgPath, "the same path every run");
      assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => !/^card\.(svg|png)$/.test(f)), [], "no temp or dated leftovers");
      assert.ok(fs.readFileSync(second.svgPath, "utf8").includes(">1</text>"), "the second run replaced the first card");
      if (process.platform === "darwin" && second.pngPath) {
        assert.strictEqual(fs.readFileSync(second.pngPath).subarray(1, 4).toString(), "PNG", "macOS also writes a real PNG");
      }
      const custom = writeCard(turns, 7, { now, dir, out: path.join(dir, "mine.png") });
      assert.strictEqual(custom.svgPath, path.join(dir, "mine.svg"), "--out sets the base name, whatever extension it was given");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // End to end under a throwaway HOME, through the real flag.
    const cHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-card-home-"));
    fs.mkdirSync(path.join(cHome, ".vibeaudio"), { recursive: true });
    const env = { ...process.env, HOME: cHome, USERPROFILE: cHome, VIBE_DISABLE: "1", VIBE_NO_UPDATE_CHECK: "1" };
    const card = (args) => run(process.execPath, [cli, ...args], { encoding: "utf8", env });
    try {
      assert.ok(/nothing to draw yet/.test(card(["--report", "--card"]).stdout), "no history: says so and draws nothing");
      assert.ok(!fs.existsSync(path.join(cHome, ".vibeaudio", "card.svg")), "no card from an empty log");
      fs.writeFileSync(path.join(cHome, ".vibeaudio", "history.jsonl"), turns.map((t) => JSON.stringify(t)).join("\n") + "\n");
      const made = card(["--report", "--card"]);
      assert.strictEqual(made.status, 0);
      assert.ok(fs.existsSync(path.join(cHome, ".vibeaudio", "card.svg")), "the card lands in ~/.vibeaudio");
      assert.ok(!/secret|client-api/.test(made.stdout), "the terminal output names no project either");
      assert.strictEqual(card(["--card"]).status, 0, "--card alone means the 7-day report");
      const bad = card(["--out", path.join(cHome, "x.png")]);
      assert.strictEqual(bad.status, 1, "--out without --card is an error");
      const withCmd = card(["--card", process.execPath, "-e", "0"]);
      assert.strictEqual(withCmd.status, 1, "a command after --card is an error, not a silent drop");
    } finally {
      fs.rmSync(cHome, { recursive: true, force: true });
    }
    assert.strictEqual(parseArgs(["node", "vibe", "--report", "30", "--card"]).card, true);
    assert.strictEqual(parseArgs(["node", "vibe", "--card", "--out", "x.png"]).cardOut, "x.png");
    console.log("   ✓ The card carries the report's numbers and no project name, is replaced rather than accumulated, and is only written locally.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
