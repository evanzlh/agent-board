# AgentBoard README and Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the default README as English GitHub-friendly documentation for `AgentBoard`, add a linked Chinese README, and add a project icon in both README headers.

**Architecture:** This is a documentation and asset update. `README.md` is the default English project overview, `README.zh-CN.md` is the linked Chinese version, and the icon is stored as a workspace asset under `docs/assets/` and referenced by a relative Markdown image path.

**Tech Stack:** GitHub Flavored Markdown, generated PNG raster asset, Node.js project commands already defined in `package.json`.

---

## File Structure

- Create: `docs/assets/agentboard-icon.png`
  - README header icon generated as a square raster image.
- Modify: `README.md`
  - Replace the existing README with an English, GitHub-style `AgentBoard` document.
- Create: `README.zh-CN.md`
  - Add a Chinese `AgentBoard` document with equivalent practical content.
- Keep: `package.json`
  - No package metadata changes. `codex-status` remains the package/bin name.

## Task 1: Generate README Icon

**Files:**
- Create: `docs/assets/agentboard-icon.png`

- [x] **Step 1: Generate the icon image**

Use the built-in image generation tool with this prompt:

```text
Use case: logo-brand
Asset type: README project icon
Primary request: Create a square app icon for an open source developer tool named AgentBoard. The icon represents a local AI coding-agent status dashboard.
Composition: Deep neutral rounded-square background, central abstract dashboard panel, three connected agent nodes, cyan and green status lights, subtle terminal/grid motif, high contrast, clean modern vector-like 3D polish.
Constraints: No readable text, no letters, no watermark, no brand logos, no mascot, no busy tiny details. Must remain recognizable at 96px in a GitHub README.
Style: Premium developer-tool icon, dark base with cyan and green accents, crisp edges, centered subject, generous padding.
```

- [x] **Step 2: Save the generated asset into the project**

Create the asset directory if needed:

```bash
mkdir -p docs/assets
```

Copy or move the selected generated PNG into:

```text
docs/assets/agentboard-icon.png
```

- [x] **Step 3: Inspect the icon file**

Run:

```bash
file docs/assets/agentboard-icon.png
```

Expected: output identifies a PNG image.

## Task 2: Rewrite README Documentation

**Files:**
- Modify: `README.md`
- Create: `README.zh-CN.md`

- [x] **Step 1: Replace default README content**

Replace `README.md` with English documentation using this structure:

```markdown
<p align="center">
  <img src="docs/assets/agentboard-icon.png" alt="AgentBoard icon" width="128" height="128">
</p>

<h1 align="center">AgentBoard</h1>

<p align="center">
  See what every Codex agent is doing, when it finishes, and when it needs your approval.
</p>

<p align="center">
  <img alt="Node.js >=22.18.0" src="https://img.shields.io/badge/node-%3E%3D22.18.0-339933">
  <img alt="Codex App Server" src="https://img.shields.io/badge/Codex-App%20Server-111827">
  <img alt="Local only" src="https://img.shields.io/badge/local--only-read--only-06b6d4">
  <img alt="Tests" src="https://img.shields.io/badge/tests-node%20--test-22c55e">
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>
```

Then include these sections in order:

1. `## Why AgentBoard`
2. `## Highlights`
3. `## Design Principles`
4. `## Quick Start`
5. `## CLI Usage`
6. `## Use Cases`
7. `## Web UI`
8. `## HTTP API`
9. `## Agent Model`
10. `## App Server Lifecycle`
11. `## Development`
12. `## Updating Vendored Euphony`
13. `## Troubleshooting`

- [x] **Step 2: Add linked Chinese README**

Create `README.zh-CN.md` using the same icon and badge header, with this language switcher:

```markdown
<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>
```

Then include these Chinese sections in order:

1. `## 为什么需要 AgentBoard`
2. `## 功能亮点`
3. `## 设计亮点`
4. `## 快速开始`
5. `## 常用命令`
6. `## 使用场景`
7. `## Web UI`
8. `## HTTP API`
9. `## Agent 数据模型`
10. `## App Server 生命周期`
11. `## 开发`
12. `## 更新 Vendored Euphony`
13. `## 故障排查`

Both README files must explicitly cover:

- Codex agent work status display
- Status transition hints for finished, approval/input waiting, and error states
- Session message list rendering with `[euphony](https://github.com/openai/euphony)`
- Non-invasive design: no shell hooks, no Codex patching, no prompt wrapping, no mutation of Codex sessions

- [x] **Step 3: Preserve factual command and API details**

Both README files must include these exact commands:

```bash
npm start
node src/cli.ts daemon [options]
curl http://127.0.0.1:17345/status
curl "http://127.0.0.1:17345/agents?status=working"
npm test
npm run smoke:real
scripts/update-euphony-vendor.sh /path/to/euphony
```

Both README files must list these HTTP routes:

```text
GET /ui
GET /ui/
GET /health
GET /status
GET /agents
GET /agents/:id
GET /agents/:id/session
GET /events
```

- [x] **Step 4: Include the read-only warning**

The English README must include this GitHub admonition:

```markdown
> [!IMPORTANT]
> AgentBoard currently supports Codex agents only and observes local Codex state. It does not approve requests, send user input, stop agents, mutate Codex sessions, or install hooks into your shell or Codex workflow.
```

The Chinese README must include a GitHub admonition with this meaning:

```markdown
> [!IMPORTANT]
> AgentBoard 目前只支持 Codex agent，并且只观察本地 Codex 状态。它不会审批请求、发送用户输入、停止代理、修改 Codex 会话，也不会给 shell 或 Codex 工作流安装 hook。
```

## Task 3: Verify and Review

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `docs/assets/agentboard-icon.png`

- [x] **Step 1: Verify asset reference**

Run:

```bash
rg -n "docs/assets/agentboard-icon.png|README.zh-CN.md|<h1 align=\"center\">AgentBoard</h1>|npm start|GET /events" README.md
rg -n "docs/assets/agentboard-icon.png|README.md|<h1 align=\"center\">AgentBoard</h1>|npm start|GET /events" README.zh-CN.md
rg -n "Codex agent work status|Status transition hints|https://github.com/openai/euphony|Non-invasive" README.md
rg -n "Codex agent 工作状态|状态转换提示|https://github.com/openai/euphony|非侵入式设计" README.zh-CN.md
```

Expected: all patterns appear in `README.md`.

- [x] **Step 2: Run tests**

Run:

```bash
npm test
```

Expected: all existing Node test files pass.

- [x] **Step 3: Review diff scope**

Run:

```bash
git diff -- README.md README.zh-CN.md docs/assets/agentboard-icon.png docs/superpowers/plans/2026-06-10-agentboard-readme-icon.md
git status --short
```

Expected: only English README, Chinese README, icon asset, and this implementation plan are changed after execution.
