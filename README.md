# 🎧 VibeAudio

> **Context-aware procedural focus music while your AI coding tools think.**  
> Zero dependencies. Zero setup. Works with Claude Code, Gemini CLI, Codex, Aider, and any terminal command.

---

## ⚡ The Problem

When AI coding agents take 15–45 seconds to reason, read files, and write code, staring at a blank terminal cursor feels agonizingly slow. If you tab away, you have to constantly check back to see if it's done.

**VibeAudio fixes dead air:**
1. **Procedural Focus Music:** While your AI agent is thinking, VibeAudio plays warm, gentle procedural music in the background.
2. **Zero Fatigue:** Built on soothing Lo-Fi Rhodes chords, analog Synthwave pads, or filtered 8-bit retro vibes—never repetitive loops.
3. **The "Done" Chime:** When the AI finishes, the music fades out and a delicate glassy chime signals that your output is ready to read.

---

## ✨ What Makes VibeAudio Different

Most audio tools for terminals rely on static MP3 files or complex audio drivers. VibeAudio was built specifically for modern AI workflows with a focus on deep work and zero annoyance:

* 🧮 **Pure Procedural Synthesis (Zero MP3s):** Every note, chord, and pad is generated mathematically in real time with pure code. Zero audio assets to download, and zero loop fatigue.
* 🛡️ **The 1.5-Second Grace Window:** Fast commands (like `/help` or quick queries) remain 100% silent. Music only begins if the AI takes longer than 1.5 seconds.
* 📈 **Adaptive Time Escalation:** Music builds energy naturally as the prompt runs (Tier 1: 0–15s gentle intro → Tier 2: 15–45s main groove → Tier 3: 45s+ deep focus layer). You can literally hear how deep into the task the AI is.
* 🔔 **Outcome-Aware Chimes:** Plays a bright ascending chime on success (`exit 0`), and a soft, melancholic descending minor chord on error (`exit 1`).
* 🌊 **ASCII Waveform HUD:** Real-time animated audio wave and timer in your terminal and window/tab title.
* 🔌 **Universal Drop-In Wrapper:** Works out-of-the-box with **Claude Code, Gemini CLI, Codex, Aider**, or any terminal command (`vibe <command>`) with zero configuration.
* 🪶 **Zero Build Dependencies:** Written in pure Node.js with no C++ bindings (`node-gyp`). `npx vibeaudio` runs instantly on any Mac without installation headaches.

---

## 🚀 Quickstart

Run directly with **`npx`** (no installation required!):

### 1. Interactive Launcher Menu
Just run `npx vibeaudio` with no arguments to get an interactive menu where you can choose your AI and music vibe:

```bash
npx vibeaudio
```

```
🎧 VibeAudio — Interactive AI Launcher

Which AI companion would you like to launch?
❯ 1. Claude Code        [✓ installed]
  2. Gemini CLI         [✓ installed]
  3. Codex CLI
  4. Aider
  5. Ollama (Llama 3)
  6. Custom command...

Choose your sound vibe:
❯ 1. ☕ Lo-Fi Focus        — Warm Rhodes electric piano & Kalimba drops
  2. 🌌 Chill Synthwave    — '80s analog chorused pads & pulsing bass
  3. 🕹️ Cozy 8-Bit         — Filtered retro chiptune arpeggios
  4. ⚡ Melodic Electronic  — Downtempo resonant plucks & tech pulse
  5. 🎷 Midnight Jazz      — ii-V-I piano chords & walking upright bass
  6. 🎋 Zen Ambient        — Meditative singing bowls & celestial pads
  7. 🎲 Shuffle / Random   — Picks a surprise vibe each time

Choose your volume level:
❯ 1. ☕ Normal (40%)       — Balanced focus background [Default]
  2. 🤫 Quiet (25%)        — Discreet focus / open office
  3. 🌙 Whisper (15%)      — Ultra-gentle / headphones / late night
  4. 📢 Loud (75%)         — Audible across the room
```

### 2. Direct Command Wrapper
Or wrap any tool directly:

```bash
# Wrap Claude Code
npx vibeaudio claude

# Wrap Gemini CLI
npx vibeaudio gemini

# Test with a 5-second sleep
npx vibeaudio sleep 5
```

---

## 📦 Global Installation

For daily use, install globally so it launches instantly with zero startup delay:

```bash
npm install -g vibeaudio
```

### Pro Tip: The 1-Line Shell Alias
Add this to your `~/.zshrc` or `~/.bashrc`:

```bash
alias claude="vibeaudio claude"
alias gemini="vibeaudio gemini"
```
Now, whenever you run `claude`, music automatically plays while it works!

---

## 🖥️ Desktop GUI Apps (Claude Desktop & Antigravity via MCP)

VibeAudio includes a native **Model Context Protocol (MCP)** server over stdio. This allows desktop AI applications to trigger focus music and completion chimes during reasoning and tool execution.

### Claude Desktop Setup
Add this to your `claude_desktop_config.json` (on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vibeaudio": {
      "command": "npx",
      "args": ["vibeaudio", "--mcp"]
    }
  }
}
```

### Antigravity Setup
Add this to your Antigravity MCP configuration:

```json
{
  "mcpServers": {
    "vibeaudio": {
      "command": "npx",
      "args": ["vibeaudio", "--mcp"]
    }
  }
}
```

#### Exposed MCP Tools:
* `vibe_play`: Start playing procedural focus music (`genre`: `lofi`, `synthwave`, `8bit`, `electronic`, `jazz`, `zen`, `random`; `volume`: `5-100`).
* `vibe_stop`: Stop music and play completion chime (`outcome`: `success` or `failure`).
* `vibe_status`: Return current playback state and active tier.

---

## 🎨 Music Genres

VibeAudio includes **6 procedural music styles** synthesized entirely in code:

| Genre | Style | Vibe |
| :--- | :--- | :--- |
| `lofi` | ☕ **Lo-Fi Focus** *(Default)* | Warm Rhodes electric piano chords & Kalimba drops |
| `synthwave` | 🌌 **Chill Synthwave** | '80s analog chorused pads & pulsing retro bass |
| `8bit` | 🕹️ **Cozy 8-Bit** | Filtered retro chiptune arpeggios & NES triangle bass |
| `electronic` | ⚡ **Melodic Electronic** | Downtempo resonant plucks & crisp tech pulse |
| `jazz` | 🎷 **Midnight Jazz** | Classic ii-V-I jazz piano chords & walking upright bass |
| `zen` | 🎋 **Zen Ambient** | Meditative Tibetan singing bowls & celestial drone (zero rhythm) |
| `random` | 🎲 **Shuffle Mode** | Picks a surprise genre on every run! |

### Usage Examples:
```bash
# Launch with Melodic Electronic
vibeaudio --genre electronic claude

# Launch with Midnight Jazz
vibeaudio --genre jazz gemini

# Launch with Zen Ambient (no drums/rhythm)
vibeaudio --genre zen claude

# Surprise shuffle on every prompt
vibeaudio --genre random claude
```

### ⚙️ Set Your Favorite Genre as Default
Add this to your `~/.zshrc` or `~/.bashrc` to set a persistent default:

```bash
export VIBE_GENRE=jazz     # or synthwave, electronic, zen, random
```

---

## ⚙️ Options & Flags

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-g, --genre <name>` | Music style: `lofi`, `synthwave`, `8bit`, `electronic`, `jazz`, `zen`, `random` | `lofi` |
| `-v, --volume <0-100>` | Set playback volume | `40` |
| `-cv, --chime-volume <0-100>` | Set independent completion chime volume | `volume * 1.1` |
| `--whisper` | Quick preset: 15% volume (headphones / late night) | — |
| `--quiet` | Quick preset: 25% volume (focus / open office) | — |
| `--loud` | Quick preset: 75% volume (hear from across the room) | — |
| `--no-chime` | Disable the resolution completion chime | `false` |
| `--no-hud` | Disable terminal window/tab title animation | `false` |
| `-h, --help` | Show help and options | — |
| `--version` | Show version | — |

### ⚙️ Environment Variables
Set persistent defaults in your `~/.zshrc` or `~/.bashrc`:

```bash
export VIBE_GENRE=jazz          # lofi, synthwave, 8bit, electronic, jazz, zen, random
export VIBE_VOLUME=25           # Background music at 25%
export VIBE_CHIME_VOLUME=70     # Crisp completion chime at 70%
```

---

## 🧠 Smart Audio UX

* **1.5-Second Grace Window:** Fast commands (like `/help` or quick queries) never trigger music. Music only starts if the AI takes longer than 1.5 seconds.
* **Instant Termination:** The exact millisecond the AI command finishes or receives `Ctrl+C`, audio stops immediately.
* **Outcome-Aware Resolution:** Plays a bright ascending chime on success (`exit 0`), and a soft descending minor tone on failure (`exit 1`) so you know the result even if you're in another room.
* **Tab-Title Animation:** Keeps an ASCII wave and timer pulsing in your terminal window/tab title while you work.
* **Pure JavaScript:** Zero C++ build dependencies (`node-gyp`), so `npx` works reliably on any Mac without compile errors.

---

## 🚢 Publishing to GitHub & NPM

### 1. Push to GitHub
```bash
git remote add origin https://github.com/<your-username>/vibeaudio.git
git add .
git commit -m "feat: initial release of vibeaudio"
git push -u origin main
```

### 2. Publish to NPM
```bash
# Login to your npm account (one-time)
npm login

# Publish publicly
npm publish --access public
```

Now anyone can run `npx vibeaudio <command>`!

---

## 📄 License
MIT © 2026
