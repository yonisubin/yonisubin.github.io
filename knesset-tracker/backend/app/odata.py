"""A small, polite client for the Knesset OData v4 API.

Phase 0 findings handled here:
- the server caps pages at 100 rows and returns an absolute @odata.nextLink;
- a server-side timeout can come back as HTTP 200 with an empty body, so any
  non-JSON body is treated as a retryable failure, never as "no rows".
"""
from __future__ import annotations

import json
import random
import time
import urllib.parse
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class ODataError(RuntimeError):
    pass


@dataclass
class Page:
    rows: list[dict[str, Any]]
    next_url: str | None


def odata_datetime(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_url(base: str, entity: str, *, filters: list[str], orderby: str | None) -> str:
    params: dict[str, str] = {}
    if filters:
        params["$filter"] = " and ".join(f"({f})" for f in filters)
    if orderby:
        params["$orderby"] = orderby
    qs = urllib.parse.urlencode(params, quote_via=urllib.parse.quote, safe="$,()':/")
    return f"{base.rstrip('/')}/{entity}" + (f"?{qs}" if qs else "")


class ODataClient:
    def __init__(
        self,
        base_url: str,
        *,
        transport: httpx.BaseTransport | None = None,
        min_interval: float = 0.25,
        max_retries: int = 5,
        backoff_base: float = 1.0,
        timeout: float = 60.0,
        sleep: Any = time.sleep,
    ) -> None:
        self.base_url = base_url
        self.min_interval = min_interval
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self._sleep = sleep
        self._last_request = 0.0
        self.requests = 0
        self._http = httpx.Client(
            transport=transport,
            timeout=timeout,
            headers={"User-Agent": "knesset-tracker/0.1 (+https://github.com/yonisubin)",
                     "Accept": "application/json"},
        )

    def close(self) -> None:
        self._http.close()

    def _throttle(self) -> None:
        wait = self.min_interval - (time.monotonic() - self._last_request)
        if wait > 0:
            self._sleep(wait)
        self._last_request = time.monotonic()

    def get_json(self, url: str) -> Any:
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            if attempt:
                # exponential backoff with full jitter
                self._sleep(random.uniform(0, self.backoff_base * 2 ** attempt))
            self._throttle()
            self.requests += 1
            try:
                resp = self._http.get(url)
            except httpx.TransportError as e:
                last_error = e
                continue
            if resp.status_code in RETRYABLE_STATUS:
                last_error = ODataError(f"HTTP {resp.status_code} for {url}")
                continue
            if resp.status_code >= 400:
                raise ODataError(f"HTTP {resp.status_code} for {url}: {resp.text[:200]}")
            try:
                return json.loads(resp.content)
            except ValueError as e:  # empty 200 = server-side timeout
                last_error = ODataError(f"non-JSON body ({len(resp.content)} bytes) for {url}")
                last_error.__cause__ = e
                continue
        raise ODataError(f"giving up after {self.max_retries} attempts: {last_error}")

    def get_page(self, url: str) -> Page:
        body = self.get_json(url)
        if not isinstance(body, dict) or not isinstance(body.get("value"), list):
            raise ODataError(f"unexpected response shape for {url}")
        return Page(rows=body["value"], next_url=body.get("@odata.nextLink"))
