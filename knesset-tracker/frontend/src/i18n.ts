// UI strings and locale helpers. Data values (bill names, statuses...) come from the
// API with Hebrew as published and English translations flagged by `en_translated`.

export type Lang = "he" | "en";
export const LANGS: Lang[] = ["he", "en"];
export const isLang = (s: string | undefined): s is Lang => s === "he" || s === "en";
export const dirOf = (lang: Lang) => (lang === "he" ? "rtl" : "ltr");

const ui = {
  siteName: { he: "מעקב הכנסת", en: "Knesset Tracker" },
  tagline: {
    he: "הצעות חוק, חברי כנסת וועדות: מה קרה, מתי, ומי היה מעורב. על בסיס המידע הפתוח של הכנסת.",
    en: "Bills, MKs and committees: what happened, when, and who was involved. Built on the Knesset's open data.",
  },
  skip: { he: "דילוג לתוכן", en: "Skip to content" },
  bills: { he: "הצעות חוק", en: "Bills" },
  mks: { he: "חברי כנסת", en: "MKs" },
  committees: { he: "ועדות", en: "Committees" },
  home: { he: "ראשי", en: "Home" },
  otherLang: { he: "English", en: "עברית" },
  loading: { he: "טוען…", en: "Loading…" },
  error: { he: "שגיאה בטעינת הנתונים.", en: "Could not load the data." },
  retry: { he: "נסו שוב", en: "Try again" },
  notFound: { he: "הדף לא נמצא.", en: "Page not found." },
  knesset: { he: "כנסת", en: "Knesset" },
  knessetN: { he: "הכנסת ה־{n}", en: "{n}th Knesset" },
  allTerms: { he: "כל הכנסות", en: "All terms" },
  stage: { he: "שלב", en: "Stage" },
  allStages: { he: "כל השלבים", en: "All stages" },
  type: { he: "סוג", en: "Type" },
  allTypes: { he: "כל הסוגים", en: "All types" },
  status: { he: "סטטוס", en: "Status" },
  committee: { he: "ועדה", en: "Committee" },
  lastUpdated: { he: "עודכן", en: "Updated" },
  results: { he: "{n} תוצאות", en: "{n} results" },
  prev: { he: "הקודם", en: "Previous" },
  next: { he: "הבא", en: "Next" },
  pageOf: { he: "עמוד {p} מתוך {n}", en: "Page {p} of {n}" },
  source: { he: "רשומה רשמית", en: "Official record" },
  sourceTitle: { he: "הרשומה במאגר המידע הפתוח של הכנסת", en: "This record in the Knesset's open data API" },
  translatedMark: { he: "תרגום של האתר", en: "translated by this site" },
  translatedNote: {
    he: "שמות, כותרות וסטטוסים מוצגים כפי שפורסמו על ידי הכנסת.",
    en: "Names, titles and statuses are shown in Hebrew as the Knesset publishes them. English labels marked with a dotted underline were translated by this site; the official data has no English names for people, bills or committees.",
  },
  footerData: {
    he: "המידע מגיע מממשק OData הרשמי של הכנסת ומתעדכן כל 30 דקות. האתר אינו מדרג ואינו מעריך חברי כנסת או הצעות חוק.",
    en: "Data comes from the Knesset's official OData API and refreshes every 30 minutes. This site does not score, rank or label MKs or bills.",
  },
  lastSync: { he: "סנכרון אחרון", en: "Last sync" },
  apiDocs: { he: "ממשק API ציבורי", en: "Public API" },
  // bills
  billNo: { he: "מספר", en: "Number" },
  initiators: { he: "יוזמים", en: "Initiators" },
  joinedInitiators: { he: "הצטרפו", en: "Joined" },
  currentStage: { he: "שלב נוכחי", en: "Current stage" },
  whatNext: { he: "מה הלאה", en: "What happens next" },
  timeline: { he: "ציר זמן", en: "Timeline" },
  summary: { he: "תקציר (מתוך המידע הרשמי)", en: "Summary (official, in Hebrew)" },
  names: { he: "שמות ההצעה לפי שלב", en: "Names by stage" },
  documents: { he: "מסמכים", en: "Documents" },
  publication: { he: "פרסום ברשומות", en: "Published in Reshumot" },
  ev_plenum_agenda: { he: "בסדר היום של המליאה", en: "On the plenum agenda" },
  ev_committee_session: { he: "דיון בוועדה", en: "Committee session" },
  ev_vote: { he: "הצבעה במליאה", en: "Plenum vote" },
  ev_status_change: { he: "שינוי סטטוס שזוהה", en: "Status change detected" },
  cancelled: { he: "בוטלה", en: "Cancelled" },
  recorded: { he: "הצבעות שנרשמו: {f} בעד, {a} נגד, {x} נמנעו", en: "Recorded votes: {f} for, {a} against, {x} abstained" },
  sessionPage: { he: "דף הישיבה", en: "Session page" },
  noBills: { he: "לא נמצאו הצעות חוק.", en: "No bills found." },
  journey: { he: "מסלול החקיקה", en: "Legislative journey" },
  // mks
  factions: { he: "סיעות", en: "Factions" },
  government: { he: "תפקידים בממשלה", en: "Government roles" },
  committeeRoles: { he: "חברות בוועדות", en: "Committee memberships" },
  billsInitiated: { he: "הצעות חוק שיזם/ה", en: "Bills initiated" },
  byStage: { he: "לפי שלב נוכחי", en: "By current stage" },
  queries: { he: "שאילתות", en: "Parliamentary questions" },
  votes: { he: "הצבעות אחרונות שנרשמו", en: "Recent recorded votes" },
  ministry: { he: "משרד", en: "Ministry" },
  submitted: { he: "הוגשה", en: "Submitted" },
  answered: { he: "נענתה", en: "Answered" },
  none: { he: "אין רשומות.", en: "No records." },
  showingFirst: { he: "מוצגות {n} האחרונות מתוך {t}. להצגת כל ההצעות", en: "Showing the latest {n} of {t}. Show all of them" },
  present: { he: "היום", en: "present" },
  mkListNote: {
    he: "הרשימה ממוינת לפי שם משפחה. לכל חבר כנסת אותו מבנה דף ואותם שדות.",
    en: "Sorted by Hebrew surname. Every MK has the same page layout and fields.",
  },
  // committees
  members: { he: "חברים", en: "Members" },
  upcoming: { he: "ישיבות קרובות", en: "Upcoming sessions" },
  past: { he: "ישיבות קודמות", en: "Past sessions" },
  noUpcoming: { he: "לא פורסמו ישיבות קרובות.", en: "No upcoming sessions published." },
  sessions: { he: "{n} ישיבות", en: "{n} sessions" },
  agenda: { he: "סדר היום", en: "Agenda" },
  // home
  recentChanges: { he: "שינויים אחרונים בהצעות חוק", en: "Recent bill changes" },
  noChanges: {
    he: "עדיין לא זוהו שינויים מאז תחילת המעקב.",
    en: "No changes detected yet since tracking started.",
  },
  recentlyUpdated: { he: "הצעות חוק שעודכנו לאחרונה", en: "Recently updated bills" },
  allBills: { he: "כל הצעות החוק", en: "Browse all bills" },
  newBill: { he: "הצעת חוק חדשה", en: "New bill" },
  // search
  search: { he: "חיפוש", en: "Search" },
  searchPlaceholder: { he: "חיפוש הצעות חוק, חוקים, ח״כים, ועדות…", en: "Search bills, laws, MKs, committees…" },
  searchHint: {
    he: "אפשר לחפש בעברית עם או בלי ניקוד וקידומות (ה, ו, ב, ל…). שגיאות הקלדה קטנות נסלחות.",
    // \u2068...\u2069 isolate the Hebrew letters so the brackets don't get reordered
    en: "Search in Hebrew, with or without niqqud and prefixes (\u2068ה, ו, ב, ל…\u2069). Small typos are tolerated. Names in the official data are Hebrew only.",
  },
  noResults: { he: "לא נמצאו תוצאות.", en: "No results." },
  allKinds: { he: "הכול", en: "Everything" },
  kind_bill: { he: "הצעת חוק", en: "Bill" },
  kind_law: { he: "חוק", en: "Law" },
  kind_person: { he: "חבר/ת כנסת", en: "MK" },
  kind_committee: { he: "ועדה", en: "Committee" },
  kind_query: { he: "שאילתה", en: "Question" },
  from: { he: "מתאריך", en: "From" },
  to: { he: "עד תאריך", en: "To" },
  moreResults: { he: "תוצאות נוספות", en: "More results" },
  // accounts & alerts
  signIn: { he: "כניסה", en: "Sign in" },
  account: { he: "החשבון שלי", en: "My account" },
  follow: { he: "מעקב", en: "Follow" },
  follow_bill: { he: "מעקב אחר ההצעה", en: "Follow this bill" },
  follow_mk: { he: "מעקב אחר חבר/ת הכנסת", en: "Follow this MK" },
  follow_committee: { he: "מעקב אחר הוועדה", en: "Follow this committee" },
  following: { he: "במעקב ✓", en: "Following ✓" },
  followHint: { he: "קבלו התראה כשמשהו משתנה", en: "Get an alert when something changes" },
  followSearch: { he: "מעקב אחר הביטוי „{q}”", en: "Follow the keyword “{q}”" },
  signInToFollow: { he: "היכנסו כדי לעקוב", en: "Sign in to follow" },
  loginTitle: { he: "כניסה למעקב הכנסת", en: "Sign in to Knesset Tracker" },
  loginIntro: {
    he: "אין סיסמאות: נשלח אליכם קישור כניסה במייל. כך אפשר לעקוב אחר הצעות חוק, חברי כנסת, ועדות וביטויים ולקבל התראות.",
    en: "No passwords: we email you a sign-in link. Then you can follow bills, MKs, committees and keywords and get alerts.",
  },
  email: { he: "כתובת מייל", en: "Email address" },
  sendLink: { he: "שליחת קישור כניסה", en: "Email me a sign-in link" },
  linkSent: { he: "שלחנו קישור כניסה ל־{email}. הקישור בתוקף 20 דקות.", en: "We sent a sign-in link to {email}. It's valid for 20 minutes." },
  verifying: { he: "מתחברים…", en: "Signing you in…" },
  verifyFailed: { he: "הקישור אינו תקף, פג תוקפו או שכבר נעשה בו שימוש.", en: "This link is invalid, expired or already used." },
  tryAgain: { he: "לבקשת קישור חדש", en: "Request a new link" },
  emailsSection: { he: "התראות במייל", en: "Email alerts" },
  frequency: { he: "תדירות", en: "How often" },
  freq_instant: { he: "מיד (תוך כ־30 דקות)", en: "Instantly (within ~30 minutes)" },
  freq_daily: { he: "סיכום יומי", en: "Daily digest" },
  freq_weekly: { he: "סיכום שבועי (ביום ראשון)", en: "Weekly digest (Sundays)" },
  emailOn: { he: "שליחת מיילים פעילה", en: "Send me emails" },
  language: { he: "שפת ההתראות", en: "Alert language" },
  pushSection: { he: "התראות בדפדפן", en: "Browser notifications" },
  pushOn: { he: "הפעלה במכשיר הזה", en: "Turn on for this device" },
  pushOff: { he: "כיבוי במכשיר הזה", en: "Turn off for this device" },
  pushDevices: { he: "מכשירים רשומים: {n}", en: "Registered devices: {n}" },
  pushUnsupported: { he: "הדפדפן הזה אינו תומך בהתראות.", en: "This browser doesn't support notifications." },
  myFollows: { he: "מה אני עוקב/ת אחריו", en: "What I follow" },
  noFollows: { he: "עדיין לא עוקבים אחרי כלום. אפשר ללחוץ „מעקב” בדפי הצעות חוק, חברי כנסת וועדות, או לעקוב אחרי ביטוי מדף החיפוש.", en: "Nothing yet. Use “Follow” on bill, MK and committee pages, or follow a keyword from the search page." },
  unfollow: { he: "הסרה", en: "Remove" },
  recentAlerts: { he: "התראות אחרונות", en: "Recent alerts" },
  noAlerts: { he: "עדיין אין התראות.", en: "No alerts yet." },
  signOut: { he: "יציאה", en: "Sign out" },
  deleteAccount: { he: "מחיקת החשבון", en: "Delete my account" },
  deleteConfirm: { he: "למחוק את החשבון, כל המעקבים וכל ההתראות? אי אפשר לבטל.", en: "Delete your account, all follows and all alerts? This can't be undone." },
  saved: { he: "נשמר", en: "Saved" },
  kindLabel_bill: { he: "הצעת חוק", en: "Bill" },
  kindLabel_mk: { he: "חבר/ת כנסת", en: "MK" },
  kindLabel_committee: { he: "ועדה", en: "Committee" },
  kindLabel_keyword: { he: "ביטוי", en: "Keyword" },
  // phase 5
  statusTitle: { he: "מצב המערכת", en: "Status" },
  statusOk: { he: "המידע מעודכן", en: "Data is up to date" },
  statusStale: { he: "חלק מהטבלאות לא סונכרנו בשעה האחרונה", en: "Some tables haven't synced in the last hour" },
  staleTables: { he: "טבלאות שלא סונכרנו", en: "Not synced" },
  statusIntro: {
    he: "האתר מסנכרן את המידע מהכנסת כל 30 דקות. לכל טבלה: מתי הסתיים בהצלחה הסנכרון האחרון, ועד מתי המידע עדכני.",
    en: "The site copies the Knesset's data every 30 minutes. For each table: when its last sync succeeded, and how recent its data is.",
  },
  entity: { he: "טבלה", en: "Table" },
  lastSuccess: { he: "סנכרון מוצלח אחרון", en: "Last successful sync" },
  dataUpTo: { he: "עדכון אחרון במקור", en: "Latest change at the source" },
  lastErrorCol: { he: "שגיאה", en: "Error" },
  dataQuality: { he: "איכות המידע", en: "Data quality" },
  dataQualityIntro: {
    he: "בדיקות אוטומטיות שרצות כל לילה על המידע הרשמי. אנחנו מציגים בעיות שמצאנו ולא מתקנים או משלימים את המידע בניחושים.",
    en: "Automatic checks that run every night on the official data. We show the problems we find; we never fix or fill in the data by guesswork.",
  },
  openIssues: { he: "פתוחות", en: "Open" },
  examples: { he: "דוגמאות", en: "Examples" },
  noticeTitle: { he: "הערה על המידע", en: "About this data" },
  apiTitle: { he: "ממשק API ציבורי", en: "Public API" },
  footerNav: { he: "על האתר", en: "About the site" },
  pageAbbr: { he: "עמ׳", en: "p." },
  aboutDataQuality: { he: "איך אנחנו בודקים את המידע", en: "How we check the data" },
  heroTitle: { he: "מה קורה בכנסת, צעד אחר צעד", en: "What the Knesset is doing, step by step" },
  heroLead: {
    he: "חפשו הצעת חוק, חבר/ת כנסת או ועדה, ראו בדיוק באיזה שלב הם נמצאים, וקבלו התראה כשמשהו זז.",
    en: "Look up a bill, an MK or a committee, see exactly where it stands, and get an alert when it moves.",
  },
  latestMovement: { he: "התזוזה האחרונה בכנסת", en: "Latest movement in the Knesset" },
  recentlyUpdatedOne: { he: "הצעת החוק שעודכנה לאחרונה", en: "Most recently updated bill" },
} satisfies Record<string, Record<Lang, string>>;

export type Key = keyof typeof ui;

export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  return ui[key][lang].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

const TZ = "Asia/Jerusalem"; // the Knesset's dates are Israel time

export function formatDate(iso: string | null | undefined, lang: Lang, withTime = false): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return new Intl.DateTimeFormat(lang === "he" ? "he-IL" : "en-GB", {
    timeZone: TZ, day: "numeric", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
}

export function formatHebrewDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  // e.g. "י״ג בכסלו תשפ״ז" in Hebrew, "13 Kislev 5787" in English
  return new Intl.DateTimeFormat(lang === "he" ? "he-IL-u-ca-hebrew" : "en-GB-u-ca-hebrew", {
    timeZone: TZ, day: "numeric", month: "long", year: "numeric",
  }).format(new Date(iso));
}

export function ordinalKnesset(lang: Lang, n: number): string {
  if (lang === "he") return t(lang, "knessetN", { n });
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s} Knesset`;
}
