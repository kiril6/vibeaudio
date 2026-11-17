const { assert, path, TEST_DIR } = require("../helpers");

(async () => {
  // [74] vibe --dashboard: local, read-only, live (#36).
  console.log("\n\x1b[1m[74] vibe --dashboard\x1b[0m");
  {
    const http = require("http");
    const { spawn } = require("child_process");
    const hooks = require("../../src/hooks");
    const { startDashboard } = require("../../src/dashboard");
    const server = await startDashboard({ port: 0 });
    const port = server.address().port;
    const get = (urlPath, { host = `127.0.0.1:${port}`, method = "GET" } = {}) =>
      new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers: { Host: host } }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on("error", reject);
        req.end();
      });
    try {
      assert.strictEqual(server.address().address, "127.0.0.1", "bound to localhost only, never 0.0.0.0");

      const page = await get("/");
      assert.strictEqual(page.status, 200);
      assert.ok(/VibeAudio/.test(page.body) && !/https?:\/\/(?!127\.0\.0\.1)/.test(page.body.replace(/<!doctype[^>]*>/i, "")), "one self-contained page, no external assets");
      assert.ok(/script-src 'sha256-/.test(page.headers["content-security-policy"]) && !page.headers["access-control-allow-origin"], "a CSP naming the one script, and no CORS");
      const hash = require("crypto").createHash("sha256").update(page.body.match(/<script>([\s\S]*)<\/script>/)[1]).digest("base64");
      assert.ok(page.headers["content-security-policy"].includes(`'sha256-${hash}'`), "the CSP hash matches the script actually served");

      // DNS rebinding: the right address with the wrong name, and the wrong port, are refused.
      assert.strictEqual((await get("/", { host: "evil.example" })).status, 403, "a foreign Host is refused");
      assert.strictEqual((await get("/", { host: `evil.example:${port}` })).status, 403);
      assert.strictEqual((await get("/", { host: "127.0.0.1:1" })).status, 403, "so is another port");
      assert.strictEqual((await get("/events", { host: "evil.example" })).status, 403, "the stream is guarded too");
      assert.strictEqual((await get("/", { host: `localhost:${port}` })).status, 200, "localhost is our own name");

      // Read-only.
      assert.strictEqual((await get("/", { method: "POST" })).status, 405);
      assert.strictEqual((await get("/events", { method: "DELETE" })).status, 405);
      assert.strictEqual((await get("/nope")).status, 404);

      // The stream: the current state first, then an event written after connecting.
      hooks.emitEvent("started", "old", "/work/old");
      const got = [];
      const stream = await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/events", headers: { Host: `127.0.0.1:${port}` } }, (res) => {
          assert.strictEqual(res.headers["content-type"], "text/event-stream");
          res.setEncoding("utf8");
          let buf = "";
          res.on("data", (c) => {
            buf += c;
            const parts = buf.split("\n\n");
            buf = parts.pop();
            for (const p of parts) if (p.startsWith("event:")) got.push({ name: p.match(/^event: (.*)/)[1], data: JSON.parse(p.match(/data: (.*)/)[1]) });
          });
          resolve(req);
        });
        req.on("error", reject);
        req.end();
      });
      const waitFor = async (what, ok) => {
        for (let t = 0; t < 100 && !ok(); t++) await new Promise((r) => setTimeout(r, 50));
        assert.ok(ok(), what);
      };
      await waitFor("the backlog and current state arrive on connect", () => got.some((m) => m.name === "backlog") && got.some((m) => m.name === "state"));
      assert.ok(got.find((m) => m.name === "backlog").data.some((e) => e.session === "old"), "recent events are replayed");
      hooks.emitEvent("waiting", "live", "/work/live", { tool: "Bash" });
      await waitFor("an event written after connecting is streamed", () => got.some((m) => m.name === "event" && m.data.session === "live"));
      await waitFor("and followed by a fresh state", () => got.filter((m) => m.name === "state").length >= 2);
      stream.destroy();
    } finally {
      await new Promise((r) => server.close(r));
    }

    // Through the CLI: the flag starts it, an explicit port in use is an error, the default falls back.
    const CLI = path.join(TEST_DIR, "..", "bin", "vibeaudio.js");
    const start = (extra) => {
      const child = spawn(process.execPath, [CLI, "--dashboard", "--no-open", ...extra], { env: { ...process.env, VIBE_NO_UPDATE_CHECK: "1" } });
      let out = "";
      const url = new Promise((resolve) => child.stdout.on("data", (c) => { out += c; const m = out.match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) resolve(m[0]); }));
      const exited = new Promise((resolve) => child.on("close", (code) => resolve({ code, out })));
      return { child, url, exited, err: () => child.stderr.setEncoding("utf8") };
    };
    const first = start(["--port", "0"]);
    try {
      const url = await first.url;
      const res = await new Promise((resolve, reject) => http.get(url, (r) => resolve(r.statusCode)).on("error", reject));
      assert.strictEqual(res, 200, "vibe --dashboard serves the page");
      const clash = start(["--port", new URL(url).port]);
      const { code } = await clash.exited;
      assert.strictEqual(code, 1, "an explicit port that is taken is an error");
    } finally {
      first.child.kill();
    }
    const bad = spawn(process.execPath, [CLI, "--port", "99999"], { env: process.env });
    assert.strictEqual((await new Promise((r) => bad.on("close", r))), 1, "a bad --port is an error");
    console.log("   ✓ Localhost only; a foreign Host is refused; read-only; the page streams state and events; the CLI starts it.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
