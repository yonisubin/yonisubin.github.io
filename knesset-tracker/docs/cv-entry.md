# CV entry

Measured locally. Replace the bracketed numbers with production measurements after deploying
(see the README's "Measured numbers").

> **Knesset Tracker**: a bilingual (Hebrew/English) legislative tracker built on the Knesset's
> official open data. Python, FastAPI, PostgreSQL (Neon), React, Wasmer Edge. Runs entirely on
> free tiers.
>
> - Built an incremental, idempotent sync pipeline mirroring 229k+ records across 21 API
>   entities, resumable at page granularity, with field-level change events.
> - Designed a change-event and alert system with exactly-once email delivery across retries and
>   crashes (dedupe keys and provider idempotency keys), verified by fault-injection tests.
> - Implemented Hebrew search with trigram indexing and custom normalisation: 30/30 on a relevance
>   set built from real data, MRR 0.978, p95 [72] ms.
> - Shipped a fully RTL/LTR interface scoring 100 on Lighthouse accessibility in both locales,
>   with CI/CD, Playwright end-to-end tests (including email delivery) and production monitoring.
> - Reconstructed bill histories the source doesn't publish (99.1% of current bills get a dated
>   timeline), and built a data-quality layer that found and disclosed systematic problems in
>   the official data.

**Interview stories:**
1. The ~1 s search queries, and the query-plan reading that fixed them.
2. The `record_hash` table that turned out to be the largest table.
3. The `-1` committee placeholder.
4. The quality rule that caught my own stage-model assumption.
5. Why push notifications carry no payload.
