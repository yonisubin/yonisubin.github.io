"""Hebrew text normalisation for search.

PostgreSQL has no Hebrew stemmer, so search uses trigram matching on text normalised
here, in Python, both when indexing and when querying, so both sides agree exactly:

- strip niqqud and cantillation marks (U+0591-U+05C7);
- unify final letters (ך ם ן ף ץ -> כ מ נ פ צ), so "שלומ" still finds "שלום";
- drop geresh/gershayim and quote marks (תשפ"ו, תשפ״ו and תשפו all match);
- lowercase Latin text, turn other punctuation into spaces;
- index a prefix-stripped variant of each word, so "לחוק", "והחוק" and "בחוק" find "חוק".
"""
from __future__ import annotations

import re
import unicodedata

_MARKS = re.compile("[֑-ֽֿ-ׇ]")  # keep maqaf (U+05BE) for now
_FINALS = str.maketrans("ךםןףץ", "כמנפצ")
_QUOTES = re.compile("[\"'`׳״‘’“”„]")
_PUNCT = re.compile(r"[^\w\s]|_", re.UNICODE)
_SPACE = re.compile(r"\s+")
_HEBREW_WORD = re.compile("^[א-ת]+$")

# One-letter prefixes (and common two/three-letter combinations of them)
PREFIXES = ("ו", "ה", "ב", "ל", "מ", "ש", "כ")
_MIN_STEM = 2


def normalize(text: str | None) -> str:
    if not text:
        return ""
    s = unicodedata.normalize("NFKC", text)
    s = _MARKS.sub("", s)
    s = s.replace("־", " ")  # maqaf joins words: treat as a space
    s = _QUOTES.sub("", s)
    s = s.translate(_FINALS).lower()
    s = _PUNCT.sub(" ", s)
    return _SPACE.sub(" ", s).strip()


def strip_prefixes(word: str) -> list[str]:
    """Candidate stems of a Hebrew word with up to three prefix letters removed.
    'ובחוק' -> ['בחוק', 'חוק']. Words that just start with a prefix letter also get
    a (wrong) stem, e.g. 'משה' -> 'שה'; that only adds recall, the original word stays."""
    out: list[str] = []
    w = word
    for _ in range(3):
        if len(w) - 1 < _MIN_STEM + 1 or not _HEBREW_WORD.match(w) or w[0] not in PREFIXES:
            break
        w = w[1:]
        out.append(w)
    return out


def index_text(*parts: str | None) -> str:
    """The searchable form of a document: normalised text plus prefix-stripped variants."""
    words = normalize(" ".join(p for p in parts if p)).split()
    extra = [stem for w in words for stem in strip_prefixes(w)]
    seen: set[str] = set()
    out = []
    for w in words + extra:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return " ".join(out)
