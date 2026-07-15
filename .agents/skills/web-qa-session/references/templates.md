# Web QA Session Templates

This document provides reusable templates to copy-paste or refer to when planning, logging, or summarizing QA sessions.

---

## 1. Test Charter Template

A charter defines the scope and goal of an exploratory session without restricting the tester to a step-by-step script.

```markdown
### Charter #[ID]: [Short Charter Title]

- **Objective / Focus:** Explore the behavior and usability of [Feature/Area].
- **Scenario Notes:** [Detail specific paths, input ranges, or edge cases]
- **Out of Scope:** [Specific features or platforms excluded from this test]
- **Target Areas:** Functional correctness, UI responsiveness, Keyboard/Screen reader support.
- **Resources Needed:** [e.g., Phantom wallet, 0.5 Devnet SOL, mobile viewport]
- **Status:** [ ] Unstarted | [ ] In Progress | [ ] Completed
```

---

## 2. Bug Report Template

A high-fidelity bug report contains all details required for a developer to reproduce and fix the bug without back-and-forth communication.

````markdown
### [Bug ID] - [Area] Short Summary of the Bug

- **Charter / Flow:** Charter # [X] - [Charter Name]
- **Severity:** [Critical | Major | Minor]
- **Environment:** [e.g., Windows 11, Chrome 126, Desktop 1440px / Phantom Wallet v24.8]

#### Steps to Reproduce:

1. Navigate to `[URL / Route]`
2. Click on `[Element]`
3. Enter `[Inputs]` and submit
4. Observe `[Specific Interaction]`

#### Expected Behavior:

[Describe what the application should have done]

#### Actual Behavior:

[Describe what the application actually did, including error codes or console errors]

#### Evidence:

- **Console Log / Stack Trace:**
  ```javascript
  // Paste relevant console errors or stack traces here
  ```
````

- **Screenshots / Recordings:** [Link to screenshot, GIF, or WebM video]

````

---

## 3. QA Session Summary Template

This template is designed to summarize the outcome of a QA session or Bug Bash for stakeholders, developers, and project managers.

```markdown
# QA Session Summary: [Feature/Release Name]

- **Date of Session:** YYYY-MM-DD
- **Session Duration:** [e.g., 90 minutes]
- **Participants:** [Tester Names / Agents]
- **Target Version / Commit:** `[Commit Hash or Version]`

## 📊 Summary Metrics
- **Total Charters Tested:** [X] / [Y]
- **Bugs Discovered:** [Total Bugs]
  - 🛑 **Critical:** [Count]
  - ⚠️ **Major:** [Count]
  - ℹ️ **Minor:** [Count]
- **Sign-off Decision:** [Approved | Blocked | Approved with Workarounds]

## 🎯 Charter Outcomes
- **Charter #1 - [Title]:** [Completed - 0 Issues | Completed - 2 Bugs found | Blocked]
- **Charter #2 - [Title]:** [Completed - 1 Minor issue]

## 🛑 Blockers & Critical Issues
*List any issue that must be fixed before release:*
1. **[Bug ID] - [Title]:** [Brief note on impact and owner]

## 📝 Additional Notes / Observations
- [Add any general observations, performance bottlenecks, or user experience polish ideas]
````
