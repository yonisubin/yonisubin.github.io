from app.hebrew import index_text, normalize, strip_prefixes


def test_strips_niqqud_and_cantillation():
    assert normalize("שָׁלוֹם") == "שלומ"
    assert normalize("בְּרֵאשִׁ֖ית") == "בראשית"


def test_unifies_final_letters():
    assert normalize("שלום") == normalize("שלומ") == "שלומ"
    assert normalize("ךםןףץ") == "כמנפצ"


def test_quotes_and_gershayim_are_dropped():
    assert normalize('התשפ"ו') == normalize("התשפ״ו") == normalize("התשפו") == "התשפו"
    assert normalize("צה\"ל") == "צהל"


def test_punctuation_maqaf_and_case():
    assert normalize("חוק עבודת נשים (תיקון מס' 67), 2026") == "חוק עבודת נשימ תיקונ מס 67 2026"
    assert normalize("קריאה שנייה־שלישית") == "קריאה שנייה שלישית"
    assert normalize("  Knesset   LAW ") == "knesset law"


def test_prefix_variants():
    assert strip_prefixes("ובחוק") == ["בחוק", "חוק"]
    assert strip_prefixes("חוק") == []  # too short to strip
    assert strip_prefixes("law") == []
    assert "חיילימ" in index_text("לחיילים בודדים").split()


def test_index_text_dedupes_and_keeps_order():
    assert index_text("החוק", "החוק") == "החוק חוק"
