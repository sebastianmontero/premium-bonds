# YieldBonds Protocol — Claude Code Workspace Instructions

@GEMINI.md

## Claude Code Specific Operational Guidelines

### Command Execution & Testing
- **Anchor & Rust Tests**: Always execute `NO_DNA=1 cargo test --manifest-path anchor/Cargo.toml` from the workspace root. Avoid running compound `cd anchor && cargo test` to prevent interactive permission prompt friction.
- **Frontend Verification**: Run `npm run lint` or `npx tsc --noEmit` from the workspace root only when TypeScript or frontend files were modified.
- **Non-Interactive Execution**: Always pass non-interactive flags where applicable (e.g., `NO_DNA=1` for Anchor/Solana commands).

### Specialized Subagents
For plan and architecture reviews, delegate to the dedicated read-only subagents in `.claude/agents/`:
- `solution-critic`: Macro-architecture and alternative evaluation.
- `code-smell-reviewer`: Fowler code smells, type design, and clean architecture.
- `contract-plan-reviewer`: Adversarial Solana/Anchor smart contract audit.
- `frontend-plan-reviewer`: Next.js 16 App Router, React 19, and framework-kit UI review.

### On-Demand Domain Skills
Activate domain procedures from `.claude/skills/` (e.g. `/solana-dev`, `/solana-contract-testing`, `/solana-adversarial-review`, `/plan-review`, `/dapp-docs`).
