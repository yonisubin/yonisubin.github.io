"""Email delivery. One interface, three backends:

- console: logs and keeps messages in memory (development and tests);
- smtp: Mailpit locally and in CI, or any SMTP relay (e.g. Brevo);
- resend: Resend's HTTP API, which honours an Idempotency-Key, so a retried send of the
  same batch is delivered once. SMTP has no such guarantee (at-least-once on retry).
"""
from __future__ import annotations

import logging
import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr, make_msgid, parseaddr

import httpx

from .config import Settings

log = logging.getLogger("knesset.email")


@dataclass
class Email:
    to: str
    subject: str
    text: str
    html: str
    headers: dict[str, str] = field(default_factory=dict)
    idempotency_key: str | None = None


class EmailError(RuntimeError):
    pass


class Emailer:
    def send(self, email: Email) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class ConsoleEmailer(Emailer):
    """Keeps sent mail in `outbox`; like Resend, ignores a repeated idempotency key."""

    def __init__(self) -> None:
        self.outbox: list[Email] = []
        self._keys: set[str] = set()

    def send(self, email: Email) -> None:
        if email.idempotency_key and email.idempotency_key in self._keys:
            log.info("duplicate send suppressed (idempotency key %s)", email.idempotency_key)
            return
        if email.idempotency_key:
            self._keys.add(email.idempotency_key)
        self.outbox.append(email)
        log.info("email to %s: %s", email.to, email.subject)


class SmtpEmailer(Emailer):
    def __init__(self, s: Settings) -> None:
        self.s = s

    def send(self, email: Email) -> None:
        msg = EmailMessage()
        name, addr = parseaddr(self.s.email_from)
        msg["From"] = formataddr((name, addr))
        msg["To"] = email.to
        msg["Subject"] = email.subject
        msg["Message-ID"] = make_msgid(domain=addr.split("@")[-1] or "localhost")
        for k, v in email.headers.items():
            msg[k] = v
        if email.idempotency_key:
            msg["X-Idempotency-Key"] = email.idempotency_key
        msg.set_content(email.text)
        msg.add_alternative(email.html, subtype="html")
        try:
            with smtplib.SMTP(self.s.smtp_host, self.s.smtp_port, timeout=30) as smtp:
                if self.s.smtp_starttls:
                    smtp.starttls()
                if self.s.smtp_user:
                    smtp.login(self.s.smtp_user, self.s.smtp_password)
                smtp.send_message(msg)
        except (OSError, smtplib.SMTPException) as e:
            raise EmailError(f"SMTP send failed: {e}") from e


class ResendEmailer(Emailer):
    def __init__(self, s: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self.s = s
        self.http = httpx.Client(base_url="https://api.resend.com", timeout=30,
                                 transport=transport,
                                 headers={"Authorization": f"Bearer {s.resend_api_key}"})

    def send(self, email: Email) -> None:
        headers = {"Idempotency-Key": email.idempotency_key} if email.idempotency_key else {}
        try:
            r = self.http.post("/emails", headers=headers, json={
                "from": self.s.email_from, "to": [email.to], "subject": email.subject,
                "text": email.text, "html": email.html, "headers": email.headers})
        except httpx.HTTPError as e:
            raise EmailError(f"Resend request failed: {e}") from e
        if r.status_code >= 400:
            raise EmailError(f"Resend HTTP {r.status_code}: {r.text[:300]}")


def make_emailer(s: Settings) -> Emailer:
    if s.email_backend == "smtp":
        return SmtpEmailer(s)
    if s.email_backend == "resend":
        return ResendEmailer(s)
    return _console


_console = ConsoleEmailer()
