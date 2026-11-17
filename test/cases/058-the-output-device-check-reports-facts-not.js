const { assert, TEST_DIR } = require("../helpers");

(async () => {
  // [58] --doctor reads where macOS sends sound, without guessing.
  {
    console.log("\n\x1b[1m[58] The output-device check reports facts, not hunches\x1b[0m");
    const { parseVolumeSettings, parseDefaultOutput } = require("../../src/output");
    assert.deepStrictEqual(parseVolumeSettings("output volume:39, input volume:88, alert volume:63, output muted:false"), { volume: 39, muted: false });
    assert.deepStrictEqual(parseVolumeSettings("output volume:missing value, input volume:88, alert volume:63, output muted:false"), { volume: null, muted: false },
      "a device with no volume control is `missing value`, which is not zero");
    assert.strictEqual(parseVolumeSettings("output volume:0, output muted:true").muted, true);
    assert.deepStrictEqual(parseVolumeSettings("nonsense"), { volume: null, muted: null }, "unparseable output is no answer, not a finding");

    const profile = JSON.stringify({ SPAudioDataType: [{ _items: [
      { _name: "MacBook Pro Speakers", coreaudio_device_transport: "coreaudio_device_type_builtin" },
      { _name: "C2723H", coreaudio_device_transport: "coreaudio_device_type_usb", coreaudio_default_audio_output_device: "spaudio_yes" }
    ] }] });
    assert.deepStrictEqual(parseDefaultOutput(profile), { name: "C2723H", transport: "USB" }, "names the device afplay will use, not the first one listed");
    assert.strictEqual(parseDefaultOutput("{}"), null);
    assert.strictEqual(parseDefaultOutput("not json"), null, "a failed lookup is silent");
    console.log("   ✓ Parses the volume settings and default device, and treats a missing answer as no finding.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
