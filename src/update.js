/**
 * "A newer version is out", said where a person is looking.
 *
 * A global CLI has no other way to reach its users: nothing tells them to
 * re-run `npm i -g`, so fixes never arrive. This asks the registry at most once
 * a day, in a detached process, and shows the answer the *next* time - a run
 * never waits on the network, and an offline machine is simply never told.
 *
 * The request is the one `npm outdated` makes, to the public registry, and
 * carries nothing about the user: no id, no settings, no usage. It is the only
 * network call VibeAudio makes, which is why it can be switched off.
 *
 * Shown only by `--status`, `--help` and the menu. Never by hooks - their
 * output goes to the agent, not the person - and never by the wrapper, whose
 * terminal belongs to the command it runs.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const pkg = require("../package.json");

const CHECK_FILE = path.join(os.homedir(), ".vibeaudio", "update.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = `https://registry.npmjs.org/${pkg.name}/latest`;

// CI and the de-facto standard opt-out (update-notifier's) as well as our own.
function checkDisabled(env = process.env) {
  return Boolean(env.VIBE_NO_UPDATE_CHECK || env.NO_UPDATE_NOTIFIER || env.CI);
}

/** Numeric x.y.z comparison; a prerelease or malformed version is never "newer". */
function isNewer(latest, current) {
  const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v || "") ? v.split(".").map(Number) : null);
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function readCheck(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (e) {
    return {};
  }
}

function writeCheck(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Per-process temp name: two runs refreshing at once must not share one.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data)}\n`);
  fs.renameSync(tmp, file);
}

function refreshInBackground(file) {
  try {
    // Stamp the attempt first, so a burst of runs starts one check, not many.
    writeCheck(file, { ...readCheck(file), checked: Date.now() });
    const child = spawn(process.execPath, [__filename, file], { detached: true, stdio: "ignore" });
    child.unref();
  } catch (e) {
    // An update notice is never worth an error.
  }
}

/**
 * The line to print, or null. Synchronous and offline: it reads what the last
 * check found, and starts the next check if that one is a day old.
 * `ephemeral`: running from an npx cache, where "npm i -g" is the wrong advice
 * and npx fetches the latest on its own anyway.
 */
function updateNotice({ file = CHECK_FILE, env = process.env, now = Date.now(), current = pkg.version, ephemeral = false, refresh = refreshInBackground } = {}) {
  if (checkDisabled(env) || ephemeral) return null;

  const state = readCheck(file);
  if (!(now - (state.checked || 0) < CHECK_INTERVAL_MS)) refresh(file);

  if (!isNewer(state.latest, current)) return null;
  return `\x1b[33mUpdate available ${current} → ${state.latest}\x1b[0m  \x1b[1mnpm i -g ${pkg.name}\x1b[0m` +
    `  \x1b[90m(what's new: https://github.com/kiril6/vibeaudio/releases)\x1b[0m`;
}

// The detached child: one request, bounded, and silent whatever happens.
async function runCheck(file) {
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return;
    const { version } = await res.json();
    if (typeof version === "string") writeCheck(file, { ...readCheck(file), latest: version });
  } catch (e) {
    // Offline, blocked, or a registry hiccup: try again tomorrow.
  }
}

if (require.main === module) runCheck(process.argv[2] || CHECK_FILE);

module.exports = { updateNotice, isNewer, checkDisabled, CHECK_FILE };
