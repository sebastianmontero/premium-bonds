"""AST-based purity test for the pipeline reconciler pure core.

Enforces:
- Python 3.11 stdlib allowlist only
- No pathlib
- Banned calls: open, os.*, subprocess.*, time.*, datetime.now/utcnow/today, date.today
- Module dependency graph edges
- Proves each ban against inline offending snippets
"""

import ast
from pathlib import Path
import unittest

PACKAGE_MODULES = {"model", "actions", "config", "state", "stages", "status_comment"}

ALLOWED_PACKAGE_EDGES = {
    "model": set(),
    "config": {"model"},
    "actions": {"model"},
    "state": {"model", "actions"},
    "stages": {"model", "actions", "config", "state", "status_comment"},
    "status_comment": {"model", "config"},
}

GLOBAL_ALLOWED_STDLIB = {
    "dataclasses",
    "enum",
    "typing",
    "collections",
    "datetime",
}

MODULE_SPECIFIC_ALLOWED = {
    "config": {"tomllib"},
    "status_comment": {"hashlib"},
}

BANNED_MODULES = {"pathlib", "os", "sys", "subprocess", "time", "socket", "http", "urllib"}


class PurityViolation(Exception):
    pass


def check_ast_purity(source: str, module_name: str) -> None:
    tree = ast.parse(source, filename=f"{module_name}.py")

    allowed_pkg = ALLOWED_PACKAGE_EDGES.get(module_name, set())
    allowed_stdlib = GLOBAL_ALLOWED_STDLIB | MODULE_SPECIFIC_ALLOWED.get(module_name, set())

    for node in ast.walk(tree):
        # 1. Imports
        if isinstance(node, ast.Import):
            for alias in node.names:
                base = alias.name.split(".")[0]
                if base in BANNED_MODULES:
                    raise PurityViolation(f"Banned module import '{alias.name}' in {module_name}")
                if base not in allowed_stdlib and base not in PACKAGE_MODULES:
                    raise PurityViolation(f"Import '{alias.name}' not in allowlist for {module_name}")

        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            base = mod.split(".")[0]
            # Relative import within package: .model, .actions, etc.
            if node.level > 0:
                rel_mod = mod.lstrip(".")
                if rel_mod and rel_mod not in allowed_pkg:
                    raise PurityViolation(
                        f"Forbidden package edge: {module_name} -> {rel_mod} (allowed: {allowed_pkg})"
                    )
                for alias in node.names:
                    if not rel_mod and alias.name in PACKAGE_MODULES:
                        if alias.name not in allowed_pkg:
                            raise PurityViolation(
                                f"Forbidden package edge: {module_name} -> {alias.name} (allowed: {allowed_pkg})"
                            )
            else:
                if base in BANNED_MODULES:
                    raise PurityViolation(f"Banned module import '{mod}' in {module_name}")
                if base not in allowed_stdlib and base not in allowed_pkg:
                    raise PurityViolation(f"Import '{mod}' not in allowlist for {module_name}")

        # 2. Banned calls
        elif isinstance(node, ast.Call):
            # Built-in open()
            if isinstance(node.func, ast.Name) and node.func.id == "open":
                raise PurityViolation(f"Banned call to 'open()' in {module_name}")

            # Attribute calls: os.*, subprocess.*, time.*, datetime.now/utcnow/today, date.today
            if isinstance(node.func, ast.Attribute):
                attr = node.func.attr
                val = node.func.value

                # E.g. os.path.exists or subprocess.run
                if isinstance(val, ast.Name):
                    if val.id in ("os", "subprocess", "time"):
                        raise PurityViolation(f"Banned call to '{val.id}.{attr}' in {module_name}")
                    if val.id == "date" and attr == "today":
                        raise PurityViolation(f"Banned call to 'date.today()' in {module_name}")
                    if val.id == "datetime" and attr in ("now", "utcnow", "today"):
                        raise PurityViolation(f"Banned call to 'datetime.{attr}()' in {module_name}")

                # Nested attribute, e.g. datetime.datetime.now()
                elif isinstance(val, ast.Attribute):
                    if val.attr == "datetime" and attr in ("now", "utcnow", "today"):
                        raise PurityViolation(f"Banned call to 'datetime.{attr}()' in {module_name}")
                    if val.attr == "date" and attr == "today":
                        raise PurityViolation(f"Banned call to 'date.today()' in {module_name}")


class TestPurity(unittest.TestCase):
    def setUp(self):
        self.repo_root = Path(__file__).resolve().parents[2]
        self.pipeline_pkg = self.repo_root / ".agents" / "scripts" / "pipeline"

    def test_pipeline_modules_conform_to_purity(self):
        for mod_name in PACKAGE_MODULES:
            path = self.pipeline_pkg / f"{mod_name}.py"
            self.assertTrue(path.exists(), f"{path} should exist")
            source = path.read_text(encoding="utf-8")
            try:
                check_ast_purity(source, mod_name)
            except PurityViolation as e:
                self.fail(f"Purity violation in {mod_name}.py: {e}")

    def test_model_is_leaf(self):
        path = self.pipeline_pkg / "model.py"
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                if isinstance(node, ast.ImportFrom) and node.level > 0:
                    self.fail("model.py must not import from within the package (it is a leaf)")

    def test_status_comment_does_not_import_stages(self):
        path = self.pipeline_pkg / "status_comment.py"
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    self.assertNotIn("stages", alias.name)
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                self.assertNotIn("stages", mod)
                for alias in node.names:
                    self.assertNotEqual(alias.name, "stages")
        check_ast_purity(source, "status_comment")

    # Proof of bans on offending snippets

    def test_ban_pathlib(self):
        snippet = "from pathlib import Path\np = Path('.')"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "model")

    def test_ban_open(self):
        snippet = "with open('foo.txt') as f:\n    pass"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "model")

    def test_ban_os_calls(self):
        snippet = "import os\nos.system('echo hi')"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "state")

    def test_ban_subprocess(self):
        snippet = "import subprocess\nsubprocess.run(['ls'])"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "stages")

    def test_ban_time_sleep(self):
        snippet = "import time\ntime.sleep(1)"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "state")

    def test_ban_datetime_now(self):
        snippet = "from datetime import datetime\nx = datetime.now()"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "stages")

    def test_ban_datetime_utcnow(self):
        snippet = "from datetime import datetime\nx = datetime.utcnow()"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "stages")

    def test_ban_datetime_today(self):
        snippet = "from datetime import datetime\nx = datetime.today()"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "stages")

    def test_ban_date_today(self):
        snippet = "from datetime import date\nx = date.today()"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "stages")

    def test_ban_illegal_package_edge_model_imports_actions(self):
        snippet = "from .actions import RecordAttempt"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "model")

    def test_ban_illegal_package_edge_status_comment_imports_stages(self):
        snippet = "from .stages import plan_issue"
        with self.assertRaises(PurityViolation):
            check_ast_purity(snippet, "status_comment")


if __name__ == "__main__":
    unittest.main()
