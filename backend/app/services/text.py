"""Helpers for normalising user-authored rich text.

Question prompts are authored in a rich-text editor and stored as sanitised
HTML. When that text is fed to the LLM (model-answer generation, answer
analysis, explanations) the markup is noise that can confuse the model, so we
strip it back to plain text first. Display surfaces keep the HTML; only the
LLM-facing paths use this.
"""

import re
from html import unescape

_BLOCK_BOUNDARY = re.compile(r"(?i)<\s*(br|/p|/div|/li|/h[1-6]|/blockquote)\s*/?>")
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"[ \t\f\v]+")


def html_to_text(value: str | None) -> str:
    """Return a plain-text view of possibly-HTML content.

    Block/line boundaries become spaces (so words don't run together), all
    other tags are removed, and HTML entities are decoded. Plain text without
    any tags is returned unchanged.
    """
    if not value:
        return ""
    if "<" not in value and "&" not in value:
        return value
    text = _BLOCK_BOUNDARY.sub(" ", value)
    text = _TAG.sub("", text)
    text = unescape(text)
    # Collapse the runs of spaces the substitutions can leave behind.
    text = _WS.sub(" ", text)
    return "\n".join(line.strip() for line in text.splitlines()).strip()
