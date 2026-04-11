# 2. Data Model

This section specifies the entry envelope, the three payload types
(Track, Log, About), the listens-entry shape, and the content-addressing
scheme.

## 2.1 Content addressing

Record-entry envelope payloads (the objects referenced by the
`content` field) MUST be stored as content-addressed objects using:

- **Format**: `dag-cbor` (IPLD canonical CBOR, RFC 8949
  deterministic encoding).
- **Hash algorithm**: `sha3-512`.
- **CID encoding (in entries)**: base58btc (multibase prefix `z`).

An implementation MUST compute content CIDs by serialising the
payload with dag-cbor, hashing with sha3-512, and encoding the
resulting CID (version 1, dag-cbor codec, sha3-512 hash) using
base58btc before writing the string into an entry's `content`
field.

Readers MUST reject any CBOR input that is not in canonical
dag-cbor form. Re-encoding a non-canonical input to canonical form
on read is non-conformant because two peers that disagree on the
canonical bytes will compute different hashes and diverge.

**Audio blobs and artwork** are NOT stored as dag-cbor objects.
They are uploaded to the content network using its default import
pipeline. The resulting CIDs are stored in `track.content.hash`
(audio) and `track.content.artwork[]` (artwork). The hash algorithm
for these CIDs is determined by the content-network configuration.
See §6.2.4 for audio CID derivation.

## 2.2 Entry envelope

Every Track, Log, and About record-entry envelope (i.e. every entry
in a `recordstore`-type library) uses the following shape. This is the
application-level payload wrapper, distinct from the signed log entry
(§4.1) that wraps it in the append-only DAG — see §1.4 for the
layering diagram.

```
{
  id:        <hex-string>,   // sha256(type_specific_identifier) as lowercase hex
  timestamp: <uint64>,       // creation time in milliseconds since Unix epoch
  v:         1,              // envelope schema version
  type:      "track" | "log" | "about",
  content:   <string>,       // base58btc-encoded CID of the payload (dag-cbor/sha3-512)
  ...extras                  // see type-specific sections
}
```

Requirements:

- `id` MUST be computed as specified in §2.3 per type, MUST be lowercase
  hex, and MUST be the plain sha256 hex digest (no length prefix, no
  separators, no salt).
- `timestamp` MUST be the creation time in milliseconds since the Unix
  epoch (UTC). Implementations MUST NOT use any other unit.
- `v` MUST be `1` for this version of the protocol.
- `type` MUST be exactly one of `"track"`, `"log"`, `"about"` (lowercase).
- `content` MUST be the base58btc-encoded CID of the payload object as
  described in §2.1.

The only envelope extra defined by this specification is Track's
`tags` field (§2.4.3), which carries library-scoped labels that
live on the envelope rather than inside the content payload (so
re-tagging reuses the same content CID). Implementations MUST NOT
write additional extras, and receivers MUST ignore any unknown
extras rather than persisting or forwarding them.

## 2.3 ID derivation

| Type  | Identifier input                                    | Formula                            |
|-------|-----------------------------------------------------|------------------------------------|
| track | Chromaprint fingerprint string (see §6)             | `sha256(fingerprint)` → lowercase hex |
| log   | Library address of the target library (`/record/.../<name>`) | `sha256(address)` → lowercase hex |
| about | Library address of the owning library               | `sha256(address)` → lowercase hex |

The sha256 input for log/about entries MUST be the **exact library
address string** including the `/record/` prefix and `/<name>` suffix.

Note that Log and About entries share the same derivation (sha256 of a
library address). Disambiguation between the two MUST rely on the
envelope `type` field.

### 2.3.1 Test vectors

**sha256 hex.** The sha256 helper hashes a UTF-8 string and returns
lowercase hex.

- Input: `"hello"` (5 UTF-8 bytes: `68 65 6c 6c 6f`)
- Output: `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`

The hash input is the **UTF-8 bytes of the string**, the output is
**lowercase hex**, no separators, no prefix.

**Content CID derivation (dag-cbor + sha3-512 + base58btc).** Given the
minimal payload object:

```
{ "hello": "world" }
```

1. Encode as canonical dag-cbor (RFC 8949 deterministic encoding).
   Expected bytes (13 bytes, lowercase hex):
   `a16568656c6c6f65776f726c64`
   (CBOR map-of-1, key `"hello"`, value `"world"`.)
2. Hash the encoded bytes with sha3-512 (multicodec `0x14`, digest
   length 64 bytes).
3. Construct a CIDv1 with codec `dag-cbor` (`0x71`) wrapping that
   multihash and encode with base58btc (multibase prefix `z`).

Expected CID string:

```
zBwWX8pQhjGaQLy57vXmwHUBxxMDeft5dzud3gari9HqUpFFzqEqfLLspwfCw7k9YSNz59f5JWJZnqP8eN8SDHwEEwrFk
```

This string is what MUST be written to the envelope's `content` field
for a payload equal to `{"hello":"world"}`. An implementation that
produces a different value is non-conformant: most commonly because
its dag-cbor library emits a non-canonical ordering, because the CID
is encoded in base32 (prefix `b`) rather than base58btc, or because
sha2-256 was used in place of sha3-512.

## 2.4 Track payload

### 2.4.1 Content object (dag-cbor)

```
{
  hash:     <CID>,          // CID of the tag-stripped audio blob
  size:     <uint64>,       // size in bytes of the audio blob
  tags: {
    acoustid_fingerprint: <string>,   // REQUIRED; drives the track id
    title:       <string>?,
    artist:      <string>?,
    artists:     <string[]>?,
    albumartist: <string>?,
    album:       <string>?,
    remixer:     <string>?,
    bpm:         <number>?,
    genre:       <string[]>?,
    track:       <object>?,           // metadata-library track object
    disk:        <object>?,           // metadata-library disk object
    ...other_common_tags              // see §6.3
  },
  audio: {
    codec:            <string>?,
    bitrate:          <number>?,
    duration:         <number>?,      // seconds
    lossless:         <boolean>?,
    container:        <string>?,
    sampleRate:       <number>?,
    numberOfSamples:  <number>?,
    numberOfChannels: <number>?,
    ...other_format_fields
  },
  artwork:  <CID[]>,                  // MAY be empty
  resolver: <ResolverEntry[]>         // MAY be empty; see §2.4.2
}
```

Required fields (MUST be present):

- `hash` — CID of the tag-stripped audio.
- `size` — byte size of the audio blob.
- `tags.acoustid_fingerprint` — drives the track id.
- `audio` — the object itself must be present even if individual fields
  are null.
- `artwork` — must be present as an array (MAY be empty).
- `resolver` — must be present as an array (MAY be empty).

Optional fields (MAY be omitted or null):

- All other keys under `tags` and `audio`.

### 2.4.2 ResolverEntry

```
{
  extractor: <string>,   // REQUIRED, e.g. "youtube", "bandcamp"
  id:        <string>,   // REQUIRED, extractor-scoped id
  fulltitle: <string>?,
  thumbnail: <string>?,
  artist:    <string>?,
  alt_title: <string>?,
  upload_date: <string>?,
  webpage_url: <string>?,
  duration:  <number>?
}
```

Implementations MUST NOT persist a streaming `url` field in a resolver
entry.

The tuple `(extractor, id)` MUST uniquely identify an external source
pointer and MAY be used as a cache key to avoid re-downloading.

### 2.4.3 Envelope `tags` (library labels)

Track envelopes MAY carry a top-level `tags: <string[]>` array. These
are library-scoped labels applied by the writing peer (distinct from
`content.tags` which are audio metadata). The labels live on the
envelope so that re-labelling the same audio produces a new oplog entry
with the same content CID.

```
{
  id: "<sha256_hex>",
  timestamp: 1611272666695,
  v: 1,
  type: "track",
  content: "<base58btc CID>",
  tags: ["downtempo", "friends-mix"]     // optional; default []
}
```

## 2.5 Log payload

`log`-type entries carry a reference to a linked library:

```
{
  address: <string>,   // REQUIRED — /record/<manifest-cid>/<name>
  alias:   <string>?   // OPTIONAL display alias, may be null
}
```

## 2.6 About payload

`about`-type entries describe the *owning* library (the library whose
log the about entry is in):

```
{
  address:  <string>,   // REQUIRED — address of the owning library
  name:     <string>?,
  bio:      <string>?,
  location: <string>?,
  avatar:   <string>?   // CID of an image blob; URLs are not permitted
}
```

The `address` field MUST equal the library's own address string.
Implementations SHOULD stamp this field automatically rather than
requiring callers to supply it. `avatar`, when present, MUST be a
content-addressed CID; opaque URLs are forbidden because a
receiving UI that loads them leaks viewer network identity to the
publishing peer.

Each library has a single canonical About id
(`sha256(own_library_address)`), though the library MAY contain multiple
About entries over time (for edits); the current About is the one with
the greatest clock / timestamp per §4.

## 2.7 Listens entry

Listen entries live in a separate library with type `"listens"` and use
a distinct, minimal shape. Unlike the `recordstore` library, they do
NOT use the envelope or a content-addressed payload.

```
{
  trackId:   <string>,     // REQUIRED — the track id being played
  address:   <string>,     // REQUIRED — library address the track was from
  timestamp: <uint64>      // milliseconds since Unix epoch
}
```

Listens entries are append-only and MUST NOT be deletable.
Implementations MUST reject a listen write with a missing `trackId`.

## 2.8 Operation shapes (PUT / DEL)

Entries are wrapped in an operation object when appended to the log:

### 2.8.1 PUT

```
{
  op:    "PUT",
  key:   <entry.id>,    // same as the envelope id field
  value: <entry>        // the full envelope object (per §2.2)
}
```

### 2.8.2 DEL

```
{
  op:    "DEL",
  key:   <entry.id>,           // id of the entry being tombstoned
  value: {
    type:      "track" | "log",
    timestamp: <uint64>        // ms since epoch
  }
}
```

Requirements:

- A `DEL` operation MUST carry `value.type` equal to either `"track"`
  or `"log"`. About entries MUST NOT be deleted in this version.
- A `DEL` operation MUST NOT carry a content CID.
- A received entry whose `payload` is a `DEL` with `value.type` equal
  to `"about"`, `"listen"`, or any value other than `"track"` or
  `"log"` MUST be rejected at the append-verification step
  (§3.5.4 / §4.5) and MUST NOT be added to the local oplog.
- In a `listens`-type library (§2.7) the only valid operation shape is
  a listen-entry write; `DEL` operations MUST be rejected by both the
  writer (on local append) and any replicating peer (on remote merge).

## 2.8.3 Size bounds

A signed log entry object MUST NOT exceed 256 KiB after dag-cbor
encoding. A record-entry envelope payload (the dag-cbor object
referenced by `envelope.content`) MUST NOT exceed 1 MiB after
encoding. Track envelopes MUST carry at most 256 `tags` entries;
each tag MUST be at most 128 UTF-8 bytes and the `tags` array MUST
serialise to at most 8 KiB. Receivers MUST drop entries or
payloads that exceed these bounds at verification time.

## 2.9 Pinning obligations

When an implementation writes an entry or replicates a remote entry
into its local store, it SHOULD pin the following content-addressed
objects:

1. The dag-cbor payload referenced by `entry.content` (non-recursive pin).
2. The signed log-entry object itself (non-recursive pin).
3. For Track entries: `content.hash` (the audio blob) and every CID in
   `content.artwork` (pinned so they are preserved locally).

These pinning actions support garbage collection on library unlink: only
content uniquely held by the unlinked library is dropped.

## 2.10 Deduplication guarantees (normative)

A compliant implementation MUST:

- Treat two tracks with the same `sha256(chromaprint_fingerprint)`
  as the same track (same `id`).
- Produce the same fingerprint (and therefore the same track ID)
  for the same audio content regardless of what metadata tags,
  artwork, or container framing accompany the audio stream (see
  §6.1.2.1).
- Treat two tag-stripped audio blobs as byte-identical given the
  same source audio, such that `content.hash` is stable across
  peers.

The `envelope.content` CID is **not** guaranteed to be identical
across peers for the same audio source, because the dag-cbor
payload includes metadata tags and format fields whose set varies
with the ingesting peer's metadata library. Cross-peer identity is
anchored by the track ID and the audio-blob CID, not by
`envelope.content`.

A compliant implementation SHOULD:

- Dedupe by track id before re-processing a file on local ingest.
- Dedupe by `(resolver.extractor, resolver.id)` before re-downloading
  a URL.
- Reject (at the library append layer) a PUT that would produce a
  duplicate of an existing entry, where "duplicate" is defined as
  another currently-live (non-tombstoned) entry in the same library
  with an equal duplicate-key tuple:

  ```
  duplicate_key = (
    library_address,
    envelope.id,
    envelope.content,        // base58btc CID string
    sorted(envelope.tags)    // library-scoped labels, canonical order
  )
  ```

  Two tuples are equal if all four components match byte-for-byte.
  The comparison MUST treat a missing `tags` field as the empty array
  `[]` and MUST sort `tags` lexicographically before comparison so
  that `["a","b"]` and `["b","a"]` are equal.

  When rejecting a duplicate the implementation MUST NOT append
  the entry to the local oplog and SHOULD surface an identifiable
  error to callers.
