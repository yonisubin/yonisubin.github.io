import { describe, expect, it } from "vitest";
import { dirOf, formatDate, formatHebrewDate, ordinalKnesset, t } from "./i18n";

describe("i18n", () => {
  it("maps languages to text direction", () => {
    expect(dirOf("he")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
  });

  it("interpolates variables", () => {
    expect(t("en", "pageOf", { p: 2, n: 5 })).toBe("Page 2 of 5");
    expect(t("he", "pageOf", { p: 2, n: 5 })).toBe("עמוד 2 מתוך 5");
  });

  it("names Knesset terms with correct English ordinals", () => {
    expect(ordinalKnesset("en", 25)).toBe("25th Knesset");
    expect(ordinalKnesset("en", 21)).toBe("21st Knesset");
    expect(ordinalKnesset("en", 22)).toBe("22nd Knesset");
    expect(ordinalKnesset("en", 23)).toBe("23rd Knesset");
    expect(ordinalKnesset("en", 11)).toBe("11th Knesset");
    expect(ordinalKnesset("he", 25)).toBe("הכנסת ה־25");
  });

  it("formats dates in Israel time, whatever the viewer's time zone", () => {
    // 23:30 UTC on 6 Jan is already 7 Jan in Jerusalem
    expect(formatDate("2026-01-06T23:30:00Z", "en")).toBe("7 Jan 2026");
  });

  it("formats Hebrew calendar dates", () => {
    expect(formatHebrewDate("2026-01-07T12:00:00+02:00", "en")).toBe("18 Tevet 5786");
    expect(formatHebrewDate("2026-01-07T12:00:00+02:00", "he")).toContain("טבת");
  });
});
