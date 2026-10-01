---
name: vibe
description: Control VibeAudio - status, mute, unmute, stop, or change genre or volume
argument-hint: "[status | mute [minutes] | unmute | stop | genre <name> | volume <5-100>]"
disable-model-invocation: true
---
Control VibeAudio, the focus music that plays while you work, for the user.
Arguments: `$ARGUMENTS`

Run the one matching command with the Bash tool, then report the result in a
single short sentence. Do nothing else.

- no arguments, or `status`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --status`
- `mute` or `mute <minutes>`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --mute <minutes>`
- `unmute`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --unmute`
- `stop`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --stop`
- `genre <name>`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --genre <name>`
- `volume <5-100>`: `node "${CLAUDE_PLUGIN_ROOT}/bin/vibeaudio.js" --volume <n>`
  Both save the user's default and reach the hooks on the next prompt - there
  is nothing to reinstall.
  Genres: lofi, synthwave, 8bit, electronic, jazz, zen, piano, drone, rain, ocean, random.

For anything else, show the user the list above instead of running a command.
