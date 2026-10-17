"""Configuration loading and validation for the reconciler.

This module imports only from model.py and standard library.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import timedelta
import tomllib

from .model import (
    Effort,
    ImplementTarget,
    IntegrateTarget,
    ReviewTarget,
    ReviseTarget,
    Step,
    StepSpec,
    StepTarget,
    VerifyTarget,
)


@dataclass(frozen=True)
class CliConfig:
    extra_args: tuple[str, ...] = ()


@dataclass(frozen=True)
class ConcurrencyConfig:
    review: int


@dataclass(frozen=True)
class PipelineConfig:
    eligible_label: str
    skip_review_label: str
    max_revision_cycles: int
    max_step_attempts: int
    runner: str
    reviews: tuple[StepSpec, ...]
    integrator: StepSpec
    implement: StepSpec
    verify: StepSpec
    revise: StepSpec
    concurrency: ConcurrencyConfig
    timeouts: Mapping[Step, timedelta]
    cli: Mapping[str, CliConfig] = field(default_factory=dict)

    def spec_for(self, target: StepTarget) -> StepSpec:
        if isinstance(target, ReviewTarget):
            if target.round < 1 or target.round > len(self.reviews):
                raise IndexError(f"Review round {target.round} out of range [1, {len(self.reviews)}]")
            return self.reviews[target.round - 1]
        elif isinstance(target, IntegrateTarget):
            return self.integrator
        elif isinstance(target, ImplementTarget):
            return self.implement
        elif isinstance(target, VerifyTarget):
            return self.verify
        elif isinstance(target, ReviseTarget):
            return self.revise
        else:
            raise TypeError(f"Unknown StepTarget: {type(target)}")

    def timeout_for(self, step: Step) -> timedelta:
        if step not in self.timeouts:
            raise KeyError(f"No timeout configured for step: {step}")
        return self.timeouts[step]


def _parse_step_spec(data: Mapping[str, object], name: str) -> StepSpec:
    cli = data.get("cli")
    if not isinstance(cli, str) or cli not in ("agy", "claude"):
        raise ValueError(f"Unknown or missing cli '{cli}' for step '{name}'")

    model = data.get("model")
    if not isinstance(model, str) or not model.strip():
        raise ValueError(f"Missing model for step '{name}'")

    raw_effort = data.get("effort")
    try:
        effort = Effort(str(raw_effort))
    except (ValueError, KeyError):
        raise ValueError(f"Invalid effort '{raw_effort}' for step '{name}'")

    return StepSpec(cli=cli, model=model.strip(), effort=effort)


def load_config(toml_content: str | bytes) -> PipelineConfig:
    if isinstance(toml_content, str):
        data = tomllib.loads(toml_content)
    else:
        data = tomllib.loads(toml_content.decode("utf-8"))

    eligible_label = str(data.get("eligible_label", "agent:auto"))
    skip_review_label = str(data.get("skip_review_label", "agent:skip-review"))
    max_revision_cycles = int(data.get("max_revision_cycles", 3))
    max_step_attempts = int(data.get("max_step_attempts", 2))
    runner = str(data.get("runner", "auto"))

    raw_reviews = data.get("reviews")
    if not isinstance(raw_reviews, list) or len(raw_reviews) == 0:
        raise ValueError("reviews list cannot be empty")

    reviews = tuple(_parse_step_spec(r, f"review[{i+1}]") for i, r in enumerate(raw_reviews))
    integrator = _parse_step_spec(data.get("integrator", {}), "integrator")
    implement = _parse_step_spec(data.get("implement", {}), "implement")
    verify = _parse_step_spec(data.get("verify", {}), "verify")
    revise = _parse_step_spec(data.get("revise", {}), "revise")

    raw_concurrency = data.get("concurrency", {})
    review_concurrency = int(raw_concurrency.get("review", 1))
    if review_concurrency < 1:
        raise ValueError("concurrency.review must be >= 1")
    concurrency = ConcurrencyConfig(review=review_concurrency)

    raw_timeouts = data.get("timeouts_minutes", {})
    valid_step_values = {s.value for s in Step}
    timeouts: dict[Step, timedelta] = {}
    for key, minutes in raw_timeouts.items():
        if key not in valid_step_values:
            raise ValueError(f"Unknown timeouts_minutes key: '{key}' (expected one of {valid_step_values})")
        timeouts[Step(key)] = timedelta(minutes=int(minutes))

    for step in Step:
        if step not in timeouts:
            raise ValueError(f"Missing timeout for step '{step.value}' in timeouts_minutes")

    cli_configs: dict[str, CliConfig] = {}
    raw_cli = data.get("cli", {})
    for cli_name, cli_data in raw_cli.items():
        extra_args = tuple(cli_data.get("extra_args", ()))
        cli_configs[cli_name] = CliConfig(extra_args=extra_args)

    return PipelineConfig(
        eligible_label=eligible_label,
        skip_review_label=skip_review_label,
        max_revision_cycles=max_revision_cycles,
        max_step_attempts=max_step_attempts,
        runner=runner,
        reviews=reviews,
        integrator=integrator,
        implement=implement,
        verify=verify,
        revise=revise,
        concurrency=concurrency,
        timeouts=timeouts,
        cli=cli_configs,
    )
