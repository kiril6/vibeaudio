const { assert, TEST_DIR } = require("../helpers");

(async () => {
  // --- 34c. The failure chime can actually be reached under hooks ---
  console.log("\n\x1b[1m[34c] Stop payload decides the chime\x1b[0m");
  {
    const { outcomeFromPayload, readPayload } = require("../../src/hooks");

    // Cursor is the only agent that reports how the turn ended.
    assert.strictEqual(outcomeFromPayload('{"status":"error"}'), "failure", "error must chime failure");
    assert.strictEqual(outcomeFromPayload('{"status":"aborted"}'), "failure", "aborted must chime failure");
    assert.strictEqual(outcomeFromPayload('{"status":"ABORTED"}'), "failure", "status must be case-insensitive");
    assert.strictEqual(outcomeFromPayload('{"status":"completed"}'), "success", "completed must chime success");
    // Claude Code ends an API-error turn with StopFailure instead of Stop.
    assert.strictEqual(
      outcomeFromPayload('{"hook_event_name":"StopFailure","error":"rate_limit"}'), "failure",
      "StopFailure must chime failure"
    );

    // Claude Code and Codex send a Stop payload with no verdict in it. Calling
    // that a failure would invent one the agent never claimed.
    assert.strictEqual(outcomeFromPayload('{"stop_hook_active":false}'), "success", "a payload with no status is a success");
    assert.strictEqual(outcomeFromPayload(""), "success", "no payload at all is a success");
    assert.strictEqual(outcomeFromPayload("not json {"), "success", "malformed input must not throw");

    // A hook that blocks on stdin that never arrives would hang the agent.
    const started = Date.now();
    await new Promise((resolve) => readPayload(resolve, 80));
    assert.ok(Date.now() - started < 2000, "readPayload must give up rather than wait forever");

    console.log("   ✓ Cursor's status reaches the chime; the silent agents still report success.");
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
