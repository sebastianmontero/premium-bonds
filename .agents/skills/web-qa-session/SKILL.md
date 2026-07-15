---
name: web-qa-session
description: Trigger this skill when planning and performing manual, automated, exploratory, or accessibility QA sessions for web applications. Use to design test charters, log bugs with high fidelity, and initialize structured session reports.
user-invocable: true
metadata:
  version: 1.0.0
---

# Web Quality Assurance (QA) Session Playbook

## What this Skill is for

This skill abstracts the process of planning, executing, and documenting Quality Assurance (QA) sessions—such as exploratory sweeps, bug bashes, accessibility (a11y) audits, and visual regression checks—for web applications. It helps ensure that frontend releases (specifically React 19 / Next.js 16 in this repository) meet strict standards of functional correctness, visual consistency, and accessibility before deploy.

---

## Core Stack & Assumptions

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS v4.
- **Client & Wallets**: `@solana/client`, `@solana/react-hooks` (ConnectorKit), wallet adapter boundaries.
- **Scope**: User interfaces, wallet connection states, responsive layout breakpoints, accessibility trees, and browser console output correctness.

---

## Operating Procedure

When tasked with running a QA sweep, audit, or preparing a release sign-off:

### 1. Initialize the QA Session Report

Run the workspace CLI utility to generate a structured markdown report under `docs/qa/`:

```bash
node .agents/skills/web-qa-session/scripts/init_session.js --title="<Session Title>" --charters="<Charter 1, Charter 2, ...>" --env="<Target Env>"
```

_Example:_

```bash
node .agents/skills/web-qa-session/scripts/init_session.js --title="Wallet Connection and Yield Claiming" --charters="ConnectorKit Integration, Yield Accumulation Display, Multi-device responsiveness" --env="Staging"
```

### 2. Plan Test Charters

Open the generated file at `docs/qa/qa-session-YYYY-MM-DD-<title>.md` and refine the charters:

- Specify target scenarios and edge cases.
- Identify the user personas or wallet configurations needed.
- Define what lies outside the boundaries of the test.

### 3. Execute QA Sweeps using Reference Checklists

Follow the comprehensive checkpoints in [checklists.md](file://./references/checklists.md) across these categories:

- **Functional Checks:** Boundary values, interruption (refresh/disconnect/lock), session synchronization.
- **Visual Checks:** Layout wrap across breakpoints (375px - 1440px), Layout Shifts (CLS), theme contrasts, hover/focus/active states.
- **Accessibility (a11y) Checks:** Keyboard-only navigation (`Tab`/`Shift+Tab`), focus outlines, no keyboard traps, text scaling to 200%.
- **Performance & Console:** Lighthouse scan, error/warning-free DevTools console audit, slow 3G loading states.

### 4. Log Issues with High Fidelity

Document any bugs discovered directly in the generated markdown table or separate files. For detailed markdown structures and examples of bug reports and final summaries, refer to [templates.md](file://./references/templates.md).

### 5. Triaging & Sign-Off

- Assist the team in triaging bugs by prioritizing them by Severity (**Critical**, **Major**, **Minor**).
- Once bugs are marked resolved, verify the fix and run regressions.
- Complete the sign-off checklist in the report.

---

## Agent Safety Constraints

- **CLI Initialization**: When executing the `init_session.js` script using `run_command`, make sure the working directory (`Cwd`) is within the workspace root.
- **Auto-run Commands**: If running browser automated tests (e.g. Playwright or Cypress) as part of custom verification, set `SafeToAutoRun` to `false` because browser runners instantiate local child processes.

---

## Progressive Disclosure (Read When Needed)

- **[Web QA Checklists](file://./references/checklists.md)**: Detailed checklists for functional, visual, accessibility, and performance audits.
- **[Web QA Templates](file://./references/templates.md)**: Standard formats for writing charters, bug reports, and session summaries.
