#!/usr/bin/env bash
# issue_lifecycle_helper.sh
# Shared helper utility for GitHub issue & PR lifecycle automation across agy & claude code.
set -euo pipefail

gh_live() {
  local out
  if ! out="$(gh "$@")"; then
    echo "Error: gh $* failed" >&2
    exit 2
  fi
  printf '%s' "$out"
}

resolve_trusted_author() {
  local explicit="${1:-}"
  if [[ -n "$explicit" ]]; then
    echo "$explicit"
    return 0
  fi
  if [[ -n "${GH_TRUSTED_AUTHOR:-}" ]]; then
    echo "$GH_TRUSTED_AUTHOR"
    return 0
  fi
  local user_login=""
  user_login="$(gh_live api user -q .login)" || exit 2
  echo "$user_login"
}

usage() {
  cat <<'EOF'
Usage: issue_lifecycle_helper.sh <command> [options]

Commands:
  --resolve-model [--model <override>]
      Resolve active AI model slug across CLI flag, environment variables, and process inspection.

  --generate-verification-id <issue> <pr> [cycle]
      Generate stateless unique verification ID: ver-YYYYMMDD-<issue>-pr<pr>-<cycle>

  --get-linked-pr <issue_number> [--state open|all] [--file <prs.json>] \
                  [--exclude <csv>] [--pipeline] [--json] \
                  [--trusted-author <login>] [--trust-any-author]
      Find linked PR for an issue across native references, markers, titles, and branch names.
      Default output is bare PR number. Emits JSON object with --json or --pipeline.

  --get-pr-issue <pr_number>
      Identify the target issue number for an open PR.

  --parse-verification <pr_number> [--file <json_file>] \
                       [--trusted-author <login>] [--trust-any-author]
      Parse verification reports and cycle reset markers from a PR, outputting structured JSON.

  --check-revision-readiness <pr_number> [--file <json_file>] [--max-cycles N] \
                             [--trusted-author <login>] [--trust-any-author]
      Determine whether PR is awaiting revision or ready for verification.
      Output cycle/effective_cycle: next cycle for READY_FOR_INITIAL_VERIFICATION/
      READY_FOR_RE_VERIFICATION, and last cycle otherwise.

  --format-verification-review --verification-id <id> --issue <num> --pr <num> \
                               [--model <slug>] [--implementing-model <slug>] \
                               --commit-sha <sha> --cycle <cycle> --verdict <verdict> \
                               [--effective-cycle <k>] [--max-cycles <N>] \
                               --test-results '<json>' --checklist '<json>' \
                               --findings '<json>' --output-file <path>
      Generate formatted verification review markdown with embedded JSON metadata.

  --close-merged-issue --issue <num> --pr <num> [--file <pr.json>]
      Close issue associated with merged PR on dev, post notice comment, and clean triage labels.

  --merge-pr <pr_number>
      Merge approved PR with squash & delete-branch using -R with --auto and fallback.

  --help
      Show this help message.
EOF
  exit 1
}

# --- Command: --resolve-model ---
cmd_resolve_model() {
  local model_arg=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model)
        model_arg="$2"
        shift 2
        ;;
      *)
        if [[ -z "$model_arg" ]]; then
          model_arg="$1"
          shift
        else
          shift
        fi
        ;;
    esac
  done

  python3 -c '
import os
import sys
import re
import glob

override = sys.argv[1] if len(sys.argv) > 1 else ""

def normalize_slug(m):
    if not m:
        return "unknown"
    m = m.strip().lower()
    if m in ("unknown", "none", "null", "undefined", ""):
        return "unknown"
    
    # Strip common wrapper prefixes if present
    if "/" in m:
        m = m.split("/")[-1]

    aliases = {
        "gemini-3.8-flash": "gemini-3.8-flash",
        "gemini-3-8-flash": "gemini-3.8-flash",
        "gemini-3.8-flash-high": "gemini-3.8-flash-high",
        "gemini-3-8-flash-high": "gemini-3.8-flash-high",
        "gemini-3.8-flash-medium": "gemini-3.8-flash-medium",
        "gemini-3-8-flash-medium": "gemini-3.8-flash-medium",
        "gemini-3.8-pro": "gemini-3.8-pro",
        "gemini-3-8-pro": "gemini-3.8-pro",
        "claude-3.7-sonnet": "claude-3-7-sonnet",
        "claude-3-7-sonnet": "claude-3-7-sonnet",
        "claude-3.5-sonnet": "claude-3-5-sonnet",
        "claude-3-5-sonnet": "claude-3-5-sonnet",
        "claude-3.5-haiku": "claude-3-5-haiku",
        "claude-3-5-haiku": "claude-3-5-haiku",
        "claude-opus-4.5": "claude-opus-4-5",
        "claude-opus-4-5": "claude-opus-4-5",
        "claude-opus-5.5": "claude-opus-5-5-high",
        "claude-opus-5-5": "claude-opus-5-5-high",
        "claude-opus-5-5-high": "claude-opus-5-5-high",
        "gpt-oss-120b": "gpt-oss-120b",
    }
    if m in aliases:
        return aliases[m]

    slug = re.sub(r"[\s_]+", "-", m)
    slug = re.sub(r"[^a-z0-9.-]", "", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    if slug in aliases:
        return aliases[slug]
    return slug if slug else "unknown"

# Tier 1: Explicit argument
if override.strip():
    print(normalize_slug(override))
    sys.exit(0)

# Tier 2: Environment variables
for env_key in ("AI_MODEL", "AGY_MODEL", "GEMINI_MODEL", "MODEL"):
    val = os.environ.get(env_key, "").strip()
    if val:
        print(normalize_slug(val))
        sys.exit(0)

# Tier 3: Process tree inspection and CLI logs
def inspect_process_tree():
    pid = os.getppid()
    while pid > 1:
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                raw = f.read().decode("utf-8", errors="ignore")
                parts = raw.split("\x00")
                proc_bin = os.path.basename(parts[0]) if parts else ""
                cmd = raw.replace("\x00", " ")
                if proc_bin not in ("bash", "sh", "zsh", "dash"):
                    m = re.search(r"(?:--model|-m)(?:\s+|=)([^\s]+)", cmd)
                    if m:
                        return m.group(1)
            with open(f"/proc/{pid}/stat", "r") as f:
                stat = f.read().split()
                pid = int(stat[3])
        except Exception:
            break
    return None

def inspect_cli_logs():
    home = os.path.expanduser("~")
    candidates = [
        os.path.join(home, ".gemini", "antigravity-cli", "cli.log")
    ]
    log_dir = os.path.join(home, ".gemini", "antigravity-cli", "log")
    if os.path.isdir(log_dir):
        files = glob.glob(os.path.join(log_dir, "cli-*.log"))
        files.sort(key=os.path.getmtime, reverse=True)
        candidates.extend(files[:3])

    for log_path in candidates:
        if os.path.exists(log_path):
            try:
                with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                    for _ in range(50):
                        line = f.readline()
                        if not line:
                            break
                        m = re.search(r"Model ID\s+([^\s]+)", line)
                        if m:
                            return m.group(1)
            except Exception:
                pass
    return None

detected = inspect_process_tree()
if detected:
    print(normalize_slug(detected))
    sys.exit(0)

detected = inspect_cli_logs()
if detected:
    print(normalize_slug(detected))
    sys.exit(0)

print("unknown")
' "$model_arg"
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
  pr="${pr#pr}"
  pr="${pr#PR}"
  local date_str
  date_str="$(date -u +%Y%m%d)"
  echo "ver-${date_str}-${issue}-pr${pr}-${cycle}"
}

# --- Command: --get-linked-pr ---
cmd_get_linked_pr() {
  local issue=""
  local state="open"
  local file=""
  local exclude=""
  local is_pipeline=false
  local is_json=false
  local trusted_author=""
  local trust_any_author=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --issue)
        issue="$2"
        shift 2
        ;;
      --state)
        state="$2"
        shift 2
        ;;
      --file)
        file="$2"
        shift 2
        ;;
      --exclude)
        exclude="$2"
        shift 2
        ;;
      --pipeline)
        is_pipeline=true
        shift
        ;;
      --json)
        is_json=true
        shift
        ;;
      --trusted-author)
        trusted_author="$2"
        shift 2
        ;;
      --trust-any-author)
        trust_any_author=true
        shift
        ;;
      *)
        if [[ -z "$issue" && "$1" =~ ^#?[0-9]+$ ]]; then
          issue="$1"
          shift
        elif [[ -z "$file" && -f "$1" ]]; then
          file="$1"
          shift
        else
          echo "Error: Unknown argument for --get-linked-pr: $1" >&2
          usage
        fi
        ;;
    esac
  done

  if [[ -z "$issue" ]]; then
    echo "Error: Issue number required" >&2
    usage
  fi
  issue="${issue#\#}"

  if [[ "$is_pipeline" == true && "$trust_any_author" == false ]]; then
    trusted_author="$(resolve_trusted_author "$trusted_author")" || exit 2
  fi

  local prs_json=""
  if [[ -n "$file" && -f "$file" ]]; then
    prs_json="$(cat "$file")"
  else
    prs_json="$(gh_live pr list --state "$state" --base dev --limit 200 --json number,state,mergedAt,closedAt,headRefName,title,body,author,isCrossRepository,closingIssuesReferences)" || exit 2
  fi

  python3 -c '
import sys
import json
import re

issue_num = str(sys.argv[1])
exclude_csv = sys.argv[2]
is_pipeline = (sys.argv[3] == "true")
is_json = (sys.argv[4] == "true")
trusted_author = sys.argv[5]
trust_any_author = (sys.argv[6] == "true")

try:
    prs = json.loads(sys.argv[7])
except Exception:
    sys.exit(1)

excluded_numbers = set()
if exclude_csv.strip():
    for part in exclude_csv.split(","):
        part = part.strip().lstrip("#")
        if part.isdigit():
            excluded_numbers.add(int(part))

candidates = []

for pr in prs:
    pr_num = pr.get("number")
    pr_state = (pr.get("state") or "").upper()

    # --exclude drops only PRs whose state is CLOSED
    if pr_num in excluded_numbers and pr_state == "CLOSED":
        continue

    is_linked = False

    if is_pipeline:
        # Strict pipeline linking:
        # 1. Body carries <!-- ai-issue-implement: {..."issue_number":<n>...} --> AND author is trusted author
        # 2. headRefName matches ^feat/issue-<n>- AND isCrossRepository is false
        body = pr.get("body", "") or ""
        author_login = (pr.get("author") or {}).get("login", "")
        head_ref = pr.get("headRefName", "") or ""
        is_cross_repo = bool(pr.get("isCrossRepository", False))

        m_impl = re.search(r"<!--\s*ai-issue-implement:\s*(\{.*?\})\s*-->", body, re.DOTALL)
        if m_impl:
            try:
                impl_meta = json.loads(m_impl.group(1))
                if str(impl_meta.get("issue_number")) == issue_num:
                    if trust_any_author or (author_login == trusted_author):
                        is_linked = True
            except Exception:
                pass

        branch_pipeline_pattern = re.compile(r"^feat/issue-" + re.escape(issue_num) + r"-")
        if branch_pipeline_pattern.search(head_ref) and not is_cross_repo:
            is_linked = True
    else:
        # Unified 5-pass linking
        # Pass 1: native closingIssuesReferences
        closing_refs = pr.get("closingIssuesReferences") or []
        for ref in closing_refs:
            if str(ref.get("number")) == issue_num:
                is_linked = True
                break

        # Pass 2: body carries ai-issue-implement
        if not is_linked:
            body = pr.get("body", "") or ""
            m_impl = re.search(r"<!--\s*ai-issue-implement:\s*(\{.*?\})\s*-->", body, re.DOTALL)
            if m_impl:
                try:
                    impl_meta = json.loads(m_impl.group(1))
                    if str(impl_meta.get("issue_number")) == issue_num:
                        is_linked = True
                except Exception:
                    pass

        # Pass 3: closing keywords in body and title
        if not is_linked:
            closing_pattern = re.compile(r"(?i)\b(?:closes|closed|fixes|fixed|resolves|resolved)\s+#?" + re.escape(issue_num) + r"\b")
            title = pr.get("title", "") or ""
            body = pr.get("body", "") or ""
            if closing_pattern.search(title) or closing_pattern.search(body):
                is_linked = True

        # Pass 4: branch naming
        if not is_linked:
            branch_pattern = re.compile(r"(?i)(?:^|/)(?:feat/)?issue-" + re.escape(issue_num) + r"(?:-.*)?$")
            head_ref = pr.get("headRefName", "") or ""
            if branch_pattern.search(head_ref):
                is_linked = True

        # Pass 5: generic reference #N in title
        if not is_linked:
            ref_pattern = re.compile(r"#\b" + re.escape(issue_num) + r"\b")
            title = pr.get("title", "") or ""
            if ref_pattern.search(title):
                is_linked = True

    if is_linked:
        candidates.append(pr)

if not candidates:
    sys.exit(1)

# Preference order: OPEN > MERGED (latest mergedAt) > CLOSED (latest closedAt)
def pr_sort_key(p):
    st = (p.get("state") or "").upper()
    if st == "OPEN":
        return (3, p.get("number", 0))
    elif st == "MERGED":
        return (2, p.get("mergedAt") or "")
    elif st == "CLOSED":
        return (1, p.get("closedAt") or "")
    else:
        return (0, "")

candidates.sort(key=pr_sort_key, reverse=True)
winner = candidates[0]

if is_json or is_pipeline:
    out_obj = {
        "number": winner.get("number"),
        "state": winner.get("state", ""),
        "merged_at": winner.get("mergedAt"),
        "closed_at": winner.get("closedAt"),
        "head_ref": winner.get("headRefName", "")
    }
    print(json.dumps(out_obj))
    sys.exit(0)
else:
    print(winner.get("number"))
    sys.exit(0)
' "$issue" "$exclude" "$is_pipeline" "$is_json" "$trusted_author" "$trust_any_author" "$prs_json"
}

# --- Command: --get-pr-issue ---
cmd_get_pr_issue() {
  local pr="${1:-}"
  if [[ -z "$pr" ]]; then
    echo "Error: PR number required" >&2
    usage
  fi
  pr="${pr#\#}"

  local pr_json=""
  pr_json="$(gh_live pr view "$pr" --json number,title,body,headRefName,closingIssuesReferences)" || exit 2

  python3 -c '
import sys
import json
import re

try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(1)

closing_refs = data.get("closingIssuesReferences") or []
if closing_refs:
    first_num = closing_refs[0].get("number")
    if first_num:
        print(first_num)
        sys.exit(0)

title = data.get("title", "") or ""
body = data.get("body", "") or ""
branch = data.get("headRefName", "") or ""

m = re.search(r"(?i)\b(?:closes|closed|fixes|fixed|resolves|resolved)\s+#?(\d+)\b", body)
if m:
    print(m.group(1))
    sys.exit(0)

m = re.search(r"(?i)\b(?:closes|closed|fixes|fixed|resolves|resolved)\s+#?(\d+)\b", title)
if m:
    print(m.group(1))
    sys.exit(0)

m = re.search(r"(?i)(?:^|/)(?:feat/)?issue-(\d+)(?:-.*)?$", branch)
if m:
    print(m.group(1))
    sys.exit(0)

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
  local trusted_author=""
  local trust_any_author=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --file)
        file="$2"
        shift 2
        ;;
      --trusted-author)
        trusted_author="$2"
        shift 2
        ;;
      --trust-any-author)
        trust_any_author=true
        shift
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

  if [[ "$trust_any_author" == false ]]; then
    trusted_author="$(resolve_trusted_author "$trusted_author")" || exit 2
  fi

  local payload=""
  if [[ -n "$file" && -f "$file" ]]; then
    payload="$(cat "$file")"
  elif [[ -n "$pr" ]]; then
    payload="$(gh_live pr view "$pr" --json number,author,body,state,headRefName,baseRefName,reviews,comments,commits,mergeable,autoMergeRequest)" || exit 2
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

trusted_author = sys.argv[1]
trust_any_author = (sys.argv[2] == "true")

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
body = data.get("body", "") or ""
author = (data.get("author") or {}).get("login", "")
state = data.get("state", "OPEN")
head_ref = data.get("headRefName", "")
base_ref = data.get("baseRefName", "")
commits = data.get("commits", []) or []
reviews = data.get("reviews", []) or []
comments = data.get("comments", []) or []

# Parse implementing model from PR body
implement_pattern = re.compile(r"<!--\s*ai-issue-implement:\s*(\{.*?\})\s*-->", re.DOTALL)
implementing_model = ""
m_impl = implement_pattern.search(body)
if m_impl:
    try:
        impl_meta = json.loads(m_impl.group(1))
        implementing_model = impl_meta.get("model", "")
    except Exception:
        pass

# Parse reset markers: <!-- ai-pipeline-cycle-reset: {...} -->
reset_pattern = re.compile(r"<!--\s*ai-pipeline-cycle-reset:\s*(\{.*?\})\s*-->", re.DOTALL)
resets = []

for r in reviews:
    r_body = r.get("body", "") or ""
    r_sub = r.get("submittedAt", "") or ""
    r_author = (r.get("author") or {}).get("login", "")
    m = reset_pattern.search(r_body)
    if m and (trust_any_author or r_author == trusted_author):
        try:
            resets.append({
                "submitted_at": r_sub,
                "meta": json.loads(m.group(1))
            })
        except Exception:
            pass

for c in comments:
    c_body = c.get("body", "") or ""
    c_sub = c.get("createdAt", "") or ""
    c_author = (c.get("author") or {}).get("login", "")
    m = reset_pattern.search(c_body)
    if m and (trust_any_author or c_author == trusted_author):
        try:
            resets.append({
                "submitted_at": c_sub,
                "meta": json.loads(m.group(1))
            })
        except Exception:
            pass

resets.sort(key=lambda x: x.get("submitted_at", ""), reverse=True)
cycle_offset = 0
if resets:
    cycle_offset = resets[0]["meta"].get("after_cycle", 0)

# Parse verification markers: <!-- ai-pr-verification: {...} -->
meta_pattern = re.compile(r"<!--\s*ai-pr-verification:\s*(\{.*?\})\s*-->", re.DOTALL)
verifications = []

for r in reviews:
    r_body = r.get("body", "") or ""
    r_sub = r.get("submittedAt", "") or ""
    r_author = (r.get("author") or {}).get("login", "")
    r_state = r.get("state", "")
    m = meta_pattern.search(r_body)
    if m and (trust_any_author or r_author == trusted_author):
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
    if m and (trust_any_author or c_author == trusted_author):
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

verifications.sort(key=lambda v: v.get("submitted_at", ""), reverse=True)

has_verification = len(verifications) > 0
latest_v = verifications[0] if has_verification else {}
latest_meta = latest_v.get("meta", {})
latest_submitted_at = latest_v.get("submitted_at", "")

raw_cycle = latest_meta.get("cycle", 0)
effective_cycle = max(0, raw_cycle - cycle_offset)

# Count commits ahead by position, not by date:
# commits after latest_meta.commit_sha in the PR commit list (all of them if SHA is absent)
commits_ahead = 0
if has_verification:
    target_sha = latest_meta.get("commit_sha", "")
    if not target_sha:
        commits_ahead = len(commits)
    else:
        found_idx = -1
        for idx, c in enumerate(commits):
            c_oid = c.get("oid", "")
            if c_oid == target_sha or (target_sha and c_oid.startswith(target_sha)):
                found_idx = idx
                break
        if found_idx != -1:
            commits_ahead = len(commits) - 1 - found_idx
        else:
            commits_ahead = len(commits)

latest_commit_sha = commits[-1].get("oid", "") if commits else ""
latest_commit_date = commits[-1].get("committedDate", "") if commits else ""

checklist = latest_meta.get("acceptance_checklist", [])
findings = latest_meta.get("findings", [])
pending_findings = [f.get("id") for f in findings if f.get("id")]

model = latest_meta.get("model", "")
if not implementing_model:
    implementing_model = latest_meta.get("implementing_model", "")

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
    "cycle": raw_cycle,
    "cycle_offset": cycle_offset,
    "effective_cycle": effective_cycle,
    "model": model,
    "implementing_model": implementing_model,
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
' "$trusted_author" "$trust_any_author" <<< "$payload"
}

# --- Command: --check-revision-readiness ---
cmd_check_revision_readiness() {
  local pr=""
  local file=""
  local max_cycles="2"
  local trusted_author=""
  local trust_any_author=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --file)
        file="$2"
        shift 2
        ;;
      --max-cycles)
        max_cycles="$2"
        shift 2
        ;;
      --trusted-author)
        trusted_author="$2"
        shift 2
        ;;
      --trust-any-author)
        trust_any_author=true
        shift
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

  local parse_args=()
  if [[ -n "$file" ]]; then
    parse_args+=(--file "$file")
  elif [[ -n "$pr" ]]; then
    parse_args+=("$pr")
  fi
  if [[ -n "$trusted_author" ]]; then
    parse_args+=(--trusted-author "$trusted_author")
  fi
  if [[ "$trust_any_author" == true ]]; then
    parse_args+=(--trust-any-author)
  fi

  local parsed_json=""
  parsed_json="$(cmd_parse_verification "${parse_args[@]}")" || exit 2

  python3 -c '
import sys
import json

max_cycles = int(sys.argv[2])
data = json.loads(sys.argv[1])
has_v = data.get("has_verification", False)
verdict = data.get("verdict", "")
raw_cycle = data.get("cycle", 0)
cycle_offset = data.get("cycle_offset", 0)
effective_cycle = data.get("effective_cycle", 0)
ahead = data.get("commits_ahead_of_review", 0)
implementing_model = data.get("implementing_model", "")
model = data.get("model", "")

common = {
    "implementing_model": implementing_model,
    "model": model,
    "cycle_offset": cycle_offset
}

if not has_v:
    res = {
        "status": "READY_FOR_INITIAL_VERIFICATION",
        "cycle": 1,
        "effective_cycle": 1,
        "message": "PR has not been verified yet."
    }
    res.update(common)
    print(json.dumps(res))
    sys.exit(0)

# Check ahead > 0 BEFORE ALREADY_APPROVED
if ahead > 0:
    next_raw = raw_cycle + 1
    next_eff = max(0, next_raw - cycle_offset)
    res = {
        "status": "READY_FOR_RE_VERIFICATION",
        "cycle": next_raw,
        "effective_cycle": next_eff,
        "commits_ahead": ahead,
        "message": f"{ahead} new commit(s) pushed since last review. Ready for /pr-verify cycle {next_raw}."
    }
    res.update(common)
    print(json.dumps(res))
    sys.exit(0)

if verdict == "APPROVED":
    res = {
        "status": "ALREADY_APPROVED",
        "cycle": raw_cycle,
        "effective_cycle": effective_cycle,
        "message": "PR verification passed and was approved."
    }
    res.update(common)
    print(json.dumps(res))
    sys.exit(0)

if verdict == "CHANGES_REQUESTED":
    if effective_cycle >= max_cycles and ahead == 0:
        res = {
            "status": "CIRCUIT_BREAKER_TRIPPED",
            "cycle": raw_cycle,
            "effective_cycle": effective_cycle,
            "message": f"Cycle limit of {max_cycles} reached. Escalated to human review."
        }
        res.update(common)
        print(json.dumps(res))
        sys.exit(0)
    else:
        res = {
            "status": "AWAITING_REVISION",
            "cycle": raw_cycle,
            "effective_cycle": effective_cycle,
            "commits_ahead": 0,
            "message": "Changes requested on PR. Awaiting fixes from /issue-implement."
        }
        res.update(common)
        print(json.dumps(res))
        sys.exit(0)

res = {
    "status": "UNKNOWN",
    "cycle": raw_cycle,
    "effective_cycle": effective_cycle,
    "message": f"PR in status: {verdict}"
}
res.update(common)
print(json.dumps(res))
' "$parsed_json" "$max_cycles"
}

# --- Command: --format-verification-review ---
cmd_format_verification_review() {
  local verification_id=""
  local issue=""
  local pr=""
  local model=""
  local implementing_model=""
  local commit_sha=""
  local cycle=""
  local effective_cycle_arg=""
  local max_cycles="2"
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
      --model)
        model="$2"
        shift 2
        ;;
      --implementing-model)
        implementing_model="$2"
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
      --effective-cycle)
        effective_cycle_arg="$2"
        shift 2
        ;;
      --max-cycles)
        max_cycles="$2"
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

  if [[ -z "$model" ]]; then
    model="$(cmd_resolve_model)"
  fi
  if [[ -z "$model" ]]; then
    model="unknown"
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
effective_cycle_arg = sys.argv[6]
max_cycles_arg = sys.argv[7]
verdict = sys.argv[8]
test_results = json.loads(sys.argv[9])
checklist = json.loads(sys.argv[10])
findings = json.loads(sys.argv[11])
output_file = sys.argv[12]
model = sys.argv[13] if len(sys.argv) > 13 and sys.argv[13] else "unknown"
implementing_model = sys.argv[14] if len(sys.argv) > 14 else ""

max_cycles = int(max_cycles_arg) if max_cycles_arg.isdigit() else 2
if effective_cycle_arg and effective_cycle_arg.isdigit():
    effective_cycle = int(effective_cycle_arg)
else:
    effective_cycle = cycle

meta_obj = {
    "version": "1.0",
    "verification_id": verification_id,
    "issue_number": issue,
    "pr_number": pr,
    "commit_sha": commit_sha,
    "cycle": cycle,
    "verdict": verdict,
    "model": model,
    "implementing_model": implementing_model,
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
if implementing_model:
    lines.append(f"**Implementing Model:** `{implementing_model}`")
lines.append(f"**Verified by Model:** `{model}`")
lines.append(f"**Verdict:** `{verdict}` (Cycle {effective_cycle}/{max_cycles})")
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
lines.append(f"<sub>*Generated by `/pr-verify` using `{model}` against closed issue specification.*</sub>\n")

with open(output_file, "w", encoding="utf-8") as out:
    out.write("\n".join(lines))

print(f"Verification review formatted successfully at: {output_file}")
' "$verification_id" "$issue" "$pr" "$commit_sha" "$cycle" "$effective_cycle_arg" "$max_cycles" "$verdict" "$test_results" "$checklist" "$findings" "$output_file" "$model" "$implementing_model"
}

# --- Command: --close-merged-issue ---
cmd_close_merged_issue() {
  local issue=""
  local pr=""
  local file=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --issue)
        issue="$2"
        shift 2
        ;;
      --pr)
        pr="$2"
        shift 2
        ;;
      --file)
        file="$2"
        shift 2
        ;;
      *)
        echo "Error: Unknown argument for --close-merged-issue: $1" >&2
        usage
        ;;
    esac
  done

  if [[ -z "$issue" || -z "$pr" ]]; then
    echo "Error: --issue and --pr required" >&2
    usage
  fi

  issue="${issue#\#}"
  pr="${pr#\#}"

  # 1. Check that PR is MERGED
  local pr_state=""
  if [[ -n "$file" && -f "$file" ]]; then
    pr_state="$(jq -r .state "$file")"
  else
    pr_state="$(gh_live pr view "$pr" --json state -q .state)" || exit 2
  fi

  if [[ "$pr_state" != "MERGED" ]]; then
    echo "Notice: PR #$pr state is '$pr_state' (not MERGED). Skipping close for issue #$issue."
    exit 0
  fi

  # 2. Check that issue is OPEN
  local issue_view_json=""
  issue_view_json="$(gh_live issue view "$issue" --json state,labels)" || exit 2

  local issue_state=""
  issue_state="$(echo "$issue_view_json" | jq -r .state)"
  if [[ "$issue_state" != "OPEN" ]]; then
    echo "Notice: Issue #$issue is already $issue_state. Nothing to do."
    exit 0
  fi

  # 3. Close issue with comment
  local close_comment
  close_comment="$(printf '<!-- ai-pipeline-notice: {"kind":"merged_close","pr":%s} -->\nMerged into dev via #%s.' "$pr" "$pr")"
  gh_live issue close "$issue" --comment "$close_comment" >/dev/null || exit 2

  # 4. Remove labels: in-progress, ready-for-human, needs-info, ready-for-agent
  local labels_to_remove=()
  for lbl in in-progress ready-for-human needs-info ready-for-agent; do
    if echo "$issue_view_json" | jq -e --arg l "$lbl" '.labels[] | select(.name == $l)' >/dev/null 2>&1; then
      labels_to_remove+=("$lbl")
    fi
  done

  if [[ ${#labels_to_remove[@]} -gt 0 ]]; then
    local remove_args=()
    for lbl in "${labels_to_remove[@]}"; do
      remove_args+=(--remove-label "$lbl")
    done
    gh_live issue edit "$issue" "${remove_args[@]}" >/dev/null || exit 2
  fi

  echo "Successfully closed issue #$issue merged via PR #$pr."
}

# --- Command: --merge-pr ---
cmd_merge_pr() {
  local pr="${1:-}"
  if [[ -z "$pr" ]]; then
    echo "Error: PR number required" >&2
    usage
  fi
  pr="${pr#\#}"

  local repo=""
  repo="$(gh_live repo view --json nameWithOwner -q .nameWithOwner)" || exit 2

  echo "Attempting auto-merge for PR #$pr (squash & delete branch) in repo $repo..."
  set +e
  local auto_out
  auto_out="$(gh pr merge "$pr" -R "$repo" --squash --delete-branch --auto 2>&1)"
  local auto_code=$?
  set -e

  if [[ $auto_code -eq 0 ]]; then
    echo "Successfully scheduled auto-merge for PR #$pr."
    exit 0
  fi

  echo "Auto-merge not eligible or disabled ($auto_out). Falling back to direct squash merge..."
  gh_live pr merge "$pr" -R "$repo" --squash --delete-branch || exit 2
  echo "Successfully merged PR #$pr directly into mainline."
}

# --- Main Dispatcher ---
if [[ $# -eq 0 ]]; then
  usage
fi

command="$1"
shift

case "$command" in
  --resolve-model)
    cmd_resolve_model "$@"
    ;;
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
  --close-merged-issue)
    cmd_close_merged_issue "$@"
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
