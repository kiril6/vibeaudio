# Security

## Reporting a vulnerability

Use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/kiril6/vibeaudio/security/advisories/new)). Include the version (`vibe --version`), what you did and what happened. Don't open a public issue for something exploitable. You'll get a reply within a few days; this is a one-person project, so a fix usually follows within a week for anything real.

## Supported versions

Only the latest release on npm. Fixes ship as a patch release.

## What VibeAudio touches

Useful when judging a report, or deciding whether to install it:

- **No dependencies, no install scripts.** Nothing runs on `npm install`.
- **Files it writes:** `~/.vibeaudio/` (settings, a cache of generated audio, session state, a local turn log) and, only when you run `vibe --install-hooks`, the hook config of each agent you name or that it detects. It backs the original up once and `--uninstall-hooks` removes its entries.
- **Processes it starts:** your OS audio player (`afplay`, `paplay`, `ffplay`, `aplay`, PowerShell) with a fixed argument list, `osascript`/`notify-send` for the opt-in banner, and the command you give `vibe <command>`. No command line is built from agent or model input.
- **Network:** one request, to `registry.npmjs.org`, at most once a day, to say whether a newer version exists. It sends nothing about you. Silenced by `VIBE_NO_UPDATE_CHECK=1` and absent under CI.
- **MCP server (`vibe --mcp`):** three tools, `vibe_play`, `vibe_stop` and `vibe_status`. They start and stop local audio and report its state. They read no files you choose and make no network calls, and each declares its annotations.
- **Releases** are published by GitHub Actions through npm trusted publishing (OIDC, with provenance), not from a laptop, and no npm token is stored.
