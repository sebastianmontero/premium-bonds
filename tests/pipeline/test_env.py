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


if __name__ == "__main__":
    unittest.main()
