/**
 * Runs every case in test/cases/ in its own process, in order, and reports all
 * failures instead of stopping at the first. Each case starts from setup.js: an
 * empty HOME and its own audio cache.
 *
 *   node test/run.js                 all cases
 *   node test/run.js 62 076          cases whose file name starts with or contains an argument
 *   node test/run.js --list          names only
 *
 * A case that hangs is named, and before it is killed the process tree under
 * it is printed (pid, state, age, command): the stuck child is the one #58 has
 * been looking for on the macOS/Node 18 runner. CASE_TIMEOUT_MS is
 * VIBE_TEST_CASE_TIMEOUT_MS, 3 minutes by default; the slowest case takes well
 * under one.
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const CASE_TIMEOUT_MS = Number(process.env.VIBE_TEST_CASE_TIMEOUT_MS) || 3 * 60 * 1000;
const posix = process.platform !== "win32";
// VIBE_TEST_CASES_DIR is internal, for the runner's own test.
const dir = process.env.VIBE_TEST_CASES_DIR || path.join(__dirname, "cases");
const all = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
const args = process.argv.slice(2);

if (args.includes("--list")) {
  console.log(all.join("\n"));
  process.exit(0);
}

const pick = args.length ? all.filter((f) => args.some((a) => f.startsWith(a.padStart(3, "0")) || f.includes(a))) : all;
if (!pick.length) {
  console.error(`No case matches: ${args.join(" ")} (node test/run.js --list)`);
  process.exit(1);
}

/** The case's descendants as `ps` sees them; empty where there is no ps. */
function processTree(rootPid) {
  if (!posix) return "";
  const ps = spawnSync("ps", ["-axo", "pid=,ppid=,stat=,etime=,command="], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  if (ps.status !== 0) return "";
  const rows = ps.stdout.split("\n").map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(l)).filter(Boolean);
  const keep = new Set([rootPid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [, pid, ppid] of rows) if (keep.has(Number(ppid)) && !keep.has(Number(pid))) keep.add(Number(pid)), (grew = true);
  }
  return rows.filter((r) => keep.has(Number(r[1]))).map((r) => `  ${r[1]} <- ${r[2]}  ${r[3]}  ${r[4]}  ${r[5].slice(0, 160)}`).join("\n");
}

// Its own process group on posix, so a stuck grandchild dies with the case.
const kill = (child) => {
  try {
    posix ? process.kill(-child.pid, "SIGKILL") : child.kill("SIGKILL");
  } catch (e) {
    // Already gone.
  }
};

let current = null;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (current) kill(current);
    process.exit(130);
  });
}

function runCase(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dir, file)], { stdio: "inherit", detached: posix });
    current = child;
    let hung = false;
    const timer = setTimeout(() => {
      hung = true;
      console.error(`\n\x1b[31m${file} has run for ${CASE_TIMEOUT_MS / 1000}s. Process tree under it:\x1b[0m\n${processTree(child.pid) || "  (unavailable)"}`);
      kill(child);
    }, CASE_TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      kill(child);
      resolve(hung ? `hung for ${CASE_TIMEOUT_MS / 1000}s and was killed` : code === 0 ? null : `exit ${code ?? signal}`);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(`could not start: ${err.message}`);
    });
  });
}

(async () => {
  console.log("Running VibeAudio Verification Tests...\n");
  const failed = [];
  for (const file of pick) {
    const why = await runCase(file);
    if (why) {
      console.error(`\n\x1b[31m✗ ${file}: ${why}\x1b[0m`);
      failed.push(file);
    }
  }

  if (failed.length) {
    console.error(`\n\x1b[31m${failed.length} of ${pick.length} cases failed:\x1b[0m\n  ${failed.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`\n\x1b[32mAll ${pick.length} test cases passed successfully!\x1b[0m`);
})();
