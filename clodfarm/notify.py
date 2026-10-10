"""Tell a human when something needs them. There's no panel, so this is how you hear about problems.

FARM_NOTIFY_URL takes an ntfy topic URL (https://ntfy.sh/<topic>), a Slack incoming webhook, or a Discord webhook.
Sending runs in a background thread and never raises: a notification must never break the work.
"""

from __future__ import annotations

import json
import threading
import urllib.request


def _payload(url: str, title: str, text: str) -> tuple[bytes, dict]:
    if "ntfy" in url:
        return text.encode(), {"Title": title.encode("ascii", "replace").decode(), "Tags": "robot"}
    body = f"*{title}*\n{text}"
    key = "content" if "discord" in url else "text"
    return json.dumps({key: body[:1900]}).encode(), {"Content-Type": "application/json"}


def send(url: str, title: str, text: str, farm: str = "") -> None:
    if not url:
        return
    title = f"{farm}: {title}" if farm else title

    def go():
        try:
            data, headers = _payload(url, title, text[:1500])
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "clodfarm", **headers}, method="POST")
            urllib.request.urlopen(req, timeout=8).close()
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(target=go, daemon=True).start()


def topic_url(topic: str) -> str:
    """A person's ntfy topic (their Claude's SETTINGS): a bare topic is on ntfy.sh."""
    topic = (topic or "").strip()
    return topic if topic.startswith("https://") else f"https://ntfy.sh/{topic}" if topic else ""


def ask_approval(topic: str, claude: str, what: str, frm: str, link: str) -> None:
    """Push to the person's phone: a mission (or message) for their Claude waits for their yes."""
    url = topic_url(topic)
    if not url:
        return

    def go():
        try:
            req = urllib.request.Request(url, data=f"{frm} asks {claude}: {what}"[:1500].encode(), method="POST",
                                         headers={"User-Agent": "clodfarm", "Title": f"{claude}: approve?",
                                                  "Tags": "question", **({"Click": link} if link else {})})
            urllib.request.urlopen(req, timeout=8).close()
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(target=go, daemon=True).start()
