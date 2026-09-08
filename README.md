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
* 🔔 **Audible Completion Chime:** When the AI finishes, the music resolves into a gentle chime. You can tab away to other windows and know the exact moment your answer is ready.
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
❯ 1. ☕ Lo-Fi Focus     — Warm Rhodes electric piano & Kalimba drops
  2. 🌌 Chill Synthwave  — '80s analog chorused pads & pulsing bass
  3. 🕹️ Cozy 8-Bit      — Filtered retro chiptune arpeggios
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

## 🎨 Music Genres

Switch genres with the `-g` or `--genre` flag:

```bash
# ☕ Lo-Fi Focus (Default): Warm Rhodes electric piano + Kalimba drops
vibeaudio --genre lofi claude

# 🌌 Chill Synthwave: '80s analog chorused pads + pulsing retro bass
vibeaudio --genre synthwave claude

# 🕹️ Cozy 8-Bit: Filtered chiptune arpeggios + NES triangle bass
vibeaudio --genre 8bit claude
```

---

## ⚙️ Options & Flags

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-g, --genre <name>` | Music style: `lofi`, `synthwave`, `8bit` | `lofi` |
| `-v, --volume <0-100>` | Set playback volume | `40` |
| `--no-chime` | Disable the completion resolution chime | `false` |
| `-h, --help` | Show help and options | — |
| `--version` | Show version | — |

---

## 🧠 Smart Audio UX

* **1.5-Second Grace Window:** Fast commands (like `/help` or quick queries) never trigger music. Music only starts if the AI takes longer than 1.5 seconds.
* **Instant Termination:** The exact millisecond the AI command finishes or receives `Ctrl+C`, audio stops immediately.
* **Resolution Chime:** Plays an audible signal on success so you can tab away to other apps and tab back when you hear the chime.
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
