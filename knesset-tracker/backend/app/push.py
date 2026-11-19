"""Web Push without payloads.

A payload would have to be encrypted (RFC 8291), which needs native crypto libraries that
may not run on Wasmer's WASIX Python. Instead each push is an empty "tickle": the service
worker (frontend/public/sw.js) wakes up and fetches the user's latest notifications from
our API with their session cookie. Only the VAPID JWT has to be signed (ES256), and the
pure-Python `ecdsa` package does that. As a bonus, alert text never passes through the
browser vendor's push service.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
from urllib.parse import urlsplit

import httpx
from ecdsa import NIST256p, SigningKey  # type: ignore[import-untyped]
from ecdsa.util import sigencode_string  # type: ignore[import-untyped]

log = logging.getLogger("knesset.push")


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def generate_vapid_keys() -> tuple[str, str]:
    """(private, public) as base64url: the raw 32-byte scalar and the 65-byte point."""
    sk = SigningKey.generate(curve=NIST256p)
    public = b"\x04" + sk.get_verifying_key().to_string()
    return b64url(sk.to_string()), b64url(public)


def vapid_jwt(private_key: str, audience: str, subject: str, ttl: int = 12 * 3600) -> str:
    sk = SigningKey.from_string(b64url_decode(private_key), curve=NIST256p)
    header = b64url(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    claims = b64url(json.dumps({"aud": audience, "exp": int(time.time()) + ttl,
                                "sub": subject}, separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}".encode()
    sig = sk.sign(signing_input, hashfunc=hashlib.sha256, sigencode=sigencode_string)
    return f"{header}.{claims}.{b64url(sig)}"


class Gone(Exception):
    """The browser dropped this subscription (404/410): delete it."""


class Pusher:
    def __init__(self, private_key: str, public_key: str, subject: str,
                 transport: httpx.BaseTransport | None = None) -> None:
        self.private_key, self.public_key, self.subject = private_key, public_key, subject
        self.http = httpx.Client(timeout=15, transport=transport)

    @property
    def enabled(self) -> bool:
        return bool(self.private_key and self.public_key)

    def tickle(self, endpoint: str, ttl: int = 24 * 3600) -> None:
        parts = urlsplit(endpoint)
        jwt = vapid_jwt(self.private_key, f"{parts.scheme}://{parts.netloc}", self.subject)
        r = self.http.post(endpoint, headers={
            "TTL": str(ttl), "Urgency": "normal", "Content-Length": "0",
            "Authorization": f"vapid t={jwt}, k={self.public_key}"})
        if r.status_code in (404, 410):
            raise Gone(endpoint)
        if r.status_code >= 400:
            raise RuntimeError(f"push service HTTP {r.status_code}: {r.text[:200]}")
