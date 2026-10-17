"""Subprocess environment configuration for pipeline operations.

Provides a consistent execution environment for git, gh, and agent processes
under both terminal and systemd service contexts.
"""

from collections.abc import Mapping
import os

PIPELINE_ENV_OVERLAY: dict[str, str] = {
    "GIT_CONFIG_COUNT": "2",
    "GIT_CONFIG_KEY_0": "url.https://github.com/.insteadOf",
    "GIT_CONFIG_VALUE_0": "git@github.com:",
    "GIT_CONFIG_KEY_1": "credential.https://github.com.helper",
    "GIT_CONFIG_VALUE_1": "!gh auth git-credential",
    "GH_PROMPT_DISABLED": "1",
    "GIT_TERMINAL_PROMPT": "0",
    "NO_DNA": "1",
}


def pipeline_env(
    base_env: Mapping[str, str] | None = None,
    extra: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Return base environment overlaid with pipeline git/gh configuration."""
    env = dict(os.environ if base_env is None else base_env)
    env.update(PIPELINE_ENV_OVERLAY)
    if extra:
        env.update(extra)
    return env
