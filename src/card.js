/**
 * `vibe --report --card`: the report as a picture you can post. The SVG is
 * built as a string (pure, no I/O, so a test can read it); macOS also gets a
 * PNG through Quick Look, since every other platform would need a rasterizer
 * and this package has no dependencies.
 *
 * It carries totals only, never a project name or path: a card is made to be
 * shared, and a project is the user's to name. It is written locally and
 * sent nowhere.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { formatDuration, summarize, dayTotals } = require("./history");
const { TARGETS } = require("./hooks");

const CARD_DIR = path.join(os.homedir(), ".vibeaudio");
// Square, because Quick Look scales a thumbnail to fit its height and crops the rest.
const SIZE = 1080;
const MAX_BARS = 14;

/** The card's SVG for a non-empty list of turns over the last `days` days. */
function renderCard(turns, days, now = Date.now()) {
  const s = summarize(turns);
  const rows = dayTotals(turns, Math.min(days, MAX_BARS), now);
  const peak = Math.max(...rows.map((r) => r.ms)) || 1;
  const period = days === 1 ? "today" : `last ${days} days`;

  const slot = 920 / rows.length;
  const barW = Math.min(46, slot * 0.6);
  const bars = rows.map((r, i) => {
    const h = r.ms ? Math.max(10, Math.round((r.ms / peak) * 160)) : 4;
    const x = Math.round(80 + i * slot + (slot - barW) / 2);
    return `<rect x="${x}" y="${780 - h}" width="${barW}" height="${h}" rx="${Math.min(barW / 2, 12)}" fill="${r.ms ? "url(#bar)" : "#3c2a5e"}"/>`;
  }).join("") + rows.map((r, i) =>
    `<text x="${Math.round(80 + i * slot + slot / 2)}" y="806" class="d" text-anchor="middle">${r.date.toLocaleDateString("en-US", { weekday: "short" })}</text>`).join("");

  // Pills, not the agents' logos: those are their owners' marks, and a pill
  // from TARGETS cannot fall out of step with what we actually hook into.
  let cx = 80;
  let cy = 864;
  const pills = Object.values(TARGETS).map(({ name }) => {
    const w = Math.round(name.length * 12 + 34);
    if (cx + w > 1000) { cx = 80; cy += 50; }
    const out = `<rect x="${cx}" y="${cy}" width="${w}" height="38" rx="10" fill="#120b1f" stroke="#3c2a5e" stroke-width="2"/><text x="${cx + w / 2}" y="${cy + 26}" class="c" text-anchor="middle">${name}</text>`;
    cx += w + 12;
    return out;
  }).join("");

  const stat = (x, value, label) =>
    `<text x="${x}" y="552" class="v">${value}</text><text x="${x}" y="586" class="l">${label}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
<defs>
<linearGradient id="hero" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff2e97"/><stop offset="1" stop-color="#ffb454"/></linearGradient>
<linearGradient id="bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#a855f7"/><stop offset="0.55" stop-color="#ff2e97"/><stop offset="1" stop-color="#ffb454"/></linearGradient>
<radialGradient id="gp" cx="0.08" cy="0.04" r="0.65"><stop offset="0" stop-color="#ff2e97" stop-opacity="0.24"/><stop offset="1" stop-color="#ff2e97" stop-opacity="0"/></radialGradient>
<radialGradient id="gc" cx="0.98" cy="0.06" r="0.55"><stop offset="0" stop-color="#00e5ff" stop-opacity="0.16"/><stop offset="1" stop-color="#00e5ff" stop-opacity="0"/></radialGradient>
<radialGradient id="gv" cx="0.5" cy="1.02" r="0.7"><stop offset="0" stop-color="#a855f7" stop-opacity="0.16"/><stop offset="1" stop-color="#a855f7" stop-opacity="0"/></radialGradient>
<clipPath id="card"><rect width="${SIZE}" height="${SIZE}" rx="48"/></clipPath>
<filter id="glow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<style>text{font-family:ui-monospace,'SF Mono',Menlo,Monaco,monospace;fill:#f2ecff}.t{font-size:60px;font-weight:800}.h{font-size:84px;font-weight:800}.v{font-size:44px;font-weight:700}.l{font-size:21px;fill:#b3a3d6}.s{font-size:26px;fill:#b3a3d6}.m{font-size:30px;font-weight:800;letter-spacing:2px}.f{font-size:20px;fill:#9584be}.c{font-size:20px}.u{font-size:23px;font-weight:700;fill:#ff2e97}.n{font-size:14px;fill:#8272ad}.d{font-size:16px;fill:#9584be}.i{font-size:20px;font-weight:700;fill:#00e5ff}</style>
</defs>
<g clip-path="url(#card)"><rect width="${SIZE}" height="${SIZE}" fill="#07050d"/><rect width="${SIZE}" height="${SIZE}" fill="url(#gp)"/><rect width="${SIZE}" height="${SIZE}" fill="url(#gc)"/><rect width="${SIZE}" height="${SIZE}" fill="url(#gv)"/></g>
<rect x="3" y="3" width="${SIZE - 6}" height="${SIZE - 6}" rx="46" fill="none" stroke="#3c2a5e" stroke-width="3"/>
<g transform="translate(80 78) scale(0.17) translate(-60 -100)"><path d="M120 300V272a136 136 0 0 1 272 0V300" fill="none" stroke="url(#bar)" stroke-width="30" stroke-linecap="round"/><rect x="86" y="286" width="76" height="136" rx="32" fill="url(#bar)"/><rect x="350" y="286" width="76" height="136" rx="32" fill="url(#bar)"/><g fill="#00e5ff"><rect x="212" y="326" width="22" height="56" rx="11"/><rect x="245" y="296" width="22" height="116" rx="11"/><rect x="278" y="318" width="22" height="72" rx="11"/></g></g>
<text x="164" y="126" class="m">VIBE<tspan fill="#ff2e97" style="fill:#ff2e97" filter="url(#glow)">AUDIO</tspan></text>
<text x="1000" y="124" class="u" text-anchor="end">kiril6.github.io/vibeaudio</text>
<text x="80" y="224" class="t" filter="url(#glow)">Focus music</text>
<text x="80" y="298" class="t" filter="url(#glow)">while your <tspan style="fill:#00e5ff">AI</tspan> codes.</text>
<text x="80" y="420" class="h" style="fill:url(#hero)">${formatDuration(s.waited)}</text>
<text x="80" y="462" class="s">with my <tspan style="fill:#00e5ff" font-weight="800">AI</tspan> agents working · ${period}</text>
${stat(80, String(s.count), s.count === 1 ? "turn" : "turns")}${stat(360, formatDuration(s.median), "typical turn")}${stat(680, formatDuration(s.longest.ms), "longest turn")}
${bars}
${rows.length < days ? `<text x="1000" y="842" class="f" text-anchor="end">bars: last ${rows.length} days</text>` : ""}
<text x="80" y="842" class="f">works as a hook for</text>
${pills}
<rect x="80" y="972" width="578" height="52" rx="10" fill="#0a1a22" stroke="#00e5ff" stroke-opacity="0.45" stroke-width="2"/>
<text x="100" y="1005" class="i">npm i -g vibeaudio &amp;&amp; vibe --install-hooks</text>
<text x="1000" y="1000" class="n" text-anchor="end">Not affiliated with or endorsed</text>
<text x="1000" y="1020" class="n" text-anchor="end">by the tools named.</text>
</svg>
`;
}

/** Write `file` by renaming a temp file into place, so an interrupted run leaves no torn card. */
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/**
 * Writes the card as one fixed file, replaced on every run, so nothing
 * accumulates. `out` is a user-chosen path (kept as given); without it the card
 * lives in ~/.vibeaudio. Returns the SVG path and the PNG path (null off macOS
 * or when Quick Look could not render).
 */
function writeCard(turns, days, { out = null, now = Date.now(), dir = CARD_DIR } = {}) {
  const base = out ? path.resolve(out.replace(/\.(svg|png)$/i, "")) : path.join(dir, "card");
  fs.mkdirSync(path.dirname(base), { recursive: true });
  const svgPath = `${base}.svg`;
  writeAtomic(svgPath, renderCard(turns, days, now));

  let pngPath = null;
  if (process.platform === "darwin") {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-card-"));
    try {
      // SIGKILL as well as a timeout: a hung system helper ignores SIGTERM.
      const r = spawnSync("qlmanage", ["-t", "-s", String(SIZE), "-o", scratch, svgPath], { stdio: "ignore", timeout: 15000, killSignal: "SIGKILL" });
      const rendered = path.join(scratch, `${path.basename(svgPath)}.png`);
      if (r.status === 0 && fs.existsSync(rendered)) {
        // Copy, not rename: the scratch dir and `--out` may be on different volumes.
        const png = `${base}.png`;
        writeAtomic(png, fs.readFileSync(rendered));
        pngPath = png;
      }
    } catch (e) {
      pngPath = null;
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  return { svgPath, pngPath };
}

module.exports = { CARD_DIR, renderCard, writeCard };
