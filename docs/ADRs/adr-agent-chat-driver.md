# ADR: how Grillo drives Claude Code for the chat view and the relay

- **Status:** proposed (approving the pull request that adds this file accepts it)
- **Date:** 2026-10-22
- **Issue:** issue 61 (ADR: how Grillo drives Claude Code for the chat view and the relay)
- **PRD:** section 4.6 items 1 and 7, section 8 (Agent runtime), section 13 (Assumptions still unverified)

## Context

Release 1 runs each agent as the member's unmodified, interactive Claude Code inside an embedded terminal
(xterm.js + node-pty). Release 2 replaces that screen with a **chat view**: message bubbles, clickable answer
buttons and a message box (PRD 4.6 item 1), plus a **support agent** that relays a message by posting it into
another agent's chat, marked "from Support, for <member>" (PRD 4.6 item 7).

A terminal screen cannot be turned into bubbles and buttons reliably, so release 2 needs a machine-readable way to
talk to Claude Code. PRD section 8 names two candidates: Claude Code's machine-readable mode (`claude -p` with
`stream-json` input and output) or the Agent SDK (`@anthropic-ai/claude-agent-sdk`). PRD section 13 lists what the
choice must prove:

1. Every wayfinder prompt comes through it: clickable options (the `AskUserQuestion` tool) and permission prompts.
2. The member's user-level `CLAUDE.md` (personal rules file) still loads.
3. The conversation can be captured word for word.

The choice is hard to reverse: it fixes a protocol and possibly a dependency for every agent tab, so it gets an ADR
before any ticket or code.

## Spike

Run on 2026-10-22 on the owner's Windows 11 laptop, Claude Code **2.1.308**, signed in with a claude.ai
subscription, from a scratch folder `C:\wt\adr-spike-scratch` (deleted afterwards). Three model prompts in total.

| # | What was run | What was seen |
|---|---|---|
| 1 | `claude -p "Reply with the single word pong" --output-format stream-json --verbose` | Four lines of JSON: `system/init` (session id, `tools`, `model`, `permissionMode`, `apiKeySource`, `memory_paths`, `capabilities`, …), `assistant` (`{"type":"text","text":"🟢 pong"}`), `rate_limit_event`, `result` (`subtype: success`, `result`, `session_id`, `num_turns`, `total_cost_usd`). |
| 2 | Same run, `system/init` fields | `apiKeySource: "none"`, which the SDK's own type definitions describe as "no API key in use, e.g. claude.ai OAuth login": the run used the member's subscription login. |
| 3 | Same run, reply text | The reply began with `🟢`, the canary that only the member's **user-level** `~/.claude/CLAUDE.md` asks for. **The user-level `CLAUDE.md` loads in `-p` mode.** |
| 4 | Same run, `system/init.tools` | `AskUserQuestion` is **not** in the tool list when no one is registered to answer prompts. Without a prompt host, clickable options never appear. |
| 5 | A small Python driver (kept outside the repository) running `claude -p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio --permission-mode manual`, sending `{"type":"control_request","request":{"subtype":"initialize"}}` and then a `user` message asking for an `AskUserQuestion` with options Apple and Pear, then a `Write` of the answer to `answer.txt` | `system/init` now lists `AskUserQuestion`. |
| 6 | Same run, the clickable-options question | Claude Code sent `{"type":"control_request","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[{"question":"Which fruit?","header":"Fruit","options":[{"label":"Apple",…},{"label":"Pear",…}],"multiSelect":false}]},"requires_user_interaction":true}}` and **waited**. The driver answered on stdin with `{"type":"control_response","response":{"subtype":"success","request_id":…,"response":{"behavior":"allow","updatedInput":{…,"answers":{"Which fruit?":"Pear"}}}}}`. The tool result read `Your questions have been answered: "Which fruit?"="Pear".` **Clickable options come through and the answer goes back.** |
| 7 | Same run, the permission prompt | Claude Code sent `control_request` / `can_use_tool` for `Write` (`file_path` `…\answer.txt`, with `permission_suggestions` such as `setMode acceptEdits`) and waited; the driver answered `allow`; `answer.txt` was written with `Pear`. **Permission prompts come through and the answer goes back.** |
| 8 | A project `CLAUDE.md` in the scratch folder saying "End every reply with the exact word ZEBRA-MARKER" | Both replies ended with `ZEBRA-MARKER` and also began with `🟢`: the project file **and** the user-level file load together. |
| 9 | The relay: after the first `result`, the driver wrote a second `user` message on the same stdin: `[from Support, for Ignacio] Please reply with the words: relay received.` | Same `session_id`, reply `🟢 Result: relay received.` **Posting into a running agent's chat is writing one more `user` line to that agent's stdin.** |
| 10 | Word-for-word capture | Every message, tool call, question and answer is in the stream Grillo reads. Claude Code also keeps its own transcript at `~/.claude/projects/<folder-slug>/<session_id>.jsonl`: both spike sessions were there, and so are the owner's earlier sessions in this repository: of 26 files, 14 carry `"entrypoint":"cli"` (interactive terminal sessions) and 12 `"sdk-cli"` (`-p` runs), so a **release-1 terminal agent's conversation is captured word for word** the same way. |
| 11 | Agent SDK package, `npm pack @anthropic-ai/claude-agent-sdk@0.3.308` | Typed messages, a `canUseTool` callback and `settingSources`. It ships its **own** Claude Code binary as per-platform optional packages (`…-win32-x64`, `…-darwin-arm64`, …); `pathToClaudeCodeExecutable` points it at another one. Its spawn code passes `--permission-prompt-tool stdio`: the SDK speaks the very protocol rows 5 to 9 used. Not run in this spike. |
| 12 | Docs, `code.claude.com/docs/en/agent-sdk/overview` and `/headless` | Overview: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." Headless: `claude -p` *is* "the Agent SDK via the CLI"; "`--bare` is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release"; bare mode skips `CLAUDE.md` and "doesn't use your subscription login". |

**Assumptions, not tested here:** a message written to stdin while the agent is mid-turn is queued and answered
after that turn (the `capabilities` list advertises `interrupt_*` and `msg_lifecycle_v1`, which suggests so); the
same behaviour on macOS; a multi-question or multi-select `AskUserQuestion` (same shape, `answers` keyed by
question text); the wayfinder skill's own prompts (they are `AskUserQuestion` calls, so they should take row 6's
path).

## Decision

**Grillo drives the member's own installed `claude` binary in machine-readable mode, as one long-lived process per
agent tab:**

```
claude -p --input-format stream-json --output-format stream-json --verbose
       --permission-prompt-tool stdio --permission-mode manual
```

started in the project folder, never with `--bare`. Grillo's main process owns the process and speaks the protocol
through **one swappable interface** (the agent chat driver), so the Agent SDK can replace it later in one module.

What comes through, and how the chat view shows it:

- **Assistant text** (`assistant` events, `text` blocks) → message bubbles.
- **Clickable options** (`control_request` / `can_use_tool` with `tool_name: "AskUserQuestion"`) → answer buttons;
  the member's click goes back as a `control_response` with `behavior: "allow"` and `updatedInput.answers`
  (question text → chosen label). A free-text answer uses the same field.
- **Permission prompts** (`control_request` / `can_use_tool` for any other tool) → an Allow / Deny card; the answer
  goes back as `behavior: "allow"` or `"deny"`.
- **The member's typing** → a `user` line on stdin.
- **Turn end** (`result` event) → the tab's "waiting for you" dot (PRD 4.6 item 2) when the last event asked
  something.

**The relay (PRD 4.6 item 7):** the support agent never talks to another agent itself. When it decides to relay,
Grillo's main process writes one `user` line into the target agent's stdin, with the text prefixed
`[from Support, for <member>]`, and the target tab's chat shows it as a bubble marked "from Support, for <member>".
Agents still share no memory (PRD 4.6 item 5): the relay is one ordinary message in the target's own conversation.

**The word-for-word record** is Grillo's own copy of the event stream it already reads; Claude Code's session
transcript under `~/.claude/projects/` is the fallback and the source for release-1 terminal agents.

Why not the SDK now: the raw route passed every check in the spike with no new dependency, runs the member's
unmodified Claude Code exactly as PRD section 8 asks, and the SDK would by default ship and run a second, bundled
copy of Claude Code next to the member's own.

## Consequences

- **Risk, the member's login (needs the owner's read before approving).** Anthropic's Agent SDK overview says
  third-party products may not offer claude.ai login or rate limits without prior approval, and the headless docs
  call `claude -p` the Agent SDK via the CLI. Grillo does not offer a login: each member runs their own Claude Code
  under their own subscription on their own laptop, as in release 1. Whether that wording still covers a published
  app that drives `claude -p` on the member's behalf is **not settled by this spike**. PRD section 13 already
  carries a related open question about Claude logins. If it is not allowed, the chat view needs either Anthropic's
  approval or a fallback that keeps the release-1 terminal.
- **Risk, `--bare` becoming the default for `-p`.** The docs say it will, and bare mode loads no `CLAUDE.md` and no
  subscription login, which breaks both requirements. The driver must pin the non-bare behaviour with whatever
  opt-out flag exists when that change ships, and a startup check must fail loudly if `system/init` shows the
  member's `CLAUDE.md` or login missing.
- **Risk, an undocumented protocol.** The `control_request` / `control_response` messages over stdio are what the
  Agent SDK uses internally; the public docs describe the flags but not the message shapes. A Claude Code update can
  change them under Grillo. Mitigation: one driver module, the SDK's published TypeScript types as the reference,
  feature checks on `system/init.capabilities`, and a test that replays recorded streams.
- **PRD 4.6 item 1, the "show terminal" switch.** In `-p` mode there is no Claude Code screen underneath to reveal.
  The switch can show the raw event stream, or stop the `-p` process and reopen the same session interactively with
  `claude --resume <session_id>` in the terminal (assumption, not tested). Which one is a product choice for the
  chat view story, and may need a PRD wording change.
- **Permission mode is explicit.** The member's own settings can set a default mode (the owner's is `auto`, which
  the spike saw); Grillo passes `--permission-mode manual` so every prompt reaches the member's screen.
- **`AskUserQuestion` exists only with a prompt host.** Without `--permission-prompt-tool stdio` Claude Code removes
  it, so the wayfinder's clickable questions would silently become plain text.
- **Usage.** Each agent tab is one Claude Code process on the member's subscription, the same as release 1.
- **Follow-up work.** After approval, the owner files the story "Agent chat protocol: drive Claude Code per the
  ADR, including the relay into another agent's chat" (seam `src/main/features/agent-chat/`, blocked by the agent
  runtime story) and adds it as a blocker of the chat view, support agent skill and support agent tab stories.

## Alternatives

- **Agent SDK (`@anthropic-ai/claude-agent-sdk`).** Gains: typed messages, a `canUseTool` callback instead of
  hand-parsed `control_request`s, protocol changes absorbed by Anthropic. Costs: a dependency that ships its own
  Claude Code binary per platform (so "the member's unmodified local Claude Code" holds only if Grillo always sets
  `pathToClaudeCodeExecutable`, and then the SDK version and the member's binary can drift apart); the same login
  question as above, stated about the SDK by name. Kept as the drop-in replacement behind the driver interface.
- **Keep the terminal and scrape it.** Parse the interactive screen from node-pty. No new protocol, but turning
  screen text into bubbles and buttons is fragile and breaks on every interface change; rejected.
- **Hooks only.** A `PermissionRequest` hook or an MCP `--permission-prompt-tool` server could forward prompts while
  the terminal stays. It covers permission prompts but not the assistant text or the relay in a structured way, and
  adds a second channel to keep in step; rejected.
