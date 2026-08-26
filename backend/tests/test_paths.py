from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class RuntimePathTests(unittest.TestCase):
    def test_barco_data_root_overrides_runtime_location(self):
        backend_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env["BARCO_DATA_ROOT"] = tmp
            env["PYTHONPATH"] = str(backend_root)
            output = subprocess.check_output(
                [sys.executable, "-c", "from barco_controller.paths import RUNTIME_ROOT; print(RUNTIME_ROOT)"],
                env=env,
                text=True,
            ).strip()
            self.assertEqual(Path(output).resolve(), Path(tmp).resolve())

    def test_app_secret_is_persistent_inside_runtime_data(self):
        backend_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env["BARCO_DATA_ROOT"] = tmp
            env["PYTHONPATH"] = str(backend_root)
            code = "from barco_controller.paths import load_or_create_app_secret; print(load_or_create_app_secret())"
            first = subprocess.check_output([sys.executable, "-c", code], env=env, text=True).strip()
            second = subprocess.check_output([sys.executable, "-c", code], env=env, text=True).strip()
            self.assertEqual(first, second)
            self.assertGreaterEqual(len(first), 32)


if __name__ == "__main__":
    unittest.main()
