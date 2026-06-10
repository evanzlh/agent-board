# agentBoard README and Icon Design

## Goal

Rewrite the project README as a Chinese, GitHub-friendly open source document and add a project icon that appears in the README header.

The README should make `agentBoard` feel like a clear, useful local tool for monitoring Codex agents, while keeping the technical details accurate enough for developers to run, inspect, and integrate the project.

## Confirmed Direction

- Product name in the README: `agentBoard`
- Package and command references remain factual: `codex-status`, `npm start`, `node src/cli.ts daemon`
- Language: Chinese primary documentation
- Style: "爆款工具型"
- Tone: concise, developer-focused, high-signal, not overly decorative
- Icon: high-contrast local AI agent status board, deep background with cyan/green status indicators

## README Structure

1. Header
   - Centered icon image
   - `agentBoard` title
   - Short Chinese slogan
   - GitHub-style badges for Node version, local-only/read-only positioning, Codex App Server, and tests

2. Value Proposition
   - Explain that `agentBoard` turns local Codex App Server state into a readable, read-only status dashboard and JSON/SSE API
   - Emphasize that it observes local state only and does not approve requests, send input, stop agents, or mutate sessions

3. Highlights
   - Real-time local agent inventory
   - Main-agent and sub-agent relationships
   - Normalized status values
   - Web UI table and Office view
   - Per-agent session/message viewing
   - Local HTTP JSON endpoints and SSE updates

4. Quick Start
   - Requirements: Node.js `>=22.18.0`, Codex CLI with App Server support
   - `npm start`
   - Open `http://127.0.0.1:17345/ui`
   - Example `curl` calls for `/status` and filtered `/agents`

5. Usage Scenarios
   - Monitor parallel Codex sessions and sub-agents
   - Spot agents waiting for approval or input
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

Create one workspace-bound raster icon for the README, stored under a project asset path such as `docs/assets/agentboard-icon.png`.

The icon should:

- Work at README header size around 96-140 px
- Use a square composition
- Represent a local monitoring dashboard for AI coding agents
- Include clear status-light or node indicators
- Avoid text inside the image so it remains legible at small sizes
- Use a deep neutral background with cyan/green accents to match the selected "爆款工具型" direction

## Constraints

- Keep README concise enough to scan, but do not remove important operational details.
- Do not add License, Contributing, or Changelog sections.
- Use GitHub Flavored Markdown.
- Use GitHub admonition syntax where it improves clarity.
- Do not change project behavior or code for this task.
- Do not rename package metadata unless separately requested.

## Verification

- Confirm the icon file exists and is referenced by README.
- Confirm README links and commands match current project files.
- Run the existing test suite if feasible to ensure no incidental project breakage.
- Review `git diff` for scope: README, icon asset, and this design doc only unless implementation planning chooses otherwise.
