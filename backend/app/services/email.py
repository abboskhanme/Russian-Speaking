"""Minimal SMTP email sender (stdlib only — no extra dependencies).

Provider-agnostic: point SMTP_* at Gmail, Resend, Mailgun, SendGrid, etc.
When SMTP isn't configured the message is logged instead of sent, so local
development and tests work without a mail server.
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import settings

log = logging.getLogger("email")


def send_email(to: str, subject: str, text: str, html: str | None = None) -> None:
    if not settings.email_enabled:
        # Dev fallback: surface the content (incl. OTP codes) in the logs.
        log.warning("SMTP not configured — email not sent. to=%s subject=%s\n%s", to, subject, text)
        return

    from_addr = settings.SMTP_FROM or settings.SMTP_USER
    msg = EmailMessage()
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{from_addr}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")

    context = ssl.create_default_context()
    if settings.SMTP_STARTTLS:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
            s.starttls(context=context)
            s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
    else:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15, context=context) as s:
            s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)


def send_otp_email(to: str, code: str) -> None:
    minutes = max(1, settings.EMAIL_OTP_TTL_SEC // 60)
    subject = "Govori — tasdiqlash kodi"
    text = (
        f"Govori'ga ro'yxatdan o'tish uchun tasdiqlash kodingiz: {code}\n\n"
        f"Kod {minutes} daqiqa amal qiladi. Agar bu siz bo'lmasangiz, "
        f"ushbu xatga e'tibor bermang."
    )
    html = f"""\
<div style="font-family:system-ui,Arial,sans-serif;max-width:440px;margin:auto;padding:24px">
  <h2 style="margin:0 0 8px">Govori — tasdiqlash kodi</h2>
  <p style="color:#555;margin:0 0 18px">Ro'yxatdan o'tishni yakunlash uchun quyidagi kodni kiriting:</p>
  <div style="font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;
              padding:16px;background:#f5f5f7;border-radius:12px">{code}</div>
  <p style="color:#888;font-size:13px;margin:18px 0 0">
    Kod {minutes} daqiqa amal qiladi. Agar bu siz bo'lmasangiz, ushbu xatga e'tibor bermang.
  </p>
</div>"""
    send_email(to, subject, text, html)
