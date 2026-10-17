import sys
from datetime import timedelta
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.config import PipelineConfig, load_config
from pipeline.model import (
    CommentRef,
    Effort,
    ImplementTarget,
    IntegrateTarget,
    IssueRef,
    PrRef,
    ReviewId,
    ReviewTarget,
    ReviseTarget,
    Step,
    StepSpec,
    VerifyTarget,
    build_prompt,
)

VALID_TOML = """
eligible_label = "agent:auto"
skip_review_label = "agent:skip-review"
max_revision_cycles = 2
max_step_attempts = 2
runner = "auto"

reviews = [
  { cli = "agy",    model = "gemini-3.8-flash", effort = "high" },
  { cli = "claude", model = "claude-opus-5-5",  effort = "high" },
]
integrator = { cli = "claude", model = "claude-opus-5-5",  effort = "high" }
implement  = { cli = "agy",    model = "gemini-3.8-flash", effort = "medium" }
verify     = { cli = "claude", model = "claude-opus-5-5",  effort = "high" }
revise     = { cli = "agy",    model = "gemini-3.8-flash", effort = "medium" }

[concurrency]
review = 2

[timeouts_minutes]
review = 45
integrate = 30
implement = 120
verify = 60
revise = 90

[cli.agy]
extra_args = ["--mode", "auto"]
[cli.claude]
extra_args = ["--permission-mode", "auto"]
"""


class TestConfig(unittest.TestCase):
    def test_load_default_pipeline_toml(self):
        toml_path = Path(__file__).resolve().parents[2] / ".agents" / "pipeline.toml"
        self.assertTrue(toml_path.exists())
        config = load_config(toml_path.read_text(encoding="utf-8"))
        self.assertEqual(config.eligible_label, "agent:auto")
        self.assertEqual(config.skip_review_label, "agent:skip-review")
        self.assertEqual(len(config.reviews), 2)
        self.assertEqual(config.concurrency.review, 2)
        self.assertEqual(config.timeout_for(Step.REVIEW), timedelta(minutes=45))
        self.assertEqual(config.timeout_for(Step.INTEGRATE), timedelta(minutes=30))
        self.assertEqual(config.timeout_for(Step.IMPLEMENT), timedelta(minutes=120))
        self.assertEqual(config.timeout_for(Step.VERIFY), timedelta(minutes=60))
        self.assertEqual(config.timeout_for(Step.REVISE), timedelta(minutes=90))

    def test_fail_fast_empty_reviews(self):
        bad_toml = VALID_TOML.replace(
            "reviews = [\n  { cli = \"agy\",    model = \"gemini-3.8-flash\", effort = \"high\" },\n  { cli = \"claude\", model = \"claude-opus-5-5\",  effort = \"high\" },\n]",
            "reviews = []",
        )
        with self.assertRaises(ValueError):
            load_config(bad_toml)

    def test_fail_fast_unknown_cli(self):
        bad_toml = VALID_TOML.replace('cli = "agy"', 'cli = "unknown_cli"')
        with self.assertRaises(ValueError):
            load_config(bad_toml)

    def test_fail_fast_missing_model(self):
        bad_toml = VALID_TOML.replace('model = "gemini-3.8-flash"', 'model = ""')
        with self.assertRaises(ValueError):
            load_config(bad_toml)

    def test_fail_fast_invalid_effort(self):
        bad_toml = VALID_TOML.replace('effort = "high"', 'effort = "super_high"')
        with self.assertRaises(ValueError):
            load_config(bad_toml)

    def test_fail_fast_concurrency_review_below_one(self):
        bad_toml = VALID_TOML.replace("review = 2", "review = 0")
        with self.assertRaises(ValueError):
            load_config(bad_toml)

    def test_fail_fast_timeout_key_not_a_step(self):
        bad_toml = VALID_TOML.replace("review = 45", "non_step_timeout = 45")
        with self.assertRaises(ValueError):
            load_config(bad_toml)

    def test_fail_fast_missing_step_timeout(self):
        bad_toml = VALID_TOML.replace("revise = 90\n", "")
        with self.assertRaises(ValueError):
            load_config(bad_toml)

    def test_spec_for_review_targets(self):
        config = load_config(VALID_TOML)
        spec1 = config.spec_for(ReviewTarget(round=1))
        self.assertEqual(spec1, config.reviews[0])
        self.assertEqual(spec1.cli, "agy")
        self.assertEqual(spec1.model, "gemini-3.8-flash")

        spec2 = config.spec_for(ReviewTarget(round=2))
        self.assertEqual(spec2, config.reviews[1])
        self.assertEqual(spec2.cli, "claude")
        self.assertEqual(spec2.model, "claude-opus-5-5")

        with self.assertRaises(IndexError):
            config.spec_for(ReviewTarget(round=3))

    def test_spec_for_other_targets(self):
        config = load_config(VALID_TOML)
        int_spec = config.spec_for(IntegrateTarget(ReviewId("rev-1"), CommentRef("IC_1")))
        self.assertEqual(int_spec, config.integrator)

        impl_spec = config.spec_for(ImplementTarget())
        self.assertEqual(impl_spec, config.implement)

        v_spec = config.spec_for(VerifyTarget(PrRef(10), 0))
        self.assertEqual(v_spec, config.verify)

        r_spec = config.spec_for(ReviseTarget(PrRef(10), 0))
        self.assertEqual(r_spec, config.revise)

    def test_build_argv_exact(self):
        agy_spec = StepSpec(cli="agy", model="gemini-3.8-flash", effort=Effort.HIGH)
        agy_argv = agy_spec.build_argv("/prompt", ["--mode", "auto"])
        self.assertEqual(
            agy_argv,
            ["agy", "-p", "/prompt", "--model", "gemini-3.8-flash-high", "--output-format", "stream-json", "--mode", "auto"],
        )

        claude_spec = StepSpec(cli="claude", model="claude-opus-5-5", effort=Effort.HIGH)
        claude_argv = claude_spec.build_argv("/prompt", ["--permission-mode", "auto"])
        self.assertEqual(
            claude_argv,
            [
                "claude",
                "-p",
                "/prompt",
                "--model",
                "claude-opus-5-5",
                "--effort",
                "high",
                "--output-format",
                "stream-json",
                "--verbose",
                "--permission-mode",
                "auto",
            ],
        )

    def test_build_prompt_starts_with_slash(self):
        spec = StepSpec(cli="agy", model="gemini-3.8-flash", effort=Effort.MEDIUM)
        prompt = build_prompt(ImplementTarget(), IssueRef(42), spec, max_cycles=2)
        lines = prompt.splitlines()
        self.assertTrue(lines[0].startswith("/issue-implement 42"))
        self.assertIn("Unattended pipeline run:", prompt)


if __name__ == "__main__":
    unittest.main()
