// VibeAudio controls for Claude Code. This mod never writes VibeAudio's
// settings itself: every change is the `vibe` CLI run with an argument list,
// so it cannot drift from the CLI. It reads ~/.vibeaudio/config.json and
// ~/.vibeaudio/muted (two small files the CLI owns) only to draw what is set.
//
// Validation rules shape this file: `$` is passed only to top-level
// functions, event names are literals, and nothing is imported.

const PANE = 'vibeaudio'
// Keep in step with AVAILABLE_GENRES in src/player.js (a root test checks it).
const GENRES = ['lofi', 'synthwave', '8bit', 'electronic', 'jazz', 'zen', 'piano', 'drone', 'rain', 'ocean']
const DEFAULT_MUTE_MINUTES = 60
const REFRESH_MS = 30000
const NO_VIBE = 'could not run vibe - install it with: npm i -g vibeaudio'
const HELP = 'Usage: /vibeaudio [mute [min] | unmute | genre <name> | volume <5-100> | music on|off | speak off|auto|always | notify on|off | card [days] | doctor | strip on|off | usage on|off | test | stop | status | help]'
const HELP_HERE = 'Add "here" to save for this project only: /vibeaudio genre jazz here'

// What the pane and the band draw, refreshed from the two files.
let view = { genre: 'lofi', volume: 40, music: true, speak: 'off', notify: false, muteUntil: undefined, here: false }
let note = ''
let cardFile = null
let cardIsPng = false
// The optional strip above the prompt: off until asked, remembered in $.store.
let strip = false
let others = []
const POLL_MS = 5000
const FRAME_MS = 600
// This session's turn (turn.start / turn.complete), the last 7 days from
// history.jsonl, and the equalizer's frame.
let working = false
let stats = null
// Opt-in: context fill and rate limits on the band, from what the status line has.
let usageOn = false
let usage = null
let frame = 0
// Only the terminal's text bars need a redraw per frame; the SVG animates itself, and a redraw restarts it.
let ticks = false
// The pane's choice of where genre, volume and music are saved: everywhere or this project.
let scopeHere = false
// `vibe --doctor`'s lines, drawn in a pane of their own.
let doctor = []
const DOCTOR = 'vibeaudio-doctor'

// The site's design tokens (docs/index.html :root), in three strengths: the
// site's own neon for a dark theme, a deeper set for a light one, and a middle
// set when the theme is "auto" and nothing says which the terminal is.
const PALETTES = {
  dark: { pink: '#ff2e97', cyan: '#00e5ff', purple: '#a855f7', amber: '#ffb454', genre: { lofi: '#ffb454', synthwave: '#ff2e97', '8bit': '#39ff8d', electronic: '#00e5ff', jazz: '#ff7a45', zen: '#39ffc9', piano: '#7cb8ff', drone: '#c084fc', rain: '#5ab0ff', ocean: '#2dd4bf' } },
  mid: { pink: '#e6007e', cyan: '#0e91ad', purple: '#9b4de8', amber: '#bf7a00', genre: { lofi: '#bf7a00', synthwave: '#e6007e', '8bit': '#1f9d55', electronic: '#0e91ad', jazz: '#e0541b', zen: '#12a37f', piano: '#3b82d6', drone: '#a05be0', rain: '#2e86de', ocean: '#14a898' } },
  light: { pink: '#c4006a', cyan: '#00728a', purple: '#7a2fd0', amber: '#96590a', genre: { lofi: '#96590a', synthwave: '#c4006a', '8bit': '#17753f', electronic: '#00728a', jazz: '#b8400f', zen: '#0d7a5f', piano: '#1f5fb0', drone: '#7e3fc0', rain: '#1c64b8', ocean: '#0d7f73' } },
}
// The status chip is dark on every theme, so its text always uses the neon set.
const CHIP = { bg: '#140c22', ...PALETTES.dark }
let INK = PALETTES.mid

async function readTheme($) {
  try {
    const row = (await $.config.list()).find((r) => r.key === 'theme')
    const t = String((row && row.value) || '')
    INK = PALETTES[/light/i.test(t) ? 'light' : /dark/i.test(t) ? 'dark' : 'mid']
  } catch (err) {
    INK = PALETTES.mid
  }
}

// A titled card: rounded border in the section's colour.
function panel(Box, Text, title, color, children) {
  return Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: color,
    paddingX: 1,
    children: [Text({ color, bold: true, children: [title] }), ...children],
  })
}

const stripAnsi = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, '')
const firstLine = (s) => stripAnsi(s).split('\n').map((l) => l.trim()).find(Boolean) || ''

async function home($) {
  return (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
}

async function readJson($, file) {
  try {
    return JSON.parse(await $.fs.read(file))
  } catch (err) {
    return null
  }
}

// muteUntil: undefined = not muted, null = muted with no end, number = ends then.
async function refresh($) {
  // A redraw restarts the SVG's own animation, so the 30 s refresh draws only when something it shows changed.
  const before = JSON.stringify([view, stats, INK, usage, minutesLeft()])
  const dir = (await home($)) + '/.vibeaudio/'
  const config = (await readJson($, dir + 'config.json')) || {}
  const mute = await readJson($, dir + 'muted')
  const speak = String(config.speak ?? '').trim().toLowerCase()
  const mine = projectEntry(config, await $.session.cwd())
  const pick = (key) => (mine[key] !== undefined ? mine[key] : config[key])
  view = {
    genre: typeof pick('genre') === 'string' ? pick('genre') : 'lofi',
    volume: Number.isFinite(Number(pick('volume'))) ? Number(pick('volume')) : 40,
    music: !['off', '0', 'false', 'no'].includes(String(pick('music') ?? 'on').trim().toLowerCase()),
    here: ['genre', 'volume', 'music'].some((k) => mine[k] !== undefined),
    speak: speak === 'always' ? 'always' : ['1', 'true', 'on', 'yes', 'auto'].includes(speak) ? 'auto' : 'off',
    notify: ['1', 'true', 'on', 'yes'].includes(String(config.notify ?? '').trim().toLowerCase()),
    muteUntil: mute ? (mute.until ? Number(mute.until) : null) : undefined,
  }
  await readStats($)
  await readTheme($)
  if (usageOn) {
    try { takeUsage(await $.session.usage()) } catch (err) { usage = null }
  }
  if (JSON.stringify([view, stats, INK, usage, minutesLeft()]) !== before) $.ui.invalidate('ui.render')
}

// The totals the week card shows, read from the CLI's own log; drawn only.
async function readStats($) {
  try {
    const text = await $.fs.read((await home($)) + '/.vibeaudio/history.jsonl')
    const since = Date.now() - 7 * 86400000
    let turns = 0
    let waited = 0
    const days = [0, 0, 0, 0, 0, 0, 0]
    for (const line of text.split('\n')) {
      let t = null
      try { t = JSON.parse(line) } catch (err) { t = null }
      if (!t || !(t.at >= since)) continue
      turns++
      const ms = Math.max(0, (Number(t.ms) || 0) - (Number(t.blockedMs) || 0))
      waited += ms
      // Local calendar days, as the card's dayTotals() buckets them; index 6 is today.
      const ago = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(t.at).setHours(0, 0, 0, 0)) / 86400000)
      days[Math.max(0, 6 - ago)] += ms
    }
    stats = { turns, waited, days }
  } catch (err) {
    stats = null
  }
}

// One block per day, tallest = busiest, a dot for a day with nothing.
function sparkline(days) {
  const peak = Math.max(...days)
  const blocks = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588'
  return days.map((d) => (d > 0 ? blocks[Math.min(7, Math.floor((d / peak) * 7.99))] : '\u00b7')).join(' ')
}

function duration(ms) {
  const m = Math.round(ms / 60000)
  if (m < 1) return Math.round(ms / 1000) + 's'
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'
}

// Context fill and rate-limit windows as one short string, and whether any is near its limit.
function usageText() {
  if (!usage) return null
  const parts = []
  if (usage.ctx !== undefined) parts.push('ctx ' + Math.round(usage.ctx) + '%')
  for (const l of usage.limits) {
    const tag = l.kind === 'five_hour' ? '5h' : l.kind === 'seven_day' ? '7d' : null
    if (tag) parts.push(tag + ' ' + Math.round(l.percentUsed) + '%')
  }
  if (!parts.length) return null
  const peak = Math.max(usage.ctx || 0, ...usage.limits.map((l) => l.percentUsed))
  return { text: parts.join('  '), hot: peak >= 80 }
}

function takeUsage(u) {
  usage = { ctx: u.context && typeof u.context.percent === 'number' ? u.context.percent : undefined, limits: Array.isArray(u.rateLimits) ? u.rateLimits : [] }
}

// Music is in the air: not muted, music on, and some agent is working.
function playing() {
  return minutesLeft() === undefined && view.music && (working || others.some((o) => o.state === 'working'))
}

// The logo: headphones around three level bars, which move while music plays.
function logoSvg(on) {
  const bar = (x, base, frames) => {
    const hs = on ? frames : [base]
    const anim = on
      ? '<animate attributeName="height" values="' + hs.join(';') + '" dur="1.2s" repeatCount="indefinite"/>' +
        '<animate attributeName="y" values="' + hs.map((h) => 354 - h / 2).join(';') + '" dur="1.2s" repeatCount="indefinite"/>'
      : ''
    return '<rect x="' + x + '" y="' + (354 - hs[0] / 2) + '" width="22" height="' + hs[0] + '" rx="11" fill="' + INK.cyan + '">' + anim + '</rect>'
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="70 120 372 320"><defs>' +
    '<linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="' + INK.purple + '"/><stop offset="0.55" stop-color="' + INK.pink + '"/><stop offset="1" stop-color="' + INK.amber + '"/></linearGradient></defs>' +
    '<path d="M120 300V272a136 136 0 0 1 272 0V300" fill="none" stroke="url(#g)" stroke-width="30" stroke-linecap="round"/>' +
    '<rect x="86" y="286" width="76" height="136" rx="32" fill="url(#g)"/><rect x="350" y="286" width="76" height="136" rx="32" fill="url(#g)"/>' +
    bar(212, 56, [56, 112, 40, 96, 56]) + bar(245, 116, [116, 60, 120, 52, 116]) + bar(278, 72, [72, 30, 104, 64, 72]) + '</svg>'
}

// The same three bars as text, for the terminal, which has no SVG.
function logoText(on) {
  const g = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587'
  if (!on) return '\u2583\u2587\u2585'
  return [0, 1, 2].map((i) => g[(frame * 3 + i * 5) % 7]).join('')
}

// The settings saved for this folder: the nearest entry walking up from the
// session's directory, as the CLI's projectSettings() does.
function projectEntry(config, cwd) {
  const projects = config.projects
  if (!projects || typeof projects !== 'object' || typeof cwd !== 'string') return {}
  let dir = cwd.length > 1 ? cwd.replace(/[\\/]+$/, '') : cwd
  for (let i = 0; i < 64; i++) {
    const entry = projects[dir]
    if (entry && typeof entry === 'object') return entry
    const parent = dir.replace(/[\\/][^\\/]*$/, '')
    if (parent === dir || parent === '') return {}
    dir = parent
  }
  return {}
}

function minutesLeft() {
  if (view.muteUntil === undefined) return undefined
  if (view.muteUntil === null) return null
  const left = Math.ceil((view.muteUntil - Date.now()) / 60000)
  return left > 0 ? left : undefined
}

// Runs the CLI. Never throws: a failure is { ok: false, message }.
async function vibe($, argv, timeoutMs) {
  try {
    const r = await $.process.run(['vibe', ...argv], { timeoutMs: timeoutMs || 15000 })
    if (r.exitCode === 0) return { ok: true, out: r.stdout }
    return { ok: false, out: r.stdout, message: firstLine(r.stderr) || firstLine(r.stdout) || 'vibe exited with ' + r.exitCode }
  } catch (err) {
    return { ok: false, message: NO_VIBE }
  }
}

async function draws($) {
  const surfaces = await $.session.surfaces()
  return surfaces.some((s) => s === 'terminal' || s === 'desktop')
}

// A toast where something draws; text where nothing does (VS Code, -p). Text
// is read by the model, so it is used only when a toast would not be seen.
async function say($, text) {
  if (await draws($)) {
    note = text
    $.ui.toast(text)
    $.ui.invalidate('ui.render')
    return {}
  }
  return { text }
}

async function change($, argv, okText) {
  const r = await vibe($, argv)
  await refresh($)
  return say($, r.ok ? okText : r.message)
}

async function makeCard($, days) {
  const r = await vibe($, ['--report', String(days), '--card'], 25000)
  if (!r.ok) return say($, r.message)
  const dir = (await home($)) + '/.vibeaudio/card.'
  cardIsPng = await $.fs.exists(dir + 'png')
  cardFile = dir + (cardIsPng ? 'png' : 'svg')
  return say($, 'Card saved: ' + cardFile)
}

async function openCard($) {
  if (!cardFile) return say($, 'Make the card first')
  for (const opener of ['open', 'xdg-open']) {
    try {
      const r = await $.process.run([opener, cardFile], { timeoutMs: 10000 })
      if (r.exitCode === 0) return {}
    } catch (err) {
      // not installed here; try the next
    }
  }
  return say($, 'Card is at ' + cardFile)
}

// Other agents on this machine, from `vibe --state`; only polled while the strip is on.
async function pollOthers($) {
  if (!strip) return
  const r = await vibe($, ['--state'], 5000)
  let next = []
  try {
    const own = await $.session.id()
    next = JSON.parse(r.out).sessions
      .filter((x) => x.session !== own)
      .map((x) => ({ name: String(x.project || '').split(/[\\/]/).filter(Boolean).pop() || 'agent', state: x.state }))
  } catch (err) {
    next = []
  }
  if (JSON.stringify(next) !== JSON.stringify(others)) {
    others = next
    $.ui.invalidate('ui.render')
  }
}

async function setUsage($, on) {
  usageOn = on
  await $.store.set('usage', on)
  usage = null
  await refresh($)
  return say($, on ? 'Usage on the strip' : 'Usage off the strip')
}

async function setStrip($, on) {
  strip = on
  await $.store.set('strip', on)
  others = []
  await refresh($)
  await pollOthers($)
  return say($, on ? 'Strip on' : 'Strip off')
}

// vibe --doctor exits 1 when it finds a problem, and its report is still the
// answer, so the output is used whatever the exit code was.
async function runDoctor($) {
  const r = await vibe($, ['--doctor'], 30000)
  const text = stripAnsi(r.out || '')
  if (!text.trim()) return say($, r.message || 'doctor printed nothing')
  doctor = text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '')
  if (!(await draws($))) {
    const interesting = doctor.filter((l) => !/^\s+[\u2714]/.test(l) && !/doctor\s*$/.test(l))
    return { text: interesting.join('\n') }
  }
  await $.ui.open({ id: DOCTOR, title: 'Doctor', focus: true, closeOnEscape: true })
  $.ui.invalidate('ui.render')
  return {}
}

function summary() {
  const left = minutesLeft()
  const sound = left === undefined ? 'sound on' : left === null ? 'muted' : 'muted ' + left + ' min'
  return view.genre + ' - ' + view.volume + '% - music ' + (view.music ? 'on' : 'off') + ' - ' + sound + (view.here ? ' - this project' : '')
}

const INT = /^\d{1,4}$/
const WORD = /^[a-z0-9]{1,24}$/i

// One typed line to one CLI call. Every argument is checked before it can
// become a flag.
async function runLine($, line) {
  const [cmd, arg, extra] = line.trim().split(/\s+/)
  const sub = (cmd || '').toLowerCase()
  switch (sub) {
    case '':
    case 'pane':
      if (!(await draws($))) return say($, summary())
      await refresh($)
      await $.ui.open({ id: PANE, title: 'VibeAudio', focus: true, closeOnEscape: true })
      return {}
    case 'status':
      await refresh($)
      return say($, summary())
    case 'mute': {
      if (arg !== undefined && !INT.test(arg)) return say($, HELP)
      const minutes = arg === undefined ? DEFAULT_MUTE_MINUTES : Number(arg)
      return change($, arg === undefined ? ['--mute'] : ['--mute', arg], minutes === 0 ? 'Muted until you unmute' : 'Muted for ' + minutes + ' min')
    }
    case 'unmute':
      return change($, ['--unmute'], 'Unmuted')
    case 'genre':
      if (!arg || !WORD.test(arg)) return say($, 'Genres: ' + GENRES.join(', ') + ', random')
      if (extra !== undefined && extra !== 'here') return say($, HELP_HERE)
      return change($, ['--genre', arg.toLowerCase(), ...(extra ? ['--here'] : [])], 'Genre: ' + arg.toLowerCase() + (extra ? ' for this project' : ' (from your next prompt)'))
    case 'volume':
      if (!arg || !INT.test(arg)) return say($, 'Volume is 5-100')
      if (extra !== undefined && extra !== 'here') return say($, HELP_HERE)
      return change($, ['--volume', arg, ...(extra ? ['--here'] : [])], 'Volume: ' + arg + '%' + (extra ? ' for this project' : ''))
    case 'music':
      if (arg !== 'on' && arg !== 'off') return say($, 'Usage: /vibeaudio music on|off')
      if (extra !== undefined && extra !== 'here') return say($, HELP_HERE)
      return change($, ['--music', arg, ...(extra ? ['--here'] : [])], 'Music: ' + arg + (extra ? ' for this project' : ''))
    case 'doctor':
      return runDoctor($)
    case 'speak': {
      const flag = { off: '--no-speak', auto: '--speak', always: '--speak-always' }[arg]
      if (!flag) return say($, 'Usage: /vibeaudio speak off|auto|always')
      return change($, [flag], 'Speak: ' + arg)
    }
    case 'notify':
      if (arg !== 'on' && arg !== 'off') return say($, 'Usage: /vibeaudio notify on|off')
      return change($, [arg === 'on' ? '--notify' : '--no-notify'], 'Banners: ' + arg)
    case 'card':
      if (arg !== undefined && !INT.test(arg)) return say($, HELP)
      return makeCard($, arg === undefined ? 7 : Number(arg))
    case 'strip':
      if (arg !== 'on' && arg !== 'off') return say($, 'Usage: /vibeaudio strip on|off')
      return setStrip($, arg === 'on')
    case 'usage':
      if (arg !== 'on' && arg !== 'off') return say($, 'Usage: /vibeaudio usage on|off')
      return setUsage($, arg === 'on')
    case 'test': {
      const r = await vibe($, ['--announce', 'VibeAudio test'])
      return say($, r.ok ? 'Test signal sent' : r.message)
    }
    case 'stop':
      return change($, ['--stop'], 'Music stopped')
    case 'help':
      return say($, HELP + '\n' + HELP_HERE)
    default:
      return say($, HELP)
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    // A taken name throws and a throwing hook is skipped, so register last.
    try {
      await $.command.register({
        name: 'vibeaudio',
        description: 'Control VibeAudio: mute, genre, volume, music, speech, share card',
        argumentHint: '[mute | unmute | genre <name> | volume <n> | card | strip on|off | usage on|off | ...]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('vibeaudio-mod: ' + err.message)
    }
    strip = (await $.store.get('strip')) === true
  usageOn = (await $.store.get('usage')) === true
    await refresh($)
    await pollOthers($)
    $.clock.every(POLL_MS, () => pollOthers($))
    ticks = (await $.session.surfaces()).includes('terminal')
    $.clock.every(FRAME_MS, () => {
      if (ticks && strip && playing()) {
        frame++
        $.ui.invalidate('ui.render')
      }
    })
    // Catches an unmute or mute made elsewhere, and redraws the minutes left.
    $.clock.every(REFRESH_MS, () => refresh($))
    return next(e)
  })

  // The status line's own figures, pushed when they move.
  on('session.measure', async ($, e, next) => {
    if (usageOn) {
      const before = JSON.stringify(usageText())
      takeUsage(e)
      // A redraw restarts the logo's animation, so only a figure that changed gets one.
      if (JSON.stringify(usageText()) !== before) $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    working = true
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    working = false
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // With the strip on, the spinner says what is playing while Claude works.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!strip) return next(e)
    const tag = minutesLeft() !== undefined ? ' \u00b7 \u266a muted' : playing() ? ' \u00b7 \u266a ' + view.genre : ''
    if (!tag) return next(e)
    const base = String(e.props.suffix ?? '\u2026')
    return next({ ...e, props: { ...e.props, suffix: base.replace(/\u2026$/, '') + tag + '\u2026' } })
  })

  on('command.run', { command: 'vibeaudio' }, async ($, e) => runLine($, e.args || ''))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button: Raw, Select, Image, Svg, Link } = $.ui.resolve(e)
    // The terminal shows no hotkey on a bracketed button, so the label names it; the Desktop app draws its own.
    const Button = (props) => Raw(e.surface === 'terminal' ? props : { ...props, label: props.label.replace(/ \([a-z0-9]\)$/, '') })
    const left = minutesLeft()
    const muted = left !== undefined
    const live = playing()
    const run = (argv, okText) => async () => { await change($, argv, okText) }
    const cycle = { off: 'auto', auto: 'always', always: 'off' }
    const speakArg = { off: '--no-speak', auto: '--speak', always: '--speak-always' }
    const volDown = Math.max(5, view.volume - 10)
    const volUp = Math.min(100, view.volume + 10)
    const nextSpeak = cycle[view.speak]
    const scopeArg = scopeHere ? ['--here'] : []
    const accent = INK.genre[view.genre] || INK.pink
    const row = (children) => Box({ flexDirection: 'row', columnGap: 2, flexWrap: 'wrap', children })

    const picture = e.surface === 'terminal' && cardFile && cardIsPng
      ? [Image({ key: 'card-image', source: { file: cardFile, format: 'png' }, columns: 36, rows: 18, alt: 'Your week as a card: ' + cardFile })]
      : []

    const logo = e.surface === 'terminal'
      ? Text({ color: INK.pink, bold: true, children: [logoText(live)] })
      : Svg({ source: logoSvg(live), alt: 'VibeAudio', width: 48, height: 42, isInteractive: live })
    const pill = muted
      ? { text: ' MUTED ' + (left === null ? '' : left + ' MIN '), color: CHIP.amber }
      : live ? { text: ' PLAYING ', color: CHIP.cyan } : view.music ? { text: ' READY ', color: '#b3a3d6' } : { text: ' MUSIC OFF ', color: '#b3a3d6' }
    const week = stats ? stats.turns + (stats.turns === 1 ? ' turn' : ' turns') + (stats.turns ? ', ' + duration(stats.waited) + ' waited' : '') : 'no history yet'
    const filled = Math.round(view.volume / 10)

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          alignItems: 'center',
          children: [
            logo,
            Box({
              flexDirection: 'column',
              children: [
                Box({ flexDirection: 'row', children: [Text({ bold: true, children: ['VIBE'] }), Text({ color: INK.pink, bold: true, children: ['AUDIO'] })] }),
                Text({ dimColor: true, children: ['Focus music while your AI codes'] }),
              ],
            }),
            Text({ color: pill.color, bold: true, backgroundColor: CHIP.bg, children: [pill.text] }),
          ],
        }),
        panel(Box, Text, 'NOW PLAYING', accent, [
          Box({
            flexDirection: 'row',
            columnGap: 2,
            children: [
              Text({ color: accent, bold: true, children: [view.genre.toUpperCase()] }),
              Text({ color: INK.cyan, children: ['█'.repeat(filled) + '░'.repeat(10 - filled)] }),
              Text({ children: [view.volume + '%'] }),
            ],
          }),
          Text({ dimColor: true, children: [summary()] }),
          row([
            muted
              ? Button({ key: 'unmute', label: 'Unmute (m)', hotkey: 'm', onPress: run(['--unmute'], 'Unmuted') })
              : Button({ key: 'mute', label: 'Mute 1h (m)', hotkey: 'm', onPress: run(['--mute'], 'Muted for ' + DEFAULT_MUTE_MINUTES + ' min') }),
            Button({ key: 'music', label: 'Music ' + (view.music ? 'off' : 'on') + ' (o)', hotkey: 'o', onPress: run(['--music', view.music ? 'off' : 'on', ...scopeArg], 'Music: ' + (view.music ? 'off' : 'on')) }),
            Button({ key: 'test', label: 'Test (t)', hotkey: 't', onPress: async () => { await runLine($, 'test') } }),
          ]),
        ]),
        panel(Box, Text, 'SOUND', INK.purple, [
          Select({
            key: 'genre',
            label: 'Genre',
            options: GENRES.map((g) => ({ value: g, label: g })),
            value: GENRES.includes(view.genre) ? view.genre : 'lofi',
            onSelect: async (value) => { await runLine($, 'genre ' + value + (scopeHere ? ' here' : '')) },
          }),
          row([
            Button({ key: 'vol-down', label: 'Volume - (d)', hotkey: 'd', onPress: run(['--volume', String(volDown), ...scopeArg], 'Volume: ' + volDown + '%') }),
            Button({ key: 'vol-up', label: 'Volume + (u)', hotkey: 'u', onPress: run(['--volume', String(volUp), ...scopeArg], 'Volume: ' + volUp + '%') }),
            Button({ key: 'scope', label: 'Saving: ' + (scopeHere ? 'this project' : 'everywhere') + ' (e)', hotkey: 'e', onPress: () => { scopeHere = !scopeHere; $.ui.invalidate('ui.render') } }),
          ]),
        ]),
        panel(Box, Text, 'ALERTS', INK.cyan, [
          Text({ dimColor: true, children: ['speech ' + view.speak + ' - banners ' + (view.notify ? 'on' : 'off')] }),
          row([
            Button({ key: 'speak', label: 'Speak: ' + nextSpeak + ' (s)', hotkey: 's', onPress: run([speakArg[nextSpeak]], 'Speak: ' + nextSpeak) }),
            Button({ key: 'notify', label: 'Banners ' + (view.notify ? 'off' : 'on') + ' (n)', hotkey: 'n', onPress: run([view.notify ? '--no-notify' : '--notify'], 'Banners: ' + (view.notify ? 'off' : 'on')) }),
          ]),
        ]),
        panel(Box, Text, 'SHARE', INK.amber, [
          Text({ dimColor: true, children: ['last 7 days: ' + week] }),
          ...(stats && stats.turns ? [Text({ color: INK.amber, children: [sparkline(stats.days)] })] : []),
          row([
            Button({ key: 'card', label: 'Week card (k)', hotkey: 'k', onPress: async () => { await runLine($, 'card') } }),
            ...(cardFile ? [Button({ key: 'card-open', label: 'Open card (c)', hotkey: 'c', onPress: async () => { await openCard($) } })] : []),
          ]),
          ...picture,
        ]),
        row([
          Button({ key: 'strip', label: 'Strip ' + (strip ? 'off' : 'on') + ' (b)', hotkey: 'b', onPress: async () => { await setStrip($, !strip) } }),
          Button({ key: 'usage', label: 'Usage ' + (usageOn ? 'off' : 'on') + ' (g)', hotkey: 'g', onPress: async () => { await setUsage($, !usageOn) } }),
          Button({ key: 'doctor', label: 'Doctor (x)', hotkey: 'x', onPress: async () => { await runDoctor($) } }),
        ]),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ dimColor: true, children: [note || 'Esc closes.'] }),
            Link({ href: 'https://kiril6.github.io/vibeaudio', label: 'kiril6.github.io/vibeaudio' }),
          ],
        }),
      ],
    })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== DOCTOR) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const mark = (l) => (/^\s*\u2714/.test(l) ? { color: 'success' } : /^\s*!/.test(l) ? { color: 'warning' } : /^\s*[\u2718\u00d7]\s/.test(l) ? { color: 'error' } : /^\s+fix:/.test(l) ? { dimColor: true } : {})
    return Box({
      flexDirection: 'column',
      children: [
        ...doctor.map((l) => Text({ ...mark(l), wrap: 'truncate-end', children: [l] })),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({ key: 'doctor-again', label: 'Run again (r)', hotkey: 'r', onPress: async () => { await runDoctor($) } }),
            Button({ key: 'doctor-test', label: 'Test signal (t)', hotkey: 't', onPress: async () => { await runLine($, 'test') } }),
          ],
        }),
      ],
    })
  })

  // The band above the prompt. Off by default: nothing is drawn unless you are
  // muted (a forgotten mute looks like a broken tool) or you turned the strip
  // on. Other mods share this band, so theirs is kept underneath.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const left = minutesLeft()
    if (left === undefined && !strip) return next(e)
    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const muted = left !== undefined
    const rows = []
    const scopeArg = scopeHere ? ['--here'] : []
    const volDown = Math.max(5, view.volume - 10)
    const volUp = Math.min(100, view.volume + 10)
    const nextGenre = GENRES[(GENRES.indexOf(view.genre) + 1) % GENRES.length]
    if (muted && !strip) {
      rows.push(Text({ color: 'warning', children: ['VibeAudio muted - ' + (left === null ? 'until you unmute' : left + ' min left') + '  (/vibeaudio unmute)'] }))
    }
    if (strip) {
      const live = playing()
      const waiting = others.filter((o) => o.state === 'waiting' || o.state === 'stuck')
      const state = muted ? 'muted ' + (left === null ? 'until you unmute' : left + ' min left') : live ? 'playing' : view.music ? '' : 'music off'
      const line = '\u266a ' + view.genre + ' ' + view.volume + '%' + (state ? ' - ' + state : '')
      const week = stats ? ['7 days', stats.turns + (stats.turns === 1 ? ' turn' : ' turns'), ...(stats.turns ? [duration(stats.waited) + ' waited'] : [])] : ['no history yet']
      const btn = (key, label, argv, okText) => Button({ key, label, onPress: async () => { await change($, argv, okText) } })
      const buttons = [
        muted ? btn('strip-unmute', 'Unmute', ['--unmute'], 'Unmuted') : btn('strip-mute', 'Mute', ['--mute'], 'Muted for ' + DEFAULT_MUTE_MINUTES + ' min'),
        btn('strip-music', 'Music ' + (view.music ? 'off' : 'on'), ['--music', view.music ? 'off' : 'on', ...scopeArg], 'Music: ' + (view.music ? 'off' : 'on')),
        btn('strip-genre', 'Genre >', ['--genre', nextGenre, ...scopeArg], 'Genre: ' + nextGenre),
        btn('strip-vol-down', 'Vol -', ['--volume', String(volDown), ...scopeArg], 'Volume: ' + volDown + '%'),
        btn('strip-vol-up', 'Vol +', ['--volume', String(volUp), ...scopeArg], 'Volume: ' + volUp + '%'),
        Button({ key: 'strip-card', label: 'Week card', onPress: async () => { await runLine($, 'card') } }),
        ...(cardFile ? [Button({ key: 'strip-card-open', label: 'Open card', onPress: async () => { await openCard($) } })] : []),
        Button({ key: 'strip-pane', label: 'Controls', onPress: async () => { await runLine($, 'pane') } }),
      ]
      const use = usageOn ? usageText() : null
      const useText = use ? [Text({ ...(use.hot ? { color: 'warning' } : { dimColor: true }), children: [use.text] })] : []
      const crowd = others.length ? [Text({ ...(waiting.length ? { color: 'warning' } : { dimColor: true }), children: [others.map((o) => o.name + ' ' + o.state).join(', ')] })] : []
      const head = Text({ ...(muted ? { color: 'warning' } : live ? { color: INK.genre[view.genre] || INK.pink } : { dimColor: true }), children: [line] })
      if (e.props.maxRows < 4) {
        rows.push(Box({ flexDirection: 'row', columnGap: 2, children: [head, ...useText, ...buttons, ...crowd] }))
      } else {
        const logo = e.surface === 'terminal'
          ? Text({ color: INK.pink, bold: true, children: [logoText(live)] })
          : Svg({ source: logoSvg(live), alt: 'VibeAudio' + (live ? ', music playing' : ''), width: 44, height: 38, isInteractive: live })
        rows.push(Box({
          flexDirection: 'row',
          columnGap: 2,
          alignItems: 'center',
          children: [
            logo,
            Box({
              flexDirection: 'column',
              rowGap: e.surface === 'terminal' ? 0 : 1,
              children: [
                Box({ flexDirection: 'row', columnGap: 2, children: [Text({ bold: true, children: ['VibeAudio'] }), head] }),
                Box({ flexDirection: 'row', columnGap: 4, children: [Box({ flexDirection: 'row', columnGap: 2, children: week.map((w) => Text({ dimColor: true, children: [w] })) }), ...useText, ...crowd] }),
                Box({ flexDirection: 'row', columnGap: 2, flexWrap: 'wrap', children: buttons }),
              ],
            }),
          ],
        }))
      }
    }
    return Box({ flexDirection: 'column', children: [...rows, await next(e)] })
  })
}
