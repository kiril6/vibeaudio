/**
 * Reading a user's own chime file (#29).
 *
 * The decisions this encodes, because each one closes a way for a hook to
 * hang, play garbage or fail:
 * - WAV only, 16-bit PCM, any rate and channel count. `aplay` and PowerShell's
 *   `SoundPlayer` take nothing else, and a decoder would break "no dependencies".
 * - The file is walked chunk by chunk and re-emitted with the canonical 44-byte
 *   header, so extra chunks (LIST, bext) are dropped and `applyGain()` - which
 *   skips exactly 44 bytes - scales real samples on every backend.
 * - At most `MAX_CHIME_MS`: `hookStop` waits for an inline chime, and the agent
 *   waits on the hook.
 * - Anything wrong returns an error string and never throws, so the caller can
 *   fall back to the built-in chime; silence and a failed hook are both worse.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_CHIME_MS = 3000;
const MAX_CHIME_BYTES = 2 * 1024 * 1024;
const KINDS = ["success", "failure"];

/** `~` expands, anything else must already be absolute. Never goes through a shell. */
function expandChimePath(raw) {
  const text = String(raw).trim();
  const full = text === "~" || text.startsWith("~/") || text.startsWith("~\\")
    ? path.join(os.homedir(), text.slice(1))
    : text;
  return path.isAbsolute(full) ? path.normalize(full) : null;
}

function canonicalWav(channels, rate, pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** @returns {{ wav: Buffer, durationMs: number } | { error: string }} */
function readChimeWav(file) {
  let buf;
  try {
    if (fs.statSync(file).size > MAX_CHIME_BYTES) return { error: "file is larger than 2 MB" };
    buf = fs.readFileSync(file);
  } catch (e) {
    return { error: e.code === "ENOENT" ? "file not found" : `cannot read file (${e.code || e.message})` };
  }

  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return { error: "not a WAV file (only WAV is supported)" };
  }

  let fmt = null;
  let pcm = null;
  for (let pos = 12; pos + 8 <= buf.length && !pcm; ) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= buf.length) {
      fmt = {
        tag: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14)
      };
    } else if (id === "data") {
      pcm = buf.subarray(body, Math.min(buf.length, body + size));
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }

  if (!fmt || !pcm) return { error: "no audio found in the file" };
  if (fmt.tag !== 1 || fmt.bits !== 16) return { error: "needs 16-bit PCM WAV" };
  if (fmt.channels < 1 || fmt.channels > 2 || fmt.rate < 8000 || fmt.rate > 192000) {
    return { error: "needs mono or stereo audio at 8-192 kHz" };
  }

  const frame = fmt.channels * 2;
  const data = pcm.subarray(0, pcm.length - (pcm.length % frame));
  const durationMs = (data.length / (fmt.rate * frame)) * 1000;
  if (durationMs < 1) return { error: "the file is empty" };
  if (durationMs > MAX_CHIME_MS) {
    return { error: `${(durationMs / 1000).toFixed(1)} s is longer than the ${MAX_CHIME_MS / 1000} s limit` };
  }
  return { wav: canonicalWav(fmt.channels, fmt.rate, data), durationMs };
}

module.exports = { readChimeWav, expandChimePath, MAX_CHIME_MS, KINDS };
