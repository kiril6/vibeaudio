const { path, assert, fs, os, CLI, TEST_DIR } = require("../helpers");

(async () => {
  // [71] MCP: the project comes from the client (#43).
  console.log("\n\x1b[1m[71] MCP seeds from the client's project: project_dir, roots, per-project settings\x1b[0m");
  {
    const { spawnSync, spawn } = require("child_process");
    const mcp = require("../../src/mcp");
    const { projectSeed } = require("../../src/player");
    const abs = (p) => path.resolve(path.sep, p);
    const A = abs("work/alpha");
    const B = abs("work/beta");

    // What counts as a project path: a plain absolute path, nothing else.
    assert.strictEqual(mcp.cleanProjectDir(`${A}${path.sep}`), A, "a trailing separator is normalised, so it matches the saved key");
    for (const bad of [undefined, null, 7, {}, "", "   ", "relative/dir", "a\0b", abs("x".repeat(2000))]) {
      assert.strictEqual(mcp.cleanProjectDir(bad), null, `${JSON.stringify(bad)} must not become a project`);
    }
    const uri = (p) => require("url").pathToFileURL(p).href;
    assert.deepStrictEqual(mcp.rootDirs([{ uri: uri(A) }, { uri: "https://example.com/x" }, { uri: "file://%zz" }, { name: "no uri" }, null, { uri: uri(abs("with space/dir")) }]),
      [A, abs("with space/dir")], "file roots only; remote, malformed and empty ones are skipped, percent-encoding is decoded");
    assert.deepStrictEqual(mcp.rootDirs("not a list"), []);

    // The protocol: ask for roots only a client that declared them, after
    // initialized and again on a change; a reply is not answered.
    const sent = [];
    const session = mcp.newSession((m) => sent.push(m));
    const player = { isPlaying: false, started: [], start(g, v, o) { this.started.push({ g, v, ...o }); return true; }, stop() {} };
    mcp.handleMessage(player, { id: 1, method: "initialize", params: { capabilities: {} } }, session);
    mcp.handleMessage(player, { method: "notifications/initialized" }, session);
    assert.strictEqual(sent.length, 0, "a client that did not declare roots is never asked for them");
    const roots = mcp.newSession((m) => sent.push(m));
    mcp.handleMessage(player, { id: 1, method: "initialize", params: { capabilities: { roots: { listChanged: true } } } }, roots);
    assert.strictEqual(sent.length, 0, "nothing is sent before the client has acknowledged");
    mcp.handleMessage(player, { method: "notifications/initialized" }, roots);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].method, "roots/list");
    assert.ok(typeof sent[0].id === "string" && sent[0].id.startsWith("vibeaudio-"), "our own id space, so a reply cannot be mistaken for the client's request");
    const strayReply = mcp.handleMessage(player, { jsonrpc: "2.0", id: 99, result: {} }, roots);
    assert.strictEqual(strayReply, null, "a response is never answered with 'method not found'");
    assert.strictEqual(mcp.handleMessage(player, { jsonrpc: "2.0", id: sent[0].id, result: { roots: [{ uri: uri(A) }, { uri: uri(B) }] } }, roots), null);
    assert.deepStrictEqual(roots.roots, [A, B]);
    mcp.handleMessage(player, { method: "notifications/roots/list_changed" }, roots);
    assert.strictEqual(sent.length, 2, "a change asks again");
    mcp.handleMessage(player, { jsonrpc: "2.0", id: sent[1].id, result: { roots: [] } }, roots);
    assert.deepStrictEqual(roots.roots, [], "and an emptied list clears it");
    mcp.handleMessage(player, { jsonrpc: "2.0", id: sent[1].id, result: { roots: [{ uri: uri(B) }] } }, roots);
    assert.deepStrictEqual(roots.roots, [], "a reply is taken once: the same id again is not a roots list");

    // Which source wins, and what reaches start().
    const play = (args, sess) => { player.started.length = 0; mcp.handleMessage(player, { id: 5, method: "tools/call", params: { name: "vibe_play", arguments: args } }, sess); return player.started[0]; };
    const withRoots = mcp.newSession(); withRoots.roots = [A, B];
    delete process.env.VIBE_SEED;
    assert.strictEqual(play({}, null).project, null, "no session and no argument keeps today's behaviour: the server's cwd");
    assert.strictEqual(play({}, withRoots).project, A, "the client's first root");
    assert.strictEqual(play({ project_dir: B }, withRoots).project, B, "an explicit project_dir outranks roots");
    assert.strictEqual(play({ project_dir: "relative" }, withRoots).project, A, "an invalid project_dir is ignored, not trusted");
    assert.strictEqual(play({ project_dir: 7 }, null).project, null, "a non-string project_dir is ignored");
    const props = mcp.TOOLS.find((t) => t.name === "vibe_play").inputSchema.properties;
    assert.ok(props.project_dir && /omit/i.test(props.project_dir.description), "the argument says it may be omitted");
    assert.ok(!(mcp.TOOLS.find((t) => t.name === "vibe_play").inputSchema.required || []).includes("project_dir"), "and is not required");

    // Per-project settings and the seed, in a child with its own HOME.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-mcp-project-"));
    try {
      fs.mkdirSync(path.join(home, ".vibeaudio"), { recursive: true });
      fs.writeFileSync(path.join(home, ".vibeaudio", "config.json"), JSON.stringify({
        genre: "zen", volume: 30,
        projects: { [A]: { genre: "jazz", volume: 70 }, [B]: { music: "off" } }
      }));
      const env = { ...process.env, HOME: home, USERPROFILE: home };
      delete env.VIBE_SEED; delete env.VIBE_GENRE; delete env.VIBE_VOLUME; delete env.VIBE_MUSIC;
      const child = (code, extra = {}) => {
        const r = spawnSync(process.execPath, ["-e", code], { env: { ...env, ...extra }, encoding: "utf8", timeout: 30000, killSignal: "SIGKILL" });
        assert.strictEqual(r.status, 0, r.stderr);
        return JSON.parse(r.stdout);
      };
      const driver = `
        const mcp = require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "mcp.js"))});
        const calls = [];
        const player = { isPlaying: false, start(g, v, o) { calls.push({ g, v, project: o.project }); return true; }, stop() {} };
        const ask = (args) => { const r = mcp.handleMessage(player, { id: 1, method: "tools/call", params: { name: "vibe_play", arguments: args } }, null); return r.result.content[0].text; };
        const out = {
          a: ask({ project_dir: ${JSON.stringify(A)} }), b: ask({ project_dir: ${JSON.stringify(B)} }),
          c: ask({}), d: ask({ project_dir: ${JSON.stringify(A)}, genre: "rain", volume: 20 }), calls
        };
        console.log(JSON.stringify(out));`;
      const out = child(driver);
      assert.strictEqual(out.calls[0].g, "jazz", "a genre saved with --here for A applies to an MCP play for A");
      assert.strictEqual(out.calls[0].v, 0.7, "and so does its volume");
      assert.ok(/nothing will play/.test(out.b) && out.calls.length === 3, "B saved music off: that applies too, and starts nothing");
      assert.strictEqual(out.calls[1].g, "zen", "a project with nothing saved gets the global default");
      assert.strictEqual(out.calls[1].v, 0.3);
      assert.strictEqual(out.calls[2].g, "rain", "what the model asked for still outranks the project's setting");
      assert.strictEqual(out.calls[2].v, 0.2);
      const envWins = child(driver, { VIBE_GENRE: "piano" });
      assert.strictEqual(envWins.calls[0].g, "piano", "an exported VIBE_GENRE still outranks a saved project setting");

      // The seed reaches the player, and a different project restarts it.
      if (process.platform !== "win32") {
        fs.writeFileSync(path.join(home, "afplay"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        fs.writeFileSync(path.join(home, "which"), `#!/bin/sh\n[ -x "${home}/$1" ] && echo "${home}/$1" || exit 1\n`, { mode: 0o755 });
        const seeds = child(`
          const { AudioPlayer, projectSeed } = require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "player.js"))});
          const p = new AudioPlayer();
          const r = {};
          r.first = p.start("zen", 0.3, { project: ${JSON.stringify(A)} });
          r.seedA = p.seed; r.expectA = projectSeed(${JSON.stringify(A)});
          r.same = p.start("zen", 0.3, { project: ${JSON.stringify(A)} });
          r.other = p.start("zen", 0.3, { project: ${JSON.stringify(B)} });
          r.seedB = p.seed; r.expectB = projectSeed(${JSON.stringify(B)});
          r.none = p.start("zen", 0.3);
          r.seedNone = p.seed; r.expectNone = projectSeed(process.cwd());
          p.stop({ playChime: false });
          console.log(JSON.stringify(r));`, { PATH: `${home}:/bin:/usr/bin`, VIBE_NO_FADE: "1", VIBE_DISABLE: "" });
        assert.strictEqual(seeds.first, true);
        assert.strictEqual(seeds.seedA, seeds.expectA, "the project's seed, not the server's cwd");
        assert.strictEqual(seeds.same, false, "the same project, genre and volume is not a restart");
        assert.strictEqual(seeds.other, true, "a different project restarts, or the first one's arrangement would play on");
        assert.strictEqual(seeds.seedB, seeds.expectB);
        assert.notStrictEqual(seeds.seedA, seeds.seedB, "two workspaces, two arrangements");
        assert.strictEqual(seeds.seedNone, seeds.expectNone, "no project: the cwd, as before");
        assert.strictEqual(child(`console.log(JSON.stringify(new (require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "player.js"))}).AudioPlayer)().start("zen", 0.3, { project: ${JSON.stringify(A)} }) ))`, { PATH: `${home}:/bin:/usr/bin`, VIBE_NO_FADE: "1", VIBE_SEED: "1234", VIBE_DISABLE: "1" }), false);
        const pinned = child(`console.log(JSON.stringify(require(${JSON.stringify(path.join(TEST_DIR, "..", "src", "player.js"))}).projectSeed(${JSON.stringify(A)})))`, { VIBE_SEED: "1234" });
        assert.strictEqual(pinned, 1234, "VIBE_SEED still wins over a project");
      }

      // End to end over stdio: a client that answers roots/list.
      const server = spawn(process.execPath, [CLI, "--mcp"], { env: { ...env, VIBE_DISABLE: "1" }, stdio: ["pipe", "pipe", "ignore"] });
      const lines = [];
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
      const send = (m) => server.stdin.write(JSON.stringify(m) + "\n");
      const waitLine = async (what, pred) => { for (let i = 0; i < 100; i++) { const hit = lines.find(pred); if (hit) return hit; await new Promise((r) => setTimeout(r, 50)); } throw new Error(`no ${what} from the MCP server`); };
      try {
        send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: { roots: {} }, clientInfo: { name: "test", version: "0" } } });
        await waitLine("initialize result", (m) => m.id === 1);
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        const ask = await waitLine("roots/list request", (m) => m.method === "roots/list");
        send({ jsonrpc: "2.0", id: ask.id, result: { roots: [{ uri: uri(A), name: "alpha" }] } });
        send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vibe_status", arguments: {} } });
        const status = JSON.parse((await waitLine("status", (m) => m.id === 2)).result.content[0].text);
        assert.strictEqual(status.project, A, "vibe_status names the project the client reported");
        assert.strictEqual(status.projectSource, "roots");
        assert.ok(!lines.some((m) => m.error), "no error was sent to the client for its own reply");
      } finally {
        server.kill("SIGKILL");
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    console.log("   ✓ project_dir and roots choose the project; its saved settings and seed apply; a new project restarts; the roots exchange works over stdio.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
