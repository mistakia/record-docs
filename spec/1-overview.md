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

## 1.2 Goals and philosophy

Every normative requirement in this document is justified against
this section. A requirement that assumes a goal not listed here is
a defect in this document.

### 1.2.1 Purpose

Record is a protocol for decentralised audio libraries:
content-addressed, peer-replicated, self-hosted. A peer runs an
implementation and maintains at least one library of its own
audio. Peers publish libraries and link to other libraries,
assembling a federated view without a central server, index, or
account system. Every peer is a full node.

### 1.2.2 Invariants

- **Audio identity is intrinsic to the audio.** Track identity is
  derived from a fingerprint of the decoded audio, not from
  metadata or from the publishing peer (§6.1).
- **Audio bytes deduplicate across peers.** Tag stripping is
  deterministic, so two peers ingesting the same recording arrive
  at the same CID (§6.2).
- **Libraries have stable provenance.** The access controller is
  fixed at creation; rotating writers means a new library
  (§3.5, §4.3).
- **History is evidence.** Libraries are signed, append-only
  CRDTs. Peers converge without coordination and every entry is
  verifiable from its signature (§3.4, §4.4).
- **Playback history belongs to the listener.** Listen entries
  live in a library owned by the listener and cannot be signed or
  retracted by anyone else (§2.7, §4.2).
- **Every persisted object is content-addressed.** Equal content
  yields equal addresses on every peer (§2.1).

### 1.2.3 Non-goals

- Global consensus or canonical network state.
- Anonymity.
- Auditable listen counts.
- Distributed moderation or takedown.
- Economic incentives.
- In-place key rotation.
- Metadata consensus across peers.
- Network-wide search or a global library registry.

### 1.2.4 Trade-offs

- Deterministic dedup requires pinning tag-stripping and
  fingerprinting tools and algorithms (§6). Silent drift breaks
  cross-peer deduplication.
- Fixed access controllers preclude in-place recovery from key
  compromise.
- CRDT tombstones hide content locally but cannot erase it from
  peers that already replicated it. "Delete" is local; "forget"
  is not a primitive.
- Per-peer metadata choice means the `envelope.content` CID for
  the same track may differ between peers (§2.10).
- Every entry carries a signature and identity reference. The
  protocol prefers this overhead over trusting any peer's server.

### 1.2.5 Runtime agnosticism

The protocol targets any content-addressed storage and pubsub
fabric providing: immutable CID-addressed blocks with a canonical
binary encoding (§2.1); block exchange by CID; and a string-topic
publish-subscribe channel (§5). Specific libraries, daemons, or
network stacks are implementation choices, not protocol
dependencies. Conformance is judged solely against this document;
behaviour that depends on a specific runtime's quirks is
non-conforming unless this document also requires it.

## 1.3 Conformance

Requirement levels follow RFC 2119 / RFC 8174:

- **MUST / MUST NOT**: absolute requirement. Non-compliance breaks
  interoperability.
- **SHOULD / SHOULD NOT**: recommendation. Deviation is permitted
  when the implications are understood.
- **MAY**: optional implementation choice with no interop impact.

A "Record peer" is any process that speaks the Record protocol. An
"implementation" is any software conforming to this specification.

## 1.4 Terminology

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
network. "Entry" used alone in sections 2 and 6 refers to this
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

**Node ID**: the protocol-level identity of a peer. Equals the
writer's compressed secp256k1 public key hex (§3).

**Chromaprint fingerprint**: the string output of `fpcalc` for an
audio file. Protocol-bound — see §6.

**Tag-stripped audio**: audio data with all metadata containers,
album art, and encoder tags removed via a deterministic, lossless
operation (§6).

## 1.5 System overview

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

## 1.6 Document organisation

- §1 Overview
- §2 Data model — entry envelope, payload schemas, content addressing
- §3 Identity and access — key generation, signing, access controllers
- §4 Library structure — append-only log, CRDT semantics, manifest
- §5 Network protocol — discovery, replication, announcement messages
- §6 Content processing — fingerprinting, tag stripping, metadata

## 1.7 Protocol scope

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
