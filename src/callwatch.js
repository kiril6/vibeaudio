"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

/**
 * Is a call in progress? The answer is "something is recording from the
 * microphone", read from the operating system with a tool it already ships:
 * no native module, no per-app list to keep current, and a call in an app nobody
 * listed (Teams, Zoom, Meet in a browser, Discord, a phone bridge) is covered by
 * the same signal. Dictation and voice recorders trip it too, which is fine:
 * those are moments to be quiet as well.
 *
 * Every probe answers { inUse, apps } or null when it could not tell. null is
 * never a call: a probe that is missing or fails must leave the music alone.
 */

const CALL_FILE = path.join(os.homedir(), ".vibeaudio", "call.json");

// A hook, the daemon and every playback gate ask. The answer is shared through a
// file and only recomputed when it is this old, so the probe's process is spawned
// about once per interval however many callers there are.
const PROBE_TTL_MS = 3000;
// A headset swap or an app's own mute lets go of the microphone for a moment.
// Hanging up is "off the mic for this long", which still ends it within seconds.
const GONE_MS = 5000;

// A Windows app that crashed on the mic leaves a stop time of 0 for good, so a
// start older than this is a leftover, not a call.
const STALE_MS = 12 * 3600 * 1000;
// Third-party text (an app's name, a file name) ends up in --why and the mod.
const MAX_APPS = 5;

function cleanApps(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((a) => typeof a === "string").slice(0, MAX_APPS).map((a) => a.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 40)).filter(Boolean);
}

// LC_ALL=C: pactl and reg print their field labels in the user's language, and
// "Corked: yes" is not "Corked: ja".
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 3000, killSignal: "SIGKILL", windowsHide: true, env: { ...process.env, LC_ALL: "C" } });
  return r.status === 0 && typeof r.stdout === "string" ? r.stdout : null;
}

/** `pactl list source-outputs` + `pactl list short sources` -> the apps recording right now, or null */
function parsePactl(outputs, shortSources) {
  const monitors = new Set(
    shortSources.split("\n").map((l) => l.split("\t")).filter((c) => c.length > 1 && c[1].endsWith(".monitor")).map((c) => c[0])
  );
  const apps = [];
  for (const block of outputs.split(/^Source Output #/m).slice(1)) {
    if (/^\s*Corked:\s*yes/m.test(block)) continue; // opened but paused: not recording
    if (/^\s*Driver:\s*module-/m.test(block)) continue; // a loopback or echo-cancel module's own stream, there all day
    if (/media\.name\s*=\s*"Peak detect"/.test(block)) continue; // a volume meter (pavucontrol, the desktop's sound panel)
    const source = (block.match(/^\s*Source:\s*(\S+)/m) || [])[1];
    if (source !== undefined && monitors.has(source)) continue; // capturing what plays, not a voice
    apps.push((block.match(/application\.name\s*=\s*"([^"]*)"/) || [])[1] || "an app");
  }
  return apps;
}

/**
 * `reg query ...\microphone /s` -> the apps holding the mic.
 * Windows stamps a start and a stop time (FILETIME, 100 ns since 1601) per app under
 * the capability store; an app that has started and not stopped has a stop time of 0.
 * Both 0 is an app that never used it, and a start older than STALE_MS with no stop
 * is an app that died on the mic.
 */
function parseReg(text, now = Date.now()) {
  const entries = [];
  let entry = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^HKEY_/i.test(line)) {
      entry = { key: line, start: 0n, stop: null };
      entries.push(entry);
      continue;
    }
    const m = entry && line.match(/^LastUsedTime(Start|Stop)\s+REG_QWORD\s+(0x[0-9a-f]+)$/i);
    if (m) entry[m[1].toLowerCase()] = BigInt(m[2]);
  }
  const nowTicks = BigInt(now + 11644473600000) * 10000n;
  const staleTicks = BigInt(STALE_MS) * 10000n;
  const apps = [];
  for (const e of entries) {
    if (e.stop !== 0n || e.start === 0n || nowTicks - e.start > staleTicks) continue;
    const leaf = e.key.split("\\").pop();
    apps.push(path.win32.basename(leaf.replace(/#/g, "\\")) || leaf);
  }
  return apps;
}

const REG_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";

const PROBES = {
  // The default input device's "running somewhere" flag, which is what the
  // system's own orange dot reads. JXA because it needs no compiler or helper.
  darwin() {
    const out = run("osascript", ["-l", "JavaScript", path.join(__dirname, "mic-probe.jxa")]);
    if (out === null) return null;
    const [verdict, ...apps] = out.split("\n").map((l) => l.trim()).filter(Boolean);
    if (verdict !== "1" && verdict !== "0") return null; // "?": a headset it cannot tell from our own music
    return { inUse: verdict === "1", apps };
  },
  win32() {
    const out = run("reg", ["query", REG_KEY, "/s"]);
    if (out === null) return null;
    const apps = parseReg(out);
    return { inUse: apps.length > 0, apps };
  },
  linux() {
    const outputs = run("pactl", ["list", "source-outputs"]);
    const sources = run("pactl", ["list", "short", "sources"]);
    if (outputs === null || sources === null) return null;
    const apps = parsePactl(outputs, sources);
    return { inUse: apps.length > 0, apps };
  }
};

/** VIBE_CALL_PROBE (internal, for the suite): a file holding 1 or 0 stands in for the system */
function probe() {
  const fake = process.env.VIBE_CALL_PROBE;
  if (fake) {
    try {
      return { inUse: fs.readFileSync(fake, "utf8").trim() === "1", apps: ["test app"] };
    } catch (e) {
      return null;
    }
  }
  const p = PROBES[process.platform];
  try {
    return p ? p() : null;
  } catch (e) {
    return null;
  }
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(CALL_FILE, "utf8"));
    if (!s || typeof s.at !== "number" || typeof s.lastInUse !== "number") return null;
    return { at: s.at, inUse: s.inUse === true, apps: cleanApps(s.apps), lastInUse: s.lastInUse };
  } catch (e) {
    return null;
  }
}

function writeState(state) {
  // Temp file + rename, like every shared file here: a reader never sees half of one.
  const tmp = `${CALL_FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(CALL_FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, CALL_FILE);
  } catch (e) {
    fs.rmSync(tmp, { force: true }); // a log of a call is not worth failing a hook
  }
}

/** The current reading, refreshed when stale: { at, inUse, apps, lastInUse } */
function callState(now = Date.now(), probeFn = probe) {
  const saved = readState();
  // A negative age is a clock that went backwards: that answer is not fresh, it is from the future.
  if (saved && now - saved.at >= 0 && now - saved.at < PROBE_TTL_MS) return saved;
  const r = probeFn();
  const state = {
    at: now,
    inUse: Boolean(r && r.inUse),
    apps: cleanApps(r && r.apps),
    lastInUse: r && r.inUse ? now : (saved && saved.lastInUse) || 0
  };
  writeState(state);
  return state;
}

/** On a call: the mic is in use, or was a moment ago */
function callActive(now = Date.now(), probeFn = probe) {
  const s = callState(now, probeFn);
  const gone = now - s.lastInUse;
  return s.inUse || (gone >= 0 && gone < GONE_MS);
}

module.exports = { probe, cleanApps, STALE_MS, CALL_FILE, PROBE_TTL_MS, GONE_MS, parsePactl, parseReg, callState, callActive };
