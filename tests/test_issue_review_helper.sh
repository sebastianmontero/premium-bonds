#!/usr/bin/env bash
# tests/test_issue_review_helper.sh
# Comprehensive test suite for .agents/scripts/issue_review_helper.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="${SCRIPT_DIR}/.agents/scripts/issue_review_helper.sh"

TMP_DIR="$(mktemp -d /tmp/issue_review_test_XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "=== Running issue_review_helper.sh test suite ==="

# Test 1: --generate-review-id
echo -n "Test 1: --generate-review-id format ... "
REV_ID="$("$HELPER" --generate-review-id 42)"
if [[ ! "$REV_ID" =~ ^rev-[0-9]{8}-42-[0-9a-f]{4}$ ]]; then
  echo "FAILED: Review ID '$REV_ID' did not match expected regex"
  exit 1
fi

REV_ID_HASH="$("$HELPER" --generate-review-id "#100")"
if [[ ! "$REV_ID_HASH" =~ ^rev-[0-9]{8}-100-[0-9a-f]{4}$ ]]; then
  echo "FAILED: Review ID with hash '$REV_ID_HASH' did not match expected regex"
  exit 1
fi
echo "PASSED"

# Test 2: --parse-reviews (extraction of metadata, checklist items, and existing ledger)
echo -n "Test 2: --parse-reviews JSON extraction and state mapping ... "
cat << 'EOF' > "$TMP_DIR/mock_issue.json"
{
  "number": 42,
  "title": "Implement Ticket Registry Reallocation",
  "body": "## Overview\nWe need to optimize ticket storage.\n\n<!-- issue-review-ledger: [\n  {\n    \"review_id\": \"rev-20261014-42-0001\",\n    \"comment_id\": 1001,\n    \"integrated_at\": \"2026-10-14T12:00:00Z\",\n    \"model\": \"claude-3-7-sonnet\",\n    \"applied\": [\"OLD-1\"],\n    \"declined\": [{\"id\": \"OLD-2\", \"reason\": \"Out of scope\"}]\n  }\n] -->",
  "updatedAt": "2026-10-15T10:00:00Z",
  "comments": [
    {
      "id": 1001,
      "author": {"login": "ai-reviewer"},
      "body": "<!-- ai-issue-review: {\"version\":\"1.0\",\"review_id\":\"rev-20261014-42-0001\",\"issue_number\":42,\"model\":\"claude-3-7-sonnet\",\"agents\":[\"solution-critic\"],\"agent_models\":{\"solution-critic\":\"claude-3-7-sonnet\"},\"timestamp\":\"2026-10-14T11:00:00Z\",\"status\":\"pending\"} -->\n### Checklist\n- [x] **[OLD-1]**: Implement baseline storage\n- [ ] **[OLD-2]**: Use deprecated zero-copy"
    },
    {
      "id": 1002,
      "author": {"login": "ai-reviewer"},
      "body": "<!-- ai-issue-review: {\"version\":\"1.0\",\"review_id\":\"rev-20261015-42-a1b2\",\"issue_number\":42,\"model\":\"gemini-3.8-flash-high\",\"agents\":[\"solution-critic\",\"contract-plan-reviewer\"],\"agent_models\":{\"solution-critic\":\"gemini-3.8-flash-high\",\"contract-plan-reviewer\":\"gemini-3.8-flash-high\"},\"timestamp\":\"2026-10-15T09:30:00Z\",\"status\":\"pending\"} -->\n## Assessment\nActionable findings:\n- [ ] **[ARCH-1]**: Refactor account reallocation to header-only dynamic sizing\n- [ ] **[SEC-1]**: Enforce canonical bump validation on vault authority PDA\n- [ ] **[OPT-1]**: Use zero-copy array"
    }
  ]
}
EOF

PARSE_OUT="$TMP_DIR/parse_out.json"
"$HELPER" --parse-reviews --file "$TMP_DIR/mock_issue.json" > "$PARSE_OUT"

# Verify parsed fields
APPLIED_COUNT="$(jq '.applied_keys | length' "$PARSE_OUT")"
DECLINED_COUNT="$(jq '.declined_keys | length' "$PARSE_OUT")"
REVIEWS_COUNT="$(jq '.reviews | length' "$PARSE_OUT")"
PENDING_COUNT="$(jq '.pending_items | length' "$PARSE_OUT")"

if [[ "$APPLIED_COUNT" -ne 1 || "$DECLINED_COUNT" -ne 1 || "$REVIEWS_COUNT" -ne 2 || "$PENDING_COUNT" -ne 3 ]]; then
  echo "FAILED: Unexpected counts: applied=$APPLIED_COUNT, declined=$DECLINED_COUNT, reviews=$REVIEWS_COUNT, pending=$PENDING_COUNT"
  cat "$PARSE_OUT"
  exit 1
fi

REV1_STATUS="$(jq -r '.reviews[] | select(.review_id=="rev-20261014-42-0001") | .status' "$PARSE_OUT")"
REV2_STATUS="$(jq -r '.reviews[] | select(.review_id=="rev-20261015-42-a1b2") | .status' "$PARSE_OUT")"

if [[ "$REV1_STATUS" != "integrated" || "$REV2_STATUS" != "pending" ]]; then
  echo "FAILED: Review status mismatch: rev1=$REV1_STATUS (expected integrated), rev2=$REV2_STATUS (expected pending)"
  exit 1
fi

REV2_MODEL="$(jq -r '.reviews[] | select(.review_id=="rev-20261015-42-a1b2") | .model' "$PARSE_OUT")"
REV2_SUBMODEL="$(jq -r '.reviews[] | select(.review_id=="rev-20261015-42-a1b2") | .agent_models."contract-plan-reviewer"' "$PARSE_OUT")"

if [[ "$REV2_MODEL" != "gemini-3.8-flash-high" || "$REV2_SUBMODEL" != "gemini-3.8-flash-high" ]]; then
  echo "FAILED: Model extraction mismatch: model=$REV2_MODEL, submodel=$REV2_SUBMODEL"
  exit 1
fi
echo "PASSED"

# Test 3: --append-ledger appending and idempotency
echo -n "Test 3: --append-ledger appending new review ... "
cat << 'EOF' > "$TMP_DIR/input_body.md"
# Feature Proposal
Description of the feature.

<!-- issue-review-ledger: [
  {
    "review_id": "rev-20261014-42-0001",
    "comment_id": 1001,
    "integrated_at": "2026-10-14T12:00:00Z",
    "applied": ["OLD-1"],
    "declined": [{"id": "OLD-2", "reason": "Out of scope"}]
  }
] -->
EOF

OUTPUT_BODY="$TMP_DIR/output_body.md"
"$HELPER" --append-ledger \
  --issue 42 \
  --review-id "rev-20261015-42-a1b2" \
  --comment-id 1002 \
  --model "gemini-3.8-flash-high" \
  --applied '["ARCH-1", "SEC-1"]' \
  --declined '[{"id": "OPT-1", "reason": "Dynamic reallocation preferred per ADR-002"}]' \
  --input-body-file "$TMP_DIR/input_body.md" \
  --output-body-file "$OUTPUT_BODY" \
  --integrated-at "2026-10-15T13:00:00Z" >/dev/null

# Verify ledger in output file has 2 entries
cat << 'EOF' > "$TMP_DIR/verify_issue.json"
{
  "number": 42,
  "body": "",
  "comments": []
}
EOF
jq --rawfile b "$OUTPUT_BODY" '.body = $b' "$TMP_DIR/verify_issue.json" > "$TMP_DIR/verify_issue_populated.json"
"$HELPER" --parse-reviews --file "$TMP_DIR/verify_issue_populated.json" > "$TMP_DIR/parse_after_append.json"

ENTRY_COUNT="$(jq '.ledger | length' "$TMP_DIR/parse_after_append.json")"
if [[ "$ENTRY_COUNT" -ne 2 ]]; then
  echo "FAILED: Expected 2 ledger entries, got $ENTRY_COUNT"
  exit 1
fi

ENTRY_MODEL="$(jq -r '.ledger[] | select(.review_id=="rev-20261015-42-a1b2") | .model' "$TMP_DIR/parse_after_append.json")"
if [[ "$ENTRY_MODEL" != "gemini-3.8-flash-high" ]]; then
  echo "FAILED: Expected model gemini-3.8-flash-high in ledger, got $ENTRY_MODEL"
  exit 1
fi

# Test idempotency (updating existing review_id)
"$HELPER" --append-ledger \
  --issue 42 \
  --review-id "rev-20261015-42-a1b2" \
  --comment-id 1002 \
  --model "gemini-3.8-flash-high" \
  --applied '["ARCH-1", "SEC-1", "OPT-1"]' \
  --declined '[]' \
  --input-body-file "$OUTPUT_BODY" \
  --output-body-file "$TMP_DIR/output_body_idempotent.md" \
  --integrated-at "2026-10-15T14:00:00Z" >/dev/null

jq --rawfile b "$TMP_DIR/output_body_idempotent.md" '.body = $b' "$TMP_DIR/verify_issue.json" > "$TMP_DIR/verify_idempotent.json"
"$HELPER" --parse-reviews --file "$TMP_DIR/verify_idempotent.json" > "$TMP_DIR/parse_idempotent.json"

ENTRY_COUNT_IDEMPOTENT="$(jq '.ledger | length' "$TMP_DIR/parse_idempotent.json")"
if [[ "$ENTRY_COUNT_IDEMPOTENT" -ne 2 ]]; then
  echo "FAILED: Idempotent append created duplicate entry: got $ENTRY_COUNT_IDEMPOTENT"
  exit 1
fi
echo "PASSED"

# Test 4: --append-ledger on fresh body without existing ledger
echo -n "Test 4: --append-ledger on fresh issue body ... "
cat << 'EOF' > "$TMP_DIR/fresh_body.md"
# Fresh Issue
No existing ledger comments here.
EOF

FRESH_OUT="$TMP_DIR/fresh_out.md"
"$HELPER" --append-ledger \
  --issue 99 \
  --review-id "rev-20261015-99-fresh" \
  --comment-id 9999 \
  --applied '["FEAT-1"]' \
  --declined '[]' \
  --input-body-file "$TMP_DIR/fresh_body.md" \
  --output-body-file "$FRESH_OUT" >/dev/null

if ! grep -q "<!-- issue-review-ledger:" "$FRESH_OUT"; then
  echo "FAILED: Ledger block not appended to fresh body"
  exit 1
fi
echo "PASSED"

# Test 5: Character limit guardrail (>= 65,000 characters)
echo -n "Test 5: Character limit guardrail (<65,000 chars) ... "
python3 -c '
with open("'"$TMP_DIR"'/oversized_body.md", "w") as f:
    f.write("# Huge Issue\n" + ("x" * 65010))
'
set +e
"$HELPER" --append-ledger \
  --issue 100 \
  --review-id "rev-huge" \
  --comment-id 5555 \
  --applied '[]' \
  --declined '[]' \
  --input-body-file "$TMP_DIR/oversized_body.md" \
  --output-body-file "$TMP_DIR/oversized_out.md" 2>"$TMP_DIR/oversized_err.txt"
OVERSIZED_EXIT=$?
set -e

if [[ "$OVERSIZED_EXIT" -eq 0 ]]; then
  echo "FAILED: Expected oversized body to be rejected, but it succeeded"
  exit 1
fi

if ! grep -q "exceeds GitHub 65,000 character limit" "$TMP_DIR/oversized_err.txt"; then
  echo "FAILED: Error message did not mention character limit"
  cat "$TMP_DIR/oversized_err.txt"
  exit 1
fi
echo "PASSED"

# Test 6: --check-drift with mocked gh
echo -n "Test 6: --check-drift verification ... "
MOCK_BIN="$TMP_DIR/bin"
mkdir -p "$MOCK_BIN"
cat << 'EOF' > "$MOCK_BIN/gh"
#!/usr/bin/env bash
if [[ "$*" =~ issue\ view.*updatedAt ]]; then
  echo "2026-10-15T12:00:00Z"
  exit 0
fi
exit 1
EOF
chmod +x "$MOCK_BIN/gh"

PATH="$MOCK_BIN:$PATH" "$HELPER" --check-drift 42 "2026-10-15T12:00:00Z" >/dev/null

set +e
PATH="$MOCK_BIN:$PATH" "$HELPER" --check-drift 42 "2026-10-15T11:00:00Z" 2>"$TMP_DIR/drift_err.txt"
DRIFT_EXIT=$?
set -e

if [[ "$DRIFT_EXIT" -eq 0 ]]; then
  echo "FAILED: Expected drift mismatch to return non-zero exit code"
  exit 1
fi
if ! grep -q "Remote drift detected" "$TMP_DIR/drift_err.txt"; then
  echo "FAILED: Error output did not mention remote drift"
  cat "$TMP_DIR/drift_err.txt"
  exit 1
fi
echo "PASSED"

# Test 7: --patch-comment graceful fallback on error (e.g. 403 Forbidden)
echo -n "Test 7: --patch-comment graceful fallback on 403 ... "
cat << 'EOF' > "$MOCK_BIN/gh"
#!/usr/bin/env bash
if [[ "$*" =~ api\ --method\ PATCH ]]; then
  echo "HTTP 403: Resource not accessible by personal access token" >&2
  exit 1
fi
exit 0
EOF

echo "Mock comment body" > "$TMP_DIR/patch_body.md"

set +e
PATH="$MOCK_BIN:$PATH" "$HELPER" --patch-comment 1234 "$TMP_DIR/patch_body.md" 2>"$TMP_DIR/patch_warn.txt"
PATCH_EXIT=$?
set -e

if [[ "$PATCH_EXIT" -ne 0 ]]; then
  echo "FAILED: Expected patch error to gracefully exit with 0"
  exit 1
fi

if ! grep -q "Warning: Could not patch review comment" "$TMP_DIR/patch_warn.txt"; then
  echo "FAILED: Expected warning about patch error in stderr"
  cat "$TMP_DIR/patch_warn.txt"
  exit 1
fi
echo "PASSED"

# Test 8: Backward compatibility without --model
echo -n "Test 8: Backward compatibility without --model ... "
cat << 'EOF' > "$TMP_DIR/legacy_body.md"
# Legacy Issue
<!-- issue-review-ledger: [
  {
    "review_id": "rev-legacy-01",
    "comment_id": 999,
    "integrated_at": "2026-10-10T10:00:00Z",
    "applied": ["LEGACY-1"],
    "declined": []
  }
] -->
EOF

"$HELPER" --append-ledger \
  --issue 77 \
  --review-id "rev-auto-model" \
  --comment-id 888 \
  --applied '["AUTO-1"]' \
  --declined '[]' \
  --input-body-file "$TMP_DIR/legacy_body.md" \
  --output-body-file "$TMP_DIR/legacy_out.md" >/dev/null

cat << 'EOF' > "$TMP_DIR/verify_legacy.json"
{
  "number": 77,
  "body": "",
  "comments": []
}
EOF
jq --rawfile b "$TMP_DIR/legacy_out.md" '.body = $b' "$TMP_DIR/verify_legacy.json" > "$TMP_DIR/verify_legacy_populated.json"
"$HELPER" --parse-reviews --file "$TMP_DIR/verify_legacy_populated.json" > "$TMP_DIR/parse_legacy.json"

LEGACY_ENTRY_COUNT="$(jq '.ledger | length' "$TMP_DIR/parse_legacy.json")"
if [[ "$LEGACY_ENTRY_COUNT" -ne 2 ]]; then
  echo "FAILED: Expected 2 ledger entries in legacy test, got $LEGACY_ENTRY_COUNT"
  exit 1
fi
AUTO_MODEL="$(jq -r '.ledger[] | select(.review_id=="rev-auto-model") | .model' "$TMP_DIR/parse_legacy.json")"
if [[ -z "$AUTO_MODEL" || "$AUTO_MODEL" == "null" ]]; then
  echo "FAILED: Auto-resolved model was empty or null in ledger: $AUTO_MODEL"
  exit 1
fi
echo "PASSED"

# Test 9: Manual review fallback requires an "Issue Review" heading (no false positives)
echo -n "Test 9: Manual review detection ignores non-review comments ... "
cat << 'EOF' > "$TMP_DIR/manual_detect.json"
{
  "number": 23,
  "title": "Manual review detection",
  "body": "## Overview",
  "updatedAt": "2026-10-16T10:00:00Z",
  "comments": [
    {
      "id": 3001,
      "author": {"login": "maintainer"},
      "body": "# Issue Review\n- [ ] **[MAN-1]**: Manual finding"
    },
    {
      "id": 3002,
      "author": {"login": "maintainer"},
      "body": "## 🔍 AI Issue Review\n- [ ] **[MAN-2]**: Heading without metadata"
    },
    {
      "id": 3003,
      "author": {"login": "maintainer"},
      "body": "### ✅ Integrated Review `rev-1`\n- [x] **[ARCH-5]**: Pool `worktrees/review-<slot>` *(Integrated)*"
    },
    {
      "id": 3004,
      "author": {"login": "maintainer"},
      "body": "Ran /review on this and see the # Issue Review notes.\n- [ ] **[NOPE-1]**: Inline mention only"
    },
    {
      "id": 3005,
      "author": {"login": "maintainer"},
      "body": "### Issue Reviewer notes\n- [ ] **[NOPE-2]**: Different word"
    }
  ]
}
EOF
"$HELPER" --parse-reviews --file "$TMP_DIR/manual_detect.json" > "$TMP_DIR/manual_detect_out.json"

DETECTED_IDS="$(jq -c '[.reviews[].comment_id]' "$TMP_DIR/manual_detect_out.json")"
PENDING_IDS="$(jq -c '[.pending_items[].id]' "$TMP_DIR/manual_detect_out.json")"
if [[ "$DETECTED_IDS" != "[3001,3002]" || "$PENDING_IDS" != '["MAN-1","MAN-2"]' ]]; then
  echo "FAILED: Expected reviews [3001,3002] and pending [MAN-1,MAN-2], got reviews=$DETECTED_IDS pending=$PENDING_IDS"
  exit 1
fi
echo "PASSED"

echo "=== All issue_review_helper.sh tests passed successfully! ==="
