"use strict";

/**
 * `vibe --dashboard`: a read-only local page showing what every agent is doing.
 * Built on what already exists: the page is fed by followEvents() (the same
 * follower behind `vibe --events`) over Server-Sent Events, so there is one
 * source of truth and nothing here reads session files itself.
 *
 * Local by construction: bound to 127.0.0.1, a Host check against the bound
 * address (so a page on the open web cannot reach it through DNS rebinding),
 * no CORS headers, and a CSP that allows exactly this page's one script. It
 * only ever answers GET, so there is nothing a cross-site request could do.
 * Controls (mute, stop) are a separate decision, because they would need CSRF
 * protection first.
 */

const http = require("http");
const crypto = require("crypto");
const hooks = require("./hooks");

const DEFAULT_PORT = 4747;
const MAX_CLIENTS = 20;
const HEARTBEAT_MS = 15000;
const BACKLOG_LINES = 25;

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#14171c;--dim:#667085;--line:#e3e6ea;--work:#1a7f4b;--wait:#b45309;--stuck:#c0262d;--idle:#98a2b3}
@media(prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#171b22;--ink:#e8ebf0;--dim:#8b95a5;--line:#262c36;--work:#4cc38a;--wait:#f5a524;--stuck:#ff6b72;--idle:#667085}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:20px}
h1{font-size:20px;margin:0}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:28px 0 8px}
#status{font-weight:600}#conn{margin-left:auto;font-size:13px;color:var(--dim)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.row{display:grid;grid-template-columns:132px 1fr auto;gap:12px;align-items:center;padding:12px 14px;border-top:1px solid var(--line)}
.row:first-child{border-top:0}.state{font-weight:600}.proj{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.path{color:var(--dim);font-size:12px;display:block;overflow:hidden;text-overflow:ellipsis}.time{color:var(--dim);font-variant-numeric:tabular-nums;font-size:13px}
.working .state{color:var(--work)}.waiting .state{color:var(--wait)}.stuck .state{color:var(--stuck)}
.waiting{background:color-mix(in srgb,var(--wait) 9%,transparent)}.stuck{background:color-mix(in srgb,var(--stuck) 9%,transparent)}
.empty{padding:20px 14px;color:var(--dim)}
li{list-style:none;display:grid;grid-template-columns:72px 96px 1fr;gap:10px;padding:7px 14px;border-top:1px solid var(--line);font-size:13px}
ul{margin:0;padding:0}li:first-child{border-top:0}li .t{color:var(--dim);font-variant-numeric:tabular-nums}li.bad{color:var(--stuck)}li.attn{color:var(--wait)}
@media(max-width:520px){.row{grid-template-columns:80px 1fr}.row .time{grid-column:2}li{grid-template-columns:60px 1fr}li .e{grid-column:2}li .d{grid-column:2}}
`;

const SCRIPT = `
const $ = (id) => document.getElementById(id);
const RANK = { waiting: 0, stuck: 1, working: 2 };
const seen = new Map(); // session -> { state, at }: when this page first saw it in that state
let rows = [];
const base = (p) => String(p || "").replace(/[\\\\/]+$/, "").split(/[\\\\/]/).pop() || "a session";
const dur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m " + (s % 60) + "s" : Math.floor(s / 3600) + "h " + Math.floor(s % 3600 / 60) + "m"; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

function renderState(st) {
  const now = Date.now();
  $("status").textContent = st.status;
  document.title = st.status === "idle" ? "VibeAudio" : st.status + " - VibeAudio";
  rows = st.sessions.slice().sort((a, b) => RANK[a.state] - RANK[b.state]).map((s) => {
    const prev = seen.get(s.session);
    const at = prev && prev.state === s.state ? prev.at : (prev ? now : ((s.state === "waiting" && s.waitingSince) || s.since || now));
    seen.set(s.session, { state: s.state, at });
    return { ...s, at };
  });
  for (const id of seen.keys()) if (!st.sessions.some((s) => s.session === id)) seen.delete(id);
  paint();
}

function paint() {
  const box = $("sessions");
  box.replaceChildren();
  if (!rows.length) { box.append(el("div", "empty", "Nothing is running. Start a turn in any agent with VibeAudio hooks and it appears here.")); return; }
  for (const s of rows) {
    const row = el("div", "row " + s.state);
    row.append(el("span", "state", s.state + (s.tool ? " (" + s.tool + ")" : "")));
    const name = el("span", "proj", base(s.project));
    if (s.project) name.append(el("span", "path", s.project));
    row.append(name, el("span", "time", dur(Date.now() - s.at)));
    box.append(row);
  }
}

function addEvent(e) {
  const li = el("li", e.outcome === "failure" || e.event === "stuck" ? "bad" : e.event === "waiting" || (e.event === "announced" && e.outcome === "attention") ? "attn" : "");
  li.append(el("span", "t", new Date(e.at).toLocaleTimeString([], { hour12: false })), el("span", "e", e.event), el("span", "d", [e.text || base(e.project), e.tool, e.outcome].filter(Boolean).join(" · ")));
  const list = $("feed");
  list.prepend(li);
  while (list.children.length > 60) list.lastChild.remove();
}

const es = new EventSource("/events");
es.addEventListener("state", (m) => renderState(JSON.parse(m.data)));
es.addEventListener("event", (m) => addEvent(JSON.parse(m.data)));
es.addEventListener("backlog", (m) => JSON.parse(m.data).forEach(addEvent));
es.onopen = () => { $("conn").textContent = "live"; };
es.onerror = () => { $("conn").textContent = "reconnecting…"; };
setInterval(paint, 1000);
`;

const BODY = `<main>
<header><h1>VibeAudio</h1><span id="status" aria-live="polite">idle</span><span id="conn">connecting…</span></header>
<h2>Sessions</h2><div class="card" id="sessions"></div>
<h2>Recent events</h2><div class="card"><ul id="feed"></ul></div>
</main>`;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VibeAudio</title><style>${STYLE}</style></head><body>${BODY}<script>${SCRIPT}</script></body></html>`;

// The page's one script is allowed by hash, so no other script, inline or not, can run in it.
const SCRIPT_HASH = crypto.createHash("sha256").update(SCRIPT).digest("base64");
const CSP = `default-src 'none'; script-src 'sha256-${SCRIPT_HASH}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": CSP, "Referrer-Policy": "no-referrer" };

/**
 * Creates the server (not yet listening). `close()` also ends the event
 * streams, which would otherwise keep it open forever.
 */
function createDashboard() {
  const clients = new Set();
  const server = http.createServer((req, res) => {
    // DNS rebinding: a hostile page can point its own name at 127.0.0.1, but the
    // browser then sends that name as Host. Only our own address is accepted.
    const port = server.address() && server.address().port;
    const host = String(req.headers.host || "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403, { ...HEADERS, "Content-Type": "text/plain" }).end("Forbidden\n");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...HEADERS, Allow: "GET, HEAD", "Content-Type": "text/plain" }).end("Read-only\n");
      return;
    }
    const url = (req.url || "").split("?")[0];
    if (url === "/") {
      res.writeHead(200, { ...HEADERS, "Content-Type": "text/html; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : PAGE);
      return;
    }
    if (url === "/events" && req.method === "GET") {
      if (clients.size >= MAX_CLIENTS) {
        res.writeHead(503, { ...HEADERS, "Content-Type": "text/plain" }).end("Too many viewers\n");
        return;
      }
      res.writeHead(200, { ...HEADERS, "Content-Type": "text/event-stream", Connection: "keep-alive" });
      const send = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      send("backlog", hooks.recentEvents(BACKLOG_LINES));
      const follower = hooks.followEvents((chunk) => {
        let line;
        try { line = JSON.parse(chunk); } catch (e) { return; }
        if (line.event === "state") return send("state", line);
        send("event", line);
        send("state", hooks.agentState()); // an event says what changed; the page wants the list
      });
      const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
      const client = { res, stop: () => { clearInterval(follower); clearInterval(beat); clients.delete(client); } };
      clients.add(client);
      req.on("close", client.stop);
      return;
    }
    res.writeHead(404, { ...HEADERS, "Content-Type": "text/plain" }).end("Not found\n");
  });
  const close = server.close.bind(server);
  server.close = (cb) => {
    for (const c of [...clients]) { c.stop(); c.res.end(); }
    return close(cb);
  };
  return server;
}

/**
 * Listens on 127.0.0.1 only. An explicit port is taken or it is an error; the
 * default port falls back to a free one, so a second dashboard still starts.
 */
function startDashboard({ port = null } = {}) {
  const server = createDashboard();
  return new Promise((resolve, reject) => {
    const listen = (p) => {
      server.once("error", (e) => {
        if (e.code === "EADDRINUSE" && port === null && p !== 0) return listen(0);
        reject(e);
      });
      server.listen(p, "127.0.0.1", () => resolve(server));
    };
    listen(port === null ? DEFAULT_PORT : port);
  });
}

module.exports = { createDashboard, startDashboard, DEFAULT_PORT, CSP };
