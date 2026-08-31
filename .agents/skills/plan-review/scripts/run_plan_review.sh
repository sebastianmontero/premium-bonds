#!/usr/bin/env bash
set -euo pipefail

# Plan Review Session Launcher Script
# Spawns a new tab in Herdr, starts an agy agent in plan mode with the requested model,
# resolves review-plan-basic skill, executes review on the target artifact,
# waits for completion, and extracts the review report via file-first protocol.

ARTIFACT_RAW=""
MODEL=""
TIMEOUT_MS=300000
PROMPT_DELAY=5
CWD="$PWD"
FOCUS="true"
LIST_ARTIFACTS="false"
BRAIN_DIR=""
SESSION_ID=""
JSON_OUTPUT="false"
OUTPUT_FILE=""

show_help() {
  cat << 'EOF'
Usage: run_plan_review.sh [OPTIONS]

Options:
  -a, --artifact PATH       Target plan/artifact path or name (Required for review)
  -M, --model MODEL         Model for review agent (default: auto-detected from current session)
  -t, --timeout MS          Timeout in milliseconds to wait for child agent (default: 300000)
  -d, --delay SECONDS       Delay in seconds before sending prompt for account verification (default: 5)
  --brain-dir DIR           Override brain directory to search for artifacts
  --session-id ID           Override conversation/session ID
  --list-artifacts          List all candidate artifacts in current session with metadata and exit
  --cwd DIR                 Working directory for the Herdr tab (default: $PWD)
  --no-focus                Do not focus the new tab
  --json                    Output final result strictly as JSON
  -h, --help                Show this help message
EOF
}

find_brain_dir() {
  if [ -n "$BRAIN_DIR" ] && [ -d "$BRAIN_DIR" ]; then
    echo "$BRAIN_DIR"
    return
  fi

  if [ -n "$SESSION_ID" ]; then
    local candidate="$HOME/.gemini/antigravity-cli/brain/$SESSION_ID"
    if [ -d "$candidate" ]; then
      echo "$candidate"
      return
    fi
  fi

  if [ -n "${ANTIGRAVITY_CONVERSATION_ID:-}" ]; then
    local candidate="$HOME/.gemini/antigravity-cli/brain/$ANTIGRAVITY_CONVERSATION_ID"
    if [ -d "$candidate" ]; then
      echo "$candidate"
      return
    fi
  fi

  if [ -n "${CONVERSATION_ID:-}" ]; then
    local candidate="$HOME/.gemini/antigravity-cli/brain/$CONVERSATION_ID"
    if [ -d "$candidate" ]; then
      echo "$candidate"
      return
    fi
  fi

  # Fallback: Find most recently modified brain directory
  python3 -c '
import os, glob
base = os.path.expanduser("~/.gemini/antigravity-cli/brain")
if os.path.isdir(base):
    dirs = [os.path.join(base, d) for d in os.listdir(base) if os.path.isdir(os.path.join(base, d)) and not d.startswith(".")]
    dirs.sort(key=os.path.getmtime, reverse=True)
    if dirs:
        print(dirs[0])
' 2>/dev/null || true
}

list_session_artifacts() {
  local target_dir
  target_dir=$(find_brain_dir)
  if [ -z "$target_dir" ] || [ ! -d "$target_dir" ]; then
    echo '[]'
    return
  fi

  python3 -c '
import os, sys, json, datetime

brain_dir = sys.argv[1]
artifacts = []
if os.path.isdir(brain_dir):
    for f in sorted(os.listdir(brain_dir)):
        if f.endswith(".md") and not f.startswith("."):
            full_path = os.path.join(brain_dir, f)
            if os.path.isfile(full_path):
                stat = os.stat(full_path)
                size_bytes = stat.st_size
                mtime = datetime.datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                if size_bytes < 1024:
                    size_formatted = f"{size_bytes} B"
                elif size_bytes < 1024 * 1024:
                    size_formatted = f"{size_bytes / 1024:.1f} KB"
                else:
                    size_formatted = f"{size_bytes / (1024 * 1024):.2f} MB"
                artifacts.append({
                    "name": f,
                    "path": os.path.abspath(full_path),
                    "size_bytes": size_bytes,
                    "size_formatted": size_formatted,
                    "modified_at": mtime,
                    "created_at": mtime
                })
# Sort most recently modified first
artifacts.sort(key=lambda x: x["modified_at"], reverse=True)
print(json.dumps(artifacts, indent=2))
' "$target_dir"
}

detect_current_model() {
  if [ -n "${AGY_MODEL:-}" ]; then
    echo "$AGY_MODEL"
    return
  fi
  if [ -n "${GEMINI_MODEL:-}" ]; then
    echo "$GEMINI_MODEL"
    return
  fi
  if [ -n "${MODEL:-}" ]; then
    echo "$MODEL"
    return
  fi

  python3 -c '
import os, sys, re, glob

model_map = {
    "gemini 3.7 flash (high)": "gemini-3.7-flash-high",
    "gemini 3.7 flash (medium)": "gemini-3.7-flash-medium",
    "gemini 3.7 flash (low)": "gemini-3.7-flash-low",
    "gemini 3.6 flash (high)": "gemini-3.6-flash-high",
    "gemini 3.6 flash (medium)": "gemini-3.6-flash-medium",
    "gemini 3.6 flash (low)": "gemini-3.6-flash-low",
    "gemini 3.5 flash (high)": "gemini-3.5-flash-high",
    "gemini 3.5 flash (medium)": "gemini-3.5-flash-medium",
    "gemini 3.5 flash (low)": "gemini-3.5-flash-low",
    "gemini 3.1 pro (high)": "gemini-3.1-pro-high",
    "gemini 3.1 pro (low)": "gemini-3.1-pro-low",
    "claude sonnet 4.6 (thinking)": "claude-sonnet-4-6",
    "claude opus 4.6 (thinking)": "claude-opus-4-6-thinking",
    "gpt-oss 120b (medium)": "gpt-oss-120b-medium",
}

def normalize(val):
    if not val:
        return ""
    c = val.strip()
    k = c.lower()
    if k in model_map:
        return model_map[k]
    if re.match(r"^[a-zA-Z0-9_\-]+$", c):
        return c
    slug = re.sub(r"[\(\)]", "", c).strip()
    slug = re.sub(r"\s+", "-", slug).lower()
    return slug

# 1. Process tree inspection
curr = os.getppid()
agy_pids = []
while curr > 1:
    try:
        with open(f"/proc/{curr}/cmdline", "rb") as f:
            cmd_strs = [c.decode("utf-8", errors="ignore") for c in f.read().split(b"\x00")]
            for i, arg in enumerate(cmd_strs):
                if arg == "--model" and i + 1 < len(cmd_strs):
                    print(normalize(cmd_strs[i+1]))
                    sys.exit(0)
                elif arg.startswith("--model="):
                    print(normalize(arg.split("=", 1)[1]))
                    sys.exit(0)
            if cmd_strs and "agy" in os.path.basename(cmd_strs[0]):
                agy_pids.append(curr)
    except Exception:
        pass
    try:
        with open(f"/proc/{curr}/stat", "r") as f:
            curr = int(f.read().split()[3])
    except Exception:
        break

# 2. Check recent logs
cli_log_dir = os.path.expanduser("~/.gemini/antigravity-cli/log")
if os.path.isdir(cli_log_dir):
    all_logs = sorted(glob.glob(f"{cli_log_dir}/cli-*.log"), key=os.path.getmtime, reverse=True)
    for log_path in all_logs[:3]:
        try:
            with open(log_path, "r", errors="ignore") as f:
                for line in reversed(f.readlines()):
                    m = re.search(r"label=\"([^\"]+)\"", line)
                    if m:
                        res = normalize(m.group(1))
                        if res:
                            print(res)
                            sys.exit(0)
                    m = re.search(r"Resolving model\s+([a-zA-Z0-9_\-\. \(\)]+)", line)
                    if m:
                        res = normalize(m.group(1))
                        if res:
                            print(res)
                            sys.exit(0)
        except Exception:
            pass
' 2>/dev/null || true
}

resolve_skill_path() {
  local search_dirs=(
    "$PWD/.agents/skills/review-plan-basic/SKILL.md"
    "$HOME/.agents/skills/review-plan-basic/SKILL.md"
    "$HOME/.gemini/skills/review-plan-basic/SKILL.md"
    "$HOME/.gemini/antigravity-cli/builtin/skills/review-plan-basic/SKILL.md"
  )

  for candidate in "${search_dirs[@]}"; do
    if [ -f "$candidate" ]; then
      realpath "$candidate"
      return 0
    fi
  done

  echo ""
  return 1
}

# Parse Arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--artifact)
      ARTIFACT_RAW="$2"
      shift 2
      ;;
    -M|--model)
      MODEL="$2"
      shift 2
      ;;
    -t|--timeout)
      TIMEOUT_MS="$2"
      shift 2
      ;;
    -d|--delay)
      PROMPT_DELAY="$2"
      shift 2
      ;;
    --brain-dir)
      BRAIN_DIR="$2"
      shift 2
      ;;
    --session-id)
      SESSION_ID="$2"
      shift 2
      ;;
    --list-artifacts)
      LIST_ARTIFACTS="true"
      shift
      ;;
    --cwd)
      CWD="$2"
      shift 2
      ;;
    --no-focus)
      FOCUS="false"
      shift
      ;;
    --json)
      JSON_OUTPUT="true"
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Error: Unknown option '$1'" >&2
      show_help
      exit 1
      ;;
  esac
done

if [ "$LIST_ARTIFACTS" = "true" ]; then
  list_session_artifacts
  exit 0
fi

# Verification of prerequisites
if [ "${HERDR_ENV:-0}" -ne 1 ]; then
  echo '{"error": "Not running inside Herdr environment (HERDR_ENV != 1). Please use in-session subagent runner instead."}' >&2
  exit 1
fi

if [ -z "$ARTIFACT_RAW" ]; then
  echo '{"error": "Missing required argument --artifact"}' >&2
  exit 1
fi

# Resolve Target Artifact Path
RESOLVED_ARTIFACT=""
if [ -f "$ARTIFACT_RAW" ]; then
  RESOLVED_ARTIFACT=$(realpath "$ARTIFACT_RAW")
elif [ -f "$CWD/$ARTIFACT_RAW" ]; then
  RESOLVED_ARTIFACT=$(realpath "$CWD/$ARTIFACT_RAW")
else
  B_DIR=$(find_brain_dir)
  if [ -n "$B_DIR" ] && [ -f "$B_DIR/$ARTIFACT_RAW" ]; then
    RESOLVED_ARTIFACT=$(realpath "$B_DIR/$ARTIFACT_RAW")
  else
    FIND_MATCH=$(find ~/.gemini/antigravity-cli/brain -name "$ARTIFACT_RAW" -type f 2>/dev/null | head -n 1 || true)
    if [ -n "$FIND_MATCH" ]; then
      RESOLVED_ARTIFACT=$(realpath "$FIND_MATCH")
    else
      echo "{\"error\": \"Could not resolve artifact '$ARTIFACT_RAW' on disk.\"}" >&2
      exit 1
    fi
  fi
fi

# Resolve review-plan-basic Skill
RESOLVED_SKILL=$(resolve_skill_path || true)
if [ -z "$RESOLVED_SKILL" ]; then
  echo '{"error": "Could not locate review-plan-basic/SKILL.md in workspace or user directories."}' >&2
  exit 1
fi

# Determine Model
if [ -z "$MODEL" ]; then
  MODEL=$(detect_current_model)
  if [ -z "$MODEL" ]; then
    MODEL="gemini-3.7-flash-high"
  fi
fi

# Resolve Workspace ID
WORKSPACE_ID="${HERDR_WORKSPACE_ID:-}"
if [ -z "$WORKSPACE_ID" ]; then
  PANE_CURR=$(herdr pane current --current 2>/dev/null || true)
  WORKSPACE_ID=$(echo "$PANE_CURR" | jq -r '.result.pane.workspace_id // "w1"')
fi

# Create Tab
FOCUS_FLAG="--focus"
if [ "$FOCUS" = "false" ]; then
  FOCUS_FLAG="--no-focus"
fi

TAB_JSON=$(herdr tab create --workspace "$WORKSPACE_ID" --cwd "$CWD" "$FOCUS_FLAG")
TAB_ID=$(echo "$TAB_JSON" | jq -r '.result.tab.tab_id')
PANE_ID=$(echo "$TAB_JSON" | jq -r '.result.root_pane.pane_id')

if [ -z "$PANE_ID" ] || [ "$PANE_ID" = "null" ]; then
  echo '{"error": "Failed to create tab or obtain pane_id from Herdr"}' >&2
  exit 1
fi

# Count active open tabs and rename new tab strictly to open count
OPEN_TABS_JSON=$(herdr tab list --workspace "$WORKSPACE_ID" 2>/dev/null || true)
OPEN_TAB_COUNT=$(echo "$OPEN_TABS_JSON" | jq -r '.result.tabs | length // 1')
LABEL="$OPEN_TAB_COUNT"

herdr tab rename "$TAB_ID" "$LABEL" >/dev/null 2>&1 || true

# Generate Agent Name
RAND_SUFFIX=$(head /dev/urandom | tr -dc 'a-z0-9' | head -c 4)
AGENT_NAME="plan-review-${RAND_SUFFIX}"

# Start Agent
MAX_RETRIES=10
RETRY_COUNT=0
READY=false
START_RES=""

AGENT_START_ARGS=("--mode" "plan" "--model" "$MODEL")

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  sleep 0.5
  START_RES=$(herdr agent start "$AGENT_NAME" --kind "agy" --pane "$PANE_ID" --timeout 15000 -- "${AGENT_START_ARGS[@]}" 2>&1 || true)
  if echo "$START_RES" | grep -Eq '"type"\s*:\s*"agent_started"'; then
    READY=true
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ "$READY" = "false" ]; then
  echo "{\"error\": \"Failed to start agent '$AGENT_NAME' in pane '$PANE_ID': $START_RES\"}" >&2
  exit 1
fi

# Account verification / readiness settling delay
if [ "$PROMPT_DELAY" -gt 0 ]; then
  sleep "$PROMPT_DELAY"
fi

# Set Unique Output File for File-First Protocol
OUTPUT_FILE="/tmp/plan_review_$(date +%s)_${RAND_SUFFIX}.md"

PROMPT_CONTENT="# Plan Review Task

You have been spawned to perform a rigorous, critical review of an implementation plan artifact.

## Operational Mode
Mode: **PLAN**
Operating in PLAN mode.

## Target Skill
Skill: **\`/review-plan-basic\`**
File: [\`${RESOLVED_SKILL}\`](file://${RESOLVED_SKILL})

**Mandatory Instructions:**
1. You MUST read the skill instructions file at \`${RESOLVED_SKILL}\` using your file viewing tool.
2. Read and critically evaluate the target plan artifact at:
   [\`${RESOLVED_ARTIFACT}\`](file://${RESOLVED_ARTIFACT})
3. Perform a thorough review examining:
   - Architecture & modularity
   - Invariants & edge cases
   - Missing test vectors & verification steps
   - Potential failure modes or security risks
   - Clean code & Fowler code smells
4. **CRITICAL OUTPUT REQUIREMENT:**
   Write your complete, un-truncated, structured markdown review report directly to the file:
   \`${OUTPUT_FILE}\`
   AND summarize your key findings in your chat response.
"

# Submit Prompt
herdr agent prompt "$AGENT_NAME" "$PROMPT_CONTENT" >/dev/null 2>&1 || true

# Wait for Agent Completion
WAIT_RES=$(herdr agent wait "$AGENT_NAME" --timeout "$TIMEOUT_MS" 2>&1 || true)

# Retrieve Review Findings (File-First with Terminal Fallback)
REVIEW_REPORT=""
OUTPUT_SOURCE="file"

if [ -s "$OUTPUT_FILE" ]; then
  REVIEW_REPORT=$(cat "$OUTPUT_FILE")
else
  OUTPUT_SOURCE="terminal_fallback"
  # Read recent unwrapped lines from agent pane and strip ANSI escape codes
  RAW_READ=$(herdr agent read "$AGENT_NAME" --source recent-unwrapped --lines 500 2>/dev/null || true)
  REVIEW_REPORT=$(python3 -c '
import sys, re
raw = sys.stdin.read()
# Strip ANSI escape codes
clean = re.sub(r"\x1B\[[0-9;]*[a-zA-Z]", "", raw)
print(clean.strip())
' <<< "$RAW_READ")
fi

# Output JSON or Formatted Output
python3 -c '
import json, sys

tab_id = sys.argv[1]
open_tabs_count = sys.argv[2]
pane_id = sys.argv[3]
agent_name = sys.argv[4]
model = sys.argv[5]
artifact_path = sys.argv[6]
output_source = sys.argv[7]
output_file = sys.argv[8]
review_report = sys.argv[9]
is_json = sys.argv[10] == "true"

res = {
    "status": "success",
    "tab_id": tab_id,
    "open_tabs_count": open_tabs_count,
    "pane_id": pane_id,
    "agent_name": agent_name,
    "model": model,
    "artifact_path": artifact_path,
    "output_source": output_source,
    "output_file": output_file,
    "review_report": review_report
}

if is_json:
    print(json.dumps(res, indent=2))
else:
    print(json.dumps(res))
' "$TAB_ID" "$OPEN_TAB_COUNT" "$PANE_ID" "$AGENT_NAME" "$MODEL" "$RESOLVED_ARTIFACT" "$OUTPUT_SOURCE" "$OUTPUT_FILE" "$REVIEW_REPORT" "$JSON_OUTPUT"
