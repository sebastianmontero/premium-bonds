"""Unit tests for pipeline store persistence, tagged codec, and atomic updates."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.model import (
    AttemptKind,
    BlockReason,
    CommentRef,
    Editor,
    Effort,
    Fingerprint,
    ImplementTarget,
    ImplAtDev,
    ImplAtPrHead,
    IntegrateTarget,
    IssueRef,
    Liveness,
    PipelineBlock,
    PrRef,
    ReviewId,
    ReviewSlot,
    ReviewTarget,
    ReviseTarget,
    RunId,
    StepSpec,
    VerificationId,
    VerifyTarget,
)
from pipeline.paths import PipelinePaths
from pipeline.state import (
    FinishedRun,
    HeadlessHandle,
    HerdrHandle,
    IssueLocalState,
    RunOutcome,
    RunRecord,
    StoreState,
    SystemdHandle,
)
from pipeline.store import (
    CorruptStoreError,
    TAGGED_DECODERS,
    decode_store_state,
    decode_tagged,
    encode_store_state,
    encode_tagged,
    load_store,
    save_store,
)


class TestStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.paths = PipelinePaths(root=Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_codec_tags_unique(self):
        # Assert one dispatch entry per concrete type and that no two types share a tag
        expected_types = {
            "review_target": ReviewTarget,
            "integrate_target": IntegrateTarget,
            "implement_target": ImplementTarget,
            "verify_target": VerifyTarget,
            "revise_target": ReviseTarget,
            "fingerprint": Fingerprint,
            "review_slot": ReviewSlot,
            "impl_at_dev": ImplAtDev,
            "impl_at_pr_head": ImplAtPrHead,
            "headless_handle": HeadlessHandle,
            "systemd_handle": SystemdHandle,
            "herdr_handle": HerdrHandle,
            "review_id": ReviewId,
            "verification_id": VerificationId,
            "pr_ref": PrRef,
            "editor": Editor,
            "pipeline_block": PipelineBlock,
        }
        self.assertEqual(set(TAGGED_DECODERS.keys()), set(expected_types.keys()))
        self.assertEqual(len(set(TAGGED_DECODERS.keys())), len(expected_types))

    def test_codec_roundtrip_all_types(self):
        cases = [
            ReviewTarget(round=1),
            IntegrateTarget(review_id=ReviewId("rev-1"), comment=CommentRef("IC_123")),
            ImplementTarget(),
            VerifyTarget(pr=PrRef(42), last_verification_cycle=1),
            ReviseTarget(pr=PrRef(42), last_verification_cycle=1),
            Fingerprint(kind=AttemptKind.REVIEW, key="1"),
            ReviewSlot(n=0),
            ImplAtDev(),
            ImplAtPrHead(head_ref="feat/issue-1-fix"),
            HeadlessHandle(),
            SystemdHandle(unit="pb-pipeline-run-1"),
            HerdrHandle(tab_id="tab-1"),
            ReviewId("rev-20261017-1"),
            VerificationId("ver-20261017-1-pr42-1"),
            PrRef(42),
            Editor("alice"),
            PipelineBlock(reason=BlockReason.DECISIONS_UNRESOLVED, ref=ReviewId("rev-1")),
            PipelineBlock(reason=BlockReason.CIRCUIT_BREAKER, ref=PrRef(101)),
            PipelineBlock(reason=BlockReason.SPEC_RETRIES_EXHAUSTED, ref=Fingerprint(AttemptKind.REVIEW, "1")),
        ]
        for obj in cases:
            encoded = encode_tagged(obj)
            decoded = decode_tagged(encoded)
            self.assertEqual(decoded, obj)

    def test_store_atomic_replace_same_filesystem(self):
        state = StoreState(version=1)
        with patch("tempfile.NamedTemporaryFile", wraps=tempfile.NamedTemporaryFile) as mock_tmp:
            save_store(self.paths, state)
            mock_tmp.assert_called_once()
            # Verify temporary file directory is state directory (same filesystem)
            _, kwargs = mock_tmp.call_args
            self.assertEqual(Path(kwargs["dir"]).resolve(), self.paths.state_json.parent.resolve())

        self.assertTrue(self.paths.state_json.exists())

    def test_schema_version_and_corruption_checks(self):
        self.paths.ensure_dirs()
        # Non-JSON content
        self.paths.state_json.write_text("not json content", encoding="utf-8")
        with self.assertRaises(CorruptStoreError):
            load_store(self.paths)

        # Wrong version
        self.paths.state_json.write_text('{"version": 2, "runs": {}}', encoding="utf-8")
        with self.assertRaises(CorruptStoreError):
            load_store(self.paths)

        # JSON not object
        self.paths.state_json.write_text('["version", 1]', encoding="utf-8")
        with self.assertRaises(CorruptStoreError):
            load_store(self.paths)

    def test_full_store_state_roundtrip(self):
        now = datetime(2026, 10, 17, 12, 0, 0, tzinfo=timezone.utc)
        record = RunRecord(
            run_id=RunId("run-1"),
            issue=IssueRef(42),
            target=ReviewTarget(round=1),
            spec=StepSpec(cli="claude", model="claude-opus-5-5", effort=Effort.HIGH),
            prompt="/issue-review 42",
            workspace=ReviewSlot(n=0),
            timeout=timedelta(minutes=45),
            started_at=now,
        )
        outcome = RunOutcome(
            exit_code=0,
            finished_at=now + timedelta(minutes=10),
            liveness=Liveness.EXITED,
        )
        finished = FinishedRun(record=record, outcome=outcome, handle=HerdrHandle("tab-1"))

        local_state = IssueLocalState(
            attempts={Fingerprint(AttemptKind.REVIEW, "1"): 1},
            last_detail={Fingerprint(AttemptKind.REVIEW, "1"): "Failed review check"},
            block=PipelineBlock(reason=BlockReason.DECISIONS_UNRESOLVED, ref=ReviewId("rev-1")),
            implement_attempted=True,
            abandoned_prs=frozenset([PrRef(101), PrRef(102)]),
        )

        state = StoreState(
            version=1,
            runs={RunId("run-1"): record},
            handles={RunId("run-1"): HerdrHandle("tab-1")},
            finished={RunId("run-1"): finished},
            issues={IssueRef(42): local_state},
        )

        save_store(self.paths, state)
        loaded = load_store(self.paths)

        self.assertEqual(loaded.version, 1)
        self.assertEqual(set(loaded.runs.keys()), {RunId("run-1")})
        self.assertEqual(loaded.runs[RunId("run-1")], record)
        self.assertEqual(loaded.handles[RunId("run-1")], HerdrHandle("tab-1"))
        self.assertEqual(loaded.finished[RunId("run-1")], finished)
        self.assertEqual(set(loaded.issues.keys()), {IssueRef(42)})
        self.assertEqual(loaded.issues[IssueRef(42)], local_state)
        self.assertEqual(loaded.issues[IssueRef(42)].abandoned_prs, frozenset([PrRef(101), PrRef(102)]))


if __name__ == "__main__":
    unittest.main()
