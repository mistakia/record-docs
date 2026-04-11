# Record Protocol Specification — Overview

**Version**: 1
**Status**: Draft

## 1.1 Introduction

Record is a peer-to-peer protocol for distributing audio files and their
metadata. Each participant maintains one or more *libraries*: signed,
append-only logs of operations on audio tracks and metadata. Libraries
are content-addressed and replicated via an underlying content-addressed
storage network.

This document specifies the wire format, identity model, network
behaviour, and content processing rules required for interoperable
implementations.

## 1.2 Conformance

Requirement levels in this specification follow RFC 2119 / RFC 8174:

- **MUST / MUST NOT**: absolute requirement. Non-compliance breaks
  interoperability with other compliant implementations.
- **SHOULD / SHOULD NOT**: recommendation. Non-compliance is permitted
  when there are valid reasons but the full implications must be
  understood.
- **MAY**: truly optional — implementation choice with no interop impact.

A "Record peer" in this document is any process that speaks the Record
protocol. An "implementation" is any software conforming to this
specification.

## 1.3 Terminology

**Peer**: a process running a Record implementation. A peer holds zero
or more libraries.

**Identity**: a secp256k1 key pair controlling one library. A peer MAY
hold multiple identities but each library has exactly one writer
identity.

**Library**: an append-only, signed log of operations identified by a
library address. Libraries are the unit of access control and
replication. The protocol defines two library types: `recordstore`
(tracks / log links / about) and `listens` (listen history).

**Library address**: a stable string of the form
`/orbitdb/<manifest-cid>/<library-name>` that identifies a library.
The `<manifest-cid>` is the content hash of the library manifest.

**Library manifest**: a content-addressed object that declares the
library name, type, and access controller reference. Writing the
manifest to content-addressed storage yields the library's
`<manifest-cid>`.

**Access controller (AC)**: a content-addressed object listing the
public keys permitted to append to the library. In this version of the
protocol, the AC is fixed at library creation and is not mutable.

**Record-entry envelope**: the payload wrapper object (§2.2) that
carries `{id, timestamp, v: 1, type, content}`. This is the
application-level data structure that describes a track, log link, or
about record. The envelope's `content` field is a CID pointing to the
dag-cbor payload stored in the content network. The term "entry" used
alone in sections 2, 6, and 7 refers to this structure.

**Signed log entry**: the append-only log object (§4.1) that wraps a
record-entry envelope inside the DAG. This structure carries `{v: 2,
id, payload, sig, key, identity, hash, next, refs, clock}`. The
`payload` field contains the PUT/DEL operation (§2.8) which in turn
contains the record-entry envelope. The term "log entry" in sections
4 and 5 refers to this structure.

These are two distinct data structures at different layers:

```
signed-log-entry (v:2, §4.1)
  └─ payload: operation {op, key, value}  (§2.8)
       └─ value: record-entry-envelope (v:1, §2.2)
            └─ content: CID → dag-cbor payload  (§2.1)
```

**Track entry**: a record-entry envelope whose payload carries audio
metadata, artwork references, and an audio-file CID.

**Log entry** (context: the tracks/logs/about library): a
record-entry envelope representing a link from one library to another
(library federation). Not to be confused with "signed log entry" or
"a log entry" in the general append-only-log sense.

**About entry**: a record-entry envelope describing the owning library
(display name, bio, location, avatar).

**Listen entry**: an operation in the separate listens library that
records a playback event.

**Track ID**: the protocol-level identity of an audio track.
Computed as `sha256(chromaprint_fingerprint)` (see §6).

**Node ID**: the protocol-level identity of a peer. Computed as
`sha256(public_key_hex_lowercase)` (see §3).

**Chromaprint fingerprint**: the string output of `fpcalc` (the
Chromaprint CLI) for an audio file. Protocol-bound — see §6.

**Tag-stripped audio**: audio data with all metadata containers, album
art, and encoder tags removed via a deterministic, lossless operation.
See §6.

## 1.4 System Overview

A Record peer performs these activities:

1. **Ingest audio**: fingerprint the audio, extract metadata, strip
   tags, upload the stripped audio (and artwork) to content-addressed
   storage, and append a Track entry to its own library.
2. **Replicate**: link to other libraries, download their signed entries
   and associated content, and merge them into local state.
3. **Discover peers**: announce its library on the network, listen for
   other peers' announcements, and establish direct content-exchange
   connections.
4. **Query**: serve local audio, metadata, and history to consumer
   software (UI clients, API consumers).

## 1.5 Document organisation

- §1 Overview (this document)
- §2 Data model — entry envelope, payload schemas, content addressing
- §3 Identity and access — key generation, signing, access controllers
- §4 Library structure — append-only log, CRDT semantics, manifest
- §5 Network protocol — discovery, replication, announcement messages
- §6 Content processing — fingerprinting, tag stripping, metadata
- §7 API surface — REST API contract (SHOULD-level)

## 1.6 Protocol scope

In scope:

- Wire formats of all persisted objects (entries, payloads, manifest,
  access controller).
- Content-addressing scheme (encoding, hash algorithm).
- Signing and verification algorithms.
- Peer discovery and announcement message formats.
- Replication semantics (ordering, merge, conflict resolution).
- Audio processing invariants (fingerprint, tag strip) required for
  cross-peer content deduplication.

Out of scope:

- Local query/index schema (an implementation's SQLite or other
  database).
- UI architecture, client framework.
- Audio codec support (any codec readable by the metadata/fingerprinting
  tools is acceptable).
- Performance tuning parameters (concurrency limits, throttle intervals,
  GC thresholds).
- File system layout for local storage.

## 1.7 Reference implementation (informative)

The reference implementation is `record-node`, a Node.js peer daemon
built on IPFS and OrbitDB. It uses custom forks of OrbitDB-family
libraries for memory-scalability features (LRU cache, lazy loading,
hash index persistence, replicator pause/resume) that do not change
the wire format. Supporting components include a URL resolver for
track ingestion and a content-network daemon wrapper.

Extraction working notes in `spec/working-notes/` document the mapping
from reference implementation source to this specification.
