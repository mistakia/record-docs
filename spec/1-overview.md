# Record Protocol Specification — Overview

**Version**: 1
**Status**: Draft

## 1.1 Introduction

Record is a peer-to-peer protocol for distributing audio files and
their metadata. Each participant maintains one or more *libraries*:
signed, append-only logs of operations on audio tracks and metadata.
Libraries are content-addressed and replicated via an underlying
content-addressed storage network.

This document specifies the wire format, identity model, network
behaviour, and content-processing rules required for interoperable
implementations.

## 1.2 Conformance

Requirement levels follow RFC 2119 / RFC 8174:

- **MUST / MUST NOT**: absolute requirement. Non-compliance breaks
  interoperability.
- **SHOULD / SHOULD NOT**: recommendation. Deviation is permitted
  when the implications are understood.
- **MAY**: optional implementation choice with no interop impact.

A "Record peer" is any process that speaks the Record protocol. An
"implementation" is any software conforming to this specification.

## 1.3 Terminology

**Peer**: a process running a Record implementation. A peer holds
zero or more libraries.

**Identity**: a secp256k1 key pair controlling one library. A peer
MAY hold multiple identities; each library has exactly one writer
identity.

**Library**: an append-only, signed log of operations identified by
a library address. Libraries are the unit of access control and
replication. The protocol defines two library types: `recordstore`
(tracks, log links, about) and `listens` (listen history).

**Library address**: a stable string of the form
`/record/<manifest-cid>/<library-name>`. The `<manifest-cid>` is
the content hash of the library manifest.

**Library manifest**: a content-addressed object declaring the
library name, type, and access controller reference. Writing the
manifest to content-addressed storage yields the `<manifest-cid>`.

**Access controller (AC)**: a content-addressed object listing the
public keys permitted to append to the library. The AC is fixed at
library creation and is not mutable in this version.

**Record-entry envelope**: the payload wrapper object (§2.2)
carrying `{id, timestamp, v: 1, type, content}`. The envelope
describes a track, log link, or about record. Its `content` field
is a CID pointing to the dag-cbor payload stored in the content
network. "Entry" used alone in sections 2, 6, and 7 refers to this
structure.

**Signed log entry**: the append-only log object (§4.1) that wraps
a record-entry envelope inside the DAG. It carries `{v: 2, id,
payload, sig, key, identity, hash, next, refs, clock}`. The
`payload` field contains the PUT/DEL operation (§2.8) which in turn
contains the record-entry envelope. "Log entry" in sections 4 and 5
refers to this structure.

The two structures live at different layers:

```
signed-log-entry (v:2, §4.1)
  └─ payload: operation {op, key, value}  (§2.8)
       └─ value: record-entry-envelope (v:1, §2.2)
            └─ content: CID → dag-cbor payload  (§2.1)
```

**Track entry**: a record-entry envelope whose payload carries
audio metadata, artwork references, and an audio-file CID.

**Log entry (federation link)**: a record-entry envelope
representing a link from one library to another. Distinct from
"signed log entry" above and from the generic "entry in a log".

**About entry**: a record-entry envelope describing the owning
library (display name, bio, location, avatar).

**Listen entry**: an operation in the separate listens library
that records a playback event.

**Track ID**: the protocol-level identity of an audio track.
Computed as `sha256(chromaprint_fingerprint)` (§6).

**Node ID**: the protocol-level identity of a peer. Computed as
`sha256(public_key_hex_lowercase)` (§3).

**Chromaprint fingerprint**: the string output of `fpcalc` for an
audio file. Protocol-bound — see §6.

**Tag-stripped audio**: audio data with all metadata containers,
album art, and encoder tags removed via a deterministic, lossless
operation (§6).

## 1.4 System overview

A Record peer performs these activities:

1. **Ingest audio**: fingerprint the audio, extract metadata, strip
   tags, upload the stripped audio and artwork to content-addressed
   storage, and append a Track entry to its own library.
2. **Replicate**: link to other libraries, download their signed
   entries and associated content, and merge them into local state.
3. **Discover peers**: announce its library on the network, listen
   for other peers' announcements, and establish direct
   content-exchange connections.
4. **Query**: serve local audio, metadata, and history to consumer
   software.

## 1.5 Document organisation

- §1 Overview
- §2 Data model — entry envelope, payload schemas, content addressing
- §3 Identity and access — key generation, signing, access controllers
- §4 Library structure — append-only log, CRDT semantics, manifest
- §5 Network protocol — discovery, replication, announcement messages
- §6 Content processing — fingerprinting, tag stripping, metadata

## 1.6 Protocol scope

In scope:

- Wire formats of all persisted objects (entries, payloads,
  manifest, access controller).
- Content-addressing scheme (encoding, hash algorithm).
- Signing and verification algorithms.
- Peer discovery and announcement message formats.
- Replication semantics (ordering, merge, conflict resolution).
- Audio processing invariants (fingerprint, tag strip) required for
  cross-peer content deduplication.

Out of scope:

- Local query or index schema.
- REST, RPC, or SDK surfaces exposed by an implementation.
- Authentication and authorisation for consumer-facing interfaces.
- Deployment, process supervision, and filesystem layout.
- UI architecture and client framework.
- Audio codec support (any codec readable by the metadata and
  fingerprinting tools is acceptable).
- Performance tuning parameters (concurrency limits, throttle
  intervals, GC thresholds).
