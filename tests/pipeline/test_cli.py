"""Subprocess CLI tests for the pipeline entry point."""

import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest


class TestPipelineCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.mock_bin = self.root / "bin"
        self.mock_bin.mkdir(parents=True, exist_ok=True)
        self.orig_path = os.environ.get("PATH", "")
        self.control_dir = Path(__file__).resolve().parents[2] / ".agents" / "scripts" / "pipeline"

    def tearDown(self):
        os.environ["PATH"] = self.orig_path
        self.tmp.cleanup()

    def _create_mock_gh(self, script_body: str) -> Path:
        p = self.mock_bin / "gh"
        p.write_text(f"#!/usr/bin/env bash\n{script_body}\n", encoding="utf-8")
        p.chmod(p.stat().st_mode | stat.S_IEXEC)
        return p

    def test_cli_help(self):
        cmd = [sys.executable, str(self.control_dir), "--help"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn("Premium Bonds Pipeline Reconciler", res.stdout)
        self.assertIn("setup", res.stdout)
        self.assertIn("tick", res.stdout)

    def test_dry_run_against_read_only_gh_stub(self):
        # Stub gh on PATH that allows reads and exits non-zero on any mutating subcommands
        self._create_mock_gh("""
        cmd="$*"
        if [[ "$1" == "api" && "$2" == "user" ]]; then
            echo "pipeline-bot"
            exit 0
        fi
        if [[ "$1" == "repo" && "$2" == "view" ]]; then
            echo '{"owner": {"login": "owner"}, "name": "repo"}'
            exit 0
        fi
        if [[ "$1" == "issue" && "$2" == "list" ]]; then
            echo '[{"number": 1, "title": "Test Issue", "body": "Ready", "labels": [{"name": "agent:auto"}, {"name": "ready-for-agent"}], "assignees": [], "comments": []}]'
            exit 0
        fi
        if [[ "$1" == "pr" && "$2" == "list" ]]; then
            echo '[]'
            exit 0
        fi
        if [[ "$1" == "api" && "$2" == "graphql"* ]]; then
            echo '{"data": {"repository": {"issue": {"editor": null}}}}'
            exit 0
        fi
        if [[ "$1" == "api" && "$2" == "repos/"* ]]; then
            echo '{}'
            exit 0
        fi

        # Mutating commands: fail immediately
        if [[ "$1" == "issue" && ("$2" == "comment" || "$2" == "edit") ]]; then
            echo "Error: Mutating command attempted: $cmd" >&2
            exit 99
        fi
        if [[ "$1" == "pr" && ("$2" == "comment" || "$2" == "edit" || "$2" == "create" || "$2" == "merge") ]]; then
            echo "Error: Mutating command attempted: $cmd" >&2
            exit 99
        fi
        exit 0
        """)

        env = dict(os.environ)
        env["PATH"] = f"{self.mock_bin}:{self.orig_path}"
        env["PIPELINE_STATE_DIR"] = str(self.root / "state")

        cmd = [sys.executable, str(self.control_dir), "tick", "--dry-run"]
        res = subprocess.run(cmd, capture_output=True, text=True, env=env)
        self.assertEqual(res.returncode, 0, f"Dry-run failed: {res.stderr}\n{res.stdout}")
        self.assertIn("Dry-run completed", res.stdout)
        self.assertNotIn("Error: Mutating command attempted", res.stderr)


if __name__ == "__main__":
    unittest.main()
