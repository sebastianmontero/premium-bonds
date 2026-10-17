import sys
from datetime import datetime, timezone
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.model import (
    BlockReason,
    CommentRef,
    ExistingComment,
    Fingerprint,
    IssueRef,
    LaneBusy,
    LaneConflict,
    PipelineBlock,
    PrRef,
    ReviewCapReached,
    ReviewId,
    ReviewStatus,
    Stage,
    _ACTION_REQUIRED,
)
from pipeline.status_comment import needs_patch, render, strip_footer
from tests.pipeline.builders import (
    default_config,
    decision,
    issue,
    open_pr,
    review,
)

T1 = datetime(2026, 10, 17, 12, 0, 0, tzinfo=timezone.utc)
T2 = datetime(2026, 10, 17, 12, 10, 0, tzinfo=timezone.utc)


class TestStatusComment(unittest.TestCase):
    def setUp(self):
        self.config = default_config()

    def test_two_renders_different_times_differ_only_in_footer(self):
        snap = issue(number=1)
        r1 = render(snap, Stage.READY, None, None, None, self.config, T1)
        r2 = render(snap, Stage.READY, None, None, None, self.config, T2)

        self.assertNotEqual(r1, r2)
        self.assertEqual(strip_footer(r1), strip_footer(r2))

        existing = ExistingComment(ref=CommentRef("IC_1"), body=r1)
        self.assertFalse(needs_patch(existing, r2))

    def test_status_comment_crlf_does_not_trigger_patch(self):
        snap = issue(number=1)
        rendered = render(snap, Stage.READY, None, None, None, self.config, T1)
        crlf_body = rendered.replace("\n", "\r\n")

        existing = ExistingComment(ref=CommentRef("IC_1"), body=crlf_body)
        self.assertFalse(needs_patch(existing, rendered))

    def test_every_block_reason_renders_action_required(self):
        snap = issue(number=1)
        for reason in BlockReason:
            blk = PipelineBlock(reason=reason, ref=IssueRef(1))
            body = render(snap, Stage.BLOCKED_HUMAN, None, None, blk, self.config, T1)
            self.assertIn("**🛑 Action required:**", body)
            expected_snippet = _ACTION_REQUIRED[reason][:25]
            self.assertIn(expected_snippet, body)

    def test_blocking_tick_and_later_blocked_human_tick_render_identical_bodies(self):
        # E.g. breaker trip: on the trip tick, stage is BREAKER_TRIP, block is blk
        # on a later tick, stage is BLOCKED_HUMAN, block is blk
        pr = open_pr(number=101)
        snap = issue(number=1, pr=pr, labels=["agent:auto", "ready-for-human"])
        blk = PipelineBlock(reason=BlockReason.CIRCUIT_BREAKER, ref=PrRef(101))

        body_blocking = render(snap, Stage.BREAKER_TRIP, None, None, blk, self.config, T1)
        body_blocked_human = render(snap, Stage.BLOCKED_HUMAN, None, None, blk, self.config, T1)

        self.assertEqual(body_blocking, body_blocked_human)

    def test_every_queue_reason_renders(self):
        snap = issue(number=1)

        b1 = render(snap, Stage.READY, None, LaneBusy(IssueRef(17)), None, self.config, T1)
        self.assertIn("queued (lane busy: #17)", b1)

        b2 = render(snap, Stage.READY, None, LaneConflict(IssueRef(17)), None, self.config, T1)
        self.assertIn("queued (lane conflict: #17)", b2)

        b3 = render(snap, Stage.REVIEW, None, ReviewCapReached(2), None, self.config, T1)
        self.assertIn("queued (review cap reached: 2)", b3)


if __name__ == "__main__":
    unittest.main()
