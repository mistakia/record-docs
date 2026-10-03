# Record Protocol Specification — Changelog

## v1.0.2 — 2026-10-02

Erratum. §4.1.1 called `next` and `refs` "IPLD link fields" while §3.4.1, §3.4.3, and §5.3.2 type them `string[]`; the two readings hash every non-root entry differently. They are plain base58btc strings, and §4.1.2 adds a child-entry vector with a non-empty `next`. §4.6 now states that AC chain objects 1-3 are a MUST pin, matching §3.5.1. The §6.1.5 test procedure passes `-algorithm 2` to fpcalc, as §6.1.2 requires.

## v1.0.1 — 2026-10-02

Erratum, no wire change. §4.4.2 listed `identity` among the signed-entry fields hashed for the current-state tiebreaker; signed entries carry no `identity` field (§3.4). The text now names `key` and `sig`.

## v1.0.0 — 2026-06-08

Finalized per task `user:task/record/finalize-record-protocol-v1-spec.md`.
