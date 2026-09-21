/**
 * The one line an install owes the user.
 *
 * `npm i -g vibeaudio` used to end in silence: nothing plays until hooks are
 * installed or a command is wrapped, so someone who installed it and then went
 * back to work heard nothing and concluded it was broken. This says what to
 * run next, once, at the only moment the user is definitely looking.
 *
 * It must never fail an install. Anything thrown here is npm's problem to
 * report and the user's to wonder about, so everything is wrapped and the exit
 * code is always 0 - a greeting is not worth a failed install.
 */
// npm 7+ hides lifecycle-script stdout unless the script fails - measured on
// npm 10, a global install printed only "added 1 package". The controlling
// terminal is outside npm's pipe, so write there; stdout remains for when
// there is no terminal (CI, Windows), where npm may or may not show it.
function say(text) {
  const fs = require("fs");
  try {
    const fd = fs.openSync("/dev/tty", "w");
    fs.writeSync(fd, text + "\n");
    fs.closeSync(fd);
  } catch (e) {
    console.log(text);
  }
}

try {
  // Local installs are a dependency of something else; their user is not here
  // and not the one who would run `vibe`. CI and Docker set this too.
  // No isTTY check: npm pipes lifecycle output often enough that gating on it
  // would mean the hint never lands for the people who need it. A global
  // install is already the narrow case - a dependency install sets this false.
  if (process.env.npm_config_global === "true") {
    const c = (code, text) => `\x1b[${code}m${text}\x1b[0m`;
    say(`
${c("1;36", "🎧 VibeAudio installed.")} Start here:

  ${c("1", "vibe")}                   ${c("90", "guided setup: pick your agent, genre and volume")}

Or skip the menu:

  ${c("1", "vibe --install-hooks")}   ${c("90", "music follows your agent's thinking — Claude Code, Codex, Cursor…")}
  ${c("1", "vibe npm test")}          ${c("90", "wrap any command that exits when it's done")}
  ${c("1", "vibe --preview jazz")}    ${c("90", "hear a genre first")}
`);
  }
} catch (e) {
  // Deliberately silent: see above.
}
