# Contributing to VibeAudio

Contributions welcome. To keep the project simple and dependable, a few ground rules.

## Principles

- **Zero runtime dependencies.** `package.json` has no `dependencies` block and should stay that way. Every oscillator, envelope and WAV header is hand-rolled in `src/synth/`. Don't add a package for what a few lines of math can do.
- **No build step.** Plain CommonJS Node (`engines.node >= 18`). No bundler, no transpiler, no `node-gyp` — `npx github:kiril6/vibeaudio` must keep working on a clean machine.
- **Keep `src/synth/` pure.** Those modules take numbers and return a WAV `Buffer`. No file I/O, no spawning, no globals — that purity is what lets `test/test-synth.js` assert on generator output directly.
- **Parse arguments in one place.** All flags and env vars go through `parseArgs` in `src/cli.js`, which is unit-tested. Don't read `process.argv` or `process.env` anywhere else.
- **Never let audio break the wrapped command.** VibeAudio is a wrapper; if playback fails, the user's tool must still run, and the exit code must still propagate unchanged.
- **Test on more than one platform** when touching playback (`src/player.js`) — the backend differs per OS.

## Architecture

[`CLAUDE.md`](CLAUDE.md) is the architecture + conventions brief — read it first if you're changing anything beyond a single genre.

Short version:

```
bin/vibeaudio.js → src/cli.js#run()
                     ├─ --mcp        → src/mcp.js   (JSON-RPC stdio server)
                     ├─ no args +TTY → src/interactive.js (launcher menu)
                     └─ <command>    → executeCommand() → spawn child
                                          ├─ src/player.js (cache + playback)
                                          └─ src/hud.js    (tab title HUD)
```

`src/player.js` owns the audio cache (`~/.vibeaudio/cache/v<version>-<synth hash>/s<seed>/`), OS player detection, tier escalation and the gapless loop scheduler.

## AI-assisted development

This project is built with the help of [Claude Code](https://claude.com/claude-code), and you're welcome to continue that way (Claude Code, Cursor, or any other AI tool). [`CLAUDE.md`](CLAUDE.md) is loaded automatically by Claude Code and is the fastest way to get an agent oriented.

## Adding a genre

1. Create `src/synth/<name>.js` exporting `generate<Name>Loop(durationSec, tier, seed)`.
2. Build it from the shared primitives in `src/synth/generator.js` (`noteToFreq`, `sine`, `triangle`, `softPulse`, `analogSaw`, `createWavBuffer`).
3. **Honour the `tier` argument** — tier 1 is a sparse intro, tier 2 the main groove, tier 3 the peak layer. A generator that ignores `tier` produces three identical cache files and silently breaks escalation.
4. **Honour the `seed` argument, and stay deterministic.** Write 2–4 hand-checked progression variants, all diatonic to one key, each with the bass line that spells its changes; `pick(makeRng(seed), VARIANTS)` chooses one. Never `Math.random()` — dither goes through `ornamentRng(seed)` too, or the same seed renders different bytes and the cache breaks.
5. **Draw ornaments before gating them by tier.** If a `tier >= 2` branch consumes random values, tier 1 and tier 3 stop being the same piece.
6. Fade the first and last ~0.08s so the loop boundary doesn't click.
7. Register it in `src/player.js`: add to `AVAILABLE_GENRES` and to the `generateLoop` switch.
8. Add it to the menu in `src/interactive.js`, the genre table in `README.md`, and the tier/seed tests in `test/test-synth.js`.

**Listen before you ship.** The test suite proves a generator is deterministic and that tiers differ — it cannot tell you whether the result sounds good. Use `--preview` with a few seeds (`vibe --seed 1 --preview <name>`, then 2, 3…) and actually listen to each variant.

## Dev loop

```bash
node bin/vibeaudio.js sleep 5          # run the wrapper without installing
node bin/vibeaudio.js --preview jazz   # audition a genre
node bin/vibeaudio.js --clear-cache    # force regeneration after a synth change
npm test                               # full suite (plain node + assert)
```

`npm test` is a single linear script of assertions — no framework, no filtering. Keep it that way, and keep it fast.

> **The cache key is derived from the generators, not declared.** `synthFingerprint()` hashes every file in `src/synth/`, so editing one invalidates the cache on its own — you do not need to bump anything, and `--clear-cache` is only for when you want a clean slate. This replaced keying on the version alone, which required someone to remember: eight of the ten generators changed across forty commits while the version sat still, so the mechanism meant to deliver audio fixes had never once fired.

## Submitting changes

This repo uses the standard **fork & pull-request** flow:

1. **Fork** this repo to your own account and clone your fork.
2. Create a branch: `git checkout -b my-change`.
3. Make your change, run `npm test`, and listen to the result if you touched audio.
4. Push to your fork and **open a pull request** against `kiril6/vibeaudio`.
5. The maintainer reviews and merges.

Keep PRs focused and small where you can; it makes review faster.

## Releasing (maintainers)

**Contributors don't do this.** You fork and open a PR (see above) — that's the whole job.

```bash
# 1. Bump the version. Note this is NOT what ships synth changes - the cache
#    key hashes src/synth/ itself, so a generator edit already invalidates it.
npm version patch          # or minor / major

# 2. Update the release chip on the site (docs/index.html, "chip-v") and amend
#    it into the version commit, so the page and npm never disagree.

# 3. Push the commit and tag - this publishes
git push --follow-tags

# 4. Write the release notes
gh release create vX.Y.Z --title vX.Y.Z --notes "..."
```

Pick the bump by semver: patch = fix, minor = feature, major = breaking.

**Pushing a `v*` tag publishes to npm** (`.github/workflows/publish.yml`). It checks the tag matches `package.json`, runs the tests, and publishes with provenance through npm trusted publishing — no token stored anywhere. Don't run `npm publish` by hand; a release that skips the workflow has no provenance.

## Reporting bugs

[Open a bug report](https://github.com/kiril6/vibeaudio/issues/new?template=bug_report.yml). The form asks for the output of `vibe --status`, which already covers your version, audio player and installed hooks, plus your OS, Node version and which agent you were using.
