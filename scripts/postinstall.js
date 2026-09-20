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
try {
  // Local installs are a dependency of something else; their user is not here
  // and not the one who would run `vibe`. CI and Docker set this too.
  // No isTTY check: npm pipes lifecycle output often enough that gating on it
  // would mean the hint never lands for the people who need it. A global
  // install is already the narrow case - a dependency install sets this false.
  if (process.env.npm_config_global === "true") {
    const c = (code, text) => `\x1b[${code}m${text}\x1b[0m`;
    console.log(`
${c("1;36", "🎧 VibeAudio installed.")} Two ways to start:

  ${c("1", "vibe --install-hooks")}   ${c("90", "music follows your agent's thinking — best for Claude Code, Codex, Cursor…")}
  ${c("1", "vibe npm test")}          ${c("90", "wrap any command that exits when it's done")}

  ${c("90", "vibe            to pick a tool and a sound from a menu")}
  ${c("90", "vibe --preview jazz   to hear one first")}
`);
  }
} catch (e) {
  // Deliberately silent: see above.
}
