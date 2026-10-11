# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""The licensing stays honest: the license files exist, and every file that is ours says so."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPDX = "SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0"
OURS = [
    "clodfarm/chat.py", "clodfarm/team.py", "clodfarm/progress.py", "clodfarm/rh.py", "clodfarm/hiring.py", "clodfarm/catalog.py",
    "tests/test_chat.py", "tests/test_claude_connectors.py", "tests/test_landing_approval.py", "tests/test_team.py",
    "tests/test_ux.py", "tests/test_licenses.py", "tests/test_progress.py", "tests/test_review_edit.py", "tests/test_backup.py", "tests/test_repo_hygiene.py", "tests/test_hiring.py",
    "overlay/exporter.js", "overlay/test/exporter.test.js", "overlay/test/sprites.test.js",
    "overlay/main.js", "overlay/preload.js", "overlay/i18n/index.js", "overlay/renderer/app.js", "overlay/renderer/office.js",
    "overlay/renderer/panel.js", "overlay/renderer/sprites.js", "overlay/renderer/templates.js",
    "overlay/test/i18n.test.js", "scripts/escritorio.mjs",
]


def read(rel):
    with open(os.path.join(ROOT, *rel.split("/")), encoding="utf-8") as f:
        return f.read()


def test_the_license_files_are_there():
    assert "PolyForm Shield License 1.0.0" in read("LICENSES/PolyForm-Shield-1.0.0.md")
    assert "Duke Security" in read("LICENSES/MIT-clodfarm.txt") and "MIT License" in read("LICENSES/MIT-clodfarm.txt")
    index = read("LICENSE")
    assert "OUR LAYER" in index and "UPSTREAM LAYER" in index and "Required Notice: Copyright" in index
    assert "NOTICE.md" in index and "TRADEMARKS.md" in index
    for rel in OURS:
        assert rel.split("/")[0] in index or rel in index, f"the LICENSE index does not cover {rel}"


def test_every_file_of_ours_carries_the_header():
    for rel in OURS:
        top = "\n".join(read(rel).split("\n")[:3])
        assert SPDX in top, f"{rel} is ours and must start with the license header"
        assert "Required Notice: Copyright (c) 2026 lcssurf" in top, rel


def test_the_image_ships_the_licenses():
    dockerfile = read("Dockerfile")
    assert "LICENSES" in dockerfile and "NOTICE.md" in dockerfile and "TRADEMARKS.md" in dockerfile
    assert "PolyForm-Shield" in dockerfile or "LicenseRef-PolyForm-Shield-1.0.0" in dockerfile
