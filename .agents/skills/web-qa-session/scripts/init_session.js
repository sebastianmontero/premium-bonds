#!/usr/bin/env node

/**
 * QA Session Template Initializer Script
 * Location: .agents/skills/web-qa-session/scripts/init_session.js
 *
 * Usage:
 *   node init_session.js --title "Deposit Feature Sweep" --charters "Deposit Flow, Wallet Reconnect, Error States"
 */

const fs = require("fs");
const path = require("path");

// Helper to parse CLI arguments
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((val) => {
    if (val.startsWith("--")) {
      const parts = val.substring(2).split("=");
      const key = parts[0];
      const value = parts.slice(1).join("=") || true;
      args[key] = value;
    }
  });
  return args;
}

function getFormattedDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function main() {
  const args = parseArgs();

  const title = args.title || "Web QA Session";
  const rawCharters = args.charters
    ? String(args.charters).split(",")
    : ["General Exploratory Test"];
  const scope =
    args.scope || "Verify recent changes and check core user flows.";
  const env = args.env || "staging (https://dev.premiumbonds.xyz)";

  const dateStr = getFormattedDate();
  // Sanitize title for filename
  const sanitizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const filename = `qa-session-${dateStr}-${sanitizedTitle}.md`;

  const qaDocsDir = path.join(process.cwd(), "docs", "qa");

  // Ensure the directory exists
  if (!fs.existsSync(qaDocsDir)) {
    fs.mkdirSync(qaDocsDir, { recursive: true });
    console.log(`Created directory: ${qaDocsDir}`);
  }

  const targetFilePath = path.join(qaDocsDir, filename);

  if (fs.existsSync(targetFilePath)) {
    console.error(`Error: QA session file already exists at ${targetFilePath}`);
    process.exit(1);
  }

  // Generate charters section
  const chartersMarkdown = rawCharters
    .map((charter, index) => {
      return `### Charter #${index + 1}: ${charter.trim()}
- **Objective / Focus:** Explore the behavior and usability of ${charter.trim()}.
- **Scenario Notes:** [Add specific steps, edge cases, or wallets to test]
- **Target Areas:** Functional correctness, UI responsiveness, Keyboard/Screen reader support.
- **Status:** [ ] Unstarted | [ ] In Progress | [ ] Completed
`;
    })
    .join("\n");

  // Markdown Template Content
  const template = `# QA Session: ${title} (${dateStr})

## 📋 Session Metadata
- **Date:** ${dateStr}
- **Session Lead:** [Assign Name/Agent]
- **Target Environment:** ${env}
- **Scope & Objective:** ${scope}
- **Test Credentials / Wallets:**
  - Account 1: \`[Insert Wallet / Address / Role]\`
  - Account 2: \`[Insert Wallet / Address / Role]\`

---

## 🎯 Test Charters
These charters guide the exploratory testing session without restricting testers to rigid scripts.

${chartersMarkdown}
---

## 🐛 Logged Bugs & Issues
Use the following table to document any bugs found during the session.

| ID | Title / Summary | Charter | Severity | Environment | Steps to Reproduce | Expected vs. Actual | Evidence (Screenshot/Logs) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Bug-01 | [Short description] | Charter #1 | Major | Chrome/Phantom | 1. ...<br>2. ... | Exp: ...<br>Act: ... | [Link to image/logs] | Open |
| Bug-02 | [Short description] | Charter #1 | Minor | Safari/Mobile | 1. ...<br>2. ... | Exp: ...<br>Act: ... | [Link to image/logs] | Open |

> **Severity Scale:**
> - **Critical:** Blocks core flows, crashes application, security vulnerability, data corruption.
> - **Major:** Broken feature or user flow with no reasonable workaround.
> - **Minor:** UI layout issues, visual alignment, minor accessibility issues, cosmetic flaws.

---

## 🔍 Sign-off Checklist
All items must be completed and approved before signing off the release.

- [ ] **Functional Verification:** All features in scope behave correctly according to specifications.
- [ ] **Edge Case Testing:** Validations handle negative numbers, empty states, and interruptions.
- [ ] **Responsive Design:** Checked mobile, tablet, laptop, and desktop viewports.
- [ ] **A11y Check:** Visually verified high contrast, tested keyboard focus outline, no tab loops.
- [ ] **Console check:** No errors or unexpected warnings printed to the browser console.
- [ ] **Sign-off Status:** [ ] Approved | [ ] Blocked

---

## 📝 Notes / Comments
*Add any additional session feedback, performance logs, or follow-up ideas here.*
`;

  fs.writeFileSync(targetFilePath, template, "utf8");
  console.log(`\nSuccessfully created new QA session file:`);
  console.log(`👉 docs/qa/${filename}`);
  console.log(`You can now edit this file to track your QA session results.`);
}

main();
