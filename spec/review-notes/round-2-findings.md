# Round 2 Review Findings — Record Protocol v1 Draft

**Context.** Round 1 surfaced ~30 gaps across the 7 chapters and landed as
commit `aeb310a2`. This round takes a fresh pass and focuses on gaps that
round 1 either missed or left incompletely resolved. The headline finding
is that the §3 identity/signing chapter, as written, is not implementable
on `@orbitdb/core` 3.0; it also does not match the reference
implementation's identity shape without custom hooks. Everything else is
smaller and mostly mechanical.

This document is **research output**. It does not edit the spec. The
mechanical fixes listed in §B can land without further direction; the
signing divergence in §A requires a decision from the protocol owner.

## A. Chapter 3 signing / identity does not match OrbitDB 3.0

### A.1 Evidence

Running the current reference OrbitDB 3.0 stack
(`@orbitdb/core@3.0.2`, `@helia/dag-cbor@4`, libp2p-crypto `secp256k1`)
in `/tmp/record-prototype/prototype.js` produces this identity on a
freshly created OrbitDB instance:

```
identityId:    03852eb660f1c2de19568f416fe316543e1163cde1c403449947cf19598024fa5a
identityHash:  zdpuAy47osWNKUxvrfEnP81b9LGWvRHoTyQvUxwvizJSXyaoj
publicKey:     026a351d78ef8a8c5ac561af1459c751c4f799c6...  (66 hex chars)
type:          publickey
```

The source of each value (file paths are inside
`/tmp/record-prototype/node_modules`):

- `@libp2p/crypto/.../secp256k1.js` line 14:
  `this.raw = compressSecp256k1PublicKey(this._key)`. Libp2p's
  `secp256k1.PublicKey.raw` is **compressed** (33 bytes, 02/03 prefix).
- `@orbitdb/core/src/key-store.js` `getPublic` returns
  `uint8ArrayToString(pubKey, 'base16')`, so OrbitDB surfaces the
  compressed pubkey as 66 lowercase hex chars.
- `@orbitdb/core/src/identities/providers/publickey.js` `getId` returns
  that same 66-char compressed pubkey hex — **not** `sha256(pubkey)`.
- `@orbitdb/core/src/oplog/entry.js` `create` builds the signing
  object as `{ id, payload, next, refs, clock, v: 2 }` (no `hash`
  field) and passes its dag-cbor bytes straight to
  `identity.sign(identity, bytes)`. `entry.identity` on the signed
  object is then set to `identity.hash` (a base58btc CID of a
  separately encoded identity block), not an inline identity object.
- `@orbitdb/core/src/identities/identities.js` `createIdentity`
  signs `id` as one message and `publicKey + signatures.id` as the
  other for `signatures.publicKey` — not `publicKey` alone as
  §3.5.1 claims.

### A.2 Spec divergences

The spec §3 and its §3.4.5 test vector contradict OrbitDB 3.0 in at
least these five places:

| # | Area | Spec says | OrbitDB 3.0 emits |
|---|------|-----------|-------------------|
| 1 | Pubkey encoding (§3.1) | MUST uncompressed SEC1, 130 hex chars, starts `04` | compressed, 66 hex chars, starts `02`/`03` |
| 2 | Node ID (§3.2) | `sha256(pubkey_hex_lowercase)` → 64 hex chars | `identity.id === identity.publicKey` (compressed pubkey hex) |
| 3 | Unsigned entry shape (§3.4.1) | includes `hash: null` field | omits `hash` field entirely |
| 4 | Entry `identity` field (§4.1.1, §3.5) | inline Identity object | base58btc CID string of a separately stored identity |
| 5 | `signatures.publicKey` input (§3.5.1) | UTF-8 bytes of `publicKey` | UTF-8 bytes of `publicKey + signatures.id` concatenation |

Items 1–3 independently break the §3.4.5 signing vector:

- The spec vector encodes the unsigned entry to **538 bytes** of
  dag-cbor. Running
  `spec/fixtures/gen-signing-vector-orbitdb3.mjs` (the OrbitDB-3.0
  shape with the same private key) produces a **468-byte** dag-cbor
  block: a completely different byte sequence, a different SHA-256
  digest (`c3378d07…` vs `e4c3f794…`), and a different DER
  signature. The current vector is internally consistent but cannot
  be produced by any OrbitDB 3.0 call path.

### A.3 What about the reference implementation?

`record-node/index.js` explicitly **decompresses** the libp2p
secp256k1 public key on line 6 (`decompressPublicKey` import) and
stores `publicKey` in its own wrapper object as the 130-char
uncompressed hex. Line 161 computes `this._id = sha256(key.publicKey)`
consistent with §3.2. So at the record-node wrapper layer the spec
matches reality.

But the wrapper does not reach inside OrbitDB's own identity flow.
`record-node` uses a custom fork
(`mistakia/orbit-db#proto/record`) of the 0.x-era `orbit-db` tree
along with `orbit-db-identity-provider@0.3` and
`orbit-db-keystore@0.3.5`. Whatever those forks sign is the actual
on-wire format. The current spec text and §3.4.5 vector should
match those forks, not `@orbitdb/core` 3.0. **That assumption has
not been verified in this round** (the relevant packages are not
installed in the record-node checkout, and the fork's identity
source was not read). Until it is, the spec should be treated as
asserting a shape whose match against the reference implementation
is unverified.

### A.4 Decision needed

Three possible resolutions, pick one:

1. **Spec is authoritative, record-node is the reference for v1.**
   - Verify that the `mistakia/orbit-db#proto/record` fork actually
     produces the 538-byte signing input shape with `hash: null`
     and uncompressed pubkey, and cite the fork hash in §3.
   - Document that `@orbitdb/core` 3.0 is **not** compatible with v1
     without a custom identity provider that forces uncompressed
     pubkey and the §3.4.1 unsigned-entry shape.
   - Either ship that custom provider as part of the reference
     implementation, or mark @orbitdb/core 3.0 as a non-compliant
     runtime.

2. **OrbitDB 3.0 is authoritative, update the spec.**
   - Rewrite §3.1 to allow compressed pubkey (or require it).
   - Rewrite §3.2 to make `node_id == publicKey` (66 hex chars),
     or rederive node_id from the libp2p peer ID.
   - Remove `hash: null` from §3.4.1.
   - Change `entry.identity` from inline object to CID reference,
     and reword §3.5.2 verification to include "fetch identity by
     CID, decode, and re-verify".
   - Regenerate §3.4.5 using
     `spec/fixtures/gen-signing-vector-orbitdb3.mjs`.
   - Accept that `sha256` no longer hides the pubkey from passive
     observers of entry metadata (if that was ever a goal).

3. **Protocol-owned identity layer.** Define signing end-to-end in
   the spec independent of OrbitDB, and either fork
   `@orbitdb/core` or intercept OrbitDB's signing hook to replace
   its identity flow. This is the most work but unblocks any
   future move off OrbitDB entirely.

Option 1 preserves wire compatibility with any already-deployed
record-node but leaves new implementers unable to build on stock
OrbitDB. Option 2 lets new implementers build on @orbitdb/core 3.0
but **breaks any on-disk data already signed by record-node** —
existing entries would fail verification under the new rules.
Option 3 is the cleanest long-term answer but the highest cost.

### A.5 Subsidiary notes

- The DER signature bytes in §3.4.5 are a function of the RFC 6979
  deterministic nonce derived from `(priv, digest)`. Any change to
  the digest (including items 1–3 in §A.2 above) changes the
  signature.
- The §3.4.5 "content CID placeholder" paragraph is misleading: the
  placeholder **does** have deterministic dag-cbor bytes. A reader
  regenerating the vector will reproduce the placeholder exactly; it
  is not actually a placeholder, just an unreferenced CID. The wording
  should match reality.

## B. Mechanical fixes (land without further direction)

### B.1 Chapter 1 — glossary table

§1.3 is currently prose. First-time readers have to scan 10 bolded
terms and infer relationships. A compact glossary table at the top of
§1.3 followed by the existing prose definitions would cut the cold
read time significantly. The layering diagram in §1.3 is correct but
does not disambiguate that "log entry" collides three ways:

1. the §2.5 federation link (record-entry-envelope `type:"log"`),
2. the §4.1 signed log entry (the DAG node),
3. an entry in the generic "append-only log" sense.

Concretely: one-line additions distinguishing Log entry (§2.5) from
Signed log entry (§4.1) from "log entry (generic)" would cover most
of the ambiguity. A full table is nice-to-have, not required.

### B.2 §5.4.2 concrete concurrency / timeout floors

The current text says "implementation choice but MUST be finite".
Without a floor, a conformant implementation could set `concurrency
= 1` and `timeout = 1ms` and still claim compliance while being
practically unusable. Suggested floor defaults (not ceilings):

- **Concurrency per library**: SHOULD default to at least 4 in-flight
  fetches.
- **Per-entry timeout**: SHOULD default to at least 30 seconds.
- **Overall subgraph budget**: SHOULD apply a wall-clock budget (e.g.
  10 minutes) before declaring a head message "abandoned" rather than
  retrying indefinitely.

These are defaults, not caps. Keep the "MUST be finite" language.

### B.3 §7.6 bearer-token rough edges

- 401 responses MUST include a `WWW-Authenticate: Bearer` header per
  RFC 7235 §4.1 so clients can distinguish "auth required" from
  "auth accepted but wrong scope". Currently §7.6 says nothing about
  the response header.
- Token rotation: the current text says "SHOULD generate an initial
  token at first launch" and "MAY support additional tokens via
  POST /settings/auth-tokens". It should also say:
  - The admin endpoint MUST support deletion / revocation of
    individual tokens.
  - The implementation MUST accept any token in its configured set
    (multi-token is explicit, not accidental).
  - On token revocation, in-flight requests using the revoked token
    MAY complete but subsequent requests MUST be rejected.
- Audit logging: §7.6 should say that token-authenticated requests
  SHOULD be logged with a token identifier (a truncated hash of the
  token, not the token itself) so operators can correlate actions.
- The "Transport" paragraph currently says SHOULD warn on plain
  HTTP. Strengthen to MUST refuse to bind non-loopback + plain HTTP
  unless an explicit `--insecure` flag is set, to avoid silent
  misconfigurations.

### B.4 §2.2 envelope malleability

§2.2 says "Implementations MAY include additional type-specific
extras on the envelope. The only extra currently defined by this
specification is Track's `tags` field (§2.4.3)". This creates a
malleability hole: a hostile writer can inflate the envelope with
arbitrary extras that conformant readers must accept. Suggested
tightening:

- §2.2 MUST list the allowed extras. Today that list is `tags`
  on Track envelopes, full stop. Other extras MUST be ignored on
  read and MUST NOT be produced on write.
- `tags` itself should have a cap: no more than 256 entries, no tag
  longer than 128 UTF-8 bytes, total tags array serialised to at
  most 8 KiB. Without a cap an envelope can carry a megabyte of
  labels on one track.

### B.5 §4.8 dual-indexing is still thin

Round 1 clarified "library vs query database" but §4.8 itself is
three sentences. Two paragraphs would help:

- Enumerate what a query index typically holds (tracks, tags,
  current-state resolution, listens by track, peers by library).
- State that every cell in the query index MUST be derivable from
  the oplog alone — i.e. the query database is a pure projection,
  not a source of authoritative state.
- State that rebuild-from-oplog MUST be idempotent: two successive
  rebuilds produce the same index state.

No schema needs to be prescribed.

### B.6 §6.1.2 Chromaprint algorithm version

§6.1.2 says "Chromaprint's default parameters" but default algorithm
version can change between releases. Chromaprint itself has
historically shipped algorithm 1 and algorithm 2; fpcalc defaults to
algorithm 2 currently. Pin the algorithm version explicitly:

- Fingerprint MUST be computed using Chromaprint algorithm 2.
- Implementations SHOULD invoke fpcalc without `-algorithm` (the
  default) and MUST verify the fpcalc version supports algorithm 2.
- If a future algorithm 3 ships as default, implementations targeting
  v1 of this protocol MUST continue to request algorithm 2
  explicitly.

Without this pin, upgrading fpcalc can silently change track IDs.

### B.7 §6.1.5 worked example reproducibility

The spec already acknowledges that the 17.9 MB MP3 isn't distributed.
A minimal improvement: commit a tiny synthetic fixture to
`spec/fixtures/` (a few seconds of a sine sweep encoded to MP3, a
few KB on disk, CC0) along with its expected fpcalc output and
expected track id. The current example is unverifiable by anyone
who doesn't have the personal homelab NFS mount.

Out of scope for this round, but note it.

### B.8 §2.2 and §2.4 extras/extras conflict

§2.2 ends with "the only extra currently defined by this
specification is Track's `tags` field" but §2.4.1 allows
`...other_common_tags` inside `content.tags` and
`...other_format_fields` inside `content.audio`. That "other_*"
language is a wildcard and effectively prevents deterministic
content CIDs across implementations with different
metadata-extraction libraries — §6.6's "Two audio files with
byte-identical content produce the same tag-stripped CID" holds at
the audio-blob layer but NOT at the dag-cbor `content` layer.

The spec should explicitly note that `envelope.content` (the
dag-cbor payload CID) is **NOT** guaranteed to be identical across
peers for the same audio source, only the **audio blob CID**
(`content.hash`) and the track ID are. §2.10 hints at this via its
SHOULD `duplicate_key` which includes `envelope.content` as part of
the tuple, but it should be stated directly.

## C. Red-team observations (hostile implementer)

Working hypothesis: "what's the meanest thing a conformant peer can
do while remaining a spec-conformant peer?"

1. **Entry size.** There is no overall size cap on a signed log
   entry. `next.length ≤ 256` and `refs.length ≤ 256` bound the
   reference array sizes, but a single entry with 256 refs × 60-byte
   CID strings = ~30 KB of references alone, plus a payload of
   arbitrary size. Envelope payloads in dag-cbor have no cap.
   Suggested cap: signed log entry object ≤ 256 KiB after dag-cbor
   encoding; envelope payload ≤ 1 MiB after dag-cbor encoding.

2. **Fan-out exhaustion.** §5.4.2 caps `next` and `refs` at 256 each
   per entry, and heads messages at 256 KiB. A hostile peer publishes
   heads messages referencing 256 distinct heads, each entry having
   256 refs pointing at unique new CIDs, every few seconds (rate
   limit is 1 heads/sec/library). Per library that's 65 536 fetches
   per second into the traversal queue. The §5.4.2 concurrency cap
   is "implementation choice but finite" (see §B.2 above) so this
   floods the fetch queue of any peer that subscribes.

3. **Per-library topic flood.** A hostile peer subscribes to every
   library it knows about and publishes 256 KiB heads messages at
   the 1/sec rate cap on each. With 100 libraries observed, that's
   25 MiB/s of inbound heads messages per library topic.
   Announcement-topic rate limits in §5.3.3 do not apply per-library
   topic. Suggested mitigation: per-library topic also SHOULD
   rate-limit heads to e.g. 256 KiB/s averaged.

4. **Malformed-but-parseable CBOR.** dag-cbor deterministic encoding
   rules forbid non-canonical integer widths, unsorted map keys,
   indefinite-length types, etc. A parser that accepts any valid
   CBOR (not dag-cbor) will accept adversarial encodings of the
   same logical object, and different peers may then disagree on
   hashes. §2.1 already says dag-cbor but it would help to add a
   MUST: "readers MUST reject any CBOR input that is not in
   canonical dag-cbor form; re-encoding to canonical form on read
   is non-conformant."

5. **AC chain circular references.** §3.6.1 has only two fetch
   hops (manifest → wrapper → writelist). A hostile writer
   constructs a wrapper whose `params.address` points back at the
   manifest CID, forming a cycle. The spec requires that the
   fetched object matches §3.6.1 item 3 (i.e. must decode as a
   `{ write: [...] }` object), so decoding will fail. Safe today
   but should be documented: "the AC resolution procedure in
   §3.6.1 MUST NOT follow more than the three fixed hops defined
   in items 1–4; cycles are not possible under a correct
   implementation because each hop dispatches on a fixed schema".

6. **Listen entries with forged trackId.** §2.7 requires a
   `trackId` but does not require that the listening peer holds the
   referenced track in any library. A malicious peer can inflate
   its listens library with thousands of fake track IDs, which
   will be replicated by any peer that subscribes. This is probably
   by design (listens are per-peer history, not audited facts) but
   the spec should state it directly: "listens entries are trusted
   to the degree of the signing peer; they are NOT evidence that
   the track existed anywhere".

7. **About `avatar` as opaque URL.** §2.6 says avatar "MAY be a CID
   or an opaque URL". A UI that blindly loads the URL sends the
   viewer's IP to an attacker-controlled server, and caches the
   content without integrity checks. Suggestion: avatar MUST be a
   CID. Opaque URLs are out of scope for a content-addressed
   protocol.

8. **Duplicate key cross-field.** §2.10's `duplicate_key` tuple
   includes `envelope.content` (the CID). If a writer appends the
   same audio under two slightly different `content.tags` objects
   (e.g. different `music-metadata` extractor versions), the
   content CIDs differ and the duplicate check does not fire. This
   is a race, not a hostile action, but it means dedup is weaker
   than §2.10 implies. The mitigation is the §6.4.1 step-3 "dedupe
   by track_id before processing", which runs earlier and catches
   this case.

9. **Manifest name mismatch.** §3.6.1 already catches a mismatch
   between the library address's `<name>` component and
   `manifest.name`. Good.

10. **Signature forgery vectors.** The signing input is controlled
    entirely by the writer, there is no wall-clock validation, no
    ordering constraint on Lamport time relative to real time, and
    no freshness nonce. A replay of an old signed entry to a peer
    that previously didn't have it is valid. This is correct CRDT
    behaviour (replay = discovery) but means no peer can safely
    "prune old entries" without unanchoring the replay window.

## D. Items deferred

- Chromaprint algorithm version pin (§B.6) — low risk, worth
  landing in round 3.
- CC0 audio fixture for §6.1.5 (§B.7) — needs a source and a CI
  pipeline that runs fpcalc.
- §B.2 network bound floors — depends on reference implementation
  measurements before pinning specific numbers.

## E. File / code changes this round produced

- `spec/fixtures/gen-signing-vector.mjs` — relocated from
  `/tmp/record-prototype/gen-signing-vector.mjs`. Runs unchanged
  and reproduces the current §3.4.5 vector.
- `spec/fixtures/gen-signing-vector-orbitdb3.mjs` — new. Reproduces
  what `@orbitdb/core` 3.0 signs for the same logical entry.
  Produces a 468-byte dag-cbor block vs the spec's 538-byte block;
  the digest and signature differ correspondingly.
- `spec/review-notes/round-2-findings.md` — this document.

No chapters were edited this round. The signing divergence in §A
gates any §3 edits and several §B items; landing them piecemeal
before that decision risks a second spec rewrite.
