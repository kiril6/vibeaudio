#!/usr/bin/env node

/**
 * VibeAudio CLI Executable
 */

const { run } = require("../src/cli");

// run() is async, so anything that escapes it surfaces as an unhandled
// rejection: a raw stack trace, and on Node 18+ a hard crash. A wrapper whose
// whole job is to run someone else's command should fail in one line instead.
run().catch((err) => {
  console.error(`\x1b[31m[vibeaudio] ${err && err.message ? err.message : err}\x1b[0m`);
  if (process.env.VIBE_DEBUG) console.error(err);
  process.exit(1);
});
