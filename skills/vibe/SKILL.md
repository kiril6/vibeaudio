---
name: vibe
description: Control VibeAudio - status, mute, unmute, stop, or change genre, volume, music, banners, speech or call muting
argument-hint: "[status | mute [minutes] | unmute | stop | genre <name> | volume <5-100> | music on|off | notify on|off | speak off|auto|always | calls on|off]"
disable-model-invocation: true
---
Control VibeAudio, the focus music that plays while you work, for the user.
Arguments: `$ARGUMENTS` (if that is not filled in, as in Codex: the words after
the skill's name in the user's message).
If `${CLAUDE_PLUGIN_ROOT}` below is not filled in either, it is the folder two
levels above this SKILL.md.

Run the one matching command in the shell (the Bash tool), then report the result in a
single short sentence. Do nothing else.

- no arguments, or `status`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --status`
- `mute` or `mute <minutes>`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --mute <minutes>`
- `unmute`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --unmute`
- `stop`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --stop`
- `genre <name>`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --genre <name>`
- `volume <5-100>`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --volume <n>`
- `music on|off`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --music <on|off>` (off keeps the chimes)
- `notify on|off`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --notify` or `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --no-notify`
- `speak off|auto|always`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --no-speak`, `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --speak` or `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --speak-always`
- `calls on|off`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --mute-on-calls` or `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --no-mute-on-calls`
  These save the user's default and reach the hooks on the next prompt - there
  is nothing to reinstall.
  Genres: lofi, synthwave, 8bit, electronic, jazz, zen, piano, drone, rain, ocean, fireplace, wind, stream, house, dubtechno, shoegaze, gamelan, musicbox, rainpiano, random.

For anything else, show the user the list above instead of running a command.
