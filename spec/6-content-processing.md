# 6. Content Processing

This section specifies audio fingerprinting, tag stripping, metadata
extraction, and content CID derivation. These rules MUST be followed
for cross-peer content deduplication to work.

## 6.1 Audio fingerprinting

### 6.1.1 Algorithm

Implementations MUST use Chromaprint (via `fpcalc` or an equivalent
library binding) to compute an audio fingerprint string for each
ingested audio file.

### 6.1.2 Fingerprint parameters

The fingerprint MUST be computed using Chromaprint algorithm
version 2. Implementations MUST NOT override any parameter that
affects the fingerprint content (algorithm version, sample-rate
scaling, length). Only the binary path MAY be configured.

The invariant is that the produced fingerprint string is
byte-identical for byte-identical decoded audio regardless of the
tool version used. An implementation that upgrades past a future
default-algorithm change MUST continue to request algorithm 2
explicitly rather than silently shifting track IDs.

### 6.1.2.1 Tag independence (idempotency)

Chromaprint operates on decoded audio samples. The fingerprint MUST be
identical regardless of metadata tags, artwork, or container framing.
Two files with the same audio samples but different tags MUST produce
the same fingerprint string and track ID.

Implementations MUST NOT feed tag-stripped audio to the fingerprinter
as a workaround for tag sensitivity. A fingerprinting tool that
produces different output depending on container metadata is
non-compliant.

### 6.1.3 Fingerprint encoding

The fingerprint MUST be the **string** output produced by fpcalc (or
an equivalent library binding that yields the same string). This is
Chromaprint's canonical base64-like encoded fingerprint.

### 6.1.4 Track ID derivation

```
track_id = sha256(fingerprint_string)   // lowercase hex output
```

The sha256 input MUST be the fingerprint string, not its raw bytes
before encoding. The output MUST be lowercase hex.

### 6.1.5 Test procedure

The track-id pipeline is:

1. Run `fpcalc -json <file>` against any audio file.
2. Extract the `fingerprint` field as a UTF-8 string.
3. Compute `sha256(fingerprint)` with the UTF-8 bytes of the
   string as input.

The resulting 64-character lowercase hex digest is the
`track_id`.

The invariant to verify across implementations is the round-trip
property: `sha256(fpcalc(tagged))` MUST equal
`sha256(fpcalc(strip_tags(tagged)))` for any compliant
tag-stripping operation (§6.2).

## 6.2 Tag stripping

### 6.2.1 Requirement

Before uploading an audio file to content-addressed storage,
implementations MUST produce a tag-stripped copy and upload that
instead. The tag-stripped form MUST be produced by a deterministic,
lossless, byte-preserving operation.

### 6.2.2 Operations

The tag-stripping operation MUST:

- Copy the audio stream only (no video, no attached art, no
  non-audio streams).
- Preserve the audio bytes exactly — no re-encoding, no sample-rate
  conversion, no bit-depth change.
- Remove all metadata (container tags, ID3, Vorbis comments, etc).
- Suppress any encoder-version tag that would make the output
  non-deterministic across tool versions.

### 6.2.3 Reference command (informative)

The following ffmpeg flags achieve the required behaviour:

```
-map 0:a            # audio stream(s) only
-codec:a copy       # no re-encoding
-bitexact           # suppress encoder-version tag
-map_metadata -1    # clear metadata
```

Any equivalent operation is acceptable as long as it produces
byte-identical output for byte-identical input across
implementations and tool versions. Older tools that fail to
suppress encoder-version metadata despite `-bitexact` are
non-conformant.

### 6.2.4 Audio CID

The tag-stripped blob is uploaded to content-addressed storage using
the content network's default chunking and hashing. The resulting CID
is stored in `track.content.hash`.

Because the tag-stripping operation is byte-deterministic, the same
source audio processed by compliant implementations will produce the
same CID, enabling cross-peer deduplication at the audio layer.

## 6.3 Metadata extraction

### 6.3.1 Persisted tags

The `track.content.tags` object MUST contain:

- `acoustid_fingerprint` — the Chromaprint fingerprint string (same
  value used for the track id).

The `track.content.tags` object SHOULD contain (when present in the
source file):

- `title`, `artist`, `artists`, `albumartist`, `album`, `remixer`,
  `bpm`, `genre`, `track`, `disk`.

Additional common-tag fields from the extraction library MAY be
included as passthrough.

### 6.3.2 Persisted format fields

The `track.content.audio` object SHOULD include these fields, with
the specified types when present (any field MAY be omitted or
`null` if not available from the source file):

| Field              | Type    | Unit / constraint                     |
|--------------------|---------|---------------------------------------|
| `duration`         | number  | seconds, finite, `> 0`                |
| `bitrate`          | number  | bits per second, integer, `> 0`       |
| `codec`            | string  | codec short name (e.g. `"MPEG 1 Layer 3"`, `"AAC"`) |
| `container`        | string  | container short name (e.g. `"MPEG"`, `"M4A/MP4"`) |
| `sampleRate`       | number  | Hz, integer, `> 0`                    |
| `numberOfChannels` | number  | integer, `1` or greater               |
| `numberOfSamples`  | number  | integer, `>= 0`                       |
| `lossless`         | boolean |                                       |
| `codecProfile`     | string  |                                       |
| `tagTypes`         | string[]|                                       |
| `trackInfo`        | object  | passthrough from metadata library     |

Implementations MUST NOT coerce missing fields to `0` — the correct
representation for unknown is omission or `null`. `codec` and
`container` are not controlled vocabulary in v1; implementations
SHOULD normalise them client-side rather than assume
cross-implementation equality.

### 6.3.3 Artwork

Album art embedded in the source file SHOULD be extracted into
individual CIDs and referenced from `track.content.artwork[]`. Each
artwork element MUST be a CID. Order SHOULD be preserved from the
source file. If the source file has no artwork, `artwork` MUST be an
empty array (not missing).

### 6.3.4 Exclusion from tag-stripped audio

Implementations MUST ensure artwork is NOT embedded in the
tag-stripped audio file. The tag-stripping operation in §6.2.2 (audio-stream-only copy)
achieves this by excluding video/image streams where embedded album
art typically lives.

## 6.4 Track add pipeline

### 6.4.1 Local file ingest

The canonical ingest path for a local audio file is:

1. Compute `fingerprint = chromaprint(filepath)`. Implementations
   MUST reject the ingest if the fingerprinter returns an empty
   string, an error exit, or a file with no decodable audio
   stream. A subsequent `sha256("")` MUST NOT be used as a
   fall-back track id.
2. Compute `track_id = sha256(fingerprint)`.
3. If an entry with this id already exists in the target library,
   return it and stop.
4. Parse metadata with a metadata-extraction library. If the
   reported audio duration is `0`, unknown, or the decoded sample
   count is zero, the implementation MUST reject the ingest.
5. Extract artwork from `metadata.common.picture` into a separate
   collection and remove it from `metadata.common`.
6. Produce a tag-stripped copy of the audio in a temporary location
   per §6.2.
7. Upload the tag-stripped copy to the content network, yielding
   `audio_cid`.
8. Upload each artwork image, yielding `artwork_cids[]`.
9. Determine the audio blob size (from the content network or local
   measurement).
10. Assemble the `track.content` object per §2.4.
11. Pin `audio_cid` and each `artwork_cids[i]`.
12. Create a Track envelope per §2.2-2.3.
13. Append the Track envelope to the library log via a PUT operation
    (§2.8.1). This step internally:
    a. Writes `track.content` to content-addressed storage as dag-cbor
       with sha3-512, yielding the content CID.
    b. Sets `envelope.content = base58btc(content_cid)`.
    c. Pins the content CID non-recursively.
    d. Wraps the envelope in a PUT op with `key = envelope.id`.
    e. Signs and appends the oplog entry.
    f. Pins the oplog entry hash non-recursively.
14. Clean up the temporary tag-stripped file.

### 6.4.2 URL ingest

Ingest from an external source URL proceeds as:

1. Resolve the URL to one or more `{ extractor, id, url, ... }`
   resolver records (§2.4.2) via an external extraction tool.
2. For each resolver record, check if a track with the same
   `(extractor, id)` already exists; if so, return the existing
   entry. The cached record is not re-validated against the
   remote URL, because a track is identified by its audio
   fingerprint, not by the URL it was fetched from.
3. Download the audio stream from `resolver.url` to a temporary
   file.
4. Call the local file ingest pipeline (§6.4.1) with the
   resolver record attached. Before persistence, implementations
   MUST strip the `url` field from the resolver record so it is
   not written to the log.

### 6.4.3 CID ingest

Ingest from an existing content CID (replicating a track known only
by CID) proceeds as:

1. Fetch the dag-cbor content object at the given CID.
2. Pass the content object through to the library PUT path directly,
   bypassing fingerprinting and metadata extraction. The content
   object is trusted to already be a valid Track payload.

Implementations MUST validate the content object's required fields
(§2.4.1) before accepting it.

## 6.5 Listens recording

Recording a listen produces a minimal operation in the listens
library:

1. `listens.add({ trackId, address })` — append the operation
   `{ trackId, address, timestamp }` (§2.7) to the listens log.
2. Sign and pin the listens-log entry hash.

Implementations MUST reject a listen write with a missing `trackId`.
Listen entries MUST NOT be deletable.

## 6.6 Deduplication guarantees

A compliant implementation guarantees:

- Two audio files with the same Chromaprint fingerprint produce the
  same track id.
- Two audio files with byte-identical content produce the same
  tag-stripped CID after the operations in §6.2.
- Re-tagging the same track (changing library-scoped labels) produces
  a new oplog entry with the same content CID — the underlying
  dag-cbor payload does not change when only envelope `tags` change.

Implementations SHOULD de-duplicate at three layers:

1. Track id (pre-processing check).
2. Content CID (pre-log-append check).
3. `(extractor, id)` (pre-download check for URL ingest).
