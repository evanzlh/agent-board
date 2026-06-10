# agentBoard README and Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the default README as English GitHub-friendly documentation for `agentBoard`, add a linked Chinese README, and add a project icon in both README headers.

**Architecture:** This is a documentation and asset update. `README.md` is the default English project overview, `README.zh-CN.md` is the linked Chinese version, and the icon is stored as a workspace asset under `docs/assets/` and referenced by a relative Markdown image path.

**Tech Stack:** GitHub Flavored Markdown, generated PNG raster asset, Node.js project commands already defined in `package.json`.

---

## File Structure

- Create: `docs/assets/agentboard-icon.png`
  - README header icon generated as a square raster image.
- Modify: `README.md`
  - Replace the existing README with an English, GitHub-style `agentBoard` document.
- Create: `README.zh-CN.md`
  - Add a Chinese `agentBoard` document with equivalent practical content.
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
Primary request: Create a square app icon for an open source developer tool named agentBoard. The icon represents a local AI coding-agent status dashboard.
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
  <img src="docs/assets/agentboard-icon.png" alt="agentBoard icon" width="128" height="128">
</p>

<h1 align="center">agentBoard</h1>

<p align="center">
  Turn local Codex agent activity into a real-time, read-only status cockpit for browsers, scripts, and dashboards.
</p>

<p align="center">
  <img alt="Node.js >=22.18.0" src="https://img.shields.io/badge/node-%3E%3D22.18.0-339933?logo=node.js&logoColor=white">
  <img alt="Codex App Server" src="https://img.shields.io/badge/Codex-App%20Server-111827">
  <img alt="Local only" src="https://img.shields.io/badge/local--only-read--only-06b6d4">
  <img alt="Tests" src="https://img.shields.io/badge/tests-node%20--test-22c55e">
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>
```

Then include these sections in order:

1. `## Why agentBoard`
2. `## Highlights`
3. `## Quick Start`
4. `## CLI Usage`
5. `## Use Cases`
6. `## Web UI`
7. `## HTTP API`
8. `## Agent Model`
9. `## App Server Lifecycle`
10. `## Development`
11. `## Updating Vendored Euphony`
12. `## Troubleshooting`

- [x] **Step 2: Add linked Chinese README**

Create `README.zh-CN.md` using the same icon and badge header, with this language switcher:

```markdown
<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>
```

Then include these Chinese sections in order:

1. `## 为什么需要 agentBoard`
2. `## 功能亮点`
3. `## 快速开始`
4. `## 常用命令`
5. `## 使用场景`
6. `## Web UI`
7. `## HTTP API`
8. `## Agent 数据模型`
9. `## App Server 生命周期`
10. `## 开发`
11. `## 更新 Vendored Euphony`
12. `## 故障排查`

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
> agentBoard currently supports Codex only and observes local Codex state. It does not approve requests, send user input, stop agents, or mutate Codex sessions.
```

The Chinese README must include a GitHub admonition with this meaning:

```markdown
> [!IMPORTANT]
> agentBoard 目前只支持 Codex，并且只观察本地 Codex 状态。它不会审批请求、发送用户输入、停止代理，也不会修改 Codex 会话。
```

## Task 3: Verify and Review

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `docs/assets/agentboard-icon.png`

- [x] **Step 1: Verify asset reference**

Run:

```bash
rg -n "docs/assets/agentboard-icon.png|README.zh-CN.md|<h1 align=\"center\">agentBoard</h1>|npm start|GET /events" README.md
rg -n "docs/assets/agentboard-icon.png|README.md|<h1 align=\"center\">agentBoard</h1>|npm start|GET /events" README.zh-CN.md
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
