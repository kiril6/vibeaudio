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
const HELP = 'Usage: /vibeaudio [mute [min] | unmute | genre <name> | volume <5-100> | music on|off | speak off|auto|always | notify on|off | card [days] | doctor | strip on|off | test | stop | status]'
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
// The pane's choice of where genre, volume and music are saved: everywhere or this project.
let scopeHere = false
// `vibe --doctor`'s lines, drawn in a pane of their own.
let doctor = []
const DOCTOR = 'vibeaudio-doctor'

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
  $.ui.invalidate('ui.render')
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

async function setStrip($, on) {
  strip = on
  await $.store.set('strip', on)
  others = []
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
    case 'test': {
      const r = await vibe($, ['--announce', 'VibeAudio test'])
      return say($, r.ok ? 'Test signal sent' : r.message)
    }
    case 'stop':
      return change($, ['--stop'], 'Music stopped')
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
        argumentHint: '[mute | unmute | genre <name> | volume <n> | card | strip on|off | ...]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('vibeaudio-mod: ' + err.message)
    }
    strip = (await $.store.get('strip')) === true
    await refresh($)
    await pollOthers($)
    $.clock.every(POLL_MS, () => pollOthers($))
    // Catches an unmute or mute made elsewhere, and redraws the minutes left.
    $.clock.every(REFRESH_MS, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'vibeaudio' }, async ($, e) => runLine($, e.args || ''))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button, Select, Image } = $.ui.resolve(e)
    const left = minutesLeft()
    const muted = left !== undefined
    const run = (argv, okText) => async () => { await change($, argv, okText) }
    const cycle = { off: 'auto', auto: 'always', always: 'off' }
    const speakArg = { off: '--no-speak', auto: '--speak', always: '--speak-always' }
    const volDown = Math.max(5, view.volume - 10)
    const volUp = Math.min(100, view.volume + 10)
    const nextSpeak = cycle[view.speak]
    const scopeArg = scopeHere ? ['--here'] : []

    const picture = e.surface === 'terminal' && cardFile && cardIsPng
      ? [Image({ key: 'card-image', source: { file: cardFile, format: 'png' }, columns: 36, rows: 18, alt: 'Your week as a card: ' + cardFile })]
      : []

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [
        Text({ bold: true, children: ['VibeAudio'] }),
        Text({ children: [summary()] }),
        Text({ dimColor: true, children: ['speech ' + view.speak + ' - banners ' + (view.notify ? 'on' : 'off')] }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            muted
              ? Button({ key: 'unmute', label: 'Unmute (m)', hotkey: 'm', onPress: run(['--unmute'], 'Unmuted') })
              : Button({ key: 'mute', label: 'Mute 1h (m)', hotkey: 'm', onPress: run(['--mute'], 'Muted for ' + DEFAULT_MUTE_MINUTES + ' min') }),
            Button({ key: 'music', label: 'Music ' + (view.music ? 'off' : 'on') + ' (o)', hotkey: 'o', onPress: run(['--music', view.music ? 'off' : 'on', ...scopeArg], 'Music: ' + (view.music ? 'off' : 'on')) }),
            Button({ key: 'test', label: 'Test (t)', hotkey: 't', onPress: async () => { await runLine($, 'test') } }),
          ],
        }),
        Select({
          key: 'genre',
          label: 'Genre',
          options: GENRES.map((g) => ({ value: g, label: g })),
          value: GENRES.includes(view.genre) ? view.genre : 'lofi',
          onSelect: async (value) => { await runLine($, 'genre ' + value + (scopeHere ? ' here' : '')) },
        }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({ key: 'vol-down', label: 'Volume - (d)', hotkey: 'd', onPress: run(['--volume', String(volDown), ...scopeArg], 'Volume: ' + volDown + '%') }),
            Button({ key: 'vol-up', label: 'Volume + (u)', hotkey: 'u', onPress: run(['--volume', String(volUp), ...scopeArg], 'Volume: ' + volUp + '%') }),
          ],
        }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({ key: 'speak', label: 'Speak: ' + nextSpeak + ' (s)', hotkey: 's', onPress: run([speakArg[nextSpeak]], 'Speak: ' + nextSpeak) }),
            Button({ key: 'notify', label: 'Banners ' + (view.notify ? 'off' : 'on') + ' (n)', hotkey: 'n', onPress: run([view.notify ? '--no-notify' : '--notify'], 'Banners: ' + (view.notify ? 'off' : 'on')) }),
          ],
        }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({ key: 'strip', label: 'Strip ' + (strip ? 'off' : 'on') + ' (b)', hotkey: 'b', onPress: async () => { await setStrip($, !strip) } }),
            Button({ key: 'scope', label: 'Saving: ' + (scopeHere ? 'this project' : 'everywhere') + ' (e)', hotkey: 'e', onPress: () => { scopeHere = !scopeHere; $.ui.invalidate('ui.render') } }),
            Button({ key: 'doctor', label: 'Doctor (x)', hotkey: 'x', onPress: async () => { await runDoctor($) } }),
            Button({ key: 'card', label: 'Week card (k)', hotkey: 'k', onPress: async () => { await runLine($, 'card') } }),
            ...(cardFile ? [Button({ key: 'card-open', label: 'Open card (c)', hotkey: 'c', onPress: async () => { await openCard($) } })] : []),
          ],
        }),
        ...picture,
        Text({ dimColor: true, children: [note || 'Esc closes. Settings are the vibe CLI\'s own.'] }),
      ],
    })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== DOCTOR) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const mark = (l) => (/^\s*\u2714/.test(l) ? { color: 'green' } : /^\s*!/.test(l) ? { color: 'yellow' } : /^\s*[\u2718\u00d7]\s/.test(l) ? { color: 'red' } : /^\s+fix:/.test(l) ? { dimColor: true } : {})
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const muted = left !== undefined
    const rows = []
    if (muted) {
      rows.push(Text({ color: 'yellow', children: ['VibeAudio muted - ' + (left === null ? 'until you unmute' : left + ' min left') + (strip ? '' : '  (/vibeaudio unmute)')] }))
    }
    if (strip) {
      const waiting = others.filter((o) => o.state === 'waiting' || o.state === 'stuck')
      const text = '♪ ' + view.genre + ' ' + view.volume + '%' + (view.music ? '' : ' - music off')
      rows.push(Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Text({ dimColor: !muted, children: [text] }),
          muted
            ? Button({ key: 'strip-unmute', label: 'Unmute', onPress: async () => { await change($, ['--unmute'], 'Unmuted') } })
            : Button({ key: 'strip-mute', label: 'Mute', onPress: async () => { await change($, ['--mute'], 'Muted for ' + DEFAULT_MUTE_MINUTES + ' min') } }),
          Button({ key: 'strip-pane', label: 'Controls', onPress: async () => { await runLine($, 'pane') } }),
          ...(others.length ? [Text({ ...(waiting.length ? { color: 'yellow' } : { dimColor: true }), children: [others.map((o) => o.name + ' ' + o.state).join(', ')] })] : []),
        ],
      }))
    }
    return Box({ flexDirection: 'column', children: [...rows, await next(e)] })
  })
}
