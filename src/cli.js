/**
 * VibeAudio CLI Wrapper Implementation
 *
 * cli.js is the entry (run) and public surface; the code lives in cli-*.js:
 * args, install, status, settings and the run loop.
 */

const { run, hooksAlreadyCover, applyMenuSelection, previewAudioFile, windowsCommandNeedsShell } = require("./cli-run");
const { parseArgs } = require("./cli-args");
const { staleHookAgents } = require("./cli-status");

module.exports = {
  run,
  parseArgs,
  hooksAlreadyCover,
  staleHookAgents,
  applyMenuSelection,
  previewAudioFile,
  windowsCommandNeedsShell,
};
