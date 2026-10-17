"""Subprocess CLI tests for the pipeline entry point."""

import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

from pipeline.__main__ import REQUIRED_ALLOW_RULES, missing_settings_rules

REPO_ROOT = Path(__file__).resolve().parents[2]

# Read-only gh stub: an allowlist of read subcommands. Every other invocation is
# appended to $GH_MUTATIONS_LOG and exits 99, so any mutation attempt is detectable
# even when the caller swallows the child's stderr.
READ_ONLY_GH_STUB = r"""
log_mutation() { printf '%s\n' "$*" >> "$GH_MUTATIONS_LOG"; exit 99; }
case "$1 $2" in
  "api graphql")
    for a in "$@"; do [[ "$a" == query=mutation* ]] && log_mutation "$@"; done
    echo '{"data": {"repository": {"issue": {"editor": null}}}}'; exit 0 ;;
  "api user") echo "pipeline-bot"; exit 0 ;;
  "repo view") echo '{"owner": {"login": "owner"}, "name": "repo"}'; exit 0 ;;
  "issue list") cat "$GH_ISSUES_JSON"; exit 0 ;;
  "pr list") echo '[]'; exit 0 ;;
esac
if [[ "$1" == "api" ]]; then
  for a in "$@"; do
    case "$a" in -X|--method|-F|--field|-f|--raw-field|--input) log_mutation "$@" ;; esac
  done
  echo '{}'; exit 0
fi
log_mutation "$@"
"""

# An eligible issue that already carries a (stale) pipeline status comment, so the
# plan contains an UpsertStatusComment that would PATCH in place outside dry-run.
ISSUES_WITH_STATUS_COMMENT = """[{"number": 1, "title": "Test Issue", "body": "Ready",
  "labels": [{"name": "agent:auto"}, {"name": "ready-for-agent"}], "assignees": [],
  "comments": [{"id": "IC_status1", "author": {"login": "pipeline-bot"}, "authorAssociation": "OWNER",
    "body": "<!-- ai-pipeline-status: {\\"issue\\": 1} -->\\nstale status", "createdAt": "2026-10-17T12:00:00Z"}]}]"""


class TestPipelineCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.mock_bin = self.root / "bin"
        self.mock_bin.mkdir(parents=True, exist_ok=True)
        self.state_root = self.root / "xdg" / "premium-bonds-pipeline"
        self.control = self.state_root / "worktrees" / "control"
        self.checkout_pkg = REPO_ROOT / ".agents" / "scripts" / "pipeline"
        self.mutations_log = self.root / "mutations.log"
        self.env = dict(os.environ)
        self.env["PATH"] = f"{self.mock_bin}:{os.environ.get('PATH', '')}"
        self.env["XDG_STATE_HOME"] = str(self.root / "xdg")
        self.env["GH_MUTATIONS_LOG"] = str(self.mutations_log)

    def tearDown(self):
        self.tmp.cleanup()

    def _create_mock_bin(self, name: str, script_body: str) -> Path:
        p = self.mock_bin / name
        p.write_text(f"#!/usr/bin/env bash\n{script_body}\n", encoding="utf-8")
        p.chmod(p.stat().st_mode | stat.S_IEXEC)
        return p

    def _create_control_copy(self) -> None:
        """Stand in for worktrees/control with a copy of this checkout's .agents tree."""
        shutil.copytree(
            REPO_ROOT / ".agents",
            self.control / ".agents",
            ignore=shutil.ignore_patterns("__pycache__"),
        )

    def _run(self, *args: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
        cmd = [sys.executable, str(self.checkout_pkg), *args]
        return subprocess.run(cmd, capture_output=True, text=True, env=self.env, cwd=cwd)

    def test_cli_help(self):
        res = self._run("--help")
        self.assertEqual(res.returncode, 0)
        self.assertIn("Premium Bonds Pipeline Reconciler", res.stdout)
        self.assertIn("setup", res.stdout)
        self.assertIn("tick", res.stdout)

    def test_dry_run_against_read_only_gh_stub(self):
        self._create_control_copy()
        issues_json = self.root / "issues.json"
        issues_json.write_text(ISSUES_WITH_STATUS_COMMENT, encoding="utf-8")
        self.env["GH_ISSUES_JSON"] = str(issues_json)
        self._create_mock_bin("gh", READ_ONLY_GH_STUB)

        res = self._run("tick", "--dry-run")
        self.assertEqual(res.returncode, 0, f"Dry-run failed: {res.stderr}\n{res.stdout}")
        self.assertIn("Dry-run completed", res.stdout)
        self.assertIn("UpsertStatusComment", res.stdout)
        self.assertIn("IC_status1", res.stdout)
        self.assertFalse(
            self.mutations_log.exists(),
            f"gh mutations attempted in dry-run: {self.mutations_log.read_text() if self.mutations_log.exists() else ''}",
        )

    def test_tick_from_another_checkout_executes_control_copy(self):
        self._create_control_copy()
        issues_json = self.root / "issues.json"
        issues_json.write_text("[]", encoding="utf-8")
        self.env["GH_ISSUES_JSON"] = str(issues_json)
        self._create_mock_bin("gh", READ_ONLY_GH_STUB)

        res = self._run("tick", "--dry-run")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn(f"Redirecting to control worktree {self.control}", res.stderr)
        self.assertIn(f"Reconciler running from {self.control}", res.stderr)

    def test_tick_without_control_worktree_requires_setup(self):
        res = self._run("tick", "--dry-run")
        self.assertEqual(res.returncode, 1)
        self.assertIn("Run `python3 .agents/scripts/pipeline setup` first", res.stderr)

    def test_exec_from_cwd_outside_repo_loads_control_config(self):
        self._create_control_copy()
        outside = self.root / "elsewhere"
        outside.mkdir()

        res = self._run("exec", "run-1-missing", cwd=outside)
        self.assertNotIn("pipeline.toml not found", res.stderr)
        self.assertIn("RunRecord run-1-missing not found in store", res.stderr)
        self.assertEqual(res.returncode, 1)


class TestPreflightSettings(unittest.TestCase):
    def test_checked_in_settings_satisfy_headless_rules(self):
        settings = json.loads((REPO_ROOT / ".claude" / "settings.json").read_text(encoding="utf-8"))
        self.assertEqual(missing_settings_rules(settings), [])

    def test_missing_rules_are_listed(self):
        allow = [r for r in REQUIRED_ALLOW_RULES if r not in ("Bash(jq *)", "Bash(sha256sum *)")]
        missing = missing_settings_rules({"permissions": {"allow": allow, "deny": []}})
        self.assertEqual(
            missing,
            ["allow Bash(jq *)", "allow Bash(sha256sum *)", "deny Bash(git push --force*)"],
        )


if __name__ == "__main__":
    unittest.main()
