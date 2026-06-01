# Pixel Office Agent View Design

## Overview

Add a second dashboard view that visualizes Codex agents as a pixel-style office. The existing table remains the precise operational/debugging view. The new Office view is a more glanceable, animated view built on the same `/status` data, the same inferred agent statuses, and the same UI filters.

The first version should be useful without becoming a game engine. It should render status clearly, preserve main/sub-agent hierarchy, and stay lightweight enough to run in the current no-build static UI.

## Goals

- Add a `Table` / `Office` view switch to the built-in UI.
- Render a pixel-style office using pure HTML and CSS.
- Represent each visible main agent as a team pod.
- Render visible sub-agents inside their parent main agent's pod.
- Reuse existing filters: `status`, `kind`, `active within`, `cwd`, and `search`.
- Make agent state readable at a glance through posture, color, and small animations.
- Keep table functionality intact.

## Non-Goals

- Do not replace the table view.
- Do not introduce Canvas, WebGL, sprite sheets, generated image assets, or a frontend build step in the first version.
- Do not add new backend endpoints.
- Do not attempt pathfinding, free movement, or a full simulation.
- Do not infer additional status semantics beyond the current normalized agent data.

## User Experience

The UI gains a view switch near the table controls with two modes:

- `Table`: current table, hierarchy, filters, and JSON detail behavior.
- `Office`: pixel office scene using the same filtered agent set.

When the user changes filters, both views use the same filtered result. This means the `Active within` filter controls which agents appear in the office. Agents outside the active window disappear from the Office view because they are not part of the filtered result.

The Office view should feel like an operational dashboard rather than a decorative landing page. It should be dense enough for real local Codex usage, where there may be many historical agents, but it can show only the currently filtered subset.

## Layout

Use the selected `Team Pods` model:

- Each visible main agent becomes one pod.
- A pod contains a compact header with the main agent name, status, and sub-agent count.
- The main agent appears as the lead desk in the pod.
- Visible child sub-agents are rendered as smaller desks inside the same pod.
- If a sub-agent is visible but its parent is not visible because filters exclude the parent, render it in an `Unassigned Sub Agents` pod.
- If an agent has unknown kind and no parent relationship, render it in an `Other Agents` pod.

Pods should use a responsive grid. On wide screens, multiple pods can sit side by side. On narrow screens, pods stack vertically. A pod may internally wrap sub-agent desks into rows.

## Status Mapping

Use the existing normalized public statuses.

| Status | Office representation |
| --- | --- |
| `working` | Agent at desk, active monitor, subtle typing or screen animation. |
| `idle` | Agent in resting pose, dimmer monitor or chair turned away. |
| `finished` | Quiet completed desk, check mark or closed-laptop state. |
| `waiting_approval` | Paused agent with yellow approval bubble. |
| `waiting_input` | Paused agent with question/input bubble. |
| `error` | Red alert screen or warning sign. |
| `unknown` | Neutral inactive desk with muted styling. |
| stale agent | Desaturated/faded treatment if still included by filters. |

Status should not rely on color alone. It should also use labels, bubble symbols, or shape changes.

## Interactions

Agent desks in Office view should be clickable. Clicking an agent should reuse the existing `expandedAgentId` detail state where practical, so Office and Table remain connected by the same selected agent concept.

First-version behavior:

- Click an office agent to show a compact detail drawer or panel within the Office view.
- The detail should include display name, status, kind, cwd, last turn, updated time, and ID.
- The JSON detail does not need to be duplicated visually in full if the table already supports it, but the selected agent must be identifiable and inspectable.

Hover/focus should show enough information to identify the agent without opening details. Keyboard focus should work on agent buttons.

## Architecture

Keep the implementation in the existing static UI structure:

- `src/ui/index.html`: add view switch container and Office view container.
- `src/ui/app.js`: maintain active view state, render either table or office, and reuse filtered agents from existing filter logic.
- `src/ui/view-model.js`: add a view-model helper for grouping visible agents into office pods, based on the same parent relationship logic as table hierarchy.
- `src/ui/styles.css`: add pixel office layout, desk sprites built from CSS boxes, status animation, and responsive rules.
- `tests/ui/view-model.test.ts`: cover Office grouping behavior.

The Office view should not create a separate data-fetching path. It should use the same `state.agents`, `state.filters`, and `state.generatedAt` values already used by the table.

## Office View Model

Add a helper that turns filtered agents into pods. It should preserve visible parent-child relationships.

Suggested conceptual shape:

```js
[
  {
    id: "main-agent-id",
    type: "main",
    agent: mainAgent,
    children: [subAgentA, subAgentB]
  },
  {
    id: "unassigned-sub-agents",
    type: "orphan-sub-agents",
    agent: null,
    children: [subAgentWithFilteredParent]
  },
  {
    id: "other-agents",
    type: "other",
    agent: null,
    children: [unknownAgent]
  }
]
```

The exact property names can follow local code style during implementation. The important contract is that Office rendering does not need to rediscover parent-child relationships itself.

## Animation

Use low-cost CSS animations:

- Working: blinking monitor, tiny typing arm shift, or activity ticks.
- Waiting approval/input: bubble pulse.
- Error: subtle warning blink.
- Stale: no animation, muted appearance.

Animations should be subtle and should not move layout. Respect `prefers-reduced-motion` by disabling or simplifying loops.

## Empty And Large States

If filters produce no visible agents, Office view should show the same kind of empty state as the table.

For large filtered sets:

- Pods should wrap naturally.
- Sub-agent desks should wrap inside pods.
- The Office view may be vertically scrollable.
- No virtualization is required for the first version.

## Testing

Use test-driven implementation:

- Unit tests for Office pod grouping:
  - parent with visible sub-agents groups into one pod;
  - visible sub-agent whose parent is filtered out appears in the unassigned pod;
  - unknown/rootless agents appear in the other pod;
  - grouping respects input order enough to keep the display stable.
- Existing table hierarchy tests must keep passing.
- Browser verification with synthetic data should confirm:
  - switching between Table and Office works;
  - Office uses the same filters;
  - working/waiting/error/idle statuses render distinct visual states;
  - clicking an office agent opens or updates the detail state;
  - layout is usable on desktop and mobile widths.

## Open Implementation Choices

The design intentionally leaves these to implementation, as long as behavior remains consistent:

- Exact visual glyphs for the pixel agent, desk, chair, and monitor.
- Whether Office detail appears as a side panel, bottom drawer, or inline panel.
- Exact tab labels, as long as they clearly distinguish table and office views.

## Acceptance Criteria

- The UI has a clear `Table` / `Office` switch.
- Existing table behavior is unchanged.
- Office view renders a pixel-style team pod per visible main agent.
- Sub-agents appear inside their parent pod when parent and child are both visible.
- Filtered-orphan sub-agents remain visible in an unassigned pod.
- Office view reflects all current filters.
- Statuses have distinct visual treatments matching the status mapping.
- Clicking an office agent exposes useful detail for that agent.
- Automated tests cover the new grouping logic.
- Browser verification covers desktop and mobile layout.
