/**
 * What macOS is actually sending sound to. `afplay` plays on the default
 * output device, which is not always the one you are listening on: connect a
 * monitor and the default can move to it, where the system volume may be
 * missing or the speakers quiet. Read only by `--doctor`; nothing else asks.
 */

const { spawnSync } = require("child_process");

/** "output volume:39, input volume:88, alert volume:63, output muted:false" */
function parseVolumeSettings(text) {
  const volume = /output volume:\s*(\d+)/.exec(text);
  const muted = /output muted:\s*(true|false)/.exec(text);
  return {
    // "missing value" is what macOS reports for a device with no software
    // volume control - common for monitors - so absent means no knob, not zero.
    volume: volume ? Number(volume[1]) : null,
    muted: muted ? muted[1] === "true" : null
  };
}

const TRANSPORTS = {
  coreaudio_device_type_usb: "USB",
  coreaudio_device_type_hdmi: "HDMI",
  coreaudio_device_type_displayport: "DisplayPort",
  coreaudio_device_type_builtin: "built-in",
  coreaudio_device_type_bluetooth: "Bluetooth",
  coreaudio_device_type_airplay: "AirPlay",
  coreaudio_device_type_virtual: "virtual"
};

/** The device `afplay` will use, from `system_profiler SPAudioDataType -json`. */
function parseDefaultOutput(json) {
  try {
    const items = (JSON.parse(json).SPAudioDataType || []).flatMap((group) => group._items || []);
    const item = items.find((i) => i.coreaudio_default_audio_output_device === "spaudio_yes");
    if (!item) return null;
    return { name: item._name, transport: TRANSPORTS[item.coreaudio_device_transport] || null };
  } catch (e) {
    return null;
  }
}

/** null off macOS, or when either lookup fails: absence of an answer is not a finding. */
function macOutput() {
  if (process.platform !== "darwin") return null;
  const run = (cmd, args) => {
    // SIGKILL, not the default SIGTERM: a lookup stuck on audio hardware (a CI
    // runner has none) can ignore TERM, and spawnSync then waits on it forever.
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
    return r.status === 0 ? r.stdout : null;
  };
  const settings = run("osascript", ["-e", "get volume settings"]);
  if (settings === null) return null;
  const profile = run("system_profiler", ["SPAudioDataType", "-json"]);
  return { ...parseVolumeSettings(settings), device: profile ? parseDefaultOutput(profile) : null };
}

module.exports = { parseVolumeSettings, parseDefaultOutput, macOutput };
