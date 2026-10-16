#!/usr/bin/env bash
# issue_lifecycle_helper.sh
# Shared helper utility for GitHub issue implementation & PR verification workflows.
set -euo pipefail
export GH_PROMPT_DISABLED=1

usage() {
  cat <<'EOF'
Usage: issue_lifecycle_helper.sh <command> [options]

Commands:
  --generate-verification-id <issue_number> <pr_number> <cycle>
      Generate deterministic verification ID: ver-YYYYMMDD-<issue>-pr<pr>-<cycle>

  --get-linked-pr <issue_number>
      Find open PR linked to the specified issue via GraphQL closing references,
      title/body regex, or topic branch naming convention.

  --get-pr-issue <pr_number>
      Extract linked issue number from PR title, body, or headRefName.

  --parse-verification <pr_number> [--file <json_file>]
      Parse latest PR verification review/comment and return structured JSON.

  --check-revision-readiness <pr_number> [--file <json_file>]
      Determine whether PR is awaiting revision or ready for verification.

  --format-verification-review --verification-id <id> --issue <num> --pr <num> \
                               --commit-sha <sha> --cycle <cycle> --verdict <verdict> \
                               --test-results '<json>' --checklist '<json>' \
                               --findings '<json>' --output-file <path>
      Generate formatted verification review markdown with embedded JSON metadata.

  --merge-pr <pr_number>
      Merge approved PR with squash & delete-branch using --auto with immediate fallback.

  --help
      Show this help message.
EOF
  exit 1
}

# --- Command: --generate-verification-id ---
cmd_generate_verification_id() {
  local issue="${1:-}"
  local pr="${2:-}"
  local cycle="${3:-1}"

  if [[ -z "$issue" || -z "$pr" ]]; then
    echo "Error: Issue number and PR number required" >&2
    usage
  fi

  issue="${issue#\#}"
  pr="${pr#\#}"
  local date_str
  date_str="$(date -u +%Y%m%d)"
  echo "ver-${date_str}-${issue}-pr${pr}-${cycle}"
}

# --- Command: --get-linked-pr ---
cmd_get_linked_pr() {
  local issue="${1:-}"
  if [[ -z "$issue" ]]; then
    echo "Error: Issue number required" >&2
    usage
  fi
  issue="${issue#\#}"

  # 1. Fetch open PRs in repository with essential fields
  local prs_json
  prs_json="$(gh pr list --state open --json number,title,body,headRefName,closingIssuesReferences 2>/dev/null || echo '[]')"

  python3 -c '
import sys
import json
import re

issue_num = sys.argv[1]
try:
    prs = json.loads(sys.argv[2])
except Exception:
    sys.exit(1)

# Pass 1: Check GitHub Native closingIssuesReferences (GraphQL)
for pr in prs:
    num = pr.get("number")
    closing_refs = pr.get("closingIssuesReferences") or []
    for ref in closing_refs:
        if str(ref.get("number")) == str(issue_num):
            print(num)
            sys.exit(0)

# Regex matching Closes #14, fixes #14, resolves #14, etc.
closing_pattern = re.compile(r"(?i)\b(?:closes|closed|fixes|fixed|resolves|resolved)\s+#?" + re.escape(issue_num) + r"\b")
# Branch pattern matching feat/issue-14-... or issue-14-...
branch_pattern = re.compile(r"(?i)(?:^|/)(?:feat/)?issue-" + re.escape(issue_num) + r"(?:-.*)?$")

# Pass 2: Check closing keywords in body and title
for pr in prs:
    num = pr.get("number")
    title = pr.get("title", "") or ""
    body = pr.get("body", "") or ""
    if closing_pattern.search(title) or closing_pattern.search(body):
        print(num)
        sys.exit(0)

# Pass 3: Check branch naming
for pr in prs:
    num = pr.get("number")
    branch = pr.get("headRefName", "") or ""
    if branch_pattern.search(branch):
        print(num)
        sys.exit(0)

# Pass 4: Check generic reference #14 in title
ref_pattern = re.compile(r"#\b" + re.escape(issue_num) + r"\b")
for pr in prs:
    num = pr.get("number")
    title = pr.get("title", "") or ""
    if ref_pattern.search(title):
        print(num)
        sys.exit(0)

sys.exit(1)
' "$issue" "$prs_json"
}

# --- Command: --get-pr-issue ---
cmd_get_pr_issue() {
  local pr="${1:-}"
  if [[ -z "$pr" ]]; then
    echo "Error: PR number required" >&2
    usage
  fi
  pr="${pr#\#}"

  local pr_json
  pr_json="$(gh pr view "$pr" --json number,title,body,headRefName,closingIssuesReferences 2>/dev/null || echo '{}')"

  python3 -c '
import sys
import json
import re

try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(1)

# Check native closingIssuesReferences first
closing_refs = data.get("closingIssuesReferences") or []
if closing_refs:
    first_num = closing_refs[0].get("number")
    if first_num:
        print(first_num)
        sys.exit(0)

title = data.get("title", "") or ""
body = data.get("body", "") or ""
branch = data.get("headRefName", "") or ""

# Match closing keywords first
m = re.search(r"(?i)\b(?:closes|closed|fixes|fixed|resolves|resolved)\s+#?(\d+)\b", body)
if m:
    print(m.group(1))
    sys.exit(0)

m = re.search(r"(?i)\b(?:closes|closed|fixes|fixed|resolves|resolved)\s+#?(\d+)\b", title)
if m:
    print(m.group(1))
    sys.exit(0)

# Match branch naming pattern: feat/issue-14-... or issue-14-...
m = re.search(r"(?i)(?:^|/)(?:feat/)?issue-(\d+)(?:-.*)?$", branch)
if m:
    print(m.group(1))
    sys.exit(0)

# Match generic #N in title
m = re.search(r"#(\d+)\b", title)
if m:
    print(m.group(1))
    sys.exit(0)

sys.exit(1)
' "$pr_json"
}

# --- Command: --parse-verification ---
cmd_parse_verification() {
  local pr=""
  local file=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --file)
        file="$2"
        shift 2
        ;;
      *)
        if [[ -z "$pr" ]]; then
          pr="$1"
          shift
        else
          echo "Error: Unknown argument: $1" >&2
          usage
        fi
        ;;
    esac
  done

  pr="${pr#\#}"

  local payload=""
  if [[ -n "$file" && -f "$file" ]]; then
    payload="$(cat "$file")"
  elif [[ -n "$pr" ]]; then
    payload="$(gh pr view "$pr" --json number,title,author,reviews,comments,commits,headRefName,baseRefName,state 2>/dev/null || echo '{}')"
  else
    if [ ! -t 0 ]; then
      payload="$(cat)"
    else
      echo "Error: PR number or --file required" >&2
      usage
    fi
  fi

  python3 -c '
import sys
import json
import re
from datetime import datetime

raw_input = sys.stdin.read()
if not raw_input.strip():
    print(json.dumps({"error": "Empty input payload"}))
    sys.exit(1)

try:
    data = json.loads(raw_input)
except Exception as e:
    print(json.dumps({"error": f"JSON parse error: {e}"}))
    sys.exit(1)

pr_number = data.get("number")
title = data.get("title", "")
author = (data.get("author") or {}).get("login", "")
state = data.get("state", "OPEN")
head_ref = data.get("headRefName", "")
base_ref = data.get("baseRefName", "")
commits = data.get("commits", []) or []
reviews = data.get("reviews", []) or []
comments = data.get("comments", []) or []

# Sort commits to find latest commit date and SHA
latest_commit_sha = ""
latest_commit_date = ""
if commits:
    # GitHub commits have committedDate
    sorted_commits = sorted(commits, key=lambda c: c.get("committedDate", ""), reverse=True)
    latest_commit_sha = sorted_commits[0].get("oid", "")
    latest_commit_date = sorted_commits[0].get("committedDate", "")

# Search both reviews and comments for <!-- ai-pr-verification: {...} -->
meta_pattern = re.compile(r"<!--\s*ai-pr-verification:\s*(\{.*?\})\s*-->", re.DOTALL)

verifications = []

for r in reviews:
    r_body = r.get("body", "") or ""
    r_sub = r.get("submittedAt", "") or ""
    r_author = (r.get("author") or {}).get("login", "")
    r_state = r.get("state", "")
    m = meta_pattern.search(r_body)
    if m:
        try:
            meta = json.loads(m.group(1))
            verifications.append({
                "type": "review",
                "submitted_at": r_sub,
                "author": r_author,
                "review_state": r_state,
                "meta": meta
            })
        except Exception:
            pass

for c in comments:
    c_body = c.get("body", "") or ""
    c_sub = c.get("createdAt", "") or ""
    c_author = (c.get("author") or {}).get("login", "")
    m = meta_pattern.search(c_body)
    if m:
        try:
            meta = json.loads(m.group(1))
            verifications.append({
                "type": "comment",
                "submitted_at": c_sub,
                "author": c_author,
                "review_state": "COMMENT",
                "meta": meta
            })
        except Exception:
            pass

# Sort verifications chronologically
verifications.sort(key=lambda v: v.get("submitted_at", ""), reverse=True)

has_verification = len(verifications) > 0
latest_v = verifications[0] if has_verification else {}
latest_meta = latest_v.get("meta", {})
latest_submitted_at = latest_v.get("submitted_at", "")

# Count commits pushed after the latest verification review
commits_ahead = 0
if has_verification and latest_submitted_at and commits:
    for c in commits:
        c_date = c.get("committedDate", "")
        if c_date > latest_submitted_at:
            commits_ahead += 1

checklist = latest_meta.get("acceptance_checklist", [])
findings = latest_meta.get("findings", [])
pending_findings = [f.get("id") for f in findings if f.get("id")]

result = {
    "pr_number": pr_number,
    "issue_number": latest_meta.get("issue_number"),
    "pr_author": author,
    "pr_state": state,
    "head_ref": head_ref,
    "base_ref": base_ref,
    "has_verification": has_verification,
    "verification_id": latest_meta.get("verification_id", ""),
    "verdict": latest_meta.get("verdict", ""),
    "cycle": latest_meta.get("cycle", 0),
    "latest_review_submitted_at": latest_submitted_at,
    "latest_commit_sha": latest_commit_sha,
    "latest_commit_date": latest_commit_date,
    "commits_ahead_of_review": commits_ahead,
    "test_results": latest_meta.get("test_results", {}),
    "acceptance_checklist": checklist,
    "findings": findings,
    "pending_findings": pending_findings
}

print(json.dumps(result, indent=2))
' <<< "$payload"
}

# --- Command: --check-revision-readiness ---
cmd_check_revision_readiness() {
  local pr=""
  local file=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --file)
        file="$2"
        shift 2
        ;;
      *)
        if [[ -z "$pr" ]]; then
          pr="$1"
          shift
        else
          echo "Error: Unknown argument: $1" >&2
          usage
        fi
        ;;
    esac
  done

  local parsed_json
  if [[ -n "$file" ]]; then
    parsed_json="$(cmd_parse_verification --file "$file")"
  else
    parsed_json="$(cmd_parse_verification "$pr")"
  fi

  python3 -c '
import sys
import json

data = json.loads(sys.argv[1])
has_v = data.get("has_verification", False)
verdict = data.get("verdict", "")
cycle = data.get("cycle", 0)
ahead = data.get("commits_ahead_of_review", 0)

if not has_v:
    print(json.dumps({
        "status": "READY_FOR_INITIAL_VERIFICATION",
        "cycle": 1,
        "message": "PR has not been verified yet."
    }))
    sys.exit(0)

if verdict == "APPROVED":
    print(json.dumps({
        "status": "ALREADY_APPROVED",
        "cycle": cycle,
        "message": "PR verification passed and was approved."
    }))
    sys.exit(0)

if verdict == "CHANGES_REQUESTED":
    if cycle >= 2 and ahead == 0:
        print(json.dumps({
            "status": "CIRCUIT_BREAKER_TRIPPED",
            "cycle": cycle,
            "message": "Cycle limit of 2 reached. Escalated to human review."
        }))
        sys.exit(0)
    elif ahead > 0:
        print(json.dumps({
            "status": "READY_FOR_RE_VERIFICATION",
            "cycle": cycle + 1,
            "commits_ahead": ahead,
            "message": f"{ahead} new commit(s) pushed since last review. Ready for /pr-verify cycle {cycle + 1}."
        }))
        sys.exit(0)
    else:
        print(json.dumps({
            "status": "AWAITING_REVISION",
            "cycle": cycle,
            "commits_ahead": 0,
            "message": "Changes requested on PR. Awaiting fixes from /issue-implement."
        }))
        sys.exit(0)

print(json.dumps({
    "status": "UNKNOWN",
    "cycle": cycle,
    "message": f"PR in status: {verdict}"
}))
' "$parsed_json"
}

# --- Command: --format-verification-review ---
cmd_format_verification_review() {
  local verification_id=""
  local issue=""
  local pr=""
  local commit_sha=""
  local cycle=""
  local verdict=""
  local test_results="{}"
  local checklist="[]"
  local findings="[]"
  local output_file=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --verification-id)
        verification_id="$2"
        shift 2
        ;;
      --issue)
        issue="$2"
        shift 2
        ;;
      --pr)
        pr="$2"
        shift 2
        ;;
      --commit-sha)
        commit_sha="$2"
        shift 2
        ;;
      --cycle)
        cycle="$2"
        shift 2
        ;;
      --verdict)
        verdict="$2"
        shift 2
        ;;
      --test-results)
        test_results="$2"
        shift 2
        ;;
      --checklist)
        checklist="$2"
        shift 2
        ;;
      --findings)
        findings="$2"
        shift 2
        ;;
      --output-file)
        output_file="$2"
        shift 2
        ;;
      *)
        echo "Error: Unknown argument for --format-verification-review: $1" >&2
        usage
        ;;
    esac
  done

  if [[ -z "$verification_id" || -z "$issue" || -z "$pr" || -z "$verdict" || -z "$output_file" ]]; then
    echo "Error: Missing required arguments for --format-verification-review" >&2
    usage
  fi

  issue="${issue#\#}"
  pr="${pr#\#}"

  python3 -c '
import sys
import json

verification_id = sys.argv[1]
issue = int(sys.argv[2])
pr = int(sys.argv[3])
commit_sha = sys.argv[4]
cycle = int(sys.argv[5]) if sys.argv[5].isdigit() else 1
verdict = sys.argv[6]
test_results = json.loads(sys.argv[7])
checklist = json.loads(sys.argv[8])
findings = json.loads(sys.argv[9])
output_file = sys.argv[10]

meta_obj = {
    "version": "1.0",
    "verification_id": verification_id,
    "issue_number": issue,
    "pr_number": pr,
    "commit_sha": commit_sha,
    "cycle": cycle,
    "verdict": verdict,
    "test_results": test_results,
    "acceptance_checklist": checklist,
    "findings": findings
}

meta_json_str = json.dumps(meta_obj, indent=2)

icon = "✅" if verdict == "APPROVED" else "❌"

lines = []
lines.append(f"<!-- ai-pr-verification: {meta_json_str} -->\n")
lines.append(f"## {icon} PR Verification Report: `{verification_id}`")
lines.append(f"**Target Issue:** #{issue}")
lines.append(f"**Verdict:** `{verdict}` (Cycle {cycle}/2)")
commit_label = commit_sha[:10] if commit_sha else "HEAD"
lines.append(f"**Commit:** `{commit_label}`\n")

# Test Results Section
lines.append("### 🧪 Automated Test Gates")
if test_results:
    for test_name, status in test_results.items():
        st_icon = "🟢" if status == "PASSED" else ("⚪" if status == "SKIPPED" else "🔴")
        lines.append(f"- {st_icon} **{test_name}**: `{status}`")
else:
    lines.append("- No automated test results recorded.")
lines.append("")

# Acceptance Checklist Section
lines.append("### 📋 Closed-Specification Acceptance Checklist")
if checklist:
    for item in checklist:
        crit = item.get("criterion", "")
        status = item.get("status", "SATISFIED")
        finding_id = item.get("finding_id", "")
        if status == "SATISFIED":
            lines.append(f"- [x] {crit}")
        else:
            tag = f"**[{finding_id}]** " if finding_id else ""
            lines.append(f"- [ ] {tag}{crit} *(`{status}`)*")
else:
    lines.append("- No checklist criteria specified.")
lines.append("")

# Actionable Findings Section
if verdict != "APPROVED" and findings:
    lines.append("### ❌ Actionable Verification Findings")
    for f in findings:
        f_id = f.get("id", "VER")
        f_cat = f.get("category", "")
        f_file = f.get("file", "")
        f_desc = f.get("description", "")
        f_fix = f.get("suggested_fix", "")
        loc = f" in `{f_file}`" if f_file else ""
        lines.append(f"- **[{f_id}]** ({f_cat}){loc}: {f_desc}")
        if f_fix:
            lines.append(f"  *Suggested Fix:* {f_fix}")
    lines.append("")

lines.append("---")
lines.append("<sub>*Generated by `/pr-verify` against closed issue specification.*</sub>\n")

with open(output_file, "w", encoding="utf-8") as out:
    out.write("\n".join(lines))

print(f"Verification review formatted successfully at: {output_file}")
' "$verification_id" "$issue" "$pr" "$commit_sha" "$cycle" "$verdict" "$test_results" "$checklist" "$findings" "$output_file"
}

# --- Command: --merge-pr ---
cmd_merge_pr() {
  local pr="${1:-}"
  if [[ -z "$pr" ]]; then
    echo "Error: PR number required" >&2
    usage
  fi
  pr="${pr#\#}"

  echo "Attempting auto-merge for PR #$pr (squash & delete branch)..."
  set +e
  local auto_out
  auto_out="$(gh pr merge "$pr" --squash --delete-branch --auto 2>&1)"
  local auto_code=$?
  set -e

  if [[ $auto_code -eq 0 ]]; then
    echo "Successfully scheduled auto-merge for PR #$pr."
    exit 0
  fi

  echo "Auto-merge not eligible or disabled ($auto_out). Falling back to direct squash merge..."
  gh pr merge "$pr" --squash --delete-branch
  echo "Successfully merged PR #$pr directly into mainline."
}

# --- Main Dispatcher ---
if [[ $# -eq 0 ]]; then
  usage
fi

command="$1"
shift

case "$command" in
  --generate-verification-id)
    cmd_generate_verification_id "$@"
    ;;
  --get-linked-pr)
    cmd_get_linked_pr "$@"
    ;;
  --get-pr-issue)
    cmd_get_pr_issue "$@"
    ;;
  --parse-verification)
    cmd_parse_verification "$@"
    ;;
  --check-revision-readiness)
    cmd_check_revision_readiness "$@"
    ;;
  --format-verification-review)
    cmd_format_verification_review "$@"
    ;;
  --merge-pr)
    cmd_merge_pr "$@"
    ;;
  --help|-h)
    usage
    ;;
  *)
    echo "Error: Unknown command: $command" >&2
    usage
    ;;
esac
