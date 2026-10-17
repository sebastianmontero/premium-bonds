#!/usr/bin/env bash
# issue_review_helper.sh
# Shared helper utility for GitHub issue review & integration workflows across agy & claude code.
set -euo pipefail

# Shared Python routine, prepended to every inline script that hashes an issue body
# (--parse-reviews body_sha256 and --check-drift), so both always agree.
# Pass the `body` string decoded from the issue JSON. Never hash a value that went
# through `$(...)` (strips trailing newlines) or `gh -q` (appends one).
PY_ISSUE_BODY_SHA256='
import hashlib

def issue_body_sha256(body):
    return hashlib.sha256((body or "").encode("utf-8")).hexdigest()
'

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
Usage: issue_review_helper.sh <command> [options]

Commands:
  --generate-review-id <issue_number>
      Generate a stateless unique review ID: rev-YYYYMMDD-<issue>-<rand4hex>

  --parse-reviews [--issue <number>] [--file <json_file>] [--trusted-author <login>] [--trust-any-author]
      Parse review comments and ledger from issue payload, outputting structured JSON
      (--issue always fetches live state; --file parses a saved snapshot)

  --append-ledger --issue <number> --review-id <id> --comment-id <id> \
                  --applied '<json_array>' --declined '<json_array>' \
                  [--decisions '<json_array>'] \
                  --input-body-file <path> --output-body-file <path> \
                  [--model <slug>] [--integrated-at <iso_timestamp>]
      Safely append or update a review record in the issue-side hidden ledger

  --check-drift <issue_number> --body-sha256 <sha256_hex>
      Check if the remote issue body SHA-256 matches expected

  --patch-comment <comment_id> <body_file> [--strict]
      Patch a comment body on GitHub (<comment_id> may be GraphQL node ID or numeric databaseId)
      With --strict, exits non-zero if the patch fails; otherwise continues with graceful fallback

  --format-review-metadata --review-id <id> --issue <n> --model <slug> --agents '<json>' \
                           [--round <k>] [--human-decision-required]
      Emit the HTML comment marker line <!-- ai-issue-review: {...} -->

  --help
      Show this help message
EOF
  exit 1
}

# --- Command: --generate-review-id ---
cmd_generate_review_id() {
  local issue="${1:-}"
  if [[ -z "$issue" ]]; then
    echo "Error: Issue number required" >&2
    usage
  fi
  issue="${issue#\#}"
  local date_str
  date_str="$(date -u +%Y%m%d)"
  local rand_hex
  if command -v openssl >/dev/null 2>&1; then
    rand_hex="$(openssl rand -hex 2)"
  else
    rand_hex="$(head -c 2 /dev/urandom | xxd -p 2>/dev/null || printf '%04x' "$$")"
  fi
  echo "rev-${date_str}-${issue}-${rand_hex}"
}

# --- Command: --parse-reviews ---
cmd_parse_reviews() {
  local issue=""
  local file=""
  local trusted_author=""
  local trust_any_author=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --issue)
        issue="$2"
        shift 2
        ;;
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
        if [[ -z "$issue" && "$1" =~ ^#?[0-9]+$ ]]; then
          issue="$1"
          shift
        elif [[ -z "$file" && -f "$1" ]]; then
          file="$1"
          shift
        else
          echo "Error: Unknown argument for --parse-reviews: $1" >&2
          usage
        fi
        ;;
    esac
  done

  issue="${issue#\#}"

  if [[ "$trust_any_author" == false ]]; then
    trusted_author="$(resolve_trusted_author "$trusted_author")" || exit 2
  fi

  local json_payload=""
  if [[ -n "$file" && -f "$file" ]]; then
    json_payload="$(cat "$file")"
  elif [[ -n "$issue" ]]; then
    json_payload="$(gh_live issue view "$issue" --json number,title,body,author,labels,comments,updatedAt)" || exit 2
  else
    if [ ! -t 0 ]; then
      json_payload="$(cat)"
    else
      echo "Error: Specify --issue <number> or --file <json_file>" >&2
      usage
    fi
  fi

  python3 -c "$PY_ISSUE_BODY_SHA256"'
import sys
import json
import re

trusted_author = sys.argv[1]
trust_any_author = (sys.argv[2] == "true")

raw_input = sys.stdin.read()
if not raw_input.strip():
    sys.stderr.write("Error: Empty JSON input\n")
    sys.exit(1)

try:
    data = json.loads(raw_input)
except Exception as e:
    sys.stderr.write(f"Error parsing JSON input: {e}\n")
    sys.exit(1)

issue_number = data.get("number")
title = data.get("title", "")
body = data.get("body", "") or ""
updated_at = data.get("updatedAt", "")
comments = data.get("comments", []) or []

body_sha256 = issue_body_sha256(body)

# 1. Parse ledger from issue body
ledger = []
ledger_pattern = re.compile(r"<!--\s*issue-review-ledger:\s*(\[.*?\])\s*-->", re.DOTALL)
ledger_match = ledger_pattern.search(body)
if ledger_match:
    try:
        ledger = json.loads(ledger_match.group(1))
    except Exception as e:
        sys.stderr.write(f"Warning: Failed to parse issue-review-ledger: {e}\n")

applied_keys = set()
declined_keys = set()
declined_items = []
resolved_by_review = {}

for entry in ledger:
    r_id = entry.get("review_id", "")
    scope = resolved_by_review.setdefault(r_id, {"applied": set(), "declined": set(), "decisions": entry.get("decisions", [])})
    for a in entry.get("applied", []):
        applied_keys.add(a)
        scope["applied"].add(a)
    for d in entry.get("declined", []):
        if isinstance(d, dict) and "id" in d:
            declined_keys.add(d["id"])
            scope["declined"].add(d["id"])
            declined_items.append(d)
        elif isinstance(d, str):
            declined_keys.add(d)
            scope["declined"].add(d)
            declined_items.append({"id": d, "reason": ""})

def is_machine_comment(c):
    c_body = c.get("body", "") or ""
    has_marker = bool(re.search(r"<!--\s*ai-", c_body))
    if not has_marker:
        return False
    if trust_any_author:
        return True
    c_author = (c.get("author") or {}).get("login", "")
    return c_author == trusted_author

def is_human_input_comment(c):
    if is_machine_comment(c):
        return False
    if trust_any_author:
        return True
    c_author = (c.get("author") or {}).get("login", "")
    assoc = c.get("authorAssociation", "")
    if c_author == trusted_author:
        return True
    if assoc in ("OWNER", "MEMBER", "COLLABORATOR"):
        return True
    return False

# Patterns
review_meta_pattern = re.compile(r"<!--\s*ai-issue-review:\s*(\{.*?\})\s*-->")
manual_review_heading_pattern = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]+(?:.*?[ \t])?Issue Review\b", re.MULTILINE)

checklist_pattern = re.compile(
    r"^[ \t]*-[ \t]*\[([ xX])\][ \t]*(?:\*\*\[([A-Za-z0-9_-]+)\]\*\*|\[([A-Za-z0-9_-]+)\]|\*\*([A-Za-z0-9_-]+)\*\*|(?!DEC-\d+/)([A-Za-z0-9_-]+)):?[ \t]*(.+)$",
    re.MULTILINE
)
question_pattern = re.compile(r"^[ \t]*#{1,6}[ \t]+\[(DEC-\d+)\][ \t]+(.+)$", re.MULTILINE)
option_pattern = re.compile(
    r"^[ \t]*-[ \t]*\[([ xX])\][ \t]*(?:\*\*)?(DEC-\d+)/([A-Z])(?:\*\*)?:?[ \t]*(.+)$",
    re.MULTILINE
)
custom_answer_pattern = re.compile(r"^(DEC-\d+)\s*:\s*(\S.*)$", re.MULTILINE)

reviews = []
pending_items = []

for c_idx, comment in enumerate(comments):
    c_id = comment.get("id") or comment.get("databaseId")
    c_body = comment.get("body", "") or ""
    c_author = (comment.get("author") or {}).get("login", "")
    c_created = comment.get("createdAt", "")

    meta_match = review_meta_pattern.search(c_body)
    is_review_comment = False
    metadata = {}
    review_id = ""
    model = "unknown"
    agent_models = {}
    round_val = None
    human_decision_required = False

    if meta_match:
        if trust_any_author or c_author == trusted_author:
            is_review_comment = True
            try:
                metadata = json.loads(meta_match.group(1))
                review_id = metadata.get("review_id", "")
                model = metadata.get("model", "unknown")
                agent_models = metadata.get("agent_models", {})
                round_val = metadata.get("round")
                human_decision_required = bool(metadata.get("human_decision_required", False))
            except Exception as e:
                sys.stderr.write(f"Warning: Failed to parse ai-issue-review metadata in comment {c_id}: {e}\n")
    elif manual_review_heading_pattern.search(c_body):
        if trust_any_author or is_human_input_comment(comment):
            is_review_comment = True
            review_id = f"manual-review-{c_id}"
            metadata = {"review_id": review_id, "type": "manual"}
            model = "unknown"
            agent_models = {}

    if not is_review_comment:
        continue

    # Parse checklist items
    items = []
    for match in checklist_pattern.finditer(c_body):
        checked_char = match.group(1)
        key = match.group(2) or match.group(3) or match.group(4) or match.group(5)
        text = match.group(6).strip()
        is_checked = (checked_char.lower() == "x")

        scope = resolved_by_review.get(review_id, {"applied": set(), "declined": set()})
        status = "pending"
        if key in scope["applied"]:
            status = "applied"
        elif key in scope["declined"]:
            status = "declined"

        item_obj = {
            "id": key,
            "text": text,
            "checked": is_checked,
            "status": status
        }
        items.append(item_obj)

        if status == "pending":
            pending_items.append({
                "review_id": review_id,
                "comment_id": c_id,
                "id": key,
                "text": text
            })

    # Parse DEC decisions in this review comment
    questions = {}
    for qm in question_pattern.finditer(c_body):
        questions[qm.group(1)] = qm.group(2).strip()

    dec_options = {}
    for om in option_pattern.finditer(c_body):
        is_checked = (om.group(1).lower() == "x")
        d_id = om.group(2)
        letter = om.group(3)
        opt_text = om.group(4).strip()
        dec_options.setdefault(d_id, []).append({
            "key": letter,
            "text": opt_text,
            "checked": is_checked
        })

    # Look for custom answers in comments created after this review comment
    custom_answers = {}
    for later_c in comments:
        later_created = later_c.get("createdAt", "")
        is_after = False
        if later_created and c_created:
            is_after = (later_created > c_created)
        else:
            is_after = (comments.index(later_c) > c_idx)

        if is_after and is_human_input_comment(later_c):
            for cam in custom_answer_pattern.finditer(later_c.get("body", "") or ""):
                custom_answers[cam.group(1)] = cam.group(2).strip()

    all_dec_ids = sorted(
        list(set(questions.keys()) | set(dec_options.keys())),
        key=lambda x: int(x.split("-")[1]) if "-" in x and x.split("-")[1].isdigit() else x
    )

    decisions = []
    for d_id in all_dec_ids:
        opts = dec_options.get(d_id, [])
        q_text = questions.get(d_id, "")
        checked_opts = [o for o in opts if o["checked"]]
        custom_ans = custom_answers.get(d_id)

        selected = None
        custom_answer = None
        resolved = False
        unresolved_reason = None

        if len(checked_opts) == 1 and not custom_ans:
            selected = checked_opts[0]["key"]
            resolved = True
        elif custom_ans and len(checked_opts) == 0:
            custom_answer = custom_ans
            resolved = True
        else:
            resolved = False
            if len(checked_opts) == 0 and not custom_ans:
                unresolved_reason = "no_selection"
            else:
                unresolved_reason = "multiple_selections"

        decisions.append({
            "id": d_id,
            "question": q_text,
            "options": opts,
            "selected": selected,
            "custom_answer": custom_answer,
            "resolved": resolved,
            "unresolved_reason": unresolved_reason
        })

    # Determine review status
    in_ledger = any(entry.get("review_id") == review_id for entry in ledger)
    has_decisions = (len(decisions) > 0)

    if (human_decision_required and not has_decisions) or (has_decisions and not human_decision_required):
        review_status = "malformed"
    elif human_decision_required and not in_ledger:
        review_status = "awaiting_decision"
    else:
        scope = resolved_by_review.get(review_id, {"applied": set(), "declined": set()})
        checklist_resolved = all(it["status"] in ("applied", "declined") for it in items) if items else True
        decisions_in_ledger = all((d["id"] in scope["applied"] or d["id"] in scope["declined"]) for d in decisions) if decisions else True
        is_round_zero_items = (round_val is not None and len(items) == 0 and not human_decision_required)

        if (items or decisions) and checklist_resolved and decisions_in_ledger:
            review_status = "integrated"
        elif is_round_zero_items:
            review_status = "integrated"
        elif not items and not decisions:
            review_status = "integrated" if in_ledger else "pending"
        else:
            any_checklist_resolved = any(it["status"] in ("applied", "declined") for it in items) if items else False
            any_decision_in_ledger = any((d["id"] in scope["applied"] or d["id"] in scope["declined"]) for d in decisions) if decisions else False
            if any_checklist_resolved or any_decision_in_ledger:
                review_status = "partially_integrated"
            else:
                review_status = "pending"

    review_obj = {
        "review_id": review_id,
        "comment_id": c_id,
        "author": c_author,
        "model": model,
        "agent_models": agent_models,
        "status": review_status,
        "metadata": metadata,
        "checklist": items,
        "decisions": decisions
    }
    if round_val is not None:
        review_obj["round"] = round_val
    if human_decision_required:
        review_obj["human_decision_required"] = True

    reviews.append(review_obj)

unresolved_decisions = []
for r in reviews:
    for d in r.get("decisions", []):
        if not d.get("resolved"):
            unresolved_decisions.append({
                "review_id": r.get("review_id"),
                "comment_id": r.get("comment_id"),
                "id": d.get("id"),
                "reason": d.get("unresolved_reason")
            })

result = {
    "issue_number": issue_number,
    "title": title,
    "body_sha256": body_sha256,
    "updated_at": updated_at,
    "ledger": ledger,
    "applied_keys": sorted(list(applied_keys)),
    "declined_keys": sorted(list(declined_keys)),
    "declined_items": declined_items,
    "reviews": reviews,
    "pending_items": pending_items,
    "unresolved_decisions": unresolved_decisions
}

print(json.dumps(result, indent=2))
' "$trusted_author" "$trust_any_author" <<< "$json_payload"
}

# --- Command: --append-ledger ---
cmd_append_ledger() {
  local issue=""
  local review_id=""
  local comment_id=""
  local model=""
  local applied="[]"
  local declined="[]"
  local decisions=""
  local input_body_file=""
  local output_body_file=""
  local integrated_at=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --issue)
        issue="$2"
        shift 2
        ;;
      --review-id)
        review_id="$2"
        shift 2
        ;;
      --comment-id)
        comment_id="$2"
        shift 2
        ;;
      --model)
        model="$2"
        shift 2
        ;;
      --applied)
        applied="$2"
        shift 2
        ;;
      --declined)
        declined="$2"
        shift 2
        ;;
      --decisions)
        decisions="$2"
        shift 2
        ;;
      --input-body-file)
        input_body_file="$2"
        shift 2
        ;;
      --output-body-file)
        output_body_file="$2"
        shift 2
        ;;
      --integrated-at)
        integrated_at="$2"
        shift 2
        ;;
      *)
        echo "Error: Unknown argument for --append-ledger: $1" >&2
        usage
        ;;
    esac
  done

  if [[ -z "$review_id" || -z "$input_body_file" || -z "$output_body_file" ]]; then
    echo "Error: Missing required arguments for --append-ledger" >&2
    usage
  fi

  if [[ ! -f "$input_body_file" ]]; then
    echo "Error: Input body file not found: $input_body_file" >&2
    exit 1
  fi

  if [[ -z "$model" ]]; then
    local helper_dir
    helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "${helper_dir}/issue_lifecycle_helper.sh" ]]; then
      model="$(bash "${helper_dir}/issue_lifecycle_helper.sh" --resolve-model 2>/dev/null || echo "unknown")"
    else
      model="unknown"
    fi
  fi
  if [[ -z "$model" ]]; then
    model="unknown"
  fi

  if [[ -z "$integrated_at" ]]; then
    integrated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  fi

  if ! echo "$applied" | jq -e . >/dev/null 2>&1; then
    echo "Error: --applied must be a valid JSON array" >&2
    exit 1
  fi
  if ! echo "$declined" | jq -e . >/dev/null 2>&1; then
    echo "Error: --declined must be a valid JSON array" >&2
    exit 1
  fi
  if [[ -n "$decisions" ]] && ! echo "$decisions" | jq -e . >/dev/null 2>&1; then
    echo "Error: --decisions must be a valid JSON array" >&2
    exit 1
  fi

  python3 -c '
import sys
import json
import re

review_id = sys.argv[1]
comment_id = sys.argv[2]
integrated_at = sys.argv[3]
applied_raw = sys.argv[4]
declined_raw = sys.argv[5]
input_file = sys.argv[6]
output_file = sys.argv[7]
model = sys.argv[8] if len(sys.argv) > 8 and sys.argv[8] else "unknown"
decisions_raw = sys.argv[9] if len(sys.argv) > 9 else ""

with open(input_file, "r", encoding="utf-8") as f:
    content = f.read()

applied = json.loads(applied_raw)
declined = json.loads(declined_raw)

try:
    comment_id_val = int(comment_id)
except (ValueError, TypeError):
    comment_id_val = comment_id

new_entry = {
    "review_id": review_id,
    "comment_id": comment_id_val,
    "integrated_at": integrated_at,
    "model": model,
    "applied": applied,
    "declined": declined
}

if decisions_raw.strip():
    new_entry["decisions"] = json.loads(decisions_raw)

ledger_pattern = re.compile(r"<!--\s*issue-review-ledger:\s*(\[.*?\])\s*-->", re.DOTALL)
match = ledger_pattern.search(content)

ledger = []
if match:
    try:
        ledger = json.loads(match.group(1))
    except Exception as e:
        sys.stderr.write(f"Warning: Corrupt existing ledger JSON, starting fresh: {e}\n")
        ledger = []

updated = False
for idx, entry in enumerate(ledger):
    if entry.get("review_id") == review_id:
        ledger[idx] = new_entry
        updated = True
        break
if not updated:
    ledger.append(new_entry)

ledger_json_str = json.dumps(ledger, indent=2)
ledger_block = f"<!-- issue-review-ledger: {ledger_json_str} -->"

if match:
    new_content = content[:match.start()] + ledger_block + content[match.end():]
else:
    stripped = content.rstrip()
    new_content = f"{stripped}\n\n{ledger_block}\n"

char_count = len(new_content)
if char_count >= 65000:
    sys.stderr.write(f"Error: Issue body exceeds GitHub 65,000 character limit ({char_count} chars). Cannot append ledger.\n")
    sys.exit(1)

with open(output_file, "w", encoding="utf-8") as f:
    f.write(new_content)

print(f"Ledger updated successfully: {len(ledger)} record(s), {char_count} total characters.")
' "$review_id" "$comment_id" "$integrated_at" "$applied" "$declined" "$input_body_file" "$output_body_file" "$model" "$decisions"
}

# --- Command: --check-drift ---
cmd_check_drift() {
  local issue=""
  local expected_sha=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --issue)
        issue="$2"
        shift 2
        ;;
      --body-sha256)
        expected_sha="$2"
        shift 2
        ;;
      *)
        if [[ -z "$issue" ]]; then
          issue="$1"
          shift
        elif [[ -z "$expected_sha" ]]; then
          expected_sha="$1"
          shift
        else
          echo "Error: Unknown argument for --check-drift: $1" >&2
          usage
        fi
        ;;
    esac
  done

  if [[ -z "$issue" || -z "$expected_sha" ]]; then
    echo "Error: Usage: issue_review_helper.sh --check-drift <issue_number> --body-sha256 <hex>" >&2
    exit 1
  fi

  issue="${issue#\#}"
  local issue_json=""
  issue_json="$(gh_live issue view "$issue" --json body)" || exit 2

  python3 -c "$PY_ISSUE_BODY_SHA256"'
import sys
import json

issue_num = sys.argv[1]
expected_sha = sys.argv[2]
try:
    data = json.loads(sys.stdin.read())
except Exception as e:
    sys.stderr.write(f"Error parsing issue JSON: {e}\n")
    sys.exit(2)

actual_sha = issue_body_sha256(data.get("body"))

if actual_sha == expected_sha:
    print(f"No drift detected: issue #{issue_num} body_sha256 matches ({expected_sha})")
    sys.exit(0)
else:
    sys.stderr.write(f"Remote drift detected: issue #{issue_num} expected body SHA-256 \"{expected_sha}\", got \"{actual_sha}\"\n")
    sys.exit(1)
' "$issue" "$expected_sha" <<< "$issue_json"
}

# --- Command: --patch-comment ---
cmd_patch_comment() {
  local comment_id=""
  local body_file=""
  local strict=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --strict)
        strict=true
        shift
        ;;
      *)
        if [[ -z "$comment_id" ]]; then
          comment_id="$1"
          shift
        elif [[ -z "$body_file" ]]; then
          body_file="$1"
          shift
        else
          echo "Error: Unknown argument for --patch-comment: $1" >&2
          usage
        fi
        ;;
    esac
  done

  if [[ -z "$comment_id" || -z "$body_file" ]]; then
    echo "Error: Usage: issue_review_helper.sh --patch-comment <comment_id> <body_file> [--strict]" >&2
    exit 1
  fi

  if [[ ! -f "$body_file" ]]; then
    echo "Error: Body file not found: $body_file" >&2
    exit 1
  fi

  set +e
  local err_output
  local exit_code=0
  if [[ ! "$comment_id" =~ ^[0-9]+$ ]]; then
    err_output="$(gh api graphql -f query='query($id: ID!) { node(id: $id) { ... on IssueComment { databaseId } } }' \
      -f id="$comment_id" -q '.data.node.databaseId' 2>&1)"
    exit_code=$?
    if [[ $exit_code -eq 0 && "$err_output" =~ ^[0-9]+$ ]]; then
      comment_id="$err_output"
    elif [[ $exit_code -eq 0 ]]; then
      exit_code=1
      err_output="could not resolve node ID '$comment_id' to a comment databaseId"
    fi
  fi
  if [[ $exit_code -eq 0 ]]; then
    err_output="$(gh api --method PATCH "repos/:owner/:repo/issues/comments/${comment_id}" -F body=@"${body_file}" 2>&1)"
    exit_code=$?
  fi
  set -e

  if [[ $exit_code -eq 0 ]]; then
    echo "Successfully patched review comment $comment_id."
    exit 0
  else
    if [[ "$strict" == true ]]; then
      echo "Error: Failed to patch review comment $comment_id (API returned exit code $exit_code: $err_output)" >&2
      exit "$exit_code"
    else
      echo "Warning: Could not patch review comment $comment_id (API returned exit code $exit_code: $err_output). Continuing with non-blocking graceful fallback." >&2
      exit 0
    fi
  fi
}

# --- Command: --format-review-metadata ---
cmd_format_review_metadata() {
  local review_id=""
  local issue=""
  local model=""
  local agents="[]"
  local round=""
  local human_decision_required=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --review-id)
        review_id="$2"
        shift 2
        ;;
      --issue)
        issue="$2"
        shift 2
        ;;
      --model)
        model="$2"
        shift 2
        ;;
      --agents)
        agents="$2"
        shift 2
        ;;
      --round)
        round="$2"
        shift 2
        ;;
      --human-decision-required)
        human_decision_required=true
        shift
        ;;
      *)
        echo "Error: Unknown argument for --format-review-metadata: $1" >&2
        usage
        ;;
    esac
  done

  if [[ -z "$review_id" || -z "$issue" || -z "$model" ]]; then
    echo "Error: Missing required arguments for --format-review-metadata" >&2
    usage
  fi

  issue="${issue#\#}"

  python3 -c '
import sys
import json

review_id = sys.argv[1]
issue = int(sys.argv[2])
model = sys.argv[3]
agents_raw = sys.argv[4]
round_arg = sys.argv[5]
hdr_arg = sys.argv[6]

try:
    agents = json.loads(agents_raw)
except Exception:
    agents = []

meta = {
    "version": "1.0",
    "review_id": review_id,
    "issue_number": issue,
    "model": model,
    "agents": agents
}

if round_arg != "":
    try:
        meta["round"] = int(round_arg)
    except ValueError:
        pass

if hdr_arg == "true":
    meta["human_decision_required"] = True

print(f"<!-- ai-issue-review: {json.dumps(meta)} -->")
' "$review_id" "$issue" "$model" "$agents" "$round" "$human_decision_required"
}

# --- Main Dispatcher ---
if [[ $# -eq 0 ]]; then
  usage
fi

command="$1"
shift

case "$command" in
  --generate-review-id)
    cmd_generate_review_id "$@"
    ;;
  --parse-reviews)
    cmd_parse_reviews "$@"
    ;;
  --append-ledger)
    cmd_append_ledger "$@"
    ;;
  --check-drift)
    cmd_check_drift "$@"
    ;;
  --patch-comment)
    cmd_patch_comment "$@"
    ;;
  --format-review-metadata)
    cmd_format_review_metadata "$@"
    ;;
  --help|-h)
    usage
    ;;
  *)
    echo "Error: Unknown command: $command" >&2
    usage
    ;;
esac
