# Record Protocol v1 — Conformance Fixtures

Deterministic test-vector generators for the Record Protocol v1
specification. Each generator regenerates a vector embedded in the
spec from scratch; downstream implementations can run them as
conformance checks. A divergent output here surfaces as a non-equal
vector rather than silent on-wire incompatibility with other Record
peers.

## How to run

From this directory:

```sh
yarn install              # or: npm install --no-audit --no-fund
node gen-signing-vector.mjs
node gen-content-cid-vector.mjs
node gen-envelope-vector.mjs
node gen-ac-chain-vector.mjs
node gen-current-state-vector.mjs
node gen-network-message-vector.mjs
node gen-audio-pipeline-smoke.mjs
node gen-library-address-vector.mjs
node gen-meta-log-vector.mjs
node gen-capability-vector.mjs
node gen-fingerprint-vector.mjs
node gen-unixfs-vector.mjs
```

Each script exits non-zero on any verification failure.

## Machine-readable vectors

Seven generators also write their cases to `vectors/<generator-name>.json`, so an implementation in another language reads the same inputs and expected outputs instead of porting them from the spec text. Rerunning a generator rewrites its file byte for byte; a diff means the vector changed.

| File | Generator | Cases |
| --- | --- | --- |
| `vectors/signing-vector.json` | F0, F4 | signing, signed entry, child entry |
| `vectors/content-cid-vector.json` | F1 | `{hello: "world"}` content CID |
| `vectors/envelope-vector.json` | F2 | track, log and about envelopes |
| `vectors/ac-chain-vector.json` | F3 | write list, wrapper, manifest and address |
| `vectors/network-message-vector.json` | F6 | LoadedAboutEntry and heads message JSON |
| `vectors/library-address-vector.json` | F8 | four (key, type, discriminator) addresses |
| `vectors/unixfs-vector.json` | F7 multi-block step | 2 MiB plus 1 byte import with its leaf CIDs and root block |

Each file is `{fixture_id, generator, description, cases: [{name, inputs, expected}]}`. Bytes are lowercase hex. Protocol objects are plain JSON: an integer-valued number encodes as a CBOR integer and any other number as a CBOR float, as `@ipld/dag-cbor` does for JavaScript numbers. The spec text stays normative. `gen-unixfs-vector.mjs` repeats F7's multi-block step without ffmpeg or fpcalc, so the UnixFS profile can be checked on any machine; its leaf CIDs and root block are diagnostics that the spec does not print.

## Fixture index

| ID  | File                                | Covered sections                | Notes                                                                                |
| --- | ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| F0  | `gen-signing-vector.mjs`            | §3.4.5                          | ECDSA/secp256k1 entry signing over canonical dag-cbor + SHA-256.                     |
| F1  | `gen-content-cid-vector.mjs`        | §2.1, §2.3.1                    | Content CID derivation `{hello:world}` → dag-cbor → sha3-512 → base58btc CIDv1.       |
| F2  | `gen-envelope-vector.mjs`           | §2.2, §2.4, §2.5, §2.6          | Track / log / about envelope round-trip + canonical-encoding hand-check.             |
| F3  | `gen-ac-chain-vector.mjs`           | §3.5.1, §3.6                    | Manifest + AC wrapper + inner write-list → 3 CIDs → assembled library address.       |
| F4  | `gen-signing-vector.mjs` (extended) | §4.1.1, §4.1.2                  | Same generator as F0; emits the signed object's CID (entry.hash) and a child entry with non-empty `next`. |
| F5  | `gen-current-state-vector.mjs`      | §4.4.2                          | Three-entry race set + `(clock.time DESC, timestamp DESC, hash ASC)` ordering rule.  |
| F6  | `gen-network-message-vector.mjs`    | §5.3.2, §5.4.1                  | LoadedAboutEntry inline-content transform + heads message size bound check.          |
| F7  | `gen-audio-pipeline-smoke.mjs`      | §5.5.1, §6.1, §6.2, §6.4        | fpcalc fingerprint (checked non-degenerate) + sha256 track_id + ffmpeg tag-strip + unixfs-v1-2025 audio CID; multi-block CID vector. v1.1 replaced the degenerate 440 Hz sine source with a 10 s chirp. Its multi-block step also runs alone, with no media toolchain, as `gen-unixfs-vector.mjs`; both share `multi-block-input.mjs`. |
| F8  | `gen-library-address-vector.mjs`    | §3.6.1, §3.6.2                  | Address from (key, type, discriminator); `library` reproduces F3; identity library address. (v1.1) |
| F9  | `gen-meta-log-vector.mjs`           | §4.8.1, §4.8.2                  | Signed identity-library entries: library, link, pin PUTs and a link DEL; current state per (type, key). (v1.1) |
| F10 | `gen-capability-vector.mjs`         | §3.5.5 – §3.5.10                | Capability, write, revocation; reference verifier with accept, inert, and reject cases, including delegation. (v1.1) |
| F11 | `gen-fingerprint-vector.mjs`        | §6.1.6, §6.4.1                  | Chromaprint fingerprint decode; degenerate when one value fills 19 in 20 positions; silence (b8702767) and the v1.0 sine reject; the v1.1 chirp and music pass. (v1.1) |

## Toolchain pinning

F0–F6, F8–F11, the CID step of F7 and `gen-unixfs-vector.mjs` are pure JavaScript and pin to exact
dependency versions in `package.json`:

| Dependency             | Pinned version |
| ---------------------- | -------------- |
| `@ipld/dag-cbor`       | 9.2.6          |
| `@noble/curves`        | 2.0.1          |
| `@noble/hashes`        | 2.0.1          |
| `ipfs-unixfs-importer` | 17.1.1         |
| `multiformats`         | 13.4.0         |

F7 shells out to external binaries that are NOT installed by
`yarn install`. The operator's machine must provide them at exactly
these versions:

| Tool     | Pinned version | Notes                                                       |
| -------- | -------------- | ----------------------------------------------------------- |
| `ffmpeg` | 7.1.1          | Chirp synthesis + tag-strip per §6.2.3 reference flags.      |
| `fpcalc` | 1.5.1          | Chromaprint algorithm 2; produces the §6.1 fingerprint.      |

`gen-audio-pipeline-smoke.mjs` runs a `-version` preflight on both
binaries and aborts with a clear error if the runtime versions do
not match these pinned values — preventing a misconfigured machine
from silently rewriting spec-embedded constants.

**Cross-machine determinism is a residual known risk.** The F7
preflight verifies single-machine cross-invocation determinism only.
Downstream implementers on different OS / libc / ffmpeg-build
combinations may regenerate divergent bytes even at matching
nominal versions. If you observe an F7 verification failure on a
fresh machine, the most likely cause is a build-level difference
in ffmpeg or libchromaprint — investigate before assuming the spec
constants are stale.
