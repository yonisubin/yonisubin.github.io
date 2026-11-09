# Launch posts (drafts)

Fill in the live link and the measured numbers after deploying. Keep the tone factual:
the project reports, it doesn't judge.

## LinkedIn (English)

I built **Knesset Tracker**, a bilingual (Hebrew/English) way to follow what happens in the
Knesset, built on its official open data: <LIVE LINK>

- Follow a bill, an MK, a committee or a keyword ("lone soldiers", "דמי לידה") and get an email
  or browser notification when something changes. Each alert says exactly what changed.
- Every bill has a plain-language stage, a "what happens next" line and a dated timeline.
  The Knesset publishes only a bill's current status, so the timeline is reconstructed from
  plenum and committee agendas and votes.
- Hebrew search that copes with prefixes, niqqud and typos, a public JSON API, and a page that
  lists the problems found in the official data.
- No scores, no rankings, no labels. Every fact links to its official record.

The engineering, briefly:
- an incremental, idempotent sync that mirrors <N> records and turns every change into an event;
- alerts with exactly-once delivery, proven by fault-injection tests;
- trigram search with Hebrew normalisation, at p95 <N> ms;
- a fully RTL/LTR interface scoring <N> on Lighthouse accessibility.

It all runs at ₪0 on free tiers (Wasmer Edge and Neon). Code and design notes: <REPO LINK>.
The most interesting part was the data itself; the README has a section on what I learned.

Feedback is very welcome, especially from journalists, NGO staff and researchers who follow
legislation.

## Hasadna community channel (Hebrew)

שלום לכולם,

בניתי את **מעקב הכנסת**, אתר דו־לשוני (עברית/אנגלית) למעקב אחר הנעשה בכנסת על בסיס המידע הפתוח
הרשמי (ממשק OData v4): <LIVE LINK>

- אפשר לעקוב אחרי הצעת חוק, חבר/ת כנסת, ועדה או ביטוי חופשי, ולקבל התראה במייל או בדפדפן כשמשהו
  משתנה. כל התראה אומרת בדיוק מה השתנה.
- לכל הצעת חוק יש שלב נוכחי בשפה פשוטה, „מה הלאה”, וציר זמן מתוארך. ציר הזמן משוחזר מסדרי היום של
  המליאה והוועדות ומההצבעות, כי ב־KNS_Bill יש רק את הסטטוס הנוכחי.
- חיפוש בעברית שמתמודד עם קידומות, ניקוד ושגיאות הקלדה, ממשק API ציבורי עם שמות שדות באנגלית,
  ודף שמפרט בעיות שמצאנו במידע הרשמי.

כמה דברים שמצאתי במידע ואולי יעניינו אתכם:
- ב־12,363 הצעות חוק הערך CommitteeID הוא ‎-1 („אין ועדה”).
- אצל 37,574 מתוך 42,824 שאילתות מספר הכנסת הוא 0–9.
- פסק זמן בשרת חוזר כתשובת ‎200 ריקה.
- תוצאות ההצבעה כוללות רק את מי שנרשם, כך שהיעדר רשומה אינו מעיד על היעדרות.

הרשימה המלאה בדף איכות המידע באתר ובקובץ DATA_MEMO שבמאגר. אשמח לפתוח issues בפרויקט knesset-data
על הממצאים, אם זה עוזר.

האתר לא מדרג ולא מתייג חברי כנסת או הצעות חוק, וכל עובדה מקושרת לרשומה הרשמית. הקוד פתוח:
<REPO LINK>. אשמח לכל משוב.
