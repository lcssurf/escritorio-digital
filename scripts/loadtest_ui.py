#!/usr/bin/env python3
"""Many people watching one farm: N viewers polling the farm UI like the page does, for a while.

    python scripts/loadtest_ui.py http://127.0.0.1:8080 --viewers 300 --seconds 30

Each viewer asks for /api/state every 2.5 s (with its ETag, as a browser does) and /api/tasks every 4 s. Prints the
requests served, errors, and latency percentiles.
"""

from __future__ import annotations

import argparse
import statistics
import threading
import time
import urllib.error
import urllib.request


def viewer(base: str, until: float, lat: dict, errors: list, tag_cache: dict):
    etag = None
    next_tasks = 0.0
    while time.time() < until:
        for path, every in (("/api/state", 2.5), ("/api/tasks", 4.0)):
            if path == "/api/tasks" and time.time() < next_tasks:
                continue
            req = urllib.request.Request(base + path, headers={"If-None-Match": etag} if etag and path == "/api/state"
                                         else {})
            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    r.read()
                    if path == "/api/state":
                        etag = r.headers.get("ETag")
            except urllib.error.HTTPError as e:
                if e.code != 304:
                    errors.append(f"{path} {e.code}")
            except Exception as e:  # noqa: BLE001
                errors.append(f"{path} {type(e).__name__}")
            lat.setdefault(path, []).append(time.time() - t0)
            if path == "/api/tasks":
                next_tasks = time.time() + every
        time.sleep(2.5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--viewers", type=int, default=300)
    ap.add_argument("--seconds", type=int, default=30)
    a = ap.parse_args()
    until = time.time() + a.seconds
    lat: dict[str, list] = {}
    errors: list[str] = []
    threads = [threading.Thread(target=viewer, args=(a.base.rstrip("/"), until, lat, errors, {}), daemon=True)
               for _ in range(a.viewers)]
    for i, t in enumerate(threads):
        t.start()
        if i % 50 == 49:
            time.sleep(0.2)  # people don't all arrive in the same millisecond
    for t in threads:
        t.join(a.seconds + 30)
    for path, xs in sorted(lat.items()):
        xs = sorted(xs)
        q = lambda p: xs[min(len(xs) - 1, int(p * len(xs)))] * 1000  # noqa: E731
        print(f"{path:<12} {len(xs):>6} requests  p50 {q(0.5):6.0f} ms  p95 {q(0.95):6.0f} ms  p99 {q(0.99):6.0f} ms"
              f"  max {xs[-1] * 1000:6.0f} ms  mean {statistics.mean(xs) * 1000:5.0f} ms")
    print(f"errors: {len(errors)}" + (f" (e.g. {errors[:5]})" if errors else ""))


if __name__ == "__main__":
    main()
