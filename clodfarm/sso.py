"""Signing in to the farm UI from somewhere else: a short-lived link signed by whoever hosts the farm.

    FARM_UI_SSO_KEY=<secret>    the farm accepts GET /sso?t=<token> signed with it: once, for a few minutes

(How the host's customer gets in the first time, right after paying, say. After that they sign in with their Claude,
like anyone: "farm login" in the Claude app.)

The link signs a device in as the person of the farm's manager Claude (the farm's own, until a manager hands it on),
the way a pairing link does. It never carries a Claude login: that stays in the claude binary's own sign-in.

A token is ``<claims>.<signature>``, both base64url without padding: the claims are JSON {farm, sub, exp, n} and the
signature is HMAC-SHA256 of the claims part with the key. `make` is what a host runs; a host in another language
does the same in a few lines.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

MAX_TTL = 300  # seconds a link may live: it opens right after it is made


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _sign(key: str, body: str) -> str:
    return _b64(hmac.new(key.encode(), body.encode(), hashlib.sha256).digest())


def make(key: str, farm: str, sub: str = "", ttl: int = 120) -> str:
    """A sign-in token for ``farm`` (its FARM_NAME); ``sub`` says who it is for (kept by the host, not the farm)."""
    claims = {"farm": farm, "sub": sub, "exp": int(time.time()) + max(1, min(ttl, MAX_TTL)), "n": secrets.token_urlsafe(12)}
    body = _b64(json.dumps(claims, separators=(",", ":")).encode())
    return f"{body}.{_sign(key, body)}"


def read(key: str, farm: str, token: str, at: float | None = None) -> dict | None:
    """The claims of a token signed with ``key`` for ``farm`` that has not expired; None for anything else. Each
    token's nonce ("n") is good once: the caller keeps the used ones (Store.use_sso)."""
    if not key or not token or len(token) > 1000 or token.count(".") != 1:
        return None
    body, sig = token.split(".")
    if not hmac.compare_digest(_sign(key, body), sig):
        return None
    try:
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except ValueError:
        return None
    t = time.time() if at is None else at
    if not isinstance(claims, dict) or claims.get("farm") != farm:
        return None
    exp, n = claims.get("exp"), claims.get("n")
    if not isinstance(exp, (int, float)) or not t < exp <= t + MAX_TTL:
        return None
    if not isinstance(n, str) or not 8 <= len(n) <= 64:
        return None
    return claims
