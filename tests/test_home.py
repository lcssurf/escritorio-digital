# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
"""The page at the office's address is the office's own, calm support page: it does not show the original clodfarm farm
(that one is kept apart, for whoever wants it)."""
import urllib.request

from test_web import ui  # noqa: F401


def get(url):
    with urllib.request.urlopen(url) as r:
        body = r.read()
        return r.status, (body.decode("utf-8") if "text" in (r.headers.get("Content-Type") or "") or "javascript" in (r.headers.get("Content-Type") or "") else body), r.headers


def test_the_front_page_is_the_offices_own_and_not_the_original_farm(ui):  # noqa: F811
    url, _ = ui
    code, html, headers = get(url + "/")
    assert code == 200 and "Escritório" in html and "Digital" in html and "escritorio.js" in html
    assert "CLOD" not in html and "PRESS START" not in html and "a farm of Claude Code agents" not in html, "none of the original game screen"
    assert "script-src 'self'" in headers.get("Content-Security-Policy", ""), "no inline scripts"
    assert "<script>" not in html and 'href="farm"' in html, "the way to the original is a small link, not the page"
    for asset in ("escritorio.js", "escritorio.css", "fonts/PressStart2P.ttf"):
        assert get(url + "/" + asset)[0] == 200, asset


def test_the_original_farm_is_still_there_for_whoever_wants_it(ui):  # noqa: F811
    url, _ = ui
    code, html, _ = get(url + "/farm")
    assert code == 200 and "CLOD" in html and "PRESS START" in html
    assert get(url + "/healthz")[0] == 200
