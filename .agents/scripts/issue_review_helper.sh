#!/usr/bin/env bash
# issue_review_helper.sh
# Shared helper utility for GitHub issue review & integration workflows across agy & claude code.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: issue_review_helper.sh <command> [options]

Commands:
  --generate-review-id <issue_number>
      Generate a stateless unique review ID: rev-YYYYMMDD-<issue>-<rand4hex>

  --parse-reviews [--issue <number>] [--file <json_file>]
      Parse review comments and ledger from issue payload, outputting structured JSON

  --append-ledger --issue <number> --review-id <id> --comment-id <id> \
                  --applied '<json_array>' --declined '<json_array>' \
                  --input-body-file <path> --output-body-file <path> [--integrated-at <iso_timestamp>]
      Safely append or update a review record in the issue-side hidden ledger

  --check-drift <issue_number> <expected_updated_at>
      Check if the remote issue updatedAt timestamp matches expected

  --patch-comment <comment_id> <body_file>
      Best-effort patch of a comment body on GitHub with graceful error fallback

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
  # Strip leading '#' if provided
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

  local json_payload=""
  if [[ -n "$file" && -f "$file" ]]; then
    json_payload="$(cat "$file")"
  elif [[ -n "$issue" ]]; then
    # Check if a cached file exists in /tmp
    if [[ -f "/tmp/issue_${issue}_full.json" ]]; then
      json_payload="$(cat "/tmp/issue_${issue}_full.json")"
    elif [[ -f "/tmp/issue_${issue}_raw.json" ]]; then
      json_payload="$(cat "/tmp/issue_${issue}_raw.json")"
    else
      json_payload="$(gh issue view "$issue" --json number,title,body,author,labels,comments,updatedAt)"
    fi
  else
    # Try reading from stdin if available
    if [ ! -t 0 ]; then
      json_payload="$(cat)"
    else
      echo "Error: Specify --issue <number> or --file <json_file>" >&2
      usage
    fi
  fi

  python3 -c '
import sys
import json
import re

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

# 1. Parse ledger from issue body
# Format: <!-- issue-review-ledger: [...] -->
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

for entry in ledger:
    for a in entry.get("applied", []):
        applied_keys.add(a)
    for d in entry.get("declined", []):
        if isinstance(d, dict) and "id" in d:
            declined_keys.add(d["id"])
            declined_items.append(d)
        elif isinstance(d, str):
            declined_keys.add(d)
            declined_items.append({"id": d, "reason": ""})

# 2. Parse review comments
# Check for <!-- ai-issue-review: {...} -->
review_meta_pattern = re.compile(r"<!--\s*ai-issue-review:\s*(\{.*?\})\s*-->")
checklist_pattern = re.compile(
    r"^[ \t]*-[ \t]*\[([ xX])\][ \t]*(?:\*\*\[([A-Za-z0-9_-]+)\]\*\*|\[([A-Za-z0-9_-]+)\]|\*\*([A-Za-z0-9_-]+)\*\*|([A-Za-z0-9_-]+)):?[ \t]*(.+)$",
    re.MULTILINE
)

reviews = []
pending_items = []

for comment in comments:
    c_id = comment.get("id") or comment.get("databaseId")
    c_body = comment.get("body", "") or ""
    c_author = (comment.get("author") or {}).get("login", "")

    meta_match = review_meta_pattern.search(c_body)
    is_review_comment = False
    metadata = {}
    review_id = ""

    if meta_match:
        is_review_comment = True
        try:
            metadata = json.loads(meta_match.group(1))
            review_id = metadata.get("review_id", "")
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to parse ai-issue-review metadata in comment {c_id}: {e}\n")
    elif "# Issue Review" in c_body or "/review" in c_body:
        # Fallback manual review comment detection
        is_review_comment = True
        review_id = f"manual-review-{c_id}"
        metadata = {"review_id": review_id, "type": "manual"}

    if not is_review_comment:
        continue

    # Parse checklist items
    items = []
    for match in checklist_pattern.finditer(c_body):
        checked_char = match.group(1)
        key = match.group(2) or match.group(3) or match.group(4) or match.group(5)
        text = match.group(6).strip()
        is_checked = (checked_char.lower() == "x")

        status = "pending"
        if key in applied_keys:
            status = "applied"
        elif key in declined_keys:
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

    # Determine review overall status
    if items:
        all_resolved = all(it["status"] in ("applied", "declined") for it in items)
        any_resolved = any(it["status"] in ("applied", "declined") for it in items)
        if all_resolved:
            review_status = "integrated"
        elif any_resolved:
            review_status = "partially_integrated"
        else:
            review_status = "pending"
    else:
        # If no checklist items found, check if review_id is in ledger
        in_ledger = any(entry.get("review_id") == review_id for entry in ledger)
        review_status = "integrated" if in_ledger else "pending"

    reviews.append({
        "review_id": review_id,
        "comment_id": c_id,
        "author": c_author,
        "status": review_status,
        "metadata": metadata,
        "checklist": items
    })

result = {
    "issue_number": issue_number,
    "title": title,
    "updated_at": updated_at,
    "ledger": ledger,
    "applied_keys": sorted(list(applied_keys)),
    "declined_keys": sorted(list(declined_keys)),
    "declined_items": declined_items,
    "reviews": reviews,
    "pending_items": pending_items
}

print(json.dumps(result, indent=2))
' <<< "$json_payload"
}

# --- Command: --append-ledger ---
cmd_append_ledger() {
  local issue=""
  local review_id=""
  local comment_id=""
  local applied="[]"
  local declined="[]"
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
      --applied)
        applied="$2"
        shift 2
        ;;
      --declined)
        declined="$2"
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

  if [[ -z "$integrated_at" ]]; then
    integrated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  fi

  # Validate applied and declined are valid JSON
  if ! echo "$applied" | jq -e . >/dev/null 2>&1; then
    echo "Error: --applied must be a valid JSON array" >&2
    exit 1
  fi
  if ! echo "$declined" | jq -e . >/dev/null 2>&1; then
    echo "Error: --declined must be a valid JSON array" >&2
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

with open(input_file, "r", encoding="utf-8") as f:
    content = f.read()

applied = json.loads(applied_raw)
declined = json.loads(declined_raw)

# Parse comment_id as int if numeric
try:
    comment_id_val = int(comment_id)
except (ValueError, TypeError):
    comment_id_val = comment_id

new_entry = {
    "review_id": review_id,
    "comment_id": comment_id_val,
    "integrated_at": integrated_at,
    "applied": applied,
    "declined": declined
}

ledger_pattern = re.compile(r"<!--\s*issue-review-ledger:\s*(\[.*?\])\s*-->", re.DOTALL)
match = ledger_pattern.search(content)

ledger = []
if match:
    try:
        ledger = json.loads(match.group(1))
    except Exception as e:
        sys.stderr.write(f"Warning: Corrupt existing ledger JSON, starting fresh: {e}\n")
        ledger = []

# Idempotently update if review_id exists, otherwise append
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

# Verify GitHub 65,000 char limit
char_count = len(new_content)
if char_count >= 65000:
    sys.stderr.write(f"Error: Issue body exceeds GitHub 65,000 character limit ({char_count} chars). Cannot append ledger.\n")
    sys.exit(1)

with open(output_file, "w", encoding="utf-8") as f:
    f.write(new_content)

print(f"Ledger updated successfully: {len(ledger)} record(s), {char_count} total characters.")
' "$review_id" "$comment_id" "$integrated_at" "$applied" "$declined" "$input_body_file" "$output_body_file"
}

# --- Command: --check-drift ---
cmd_check_drift() {
  local issue="${1:-}"
  local expected_updated_at="${2:-}"

  if [[ -z "$issue" || -z "$expected_updated_at" ]]; then
    echo "Error: Usage: issue_review_helper.sh --check-drift <issue_number> <expected_updated_at>" >&2
    exit 1
  fi

  issue="${issue#\#}"
  local current_updated_at
  current_updated_at="$(gh issue view "$issue" --json updatedAt -q .updatedAt)"

  if [[ "$current_updated_at" == "$expected_updated_at" ]]; then
    echo "No drift detected: issue #$issue updatedAt matches ($expected_updated_at)"
    exit 0
  else
    echo "Remote drift detected: issue #$issue expected updatedAt '$expected_updated_at', got '$current_updated_at'" >&2
    exit 1
  fi
}

# --- Command: --patch-comment ---
cmd_patch_comment() {
  local comment_id="${1:-}"
  local body_file="${2:-}"

  if [[ -z "$comment_id" || -z "$body_file" ]]; then
    echo "Error: Usage: issue_review_helper.sh --patch-comment <comment_id> <body_file>" >&2
    exit 1
  fi

  if [[ ! -f "$body_file" ]]; then
    echo "Error: Body file not found: $body_file" >&2
    exit 1
  fi

  set +e
  local err_output
  err_output="$(gh api --method PATCH "repos/:owner/:repo/issues/comments/${comment_id}" -F body=@"${body_file}" 2>&1)"
  local exit_code=$?
  set -e

  if [[ $exit_code -eq 0 ]]; then
    echo "Successfully patched review comment $comment_id."
    exit 0
  else
    echo "Warning: Could not patch review comment $comment_id (API returned exit code $exit_code: $err_output). Continuing with non-blocking graceful fallback." >&2
    exit 0
  fi
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
  --help|-h)
    usage
    ;;
  *)
    echo "Error: Unknown command: $command" >&2
    usage
    ;;
esac
