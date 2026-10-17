"""Pipeline test package. Puts .agents/scripts on sys.path."""

import sys
from pathlib import Path

scripts_dir = Path(__file__).resolve().parents[2] / ".agents" / "scripts"
if str(scripts_dir) not in sys.path:
    sys.path.insert(0, str(scripts_dir))
