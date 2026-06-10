# Office Agent Detail Popup Design

## Goal

In the Office view, clicking an agent icon should show that agent's details in a popup dialog instead of rendering the detail panel at the bottom of the page.

## Scope

- Change only the Office view agent detail presentation.
- Keep the existing agent selection state and detail fields.
- Do not change the agent messages page, diagnostics summary, table view, or backend APIs.

## Current Behavior

The Office view stores the selected agent id in `expandedAgentId`. When an Office agent is clicked, `renderOfficeDetail()` renders an inline `#office-detail` panel after the Office body. This makes the detail content appear at the bottom of the page.

## Proposed Behavior

Clicking an agent icon opens a centered modal dialog. The selected agent remains visually highlighted while the dialog is open.

The dialog closes when the user:

- clicks the same agent again,
- clicks the backdrop,
- clicks the dialog close button,
- presses `Escape`.

The dialog keeps the existing detail content:

- agent display name,
- `View messages` link,
- Status,
- Kind,
- Last turn,
- Updated,
- Cwd,
- ID.

## UI Structure

Reuse the existing `#office-detail` element as the dialog container, but style it as an overlay instead of an inline panel. The container should include a backdrop and a dialog surface.

The dialog should use:

- `role="dialog"`,
- `aria-modal="true"`,
- a labelled title,
- a real button for closing.

Long values, especially `cwd` and ids, should wrap or scroll without expanding the viewport.

## State And Data Flow

No new data source is needed.

`expandedAgentId` remains the source of truth for which Office agent is selected. `renderOfficeDetail(visibleAgents)` continues to find the selected agent from the currently visible agents and renders empty hidden state when no valid selected agent exists.

When the dialog closes, `expandedAgentId` is set to `null` and the active view is re-rendered.

## Responsive Behavior

On desktop, the modal is centered with a constrained width.

On narrow screens, the modal uses most of the viewport width with fixed outer margins. Its content can scroll internally if needed.

## Testing

Update the Office UI tests to reflect that selecting an Office agent opens a popup dialog rather than showing an inline bottom panel.

Verification should include:

- `npm test`,
- a browser smoke check for Office agent click behavior if a local server is practical.
