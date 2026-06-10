# AgentBoard README and Icon Design

## Goal

Rewrite the default project README as an English, GitHub-friendly open source document, add a linked Chinese README, and add a project icon that appears in both README headers.

The README set should make `AgentBoard` feel like a clear, useful local tool for monitoring Codex agents, while keeping the technical details accurate enough for developers to run, inspect, and integrate the project in either English or Chinese.

## Confirmed Direction

- Product name in the README files: `AgentBoard`
- Package and command references remain factual: `codex-status`, `npm start`, `node src/cli.ts daemon`
- Language: English default documentation in `README.md`; Chinese documentation in `README.zh-CN.md`
- Style: "爆款工具型"
- Tone: concise, developer-focused, high-signal, not overly decorative
- Icon: high-contrast local AI agent status board, deep background with cyan/green status indicators

## README Structure

1. Header in both README files
   - Centered icon image
   - `AgentBoard` title
   - Short localized slogan
   - GitHub-style badges for Node version, local-only/read-only positioning, Codex App Server, and tests
   - Language switcher linking `README.md` and `README.zh-CN.md`

2. Value Proposition in both languages
   - Explain that `AgentBoard` shows Codex agent work status through a readable, read-only status dashboard and JSON/SSE API
   - Emphasize status transitions such as finished work, approval waits, input waits, and errors
   - Explain that session message lists are rendered through vendored euphony assets and link to `https://github.com/openai/euphony`
   - Emphasize that it observes local state only and does not approve requests, send input, stop agents, mutate sessions, install shell hooks, or hook into Codex execution

3. Highlights
   - Real-time local agent inventory
   - Main-agent and sub-agent relationships
   - Codex agent work status display
   - Status transition hints for finished, approval/input waiting, and error states
   - Normalized status values
   - Web UI table and Office view
   - Per-agent session/message viewing rendered with euphony
   - Local HTTP JSON endpoints and SSE updates
   - Non-invasive design: read-only observer, no hooks, no prompt wrapping, no Codex patching

4. Quick Start
   - Requirements: Node.js `>=22.18.0`, Codex CLI with App Server support
   - `npm start`
   - Open `http://127.0.0.1:17345/ui`
   - Example `curl` calls for `/status` and filtered `/agents`

5. Usage Scenarios
   - Monitor parallel Codex sessions and sub-agents
   - Spot agents waiting for approval or input
   - Notice agent completion and other state transitions
   - Review rendered message lists instead of raw session JSONL
   - Debug App Server connection and stale state
   - Feed local dashboards or scripts through JSON/SSE

6. Reference Sections
   - CLI options
   - App Server lifecycle
   - Web UI capabilities
   - HTTP API table
   - Agent model and status mapping
   - Development and testing
   - Troubleshooting

## Icon Requirements

Create one workspace-bound raster icon for the README files, stored under a project asset path such as `docs/assets/agentboard-icon.png`.

The icon should:

- Work at README header size around 96-140 px
- Use a square composition
- Represent a local monitoring dashboard for AI coding agents
- Include clear status-light or node indicators
- Avoid text inside the image so it remains legible at small sizes
- Use a deep neutral background with cyan/green accents to match the selected "爆款工具型" direction

## Constraints

- Keep both README files concise enough to scan, but do not remove important operational details.
- Do not add License, Contributing, or Changelog sections.
- Use GitHub Flavored Markdown.
- Use GitHub admonition syntax where it improves clarity.
- Do not change project behavior or code for this task.
- Do not rename package metadata unless separately requested.

## Verification

- Confirm the icon file exists and is referenced by both README files.
- Confirm both README files link to each other.
- Confirm both README files use `AgentBoard` casing for the product name.
- Confirm both README files mention Codex agent status display, status transition hints, euphony rendering with GitHub link, and non-invasive/no-hook design.
- Confirm README links and commands match current project files.
- Run the existing test suite if feasible to ensure no incidental project breakage.
- Review `git diff` for scope: English README, Chinese README, icon asset, plan doc, and this design doc only unless implementation planning chooses otherwise.
