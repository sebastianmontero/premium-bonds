"""Unit tests for pipeline subprocess environment configuration."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.env import PIPELINE_ENV_OVERLAY, pipeline_env


class TestPipelineEnv(unittest.TestCase):
    def test_pipeline_env_overlay_exact_keys_and_values(self):
        expected = {
            "GIT_CONFIG_COUNT": "2",
            "GIT_CONFIG_KEY_0": "url.https://github.com/.insteadOf",
            "GIT_CONFIG_VALUE_0": "git@github.com:",
            "GIT_CONFIG_KEY_1": "credential.https://github.com.helper",
            "GIT_CONFIG_VALUE_1": "!gh auth git-credential",
            "GH_PROMPT_DISABLED": "1",
            "GIT_TERMINAL_PROMPT": "0",
            "NO_DNA": "1",
        }
        self.assertEqual(PIPELINE_ENV_OVERLAY, expected)

    def test_base_environment_preserved(self):
        base = {
            "PATH": "/usr/local/bin:/usr/bin",
            "HOME": "/home/developer",
            "USER": "developer",
            "CUSTOM_VAR": "hello_world",
        }
        res = pipeline_env(base)
        self.assertEqual(res["PATH"], "/usr/local/bin:/usr/bin")
        self.assertEqual(res["HOME"], "/home/developer")
        self.assertEqual(res["USER"], "developer")
        self.assertEqual(res["CUSTOM_VAR"], "hello_world")
        self.assertEqual(res["GIT_TERMINAL_PROMPT"], "0")
        self.assertEqual(res["NO_DNA"], "1")

    def test_extra_additions_applied(self):
        base = {"HOME": "/home/developer"}
        extra = {"PIPELINE_RUN_ID": "run-123", "GH_TRUSTED_AUTHOR": "bot-user"}
        res = pipeline_env(base, extra)
        self.assertEqual(res["PIPELINE_RUN_ID"], "run-123")
        self.assertEqual(res["GH_TRUSTED_AUTHOR"], "bot-user")
        self.assertEqual(res["HOME"], "/home/developer")

    def test_subprocess_call_sites_pass_pipeline_env(self):
        from unittest.mock import patch, MagicMock
        from pipeline.executor import LocalGitClient
        from pipeline.gh import GhClient
        from pipeline.snapshot import LocalHelperClient

        # 1. LocalHelperClient
        captured_env = None
        def mock_subprocess_run(cmd, **kwargs):
            nonlocal captured_env
            captured_env = kwargs.get("env")
            mock = MagicMock()
            mock.returncode = 0
            mock.stdout = ""
            mock.stderr = ""
            return mock

        with patch("subprocess.run", side_effect=mock_subprocess_run):
            helpers = LocalHelperClient(repo_root=Path("/fake/repo"))
            helpers.run_review_helper(["--help"])
            self.assertIsNotNone(captured_env)
            self.assertEqual(captured_env.get("GH_PROMPT_DISABLED"), "1")
            self.assertEqual(captured_env.get("GIT_TERMINAL_PROMPT"), "0")
            self.assertEqual(captured_env.get("NO_DNA"), "1")

            helpers.run_lifecycle_helper(["--help"])
            self.assertIsNotNone(captured_env)
            self.assertEqual(captured_env.get("GH_PROMPT_DISABLED"), "1")

        # 2. LocalGitClient
        with patch("subprocess.run", side_effect=mock_subprocess_run):
            git_client = LocalGitClient(repo_root="/fake/repo")
            git_client.run(["status"])
            self.assertIsNotNone(captured_env)
            self.assertEqual(captured_env.get("GIT_TERMINAL_PROMPT"), "0")
            self.assertEqual(captured_env.get("NO_DNA"), "1")

        # 3. GhClient
        with patch("subprocess.run", side_effect=mock_subprocess_run):
            gh_client = GhClient()
            gh_client.read(["api", "user"])
            self.assertIsNotNone(captured_env)
            self.assertEqual(captured_env.get("GH_PROMPT_DISABLED"), "1")
            self.assertEqual(captured_env.get("NO_DNA"), "1")


if __name__ == "__main__":
    unittest.main()
