# 🎧 VibeAudio

[![test](https://github.com/kiril6/vibeaudio/actions/workflows/test.yml/badge.svg)](https://github.com/kiril6/vibeaudio/actions/workflows/test.yml)

> **Procedural focus music while your AI coding tools think.**
> Every project gets its own arrangement. Zero dependencies, zero audio files.
> Works with Claude Code, Codex, Cursor, Grok, Gemini CLI, Copilot CLI, Qwen Code, Aider — and any terminal command.

**[Install](#-install)** · **[Agent hooks](#-agent-hooks-no-wrapper-needed)** · **[Genres](#-music-genres)** · **[Flags](#-options--flags)** · **[Troubleshooting](#-troubleshooting)** · **[Uninstall](#-uninstall)**

> **🔊 [Listen to every genre →](https://kiril6.github.io/vibeaudio/)** — hear all 8 genres, the tier escalation, and the three chimes, rendered from the real synth.

> **In a hurry?** `npm i -g vibeaudio`, then `vibe --install-hooks`. Your next prompt has music.

---

## ⚡ Why

AI coding agents take 15–45 seconds to reason, read files and write code. Staring at a blank cursor feels slow; tabbing away means checking back to see if it's done. VibeAudio fills that gap with music while the agent thinks, and a chime when your output is ready to read.

**How it behaves:**

* 🧮 **Pure synthesis, zero MP3s.** Every note, chord and pad is generated in code — no audio assets, no npm dependencies, no `node-gyp`.
* 🎼 **A different arrangement per project.** Your working directory seeds the progression, bass line and melody, so each repo has its own sound and keeps it.
* 🛡️ **A grace window.** Fast commands stay 100% silent — music starts only past 1.5s (`--grace`).
* 📈 **Escalating layers.** Tier 1 (0–15s) gentle intro → Tier 2 (15–45s) main groove → Tier 3 (45s+) deep focus. You can hear how deep into the task the agent is.
* 🔔 **Outcome-aware chimes.** Ascending on success, a soft descending minor chord on failure, and **silence on `Ctrl+C`** — an abort is never reported as done.
* ✋ **A "your turn" chime.** When Claude Code stops to ask permission (or an MCP server asks for input), the music pauses and a rising two-note chime asks for you; it picks back up once you've answered.
* 🪟 **Several sessions, one soundtrack.** Run as many terminals of the same agent as you like: the music plays while *any* of them is working, and each finishes with its own chime. One session ending, pausing for a permission dialog or being interrupted never cuts off another that's still going.
* 🧮 **Honest exit codes.** Your command's status passes straight through (`130` on `Ctrl+C`), so `vibe claude && next-step` behaves exactly as it would without the wrapper.
* 🌊 **Terminal title HUD.** A live ASCII wave and elapsed timer in the window title, where it can't corrupt a full-screen TUI.
* 🔌 **Universal drop-in.** Hooks for **Claude Code, Codex, Cursor, Grok, Gemini CLI, Copilot CLI and Qwen Code**; MCP for **Claude Desktop and Antigravity**; the wrapper (`vibe <command>`) for anything else.

### 🎼 Every project gets its own arrangement

VibeAudio seeds the composition from your **project directory**. The repo you're in picks the chord progression, the bass line, the melodic contour, and where the ornaments land — so `~/work/api` and `~/side/game` genuinely sound different, while each one sounds the *same every time you come back to it*.

That's a deliberate choice. Focus music has one job: **be ignorable.** Music that reinvents itself every run keeps pulling your ear back, which is the opposite of what you want while reading an agent's output. Familiar-per-project gives you variety across contexts and predictability within one — by your third session in a repo, its loop has faded into the furniture.

Pin or explore arrangements when you want to:

```bash
vibe --seed 42 --preview jazz    # audition one specific arrangement
export VIBE_SEED=7               # pin the same sound everywhere
```

**How "procedural" actually works** — worth being precise, since it shapes what you'll hear. Each genre is **synthesized from code** (oscillators, chord tables, envelopes rendered to PCM), not shipped as audio files. The seed selects among *hand-written, human-checked* variants — three progressions per genre, each diatonic to that genre's key, plus seeded ornament placement — so it never invents harmony and can't wander out of key. The chosen arrangement is rendered once per project, cached under `~/.vibeaudio/cache/`, and looped. Within a session you're hearing a 6–8 second bar repeat that gains layers as you cross the tier boundaries.

---

## 📋 Requirements

* **Node.js ≥ 18**
* **An audio player.** VibeAudio shells out to whatever your OS provides:

| Platform | Player used | Volume control | Notes |
| :--- | :--- | :--- | :--- |
| **macOS** | `afplay` | ✅ | Ships with the system — nothing to install. |
| **Linux** | `paplay`, `ffplay`, or `aplay` | ✅ | Install `pulseaudio-utils`, `ffmpeg`, or `alsa-utils`. |
| **Windows** | PowerShell `SoundPlayer` | ✅ | Nothing to install. |

`aplay` and PowerShell's `SoundPlayer` take no volume argument, so `--volume` is applied by rendering the loop pre-attenuated instead — same result, one cached file per volume you use.

If no player is found, VibeAudio prints a one-line notice and runs your command **silently** — it never blocks the tool you actually wanted to run.

---

## 🚀 Install

One line. No clone, no build step, no dependencies to resolve:

```bash
npm i -g vibeaudio
```

That puts `vibe` and `vibeaudio` on your `PATH`. Re-run the same command to update, or see [Uninstall](#-uninstall) to remove it cleanly.

### Then pick how it runs

**Using Claude Code, Codex, Cursor or Grok interactively?** Install the hooks — this is the mode that actually tracks thinking:

```bash
vibe --install-hooks
```

Now run your agent normally, with no prefix. Music starts when you submit a prompt and stops with a chime when the agent finishes. [Details below.](#-agent-hooks-no-wrapper-needed)

**Running one-shot commands?** Wrap them:

```bash
vibe npm test
vibe claude -p "explain this repo"
```

**Lost?** `vibe --help` lists every flag, and `vibe --status` reads your live setup back to you — what's installed, what's playing, and which agents it found.

> **Which one you want:** the wrapper plays music for as long as the wrapped process lives. That's exactly right for a command that exits when its work is done — and wrong for an interactive REPL like `claude`, where the process stays alive while you read and type, so the music never stops. Hooks know when the agent is actually thinking; the wrapper can only time the process.

### Try it without installing

```bash
npx vibeaudio --preview jazz   # hear a loop right now
npx vibeaudio sleep 8          # hear the wrapper: music, then the done chime
```

> **Heard nothing?** Music only starts once the wrapped command has run longer than the 1.5s grace window — that's [the point](#-why), so quick commands stay silent. `sleep 8` is the reliable demo; something like `npm test` is silent if the tests finish fast or the command errors out immediately.

`npx` runs from a temporary cache that npm eventually deletes, so `--install-hooks` refuses to run this way — it would write a path into your agent's hook config that later vanishes. Install globally first.

### Interactive Launcher Menu

Run with no command to get a menu for picking your AI, vibe, and volume:

```bash
vibe
```

```
🎧 VibeAudio — Interactive AI Launcher

Which AI companion would you like to launch?
❯ 1. Claude Code          [✓ installed]
  2. Gemini CLI           [✓ installed]
  3. Codex CLI            [✓ installed]
  4. GitHub Copilot CLI   [✓ installed]
  5. Grok CLI             (not found in PATH)
  6. Cursor CLI           (not found in PATH)
  7. Aider                (not found in PATH)
  8. Ollama (Llama 3)     (not found in PATH)
  9. Custom command...

Choose your sound vibe:
❯ 1. ☕ Lo-Fi Focus        — Warm Rhodes electric piano & Kalimba drops
  2. 🌌 Chill Synthwave    — '80s analog chorused pads & pulsing bass
  3. 🕹️ Cozy 8-Bit         — Filtered retro chiptune arpeggios
  4. ⚡ Melodic Electronic  — Downtempo resonant plucks & tech pulse
  5. 🎷 Midnight Jazz      — ii-V-I piano chords & walking upright bass
  6. 🎋 Zen Ambient        — Meditative singing bowls & floating celestial pads
  7. 🎹 Sparse Piano       — Single struck notes & long silences — Satie-ish
  8. 🌫️ Deep Drone         — Held tone & filtered noise — no melody at all
  9. 🎲 Shuffle / Random   — Picks a surprise vibe each time

Choose your volume level:
❯ 1. ☕ Normal (40%)       — Balanced focus background [Default]
  2. 🤫 Quiet (25%)        — Discreet focus / open office
  3. 🌙 Whisper (15%)      — Ultra-gentle / headphones / late night
  4. 📢 Loud (75%)         — Audible across the room
```

Pick **Claude Code** or **Codex** and it asks how the music should run — hooks or just this session — and the hooks branch then offers [reactive mode](#reactive-mode-opt-in) too:

```
How should the music run?
❯ 1. Agent hooks          — Music follows the agent's thinking. Set once, no wrapper needed
  2. This session only    — Music plays while the process lives - fine for one-shot commands

Should the music react to what the agent is doing?
❯ 1. Steady (recommended) — Intensity follows elapsed time, and stays ignorable
  2. Reactive             — Intensity follows the tool in use - noticeable, by design
```

**Press `p` to hear the highlighted genre.** Nine names and a one-line description each is not much to choose from; a loop renders in about 150ms, so auditioning is just a keypress, and moving on replaces it. Leaving the menu stops it.

Choosing hooks installs them for the tool you picked, then launches it — the same thing `vibe --genre <g> --volume <n> --reactive --install-hooks` does, without memorising flags. Once they're installed the first question becomes **Just launch it** / **Reconfigure the hooks**, and launching skips the genre and volume prompts, since your saved default already answers those (`vibe --genre zen` changes it any time).

Installed tools sort to the top. The list is a shortcut, not a compatibility list — **`vibe` wraps any command at all**, and "Custom command..." takes one you type (quoted arguments survive intact). Adding an entry is one line in [`src/interactive.js`](src/interactive.js).

---

## 🪝 Agent Hooks (no wrapper needed)

> **`--install-hooks` supports Claude Code, Codex, Cursor, Grok, Gemini CLI, GitHub Copilot CLI and Qwen Code.** Everything else uses the [wrapper or MCP](#-everything-else-claude-desktop-antigravity-via-mcp) instead.

Wrapping (`vibe claude`) infers "the AI is thinking" from how long the process runs. Hooks know for certain — so music starts the moment you submit a prompt and stops the moment the agent finishes, with no grace-window guessing and no aliases.

Once hooks are installed they take over: running `vibe claude` (or `vibe codex`) anyway plays no music of its own and says so, rather than layering a session-long loop on top of the hooks' per-prompt one.

```bash
vibe --install-hooks                             # every agent found on this machine
vibe --install-hooks --tools codex               # or just one of them
vibe --genre jazz --volume 25 --install-hooks    # install, and save these as your default
vibe --install-hooks --dry-run                   # show what would change, write nothing
```

**It auto-detects.** With no `--tools`, VibeAudio wires up each supported agent it finds on your machine — one counts as present when its config directory exists or its CLI is on your `PATH`. `--tools claude,codex,cursor,grok,gemini,copilot,qwen` overrides that. Add `--dry-run` to see, per event, what would be added or changed in each file before anything is written.

Each tool spells its events its own way, and VibeAudio writes whichever dialect the file expects:

| | File | Music starts | Music stops + chime | Reactive (opt-in) |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Code** | `~/.claude/settings.json` | `UserPromptSubmit` | `Stop` | `PreToolUse` |
| **Codex** | `~/.codex/hooks.json` | `UserPromptSubmit` | `Stop` | `PreToolUse` |
| **Cursor** | `~/.cursor/hooks.json` | `beforeSubmitPrompt` | `stop` | `preToolUse` |
| **Grok** | `~/.grok/hooks/vibeaudio.json` | `UserPromptSubmit` | `Stop` | `PreToolUse` |
| **Gemini CLI** | `~/.gemini/settings.json` | `BeforeAgent` | `AfterAgent` | `BeforeTool` |
| **Copilot CLI** | `~/.copilot/hooks/vibeaudio.json` | `UserPromptSubmit` | `Stop` | `PreToolUse` |
| **Qwen Code** | `~/.qwen/settings.json` | `UserPromptSubmit` | `Stop` | `PreToolUse` |

Where an agent reports more than start and stop, VibeAudio listens for that too — and only where the event was confirmed against the tool itself:

| | Music pauses + "your turn" chime | Music resumes | Failure chime (API error) | Session closes mid-turn (silent) |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Code** | `PermissionRequest`, `Elicitation` | `PostToolUse`, `PostToolUseFailure`, `ElicitationResult` | `StopFailure` | `SessionEnd` |
| **Codex** | `PermissionRequest` | `PostToolUse` | — | — |
| **Gemini CLI** | `Notification` (tool permission) | `AfterTool` | — | `SessionEnd` |
| **Copilot CLI** | `Notification` (permission prompt) | `PostToolUse`, `PostToolUseFailure` | — | `SessionEnd` |
| **Qwen Code** | `PermissionRequest` | `PostToolUse`, `PostToolUseFailure` | `StopFailure` | `SessionEnd` |
| **Cursor, Grok** | — | — | — | — |

That's it — run your agent normally, with no `vibe` prefix.

Six things differ per agent, and none of them need any action from you except the first:

| | |
| :--- | :--- |
| **Five agents tell you when they're waiting on you** | When a permission dialog opens the music stops rather than sounding busy while the agent is stuck on you, and it resumes once the thing you answered has run. Claude Code covers the terminal, desktop app and IDEs alike, plus MCP servers asking for input. Copilot CLI's own `PermissionRequest` fires before *every* permission check — dialog or not — so VibeAudio listens for its permission-prompt notification instead. Cursor and Grok have no such event that's been verified, so they keep playing through a prompt. |
| **Claude Code turns that never reach `Stop` still end the music** | An API error or rate limit ends the turn with `StopFailure` instead, which plays the failure chime. Interrupting (Esc, or the stop button in the desktop app) fires no hook at all, so the background player watches the session transcript for Claude Code's interrupt entry and stops silently within half a second — whether the agent was writing or running a tool. Closing the session mid-turn stops it too — but only if that session started the music, so closing an idle terminal never silences another one. |
| **Codex asks you to trust the hook once** | Codex keeps a per-hook trust hash in `~/.codex/config.toml` and won't run a hook it hasn't been told to trust, so the install isn't live until you approve each one the first time it fires. |
| **Only Cursor can play the failure chime** | Its stop event reports whether the turn completed, aborted or errored. The others send no verdict, so a turn there always ends on the success chime — VibeAudio won't invent a failure the agent never claimed. |
| **Grok and Copilot CLI get a file of their own** | Each reads every `*.json` in its `hooks/` directory, so VibeAudio writes `vibeaudio.json` rather than merging into anyone else's — which makes uninstalling it a delete, and leaves no backup file behind. Copilot's honours `COPILOT_HOME`. |

### Several sessions at once

Every session of an agent is tracked separately, by the session id in its hook payload, so two terminals (or a terminal and the desktop app) share one soundtrack instead of fighting over it:

* **The music plays while any session is working.** A second prompt doesn't restart it, and it stops only when the last working session finishes.
* **More sessions, more music.** Two sessions working at once plays at least tier 2 and three or more plays tier 3 — the same piece with more layers, arriving at the next loop boundary and easing off as sessions finish. It only ever raises the tier, so it works alongside time escalation and [reactive mode](#reactive-mode-opt-in).
* **Every session gets its own chime.** A quick question that finishes while another agent is still busy chimes "done" and the music carries on underneath.
* **Dialogs and Esc are per session.** A permission dialog in one terminal plays the "your turn" chime but only pauses the music once *every* session is waiting; Esc ends just that session's turn.
* **Crashed agents can't hold it hostage.** A session that never sent `Stop` is dropped after 15 minutes, the same ceiling the background player stops at.

Sessions with no id in their payload share a single slot, so they behave as one. VibeAudio keeps one stream: per-session genres or several streams mixed together aren't supported.

> **No restart needed, even mid-session — for Claude Code, Codex, Cursor and Grok.** Each re-reads its hook file every time a hook fires, so changes land on your **next prompt**. A daemon already playing keeps its old settings until that prompt replaces it — at most the tail of one turn. Whether an open Gemini CLI, Copilot CLI or Qwen Code session does the same hasn't been checked, so start a new session there to be sure.

> **One player is shared.** They all drive the same background player, so if you prompt two agents at once, the last prompt owns the music. One person, one set of speakers — deliberate, not a limitation being worked around.

> **The Claude Code desktop app is covered too**, not just the terminal — both read the same `~/.claude/settings.json`. (The separate **Claude Desktop** chat app is a different product with no hooks; that one needs [MCP](#-everything-else-claude-desktop-antigravity-via-mcp).)

### `/vibe` inside Claude Code

Installing the Claude Code hooks also adds a `/vibe` command (`~/.claude/commands/vibe.md`), so you can control the music without leaving the session:

```text
/vibe                 what's installed and playing
/vibe mute 30         silence for 30 minutes (/vibe unmute to end it early)
/vibe stop            stop the music now
/vibe genre jazz      switch genre, keeping your volume
/vibe volume 20       change volume, keeping your genre
```

It asks Claude to run the matching `vibe` command, so Claude Code will ask permission for that command the first time. If you already have your own `vibe.md` there, VibeAudio leaves it alone and says so; `--uninstall-hooks` removes only its own.

### Changing the sound later

One command, and it reaches everything:

```bash
vibe --genre electronic --volume 25
```

That saves your default to `~/.vibeaudio/config.json`. **Installed hooks read it on their next prompt** — nothing to reinstall, nothing to restart. The same file is what the wrapper and the MCP server use, so there is one answer to "what genre am I on" rather than three. `vibe --status` shows it.

Audition before you commit: `vibe --preview electronic`.

A flag still beats an environment variable, which still beats the saved file — so a one-off stays a one-off:

```bash
vibe --genre 8bit npm test      # this run only, nothing saved
```

**Coming from an older install?** Its genre and volume were frozen into the hook entries. The first `vibe --install-hooks` after upgrading carries them over into the config file, so nothing about your music changes — unless you name a new genre or volume, or have already saved one.

[Reactive mode](#reactive-mode-opt-in) is the exception, because it isn't a setting the music reads — it decides which hooks exist at all. Turning it on or off means an install:

```bash
vibe --reactive --install-hooks     # on
vibe --install-hooks                # off again
```

Music already playing keeps the old genre until the next prompt swaps the daemon — `vibe --stop` cuts it short.

Removing them is one command:

```bash
vibe --uninstall-hooks
```

### Reactive mode (opt-in)

```bash
vibe --reactive --install-hooks
```

Adds a `PreToolUse` hook so intensity follows **what the agent is doing**, not just how long it's taken:

| Agent is… | Tools | Tier |
| :--- | :--- | :--- |
| Looking things up, or waiting on you | `Read`, `Grep`, `Glob`, `WebFetch`, `AskUserQuestion` | 1 — sparse |
| Changing code | `Edit`, `Write`, `NotebookEdit`, `apply_patch` | 2 — groove enters |
| Shelling out, or handing work to a subagent | `Bash`, `Agent`, `Skill`, `shell` | 3 — peak |

Each agent names its tools differently, and all the vocabularies are mapped. **MCP tools stay at tier 2** — they arrive as `mcp__<server>__<tool>` and can't be enumerated, since everyone's servers differ. That's a third of real traffic, and tier 2 is the honest read: real work, rarely the heaviest thing in a turn.

Changes land at the next loop boundary, so it shifts musically rather than cutting mid-bar. Without a tool signal it falls back to time-based escalation.

**This is off by default on purpose.** Music that moves every time the agent switches tools is music you *notice* — which is the opposite of what focus audio is for. Try it, but if you catch yourself listening to it instead of reading, reinstall without `--reactive` (which removes the `PreToolUse` hook again).

**What the installer will and won't do to your config:**

* **Merges, never replaces.** Other tools' hooks are left untouched and keep their position in the file — which is what Codex keys its trust records by.
* **Backs up first, once.** The first install copies your file alongside as `*.vibeaudio.bak`. Later installs leave it alone — re-copying would overwrite your real pre-VibeAudio config with a copy of VibeAudio's own last install.
* **Reinstalling updates, never duplicates.** Uninstalling sweeps every supported agent and removes only VibeAudio's own entries.
* **Refuses rather than clobbers.** Malformed JSON aborts the write; a temporary `npx` checkout is rejected outright, since the hook records an absolute path that npm's cache eviction would later delete.
* **Can't run away.** The background player is capped at 15 minutes, so a missed stop event can't leave music looping.

---

## 🖥️ Everything Else (Claude Desktop, Antigravity… via MCP)

**Claude Code, [Codex](https://github.com/openai/codex), [Cursor](https://cursor.com/docs/hooks), [Grok](https://docs.x.ai/build/features/hooks), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Copilot CLI](https://docs.github.com/en/copilot/reference/hooks-configuration) and [Qwen Code](https://github.com/QwenLM/qwen-code) have hook systems, and `--install-hooks` writes to all seven** — use [hooks](#-agent-hooks-no-wrapper-needed) there, they're strictly better. This section is for everything else. MCP is the way in: it's plain stdio JSON-RPC, so the setup is identical everywhere and only the config file differs.

> **This is weaker than hooks, by nature.** Hooks fire on an event — the music always starts when you submit a prompt. MCP tools are *model-invoked*: the assistant has to decide to call `vibe_play`, and to remember `vibe_stop` when it's done. The server tells it when to do that (via the MCP `instructions` field), but it's a suggestion, not a guarantee — expect the occasional silent turn, and say "play some focus music while you work on this" if you want it reliably. **On any of the seven agents above, use [hooks](#-agent-hooks-no-wrapper-needed) instead.**

Use an **absolute path**, not the bare `vibe` command: GUI apps launched from Finder don't inherit your shell's `PATH`, and version managers like `fnm` or `nvm` put `vibe` on a per-shell path that won't resolve. Print yours with:

```bash
echo "$(npm root -g)/vibeaudio/bin/vibeaudio.js"
```

Most apps use this JSON shape:

```json
{
  "mcpServers": {
    "vibeaudio": {
      "command": "node",
      "args": ["/absolute/path/from/the/command/above", "--mcp"]
    }
  }
}
```

Where the file lives:

| Tool | Config file |
| :--- | :--- |
| **Claude Desktop** (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Antigravity, VS Code, Zed, …** | that app's own MCP settings — same JSON shape |

Codex uses TOML rather than JSON, in `~/.codex/config.toml` — but it has hooks, so [use those instead](#-agent-hooks-no-wrapper-needed) unless you specifically want model-invoked music:

```toml
[mcp_servers.vibeaudio]
command = "node"
args = ["/absolute/path/from/the/command/above", "--mcp"]
```

Restart the app afterwards. Older Gemini CLI releases predate its hook system (0.10.0 has none) — if you're on one and can't upgrade, the same JSON goes in `~/.gemini/settings.json`.

### Changing the genre here

`vibe --genre` doesn't apply — the app launches the server, not you. Two ways instead:

**Just ask.** `vibe_play` takes a genre, so "play some jazz while you work on this" is enough, no config edit and no restart.

**Or set a default in the config's `env` block**, since a GUI app won't inherit `VIBE_GENRE` from your shell. Most clients support `env` alongside `command`/`args`:

```json
"env": { "VIBE_GENRE": "jazz", "VIBE_VOLUME": "25" }
```

```toml
[mcp_servers.vibeaudio.env]
VIBE_GENRE = "jazz"
VIBE_VOLUME = "25"
```

Restart the app afterwards. A genre the assistant passes to `vibe_play` still wins over this default.

#### Exposed MCP Tools:
* `vibe_play`: Start procedural focus music (`genre`: `lofi`, `synthwave`, `8bit`, `electronic`, `jazz`, `zen`, `piano`, `drone`, `random`; `volume`: `5-100`).
* `vibe_stop`: Stop music and play the completion chime (`outcome`: `success` or `failure`).
* `vibe_status`: Return current playback state and active tier.

Playback stops automatically if the desktop client disconnects, and caps out after 15 minutes — which also covers the likelier case of a model that started the music and never called `vibe_stop`.

---

## 🎨 Music Genres

VibeAudio includes **8 procedural music styles** synthesized entirely in code:

| Genre | Style | Vibe |
| :--- | :--- | :--- |
| `lofi` | ☕ **Lo-Fi Focus** *(Default)* | Warm Rhodes electric piano chords & Kalimba drops |
| `synthwave` | 🌌 **Chill Synthwave** | '80s analog chorused pads & pulsing retro bass |
| `8bit` | 🕹️ **Cozy 8-Bit** | Filtered retro chiptune arpeggios & NES triangle bass |
| `electronic` | ⚡ **Melodic Electronic** | Downtempo resonant plucks & crisp tech pulse |
| `jazz` | 🎷 **Midnight Jazz** | Classic ii-V-I jazz piano chords & walking upright bass |
| `zen` | 🎋 **Zen Ambient** | Meditative Tibetan singing bowls & celestial drone (zero rhythm) |
| `piano` | 🎹 **Sparse Piano** | Single struck notes and long silences — Satie-ish |
| `drone` | 🌫️ **Deep Drone** | A held tone and filtered noise — **no melody at all** |
| `random` | 🎲 **Shuffle Mode** | Picks a surprise genre for the run — **never `drone`** |

Aliases also work: `chiptune` → `8bit`, `downtempo` → `electronic`, `bossa` → `jazz`, `ambient` → `zen`, `sparse`/`satie` → `piano`, `noise`/`focus` → `drone`.

> **If any melody distracts you, use `drone`.** Every other genre plays something — notes, a progression, a bass line — and some people can't read while that happens. `drone` holds one low tone under a slow-breathing noise bed and never moves: closer to a fan or rainfall than to music. Tiers add weight rather than movement.
>
> **`piano` is the gentler version of that idea.** It still plays notes — two in eight seconds at tier 1 — but they're single struck tones with silence between them and nothing running underneath. Higher tiers fill the gaps rather than adding a groove. Try it before `drone` if you want *something* there.
>
> For the same reason **`random` never picks `drone`**. Shuffle is for a surprise *mood*, and drone isn't one — landing on a fan noise when you asked for variety reads as broken audio, not as range. Ask for it by name (or `noise` / `focus`) when you want it.

### Usage Examples:
```bash
vibe --genre electronic claude   # Melodic Electronic
vibe --genre jazz npm test       # Midnight Jazz
vibe --genre zen claude          # Zen Ambient (no drums/rhythm)
vibe --genre random claude       # Surprise vibe each run
```

### ⚙️ Set Your Favorite Genre as Default

```bash
vibe --genre jazz --volume 25
```

Saved to `~/.vibeaudio/config.json` and read by all three ways of running VibeAudio — wrapper, agent hooks, MCP. It applies on your next prompt.

```bash
vibe --genre jazz          # lofi, synthwave, 8bit, electronic, jazz, zen, piano, drone, random
vibe --volume 25           # or --whisper / --quiet / --loud
vibe --chime-volume 70
vibe --status              # what's saved, and what's overriding it
```

An `export VIBE_GENRE=jazz` still works and takes precedence in that shell — useful for one terminal you want different, not needed for a default any more.

**One project that should sound different:**

```bash
cd ~/work/api
vibe --genre zen --here      # this directory and everything under it
```

Your global default is untouched, and an agent launched from a subdirectory still gets it — the lookup walks up, so `~/work/api/src` finds what you saved at `~/work/api`. `vibe --status` says which one answered (`saved for this project` / `saved` / `default`).

The full order, highest first: **a flag** → **an environment variable** → **`--here`** → **your global default** → `lofi` at 40%.

---

## ⚙️ Options & Flags

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-g, --genre <name>` | Music style: `lofi`, `synthwave`, `8bit`, `electronic`, `jazz`, `zen`, `piano`, `drone`, `random`. With no command after it, saves your default | `lofi` |
| `-v, --volume <5-100>` | Set playback volume. With no command after it, saves your default | `40` |
| `-cv, --chime-volume <5-100>` | Set independent completion chime volume | `volume × 1.1`, kept within 35–65 |
| `--grace <ms>` | Silence window before music starts | `1500` |
| `--here` | With a saved setting: this directory tree only, not everywhere | off |
| `--seed <n>` | Force a specific arrangement | derived from the project directory |
| `--whisper` | Quick preset: 15% volume (headphones / late night) | — |
| `--quiet` | Quick preset: 25% volume (focus / open office) | — |
| `--loud` | Quick preset: 75% volume (hear from across the room) | — |
| `--no-chime` | Disable the resolution completion chime | `false` |
| `--no-hud` | Disable terminal window/tab title animation | `false` |
| `--preview <genre>` | Play one loop of a genre and exit | — |
| `--status` | Show what's installed, running and detected, then exit | — |
| `--stop` | Stop the background player, then exit | — |
| `--mute [minutes]` | Silence everything for a call, then exit | `60` min (`0` = until unmuted) |
| `--unmute` | Resume normal playback, then exit | — |
| `--clear-cache` | Delete all cached audio, then exit | — |
| `--mcp` | Run as an MCP stdio server for desktop apps | — |
| `--install-hooks` | Wire music into your agent's hooks (no wrapper needed) | — |
| `--tools <list>` | With `--install-hooks`: `claude,codex,cursor,grok,gemini,copilot,qwen` | auto-detect |
| `--reactive` | With `--install-hooks`: intensity follows the tool in use | off |
| `--dry-run` | With `--install-hooks`: show what would change in each file, write nothing | off |
| `--uninstall-hooks` | Remove the hooks again, from every agent | — |
| `-h, --help` | Show help and options | — |
| `--version` | Show version | — |

### ⚙️ Environment Variables

**Defaults live in `~/.vibeaudio/config.json` now** — `vibe --genre jazz` is the short way to set one. These override it for a single shell, which is what you want for one terminal that should sound different, or for a machine you don't want writing config at all:

```bash
export VIBE_GENRE=jazz          # lofi, synthwave, 8bit, electronic, jazz, zen, piano, drone, random
export VIBE_VOLUME=25           # Background music at 25%
export VIBE_CHIME_VOLUME=70     # Crisp completion chime at 70%
export VIBE_GRACE_MS=3000       # Wait 3s of thinking before any music
export VIBE_SEED=7              # Same arrangement everywhere, ignoring the directory
export VIBE_DISABLE=1           # Mute, without uninstalling anything
```

**`VIBE_DISABLE=1` is for a shell you always want quiet** — a CI job, a shared machine, a terminal profile you keep silent. It's read at playback time and covers hooks, wrapper and MCP alike.

**For a call that's ringing right now, use `vibe --mute` instead.** An environment variable can't help there: a hook runs as a child of your agent and inherits the environment the agent had *when it launched*, so exporting `VIBE_DISABLE` in another terminal reaches nothing already running — and restarting your agent is exactly what you can't do mid-call.

```bash
vibe --mute        # silent now, music returns by itself in an hour
vibe --mute 15     # or pick the window
vibe --mute 0      # stay off until I say otherwise
vibe --unmute      # end it early
```

`--mute` writes a flag file, which crosses process boundaries where a variable cannot, and stops whatever is playing on the spot. Your hooks and settings are untouched, so there's nothing to put back afterwards.

**It expires after an hour by default, and that's deliberate.** A call is a bounded thing; a mute you forget about is worse than no mute, because the tool just stops working and nothing ever tells you why. Expiring means the worst case is "music came back sooner than I wanted" rather than a week of silence you never diagnose. `--mute 0` opts into indefinite explicitly, and `vibe --status` always shows how much of the window is left.

Either way, `--preview` still plays: that one is an explicit request to hear something.

---

## 🔧 Troubleshooting

**No sound at all**
Check that a player exists for your platform (see [Requirements](#-requirements)). VibeAudio prints a notice to stderr when it can't find one. On Linux: `sudo apt install pulseaudio-utils` (or `ffmpeg` / `alsa-utils`).

**Music starts immediately instead of after the grace window**
It usually is waiting — your AI tool's own startup (auth, session load) just takes longer than 1.5s, so music and the tool's first output appear together. Raise the window: `vibe --grace 3000 claude`.

**Music sounds stale after upgrading**
It shouldn't. The cache key includes a hash of the synth sources, so changing a generator invalidates it automatically and the old directory is pruned on the next run. To force a rebuild anyway:

```bash
vibe --clear-cache
```

**Silent when the agent runs on another machine over SSH**
Sound plays on the machine where the agent runs, and a remote server usually has no sound card — so VibeAudio finds no player and stays quiet. You can hear it locally by forwarding a PulseAudio socket through the SSH connection: the remote `paplay` sends the audio back over SSH to your own speakers.

This needs a PulseAudio-compatible sound server on **your local machine**: a Linux desktop (PipeWire and PulseAudio both provide one) or Windows with WSLg. macOS has none built in, so this route doesn't apply there.

1. **Connect with the socket forwarded.** On the local machine, pick the socket for your setup:

   ```bash
   ssh -R /tmp/vibe-pulse.sock:"$XDG_RUNTIME_DIR/pulse/native" you@server   # Linux desktop
   ssh -R /tmp/vibe-pulse.sock:/mnt/wslg/PulseServer you@server              # WSLg
   ```

2. **On the server, point audio at it and install a player** — in the shell you launch the agent from, since hooks inherit the agent's environment:

   ```bash
   sudo apt install pulseaudio-utils           # provides paplay
   export PULSE_SERVER=unix:/tmp/vibe-pulse.sock
   vibe --preview jazz                         # you should hear it locally
   ```

If the second connection fails with the socket "already in use", an earlier session left it behind: `rm /tmp/vibe-pulse.sock` on the server, or set `StreamLocalBindUnlink yes` in the server's `sshd_config`. If `paplay` says access denied, your local PulseAudio requires its cookie — copy `~/.config/pulse/cookie` to the same path on the server.

**Volume flag does nothing**
Shouldn't happen any more — where the player can't attenuate (`aplay`, PowerShell), the gain is baked into the audio instead. A `--volume` change lands at the next loop boundary, and on hooks at your next prompt; `vibe --status` shows the volume in effect and what set it.

---

## 🩺 What's actually running

```bash
vibe --status
```

Reads live state rather than guessing — the fastest answer to "why do I hear nothing" or "which genre is this set to":

```
Audio
  player    afplay
  cache     7.6 MB in ~/.vibeaudio/cache

Hooks
  Claude Code
    ✔ Stop
    ✔ UserPromptSubmit     jazz @ 25%, reactive
    ✔ PreToolUse
    ✔ PermissionRequest
    ✔ PostToolUse          jazz @ 25%, reactive
    ✔ StopFailure
    ✔ SessionEnd
  Codex        not installed — run: vibe --install-hooks
  Cursor       not installed — run: vibe --install-hooks
  Grok         not installed (not found on this machine)

Background player
  running pid 59078   stop it with: vibe --stop

AI tools found
  ✔ Claude Code         hooks — installed
  ✔ Codex               hooks — run: vibe --install-hooks
  ✔ Gemini CLI          hooks — run: vibe --install-hooks
  ✔ GitHub Copilot CLI  hooks — run: vibe --install-hooks
```

The last block is detected from your own `PATH`, so it answers "will this work with my tool" without you matching yourself against a table. `vibe --stop` kills the background player on the spot; the next prompt starts a fresh one.

---

## 🧹 Uninstall

**Remove the hooks first, while `vibe` still exists:**

```bash
vibe --uninstall-hooks          # 1. unwire every agent, and stop any player still running
npm rm -g vibeaudio             # 2. remove the CLI
rm -rf ~/.vibeaudio             # 3. optional: cached audio, saved settings, daemon state
```

Step 1 also **stops a background player that's still going**. That matters: once the hooks are gone nothing will ever send the `Stop` event, and after step 2 there's no `vibe` left to stop it with — music would simply play on until its 15-minute cap. If you ever need to do it by hand: `pkill -f "vibeaudio.js --daemon"`.

> **Order matters.** `npm rm -g` deletes the binary but not your hook config. Removing the package first strands hook entries that point at a path that no longer exists, and your agent will run a failing hook on every prompt. If you already did it in the wrong order, reinstall, run `vibe --uninstall-hooks`, then remove again — or delete the `vibeaudio` entries from `~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.cursor/hooks.json`, `~/.gemini/settings.json` and `~/.qwen/settings.json` by hand, and delete `~/.grok/hooks/vibeaudio.json`, `~/.copilot/hooks/vibeaudio.json` and `~/.claude/commands/vibe.md`.

Step 3 reclaims disk — the audio cache, pruned to the 3 most recent projects — and drops your saved genre and volume. Both come back on their own, so skip it if you're reinstalling.

**Two things are deliberately left behind:**

| Leftover | Why, and how to remove it |
| :--- | :--- |
| `*.vibeaudio.bak` next to each shared hook config | Your config as it was before the first install — one each for Claude Code, Codex, Cursor, Gemini CLI and Qwen Code. A safety net we won't delete for you; `rm` them once you're happy the real files are correct, and `vibe --uninstall-hooks` prints the path of every one it finds. (Grok and Copilot CLI leave nothing: their files are ours alone, so uninstall deletes them outright.) |
| `vibeaudio` entries in other apps' MCP configs | VibeAudio never edits those files, so it can't clean them either. Drop the entry from [whichever config you added it to](#-everything-else-claude-desktop-antigravity-via-mcp). |

Apart from those two, the three commands above remove everything VibeAudio writes.

---

## 🤝 Contributing

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the ground rules (zero runtime dependencies, no build step, pure synth modules) and the dev loop. Found a bug? [Open an issue](https://github.com/kiril6/vibeaudio/issues/new) with your **OS**, **Node version**, and which audio player you have installed.

Working on it locally:

```bash
git clone https://github.com/kiril6/vibeaudio.git
cd vibeaudio
npm link        # puts your clone's `vibe` on PATH
npm test
```

---

## 📄 License
MIT © 2026
