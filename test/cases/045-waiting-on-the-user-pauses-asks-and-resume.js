const { os, assert, CLI, TEST_DIR } = require("../helpers");

(async () => {
  // 45. Blocked on the user: the music must stop saying "working".
  //
  //     Music that plays through a permission dialog tells someone in another
  //     window the agent is busy when it is stuck on them. PermissionRequest
  //     pauses and asks with its own chime; the approved tool's PostToolUse
  //     resumes. Driven through the real CLI and daemon against a fake backend,
  //     because each step's effect is a process or a file another process reads.
  {
    const fs = require("fs");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const hooks = require("../../src/hooks");

    console.log("\n\x1b[1m[45] Waiting on the user pauses, asks, and resumes\x1b[0m");

    // Install shape - checkable everywhere.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-wait-"));
    const file = path.join(tmp, "settings.json");
    hooks.installHooks("jazz", 0.3, file, { id: "claude", reactive: true });
    const s = JSON.parse(fs.readFileSync(file, "utf8")).hooks;
    for (const event of ["PermissionRequest", "Elicitation"]) {
      const wait = s[event][0].hooks[0];
      assert.ok(/--hook-wait\b/.test(wait.command), `${event} must run --hook-wait`);
    }
    for (const event of ["PostToolUse", "PostToolUseFailure", "ElicitationResult"]) {
      const resume = s[event][0].hooks[0];
      // A resume respawns the daemon, so it has to carry --reactive - which
      // shapes which hooks exist - while genre and volume come from the config
      // file the respawned process reads for itself.
      assert.ok(/--hook-resume --reactive/.test(resume.command), `${event} must resume in the same mode`);
    }
    // The turns that never reach Stop.
    assert.ok(/--hook-stop\b/.test(s.StopFailure[0].hooks[0].command), "StopFailure must end the turn like Stop");
    assert.ok(/--hook-end\b/.test(s.SessionEnd[0].hooks[0].command), "SessionEnd must run --hook-end");
    for (const id of ["cursor", "grok"]) {
      const ev = hooks.TARGETS[id].events;
      assert.ok(!ev.wait && !ev.failure && !ev.end, `${id} has no verified waiting, failure or session-end event`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });

    if (process.platform === "win32") {
      console.log("   ✓ Install shape checked; daemon flow skipped on Windows (needs a POSIX executable bit).");
    } else {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-waitflow-"));
      const log = path.join(dir, "played.log");
      fs.writeFileSync(log, "");
      // The attention chime "plays" for 2s, so a hook that waits for it shows.
      fs.writeFileSync(path.join(dir, "afplay"), `#!/bin/sh\necho "$@" >> ${log}\ncase "$*" in *chime_attention*) sleep 2;; esac\nexit 0\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(dir, "which"), `#!/bin/sh\n[ -x "${dir}/$1" ] && echo "${dir}/$1" || exit 1\n`, { mode: 0o755 });
      // ps must stay reachable: stopDaemon refuses to signal a pid it cannot verify.
      const env = { ...process.env, PATH: `${dir}:/bin:/usr/bin`, HOME: dir, USERPROFILE: dir, VIBE_DISABLE: "" };
      const cli = (args, payload = "") =>
        spawnSync(process.execPath, [CLI, ...args], { input: payload, env, timeout: 20000 });
      const state = path.join(dir, ".vibeaudio");
      const pidFile = path.join(state, "daemon.pid");
      const sessionPath = (id) => path.join(state, "sessions", `${id}.json`);
      const waitingFile = sessionPath("anon");
      // What a session is paused on: null while working, and no file once its turn ended.
      const waitingOn = (id = "anon") => (fs.existsSync(sessionPath(id)) ? JSON.parse(fs.readFileSync(sessionPath(id), "utf8")).waiting : undefined);
      const settle = async (what, check) => {
        for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
        assert.ok(check(), what);
      };
      const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
      const bash = JSON.stringify({ tool_name: "Bash" });

      try {
        // Nothing playing: a dialog after the turn ended has nobody to interrupt.
        cli(["--hook-wait"], bash);
        assert.ok(!/chime_attention/.test(fs.readFileSync(log, "utf8")), "no chime when no music was playing");
        assert.strictEqual(waitingOn(), undefined, "and no wait recorded");

        cli(["--hook-start", "--genre", "zen", "--volume", "5"]);
        await settle("the daemon must reach the backend", () => /loop_zen_/.test(fs.readFileSync(log, "utf8")));
        const firstPid = parseInt(fs.readFileSync(pidFile, "utf8"), 10);

        const waitStarted = Date.now();
        cli(["--hook-wait"], bash);
        assert.ok(Date.now() - waitStarted < 1500, "the wait hook must not hold the dialog back for the chime");
        await settle("the dialog must play the attention chime", () => /chime_attention/.test(fs.readFileSync(log, "utf8")));
        assert.ok(!/chime_success/.test(fs.readFileSync(log, "utf8")), "not the done chime");
        assert.ok(!fs.existsSync(pidFile), "the music must stop while waiting");
        await settle("the daemon must actually exit", () => !alive(firstPid));
        assert.strictEqual(waitingOn(), "Bash", "the wait must remember which tool it is for");

        // A different tool finishing (a parallel read) is not the approval.
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], JSON.stringify({ tool_name: "Read" }));
        assert.ok(!fs.existsSync(pidFile), "another tool's PostToolUse must not resume");

        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], bash);
        assert.ok(fs.existsSync(pidFile), "the approved tool's PostToolUse must resume the music");
        assert.strictEqual(waitingOn(), null, "and end the wait");
        const resumedPid = parseInt(fs.readFileSync(pidFile, "utf8"), 10);
        await settle("the resumed daemon must be running", () => alive(resumedPid));

        // Paused, then the turn ends with nothing resumed (a denied tool): it
        // still finished, so it still chimes done.
        cli(["--hook-wait"], bash);
        fs.writeFileSync(log, "");
        cli(["--hook-stop"], "{}");
        assert.ok(/chime_success/.test(fs.readFileSync(log, "utf8")), "a turn ending while paused must still chime done");
        assert.strictEqual(waitingOn(), undefined, "Stop must clear the wait");

        const start = (session) =>
          cli(["--hook-start", "--genre", "zen", "--volume", "5"], JSON.stringify({ session_id: session }));
        const playing = () => fs.existsSync(pidFile);

        // An MCP server asking for input is a wait too, ended by its own result.
        start("s1");
        const elicit = JSON.stringify({ session_id: "s1", hook_event_name: "Elicitation", mcp_server_name: "github" });
        cli(["--hook-wait"], elicit);
        assert.ok(!playing(), "an elicitation must pause the music");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], JSON.stringify({ session_id: "s1", hook_event_name: "ElicitationResult", mcp_server_name: "slack" }));
        assert.ok(!playing(), "another server's result is not the answer");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], JSON.stringify({ session_id: "s1", hook_event_name: "ElicitationResult", mcp_server_name: "github" }));
        assert.ok(playing(), "its ElicitationResult must resume it");

        // Copilot and Gemini announce the dialog as a Notification, among
        // others that are not waits, and name no tool - so any tool resumes.
        start("s1");
        await settle("s1's music must start", () => playing());
        cli(["--hook-wait"], JSON.stringify({ session_id: "s1", hook_event_name: "Notification", notification_type: "idle_prompt" }));
        assert.ok(playing(), "a notification that is not a dialog must not pause");
        cli(["--hook-wait"], JSON.stringify({ session_id: "s1", hook_event_name: "Notification", notification_type: "ToolPermission" }));
        assert.ok(!playing(), "Gemini's ToolPermission notification must pause");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], JSON.stringify({ session_id: "s1", tool_name: "run_shell_command" }));
        assert.ok(playing(), "a wait that named no tool resumes on whichever tool finishes");

        // Copilot's ask_user: the Notification is camelCase (`sessionId`, seen
        // live), unlike its snake_case Stop. Unread, the wait hit the `anon`
        // slot and the music played on under the question.
        cli(["--hook-wait"], JSON.stringify({ sessionId: "s1", notificationType: "elicitation_dialog", title: "Information requested" }));
        assert.ok(!playing(), "Copilot's camelCase elicitation_dialog must pause the music");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], JSON.stringify({ session_id: "s1", tool_name: "ask_user" }));
        assert.ok(playing(), "and its tool result resumes it");

        // An API error never reaches Stop; StopFailure is the only end.
        fs.writeFileSync(log, "");
        cli(["--hook-stop"], JSON.stringify({ session_id: "s1", hook_event_name: "StopFailure", error: "rate_limit" }));
        assert.ok(!playing(), "StopFailure must stop the music");
        assert.ok(/chime_failure/.test(fs.readFileSync(log, "utf8")), "and play the failure chime, not success");

        // Esc fires no hook at all - mid-reply nothing, mid-tool a plain
        // PostToolUse (both observed against the real binary). The transcript
        // entry is the only signal, so the daemon watches for it.
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const transcript = path.join(dir, "session.jsonl");
        const userText = (text) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n";
        const INTERRUPT = "[Request interrupted by user]";
        const turnPayload = (extra = {}) => JSON.stringify({ session_id: "s3", transcript_path: transcript, cwd: "/work/api", ...extra });
        const startTurn = async () => {
          fs.writeFileSync(log, "");
          cli(["--hook-start", "--genre", "zen", "--volume", "5"], turnPayload());
          await settle("the turn's music must start", () => /loop_zen_/.test(fs.readFileSync(log, "utf8")));
          return parseInt(fs.readFileSync(pidFile, "utf8"), 10);
        };

        // The previous turn ended interrupted: that entry predates this prompt.
        fs.writeFileSync(transcript, userText("earlier prompt") + userText(INTERRUPT));
        const turnPid = await startTurn();
        // Quoting the phrase is not interrupting - this conversation does it.
        fs.appendFileSync(transcript,
          JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: INTERRUPT }] } }) + "\n" +
          JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: INTERRUPT }] } }) + "\n");
        await sleep(1200);
        assert.ok(alive(turnPid), "an old interrupt, or a quote of the phrase, must not stop the music");

        // The entry can arrive split across two polls.
        const entry = userText("[Request interrupted by user for tool use]");
        fs.writeFileSync(log, "");
        fs.appendFileSync(transcript, entry.slice(0, 40));
        await sleep(1200);
        assert.ok(alive(turnPid), "half an entry is not an entry yet");
        fs.appendFileSync(transcript, entry.slice(40));
        await settle("Esc must stop the music", () => !alive(turnPid));
        assert.ok(!playing(), "and the interrupted daemon must clear its pid file");
        assert.ok(!/chime/.test(fs.readFileSync(log, "utf8")), "silently: an interrupt is never reported as done");
        // The one event no hook raises: the daemon's sweep emits it, and it names
        // the project from the session file because there is no payload to read.
        const lastEvent = JSON.parse(fs.readFileSync(path.join(state, "events.jsonl"), "utf8").trim().split("\n").pop());
        assert.deepStrictEqual(
          [lastEvent.event, lastEvent.session, lastEvent.project, lastEvent.status],
          ["interrupted", "s3", "/work/api", "idle"],
          "an Esc must log interrupted with its project, leaving the machine idle");

        // Esc during an approved tool still fires its PostToolUse. The resumed
        // daemon watches from the prompt, not from its own start, so it sees
        // the interrupt that came first and never plays.
        await startTurn();
        cli(["--hook-wait"], turnPayload({ tool_name: "Bash" }));
        fs.appendFileSync(transcript, userText(INTERRUPT));
        fs.writeFileSync(log, "");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], turnPayload({ tool_name: "Bash" }));
        await sleep(1500);
        assert.ok(!/loop_/.test(fs.readFileSync(log, "utf8")), "an interrupted approved tool must not bring the music back");

        // A prompt another hook blocked: hooks run side by side, so ours had
        // already started the music, and no Stop will come. Claude Code leaves a
        // system entry in the transcript (observed against the real binary).
        cli(["--stop"]);
        fs.writeFileSync(transcript, "");
        const blockedPid = await startTurn();
        const sys = (content) => JSON.stringify({ type: "system", subtype: "informational", content }) + "\n";
        fs.appendFileSync(transcript, sys("some other notice"));
        await sleep(1200);
        assert.ok(alive(blockedPid), "an unrelated system entry must not stop the music");
        fs.appendFileSync(transcript, sys("UserPromptSubmit operation blocked by hook:\n[x]: blocked\n\nOriginal prompt: hi"));
        await settle("a blocked prompt must stop the music", () => !alive(blockedPid));

        // The same rejection landing *before* our hook measured the transcript:
        // a native blocker beats a node start. Nothing follows the offset, so
        // the music must never begin - but a stale entry must not count.
        cli(["--stop"]);
        const stamp = (ago) => new Date(Date.now() - ago).toISOString();
        const blockedAt = (ago) => JSON.stringify({ type: "system", subtype: "informational", timestamp: stamp(ago),
          content: "UserPromptSubmit operation blocked by hook:\nx\n\nOriginal prompt: which node" }) + "\n";
        fs.writeFileSync(transcript, userText("earlier") + blockedAt(60000));
        await startTurn();
        assert.ok(playing(), "a block from a minute ago is another prompt's, not this one's");
        cli(["--stop"]);
        fs.writeFileSync(transcript, userText("earlier") + blockedAt(400));
        fs.writeFileSync(log, "");
        cli(["--hook-start", "--genre", "zen", "--volume", "5"], turnPayload());
        await sleep(1200);
        assert.ok(!playing(), "a prompt already blocked must not start the music");
        assert.ok(!/loop_/.test(fs.readFileSync(log, "utf8")), "and nothing may reach the backend");

        // SessionEnd: only the session that started the music may stop it.
        start("s1");
        await settle("s1's music must start", () => playing());
        cli(["--hook-end"], JSON.stringify({ session_id: "s2", reason: "prompt_input_exit" }));
        assert.ok(playing(), "another session closing must not silence this one");
        cli(["--hook-end"], "{}");
        assert.ok(playing(), "an unidentified session must not stop it either");
        cli(["--hook-end"], JSON.stringify({ session_id: "s1", reason: "prompt_input_exit" }));
        assert.ok(!playing(), "the owning session ending must stop it");

        // Several sessions of one agent share the music: it plays while any of
        // them is working, and each still gets its own chime.
        const sid = (session, extra = {}) => JSON.stringify({ session_id: session, ...extra });
        const goStart = (session) => cli(["--hook-start", "--genre", "zen", "--volume", "5"], sid(session));
        cli(["--stop"]);

        goStart("A");
        await settle("A's music must start", () => playing());
        const aPid = parseInt(fs.readFileSync(pidFile, "utf8"), 10);
        goStart("B");
        assert.strictEqual(parseInt(fs.readFileSync(pidFile, "utf8"), 10), aPid, "a second session's prompt must not restart A's music");

        fs.writeFileSync(log, "");
        cli(["--hook-stop"], sid("B"));
        assert.ok(playing() && alive(aPid), "B finishing must not silence A, which is still working");
        assert.ok(/chime_success/.test(fs.readFileSync(log, "utf8")), "but B still gets its own done chime");

        cli(["--hook-wait"], sid("C", { tool_name: "Bash" }));
        assert.ok(playing(), "a session with no turn on record cannot pause the music");

        fs.writeFileSync(log, "");
        cli(["--hook-stop"], sid("A"));
        assert.ok(!playing(), "the last working session ending must stop the music");
        assert.ok(/chime_success/.test(fs.readFileSync(log, "utf8")), "with A's chime");
        await settle("the daemon must exit", () => !alive(aPid));

        // More sessions working, more of the same piece: tier 2 at the next loop
        // boundary once a second one starts, back down as it finishes.
        const waitFor = async (what, check, ms = 12000) => {
          for (let i = 0; i < ms / 100 && !check(); i++) await sleep(100);
          assert.ok(check(), what);
        };
        const logged = () => fs.readFileSync(log, "utf8");
        fs.writeFileSync(log, "");
        goStart("A");
        await waitFor("one session plays tier 1", () => /loop_zen_t1/.test(logged()));
        assert.ok(!/loop_zen_t[23]/.test(logged()), "a lone session stays at its time-based tier");
        goStart("B");
        await waitFor("a second working session raises the tier", () => /loop_zen_t2/.test(logged()));
        cli(["--hook-stop"], sid("B"));
        cli(["--hook-stop"], sid("A"));
        await settle("the daemon must stop", () => !playing());

        // A dialog pauses the music only when nobody else is working.
        goStart("A");
        goStart("B");
        cli(["--hook-wait"], sid("A", { tool_name: "Bash" }));
        assert.ok(playing(), "A's dialog must not pause the music while B works");
        assert.strictEqual(waitingOn("A"), "Bash");
        cli(["--hook-wait"], sid("B", { tool_name: "Read" }));
        assert.ok(!playing(), "every session waiting pauses it");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], sid("A", { tool_name: "Read" }));
        assert.ok(!playing(), "another session's tool finishing is not A's approval");
        cli(["--hook-resume", "--genre", "zen", "--volume", "5"], sid("A", { tool_name: "Bash" }));
        assert.ok(playing(), "A's own approval resumes the music");
        cli(["--hook-end"], sid("A"));
        assert.ok(!playing(), "A closing leaves only B, which is waiting, so it stops");
        assert.strictEqual(waitingOn("B"), "Read", "and B's wait survives");

        // Esc in one session ends only that session's turn.
        const tA = path.join(dir, "a.jsonl");
        const tB = path.join(dir, "b.jsonl");
        fs.writeFileSync(tA, "");
        fs.writeFileSync(tB, "");
        cli(["--stop"]);
        cli(["--hook-start", "--genre", "zen", "--volume", "5"], sid("A", { transcript_path: tA }));
        cli(["--hook-start", "--genre", "zen", "--volume", "5"], sid("B", { transcript_path: tB }));
        await settle("the music must start", () => playing());
        const bothPid = parseInt(fs.readFileSync(pidFile, "utf8"), 10);
        fs.appendFileSync(tB, userText(INTERRUPT));
        await settle("B's Esc must end B's turn", () => waitingOn("B") === undefined);
        await sleep(800);
        assert.ok(alive(bothPid) && playing(), "A is still working, so the music carries on");
        fs.appendFileSync(tA, userText(INTERRUPT));
        await settle("A's Esc must end the music", () => !alive(bothPid));
        assert.ok(!playing(), "with both interrupted nothing is left to play");

        // The 15-minute limit is silence from the agent, not time since the
        // prompt: a turn that keeps calling tools outlasts it, one that goes
        // quiet does not. Scaled to 2.5s here; every hook refreshes the session.
        cli(["--stop"]);
        const shortEnv = { ...env, VIBE_MAX_DAEMON_MS: "2500" };
        const run = (args, payload = "") => spawnSync(process.execPath, [CLI, ...args], { input: payload, env: shortEnv, timeout: 20000 });
        run(["--hook-start", "--genre", "zen", "--volume", "5"], sid("L"));
        await settle("the long turn's music must start", () => playing());
        const longPid = parseInt(fs.readFileSync(pidFile, "utf8"), 10);
        for (let i = 0; i < 12; i++) {
          await sleep(500);
          run(["--hook-resume", "--genre", "zen", "--volume", "5"], sid("L", { tool_name: "Read", hook_event_name: "PostToolUse" }));
        }
        assert.ok(alive(longPid) && playing(), "6s of tool calls is past the limit, and the music must still be playing");
        await settle("a session that goes quiet is dropped and the music stops", () => !alive(longPid));
        assert.ok(!playing(), "and the pid file goes with it");
      } finally {
        cli(["--stop"]);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      console.log("   ✓ Dialogs and elicitations pause and resume; API errors, Esc (via the transcript) and session end stop the music; several sessions share it and each keeps its own chime.");
    }
  }


})().catch((err) => {
  console.error(`\n\x1b[31mTest failure:\x1b[0m ${err && err.message ? err.message : err}`);
  process.exit(1);
});
