const { sandboxPathWith, assert, fs, TEST_DIR } = require("../helpers");

(async () => {
  // 28. The launcher menu must only offer reactive where it does something
  // --reactive is a hooks-only feature, so offering it on the wrapper branch
  // would be a control that silently does nothing.
  console.log("28. Testing Launcher Menu Flow...");
  if (process.platform === "win32") {
    console.log("   ✓ Skipped on Windows (needs a POSIX executable bit to fix menu order).");
  } else {
    const { promptInteractive } = require("../../src/interactive");

    // Make exactly one tool discoverable, so the installed-first sort puts
    // Claude Code at position 1 no matter what the host has installed.
    const binDir = sandboxPathWith(["claude"]);
    const realPath = process.env.PATH;
    const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    process.env.PATH = binDir;

    // The menus paint themselves on stdout; keep that out of the test log.
    const realWrite = process.stdout.write.bind(process.stdout);
    const realLog = console.log;
    process.stdout.write = () => true;
    console.log = () => {};

    // Drive the menus by feeding the next key as soon as a menu subscribes,
    // which keeps this deterministic instead of racing timers.
    const drive = (keys) => {
      const queue = [...keys];
      const fake = new (require("events").EventEmitter)();
      Object.assign(fake, {
        isTTY: true,
        setRawMode() {},
        resume() {},
        pause() {},
        setEncoding() {}
      });
      const realOn = fake.on.bind(fake);
      fake.on = (event, fn) => {
        const out = realOn(event, fn);
        if (event === "data" && queue.length) setImmediate(() => fake.emit("data", queue.shift()));
        return out;
      };
      Object.defineProperty(process, "stdin", { value: fake, configurable: true });
      return { pending: () => queue.length };
    };

    // Claude Code -> hooks -> lofi -> Normal -> Reactive
    const hooksRun = drive(["1", "1", "1", "1", "2"]);
    const withHooks = await promptInteractive({ hooksInstalledFor: () => false });
    assert.deepStrictEqual(withHooks.cmd, ["claude"], "first entry must be the one installed tool");
    assert.strictEqual(withHooks.installHooks, true, "the hooks branch must report itself");
    assert.strictEqual(withHooks.reactive, true, "reactive must be selectable from the menu");
    assert.strictEqual(withHooks.genre, "lofi");
    assert.strictEqual(withHooks.volume, 0.4);
    assert.strictEqual(hooksRun.pending(), 0, "the hooks branch asks all five questions");

    // Claude Code -> this session only -> lofi -> Normal, and no reactive step
    const wrapperRun = drive(["1", "2", "1", "1", "2"]);
    const withWrapper = await promptInteractive({ hooksInstalledFor: () => false });
    assert.strictEqual(withWrapper.installHooks, false, "the wrapper branch must not install");
    assert.strictEqual(withWrapper.reactive, false, "reactive is meaningless without hooks");
    assert.strictEqual(wrapperRun.pending(), 1, "the wrapper branch must not ask the reactive question");

    // With hooks installed, option 1 launches without asking anything else:
    // a genre and volume the hooks ignore must not be collected at all.
    const installedRun = drive(["1", "1", "1", "1", "1"]);
    const withInstalled = await promptInteractive({ hooksInstalledFor: () => true });
    assert.strictEqual(withInstalled.installHooks, false, "launching must not reinstall");
    assert.strictEqual(withInstalled.genre, undefined, "no genre is collected when hooks own it");
    assert.strictEqual(withInstalled.volume, undefined, "no volume is collected when hooks own it");
    assert.strictEqual(installedRun.pending(), 3, "only the tool and the delivery question are asked");

    process.stdout.write = realWrite;
    console.log = realLog;
    process.env.PATH = realPath;
    Object.defineProperty(process, "stdin", realStdin);
    fs.rmSync(binDir, { recursive: true, force: true });
    console.log("   ✓ Reactive is offered on the hooks branch, withheld from the wrapper, and dead questions are skipped when hooks already own the music.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
