# Record Protocol Specification — Changelog

## v1.0.4 — 2026-10-02

Erratum, no vector change. §2.4.1 typed `content.hash` and `content.artwork` as `<CID>` while the published F2 vector stores `hash` as a base58btc string and §2.1 makes base58btc the CID encoding in entries. Both fields are now base58btc CID strings, which §5.5.1 and §6.2.4 restate as the stored form; readers still accept any valid CID string. §2.2.1 notes that the F2 `hash` is a placeholder, not a profile-conformant audio CID. F7 asserts the base58btc form, with base32 printed as an informative equivalent.

## v1.0.3 — 2026-10-02

Erratum. §2.10, §1.2, and §6.6 require `content.hash` to be stable across peers, while §2.1 and §6.2.4 left the audio CID to each peer's content-network import defaults, so two conformant peers could write different CIDs for byte-identical audio. §5.5.1 now pins the IPIP-499 `unixfs-v1-2025` import profile for audio blobs and artwork, forbids overriding its parameters, and requires readers to accept any valid CID, so legacy CIDv0 entries stay readable. §2.1, §4.6, §6.2.4, §6.6, and §1.2.4 now reference the profile. §6.2.4 drops its "anchored to the stripped bytes" paragraph and prints the fixture's audio CID and a multi-block vector. `/audio/{cid}` accepts CIDv0 as well as CIDv1. F7 asserts both CIDs and pins `ipfs-unixfs-importer`.

## v1.0.2 — 2026-10-02

Erratum. §4.1.1 called `next` and `refs` "IPLD link fields" while §3.4.1, §3.4.3, and §5.3.2 type them `string[]`; the two readings hash every non-root entry differently. They are plain base58btc strings, and §4.1.2 adds a child-entry vector with a non-empty `next`. §4.6 now states that AC chain objects 1-3 are a MUST pin, matching §3.5.1. The §6.1.5 test procedure passes `-algorithm 2` to fpcalc, as §6.1.2 requires.

## v1.0.1 — 2026-10-02

Erratum, no wire change. §4.4.2 listed `identity` among the signed-entry fields hashed for the current-state tiebreaker; signed entries carry no `identity` field (§3.4). The text now names `key` and `sig`.

## v1.0.0 — 2026-06-08

Finalized per task `user:task/record/finalize-record-protocol-v1-spec.md`.
