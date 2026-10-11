# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""Things that broke the install once, silently: an invisible byte-order mark before the first line of a script, accents
turned into gibberish by a bad re-save, a version that does not look like one. None of them shows up in a diff."""
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".pytest_cache", "docs"}   # docs/ holds the original clodfarm files, untouched
TEXT = (".mjs", ".js", ".py", ".json", ".md", ".yml", ".yaml", ".html", ".sh", ".vbs", ".command", ".toml", ".txt")
MOJIBAKE = re.compile("\u00c3[\u00a1-\u00bf\u0080-\u009f]|\u00e2\u20ac|\u00e2\u0153|\u00f0\u0178|\u00c3\u0192")   # UTF-8 read as Windows-1252 and saved again


def text_files():
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith(TEXT) or f.startswith("Dockerfile") or f in ("LICENSE", "VERSION"):
                yield os.path.join(base, f)


def test_no_file_starts_with_a_byte_order_mark_where_it_breaks():
    # a BOM before "#!" or "FROM" makes Node and Docker refuse the file; elsewhere it only makes diffs noisy
    bad = []
    for p in text_files():
        with open(p, "rb") as f:
            head = f.read(3)
        name = os.path.basename(p)
        if head == b"\xef\xbb\xbf" and (name.endswith((".mjs", ".sh", ".command")) or name.startswith("Dockerfile") or name == "VERSION"):
            bad.append(os.path.relpath(p, ROOT))
    assert not bad, f"remove the BOM from: {bad}"


def test_no_accent_was_turned_into_gibberish():
    bad = []
    for p in text_files():
        with open(p, encoding="utf-8", errors="replace") as f:
            for n, line in enumerate(f, 1):
                if MOJIBAKE.search(line):
                    bad.append(f"{os.path.relpath(p, ROOT)}:{n}")
                    break
    assert not bad, f"text saved with the wrong encoding in: {bad}"


def test_the_version_is_a_version_and_the_install_script_reads_it():
    v = open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()
    assert re.fullmatch(r"\d+\.\d+\.\d+", v), v
    cli = open(os.path.join(ROOT, "scripts", "escritorio.mjs"), encoding="utf-8").read()
    assert "'VERSION'" in cli and "${VERSION}" in cli, "the image tag comes from the VERSION file"


@pytest.mark.skipif(not shutil.which("node"), reason="Node is not installed here")
def test_the_install_script_parses():
    r = subprocess.run(["node", "--check", os.path.join(ROOT, "scripts", "escritorio.mjs")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    r = subprocess.run(["node", os.path.join(ROOT, "scripts", "escritorio.mjs")], capture_output=True, text=True)
    assert "atualizar" in r.stdout and "instalar" in r.stdout, "it prints its usage"
