"""Load pure core without importing the HA runtime on a Windows development host."""

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for name, path in (
    ("custom_components", ROOT / "custom_components"),
    ("custom_components.sigen_hybrid", ROOT / "custom_components/sigen_hybrid"),
):
    module = types.ModuleType(name)
    module.__path__ = [str(path)]
    sys.modules[name] = module
