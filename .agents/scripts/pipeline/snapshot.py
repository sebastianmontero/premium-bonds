"""Issue and PR state snapshot collection and helper boundary.

Enforces the boundary between external JSON/CLI representations and domain
types (wrapping numbers into IssueRef/PrRef and strings into ReviewId/VerificationId).
"""

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any, Protocol

from .config import PipelineConfig
from .gh import GhPort
from .model import (
    Comment,
    CommentOrigin,
    CommentRef,
    CustomAnswer,
    Decision,
    Editor,
    ExistingComment,
    FailedSnapshot,
    IssueDetails,
    IssueRef,
    IssueSnapshot,
    LinkedPr,
    Mergeable,
    MergedPr,
    ClosedPr,
    OpenPr,
    PipelineNotice,
    PrRef,
    Readiness,
    ReviewId,
    ReviewSnapshot,
    ReviewStatus,
    SelectedOption,
    Unresolved,
    UnresolvedReason,
    VerificationId,
)

logger = logging.getLogger(__name__)


class GlobalSnapshotError(Exception):
    """Raised when a global query fails and tick cannot safely proceed."""


class HelperPort(Protocol):
    def run_review_helper(self, args: Sequence[str]) -> str: ...
    def run_lifecycle_helper(self, args: Sequence[str]) -> str: ...


class LocalHelperClient:
    def __init__(self, repo_root: Path, base_env: dict[str, str] | None = None) -> None:
        self.repo_root = repo_root
        self.base_env = base_env

    def run_review_helper(self, args: Sequence[str]) -> str:
        script = self.repo_root / ".agents" / "scripts" / "issue_review_helper.sh"
        cmd = ["bash", str(script), *args]
        proc = subprocess.run(cmd, capture_output=True, text=True, env=self.base_env, check=False)
        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout, proc.stderr)
        return proc.stdout

    def run_lifecycle_helper(self, args: Sequence[str]) -> str:
        script = self.repo_root / ".agents" / "scripts" / "issue_lifecycle_helper.sh"
        cmd = ["bash", str(script), *args]
        proc = subprocess.run(cmd, capture_output=True, text=True, env=self.base_env, check=False)
        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout, proc.stderr)
        return proc.stdout


# --- Helper JSON Decoders (Ref Boundary) ---


def reviews_from_helper_json(data: dict[str, Any]) -> tuple[ReviewSnapshot, ...]:
    """Convert issue_review_helper --parse-reviews output to tuple of ReviewSnapshot."""
    out: list[ReviewSnapshot] = []
    for r in data.get("reviews", []):
        r_id = ReviewId(str(r["review_id"]))
        round_val = int(r["round"]) if r.get("round") is not None else None
        comment_ref = CommentRef(node_id=str(r.get("comment_id", "")))
        status_str = str(r.get("status", "pending")).upper()
        try:
            status = ReviewStatus(status_str)
        except ValueError:
            status = ReviewStatus.PENDING

        decisions: list[Decision] = []
        for d in r.get("decisions", []):
            d_id = str(d["id"])
            q = str(d.get("question", ""))
            opts = tuple(str(o.get("key", o) if isinstance(o, dict) else o) for o in d.get("options", []))

            if d.get("resolved"):
                if d.get("selected"):
                    res = SelectedOption(key=str(d["selected"]))
                elif d.get("custom_answer"):
                    res = CustomAnswer(text=str(d["custom_answer"]))
                else:
                    res = Unresolved(reason=UnresolvedReason.NO_SELECTION)
            else:
                reason_str = str(d.get("unresolved_reason", "")).upper()
                try:
                    reason_enum = UnresolvedReason(reason_str)
                except (ValueError, KeyError):
                    reason_enum = UnresolvedReason.NO_SELECTION
                res = Unresolved(reason=reason_enum)

            decisions.append(Decision(id=d_id, question=q, options=opts, resolution=res))

        checklist_keys = tuple(
            str(it["key"]) for it in r.get("checklist", []) if "key" in it
        )

        out.append(
            ReviewSnapshot(
                review_id=r_id,
                round=round_val,
                comment=comment_ref,
                status=status,
                decisions=tuple(decisions),
                checklist_keys=checklist_keys,
            )
        )
    return tuple(out)


def open_pr_from_helper_json(
    pr_view: dict[str, Any],
    readiness_data: dict[str, Any],
    verification_data: dict[str, Any],
) -> OpenPr:
    """Construct OpenPr from pr view, readiness, and verification helper JSONs."""
    pr_num = int(pr_view["number"])
    head_ref = str(pr_view.get("headRefName", ""))

    readiness = Readiness(str(readiness_data["status"]))
    raw_cycle = int(verification_data.get("cycle", 0))
    eff_cycle = int(readiness_data.get("effective_cycle", 0))

    v_id_str = verification_data.get("verification_id", "")
    verification_id = VerificationId(v_id_str) if v_id_str else None
    verdict = str(verification_data.get("verdict", ""))

    raw_mergeable = str(pr_view.get("mergeable", "UNKNOWN")).upper()
    try:
        mergeable = Mergeable(raw_mergeable)
    except ValueError:
        mergeable = Mergeable.UNKNOWN

    auto_merge = bool(pr_view.get("autoMergeRequest"))
    labels = [l.get("name") for l in pr_view.get("labels", []) if isinstance(l, dict)]
    has_rfh = "ready-for-human" in labels

    return OpenPr(
        pr=PrRef(pr_num),
        head_ref=head_ref,
        readiness=readiness,
        last_verification_cycle=raw_cycle,
        effective_cycle=eff_cycle,
        verification_id=verification_id,
        raw_verdict=verdict,
        mergeable=mergeable,
        auto_merge_enabled=auto_merge,
        has_ready_for_human_label=has_rfh,
    )


# --- Comment Classification ---


AI_MARKER_REGEX = re.compile(r"<!--\s*ai-")
AI_STATUS_REGEX = re.compile(r"<!--\s*ai-pipeline-status:\s*(\{.*?\})\s*-->")
AI_NOTICE_REGEX = re.compile(r"<!--\s*ai-pipeline-notice:\s*(\{.*?\})\s*-->")


def classify_comments(
    comments_raw: Sequence[dict[str, Any]],
    trusted_author: str,
    collaborators: set[str],
    issue_num: int,
) -> tuple[list[Comment], ExistingComment | None, tuple[PipelineNotice, ...]]:
    """Classify comments into MACHINE | HUMAN_INPUT | OTHER per #23 trust model."""
    comments: list[Comment] = []
    status_comment: ExistingComment | None = None
    notices: list[PipelineNotice] = []

    for c in comments_raw:
        c_id = str(c.get("id") or c.get("databaseId") or "")
        ref = CommentRef(node_id=c_id, database_id=c.get("databaseId"))
        author = (c.get("author") or {}).get("login", "")
        assoc = str(c.get("authorAssociation", "")).upper()
        body = c.get("body", "") or ""
        created_str = c.get("createdAt", "")
        try:
            created_at = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
        except Exception:
            created_at = datetime.now(timezone.utc)

        has_ai_marker = bool(AI_MARKER_REGEX.search(body))
        is_trusted = (author == trusted_author)
        is_collab = is_trusted or assoc in ("OWNER", "MEMBER", "COLLABORATOR") or author in collaborators

        # Determine origin
        if is_trusted and has_ai_marker:
            origin = CommentOrigin.MACHINE
        elif (not has_ai_marker) and is_collab:
            origin = CommentOrigin.HUMAN_INPUT
        else:
            origin = CommentOrigin.OTHER

        comments.append(
            Comment(
                ref=ref,
                author=author,
                association=assoc,
                created_at=created_at,
                body=body,
                origin=origin,
            )
        )

        # Process machine markers (only from trusted author)
        if origin is CommentOrigin.MACHINE:
            m_status = AI_STATUS_REGEX.search(body)
            if m_status:
                try:
                    s_data = json.loads(m_status.group(1))
                    if s_data.get("issue") == issue_num:
                        status_comment = ExistingComment(ref=ref, body=body)
                except Exception:
                    pass

            m_notice = AI_NOTICE_REGEX.search(body)
            if m_notice:
                try:
                    n_data = json.loads(m_notice.group(1))
                    kind = str(n_data.get("kind", ""))
                    r_id_str = n_data.get("review_id")
                    r_id = ReviewId(str(r_id_str)) if r_id_str else None
                    notices.append(
                        PipelineNotice(
                            kind=kind,
                            review_id=r_id,
                            created_at=created_at,
                        )
                    )
                except Exception:
                    pass

    return comments, status_comment, tuple(notices)


# --- Full Snapshot Orchestrator ---


class Snapshotter:
    def __init__(self, gh: GhPort, helpers: HelperPort) -> None:
        self.gh = gh
        self.helpers = helpers
        self._collab_cache: dict[str, bool] = {}

    def is_collaborator(self, owner: str, repo: str, login: str) -> bool:
        if not login:
            return False
        if login in self._collab_cache:
            return self._collab_cache[login]
        try:
            self.gh.read(["api", f"repos/{owner}/{repo}/collaborators/{login}"])
            self._collab_cache[login] = True
            return True
        except Exception:
            self._collab_cache[login] = False
            return False

    def get_repo_owner_name(self) -> tuple[str, str]:
        repo_json = self.gh.read(["repo", "view", "--json", "owner,name"])
        data = json.loads(repo_json)
        return data["owner"]["login"], data["name"]

    def snapshot(
        self,
        config: PipelineConfig,
        abandoned_prs_by_issue: Mapping[IssueRef, frozenset[PrRef]] | None = None,
    ) -> tuple[IssueSnapshot | FailedSnapshot, ...]:
        """Perform full snapshot pass across eligible issues."""
        abandoned_map = abandoned_prs_by_issue or {}

        # 1. Pipeline login
        try:
            login_out = self.gh.read(["api", "user", "-q", ".login"]).strip()
        except Exception as e:
            raise GlobalSnapshotError(f"Failed to query pipeline login: {e}") from e
        pipeline_login = login_out

        owner, repo = self.get_repo_owner_name()

        # 2. Issues query
        try:
            issues_out = self.gh.read([
                "issue", "list",
                "--label", config.eligible_label,
                "--state", "open",
                "--json", "number,title,body,labels,assignees,comments,updatedAt",
            ])
            issues_data = json.loads(issues_out)
        except Exception as e:
            raise GlobalSnapshotError(f"Failed to list issues with label {config.eligible_label}: {e}") from e

        # 3. Global PRs query (limit 200)
        try:
            prs_out = self.gh.read([
                "pr", "list",
                "--state", "all",
                "--base", "dev",
                "--limit", "200",
                "--json", "number,state,mergedAt,closedAt,headRefName,title,body,author,isCrossRepository,closingIssuesReferences",
            ])
            prs_data = json.loads(prs_out)
            if len(prs_data) >= 200:
                raise GlobalSnapshotError("PR list returned 200 rows (limit reached). Aborting tick.")
        except GlobalSnapshotError:
            raise
        except Exception as e:
            raise GlobalSnapshotError(f"Failed to list PRs: {e}") from e

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            prs_file = tmp_path / "prs.json"
            prs_file.write_text(json.dumps(prs_data), encoding="utf-8")

            snapshots: list[IssueSnapshot | FailedSnapshot] = []

            for raw_issue in issues_data:
                num = int(raw_issue["number"])
                issue_ref = IssueRef(num)
                labels = frozenset(l.get("name", "") for l in raw_issue.get("labels", []))

                try:
                    snap = self._snapshot_single_issue(
                        raw_issue=raw_issue,
                        issue_ref=issue_ref,
                        labels=labels,
                        config=config,
                        pipeline_login=pipeline_login,
                        owner=owner,
                        repo=repo,
                        prs_file=prs_file,
                        tmp_path=tmp_path,
                        abandoned_prs=abandoned_map.get(issue_ref, frozenset()),
                    )
                    snapshots.append(snap)
                except Exception as e:
                    logger.warning("Snapshot failed for issue #%s: %s", num, e)
                    snapshots.append(
                        FailedSnapshot(
                            issue=issue_ref,
                            labels=labels,
                            error=str(e),
                        )
                    )

            return tuple(snapshots)

    def _snapshot_single_issue(
        self,
        raw_issue: dict[str, Any],
        issue_ref: IssueRef,
        labels: frozenset[str],
        config: PipelineConfig,
        pipeline_login: str,
        owner: str,
        repo: str,
        prs_file: Path,
        tmp_path: Path,
        abandoned_prs: frozenset[PrRef],
    ) -> IssueSnapshot:
        num = issue_ref.number

        # Editor check
        editor_login: str | None = None
        try:
            editor_query = (
                f'query {{ repository(owner: "{owner}", name: "{repo}") {{ '
                f'issue(number: {num}) {{ editor {{ login }} }} }} }}'
            )
            ed_out = self.gh.read(["api", "graphql", "-f", f"query={editor_query}"])
            ed_data = json.loads(ed_out)
            ed_obj = ed_data.get("data", {}).get("repository", {}).get("issue", {}).get("editor")
            if ed_obj:
                editor_login = ed_obj.get("login")
        except Exception:
            editor_login = None

        editor = Editor(editor_login) if editor_login else None
        body_trusted = True
        if editor_login:
            if editor_login != pipeline_login and not self.is_collaborator(owner, repo, editor_login):
                body_trusted = False

        # Open blocker count
        blocker_count = 0
        try:
            dep_out = self.gh.read(["api", f"repos/{owner}/{repo}/issues/{num}"])
            dep_data = json.loads(dep_out)
            dep_summary = dep_data.get("issue_dependencies_summary")
            if dep_summary and "blocked_by" in dep_summary:
                blocker_count = int(dep_summary["blocked_by"])
        except Exception:
            blocker_count = 0

        # Comments classification
        comments_raw = raw_issue.get("comments", [])
        _, status_comment, notices = classify_comments(
            comments_raw=comments_raw,
            trusted_author=pipeline_login,
            collaborators=set(),  # cached in is_collaborator if needed
            issue_num=num,
        )

        # Reviews via helper
        issue_file = tmp_path / f"issue_{num}.json"
        issue_file.write_text(json.dumps(raw_issue), encoding="utf-8")
        rev_out = self.helpers.run_review_helper([
            "--parse-reviews",
            "--file", str(issue_file),
            "--trusted-author", pipeline_login,
        ])
        reviews = reviews_from_helper_json(json.loads(rev_out))

        # Linked PR via helper
        exclude_csv = ",".join(str(p.number) for p in abandoned_prs)
        link_args = [
            "--get-linked-pr", str(num),
            "--pipeline",
            "--state", "all",
            "--file", str(prs_file),
            "--trusted-author", pipeline_login,
        ]
        if exclude_csv:
            link_args.extend(["--exclude", exclude_csv])

        linked_pr: LinkedPr | None = None
        try:
            link_out = self.helpers.run_lifecycle_helper(link_args).strip()
            if link_out:
                winner = json.loads(link_out)
                pr_num = int(winner["number"])
                pr_state = str(winner.get("state", "")).upper()
                if pr_state == "MERGED":
                    merged_at_str = winner.get("merged_at") or datetime.now(timezone.utc).isoformat()
                    linked_pr = MergedPr(
                        pr=PrRef(pr_num),
                        merged_at=datetime.fromisoformat(merged_at_str.replace("Z", "+00:00")),
                    )
                elif pr_state == "CLOSED":
                    closed_at_str = winner.get("closed_at") or datetime.now(timezone.utc).isoformat()
                    linked_pr = ClosedPr(
                        pr=PrRef(pr_num),
                        closed_at=datetime.fromisoformat(closed_at_str.replace("Z", "+00:00")),
                    )
                elif pr_state == "OPEN":
                    pr_view_out = self.gh.read([
                        "pr", "view", str(pr_num),
                        "--json", "number,author,body,state,headRefName,baseRefName,reviews,comments,commits,mergeable,autoMergeRequest,labels",
                    ])
                    pr_view = json.loads(pr_view_out)
                    pr_file = tmp_path / f"pr_{pr_num}.json"
                    pr_file.write_text(json.dumps(pr_view), encoding="utf-8")

                    v_out = self.helpers.run_lifecycle_helper([
                        "--parse-verification", str(pr_num),
                        "--file", str(pr_file),
                        "--trusted-author", pipeline_login,
                    ])
                    v_data = json.loads(v_out)

                    r_out = self.helpers.run_lifecycle_helper([
                        "--check-revision-readiness", str(pr_num),
                        "--file", str(pr_file),
                        "--max-cycles", str(config.max_revision_cycles),
                        "--trusted-author", pipeline_login,
                    ])
                    r_data = json.loads(r_out)

                    linked_pr = open_pr_from_helper_json(pr_view, r_data, v_data)
        except Exception as e:
            # If helper fails with exit 2 or PR fetch fails, let caller wrap into FailedSnapshot
            raise RuntimeError(f"Linked PR processing failed for #{num}: {e}") from e

        return IssueSnapshot(
            issue=issue_ref,
            details=IssueDetails(),
            labels=labels,
            is_open=True,
            body_trusted=body_trusted,
            editor=editor,
            open_blocker_count=blocker_count,
            reviews=reviews,
            linked_pr=linked_pr,
            status_comment=status_comment,
            pipeline_notices=notices,
        )
