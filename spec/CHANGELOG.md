# Record Protocol Specification — Changelog

## v1.0.1 — 2026-10-02

Erratum, no wire change. §4.4.2 listed `identity` among the signed-entry fields hashed for the current-state tiebreaker; signed entries carry no `identity` field (§3.4). The text now names `key` and `sig`.

## v1.0.0 — 2026-06-08

Finalized per task `user:task/record/finalize-record-protocol-v1-spec.md`.
