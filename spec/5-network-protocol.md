# 5. Network Protocol

## 5.1 Transport abstraction

Record peers communicate via three logical channels:

1. **Content-addressed fetch**: on-demand retrieval of CIDs
   (manifest, AC chain, entries, payloads, audio blobs, artwork).
   Any content-addressed storage network that supports the
   required CID formats is acceptable.
2. **Publish-subscribe**: library announcement broadcast (§5.3)
   and per-library replication messaging (§5.4).
3. **Peer discovery**: a mechanism for peers to find one
   another's network addresses.

Transport choices are SHOULD-level recommendations; observable
message formats are MUST-level requirements.

## 5.2 Peer discovery

Peers MUST be able to discover one another to exchange addresses,
library information, and signed log entries. An implementation
SHOULD support at least two of the following mechanisms and MUST
be able to bootstrap from any one in isolation:

- **Shared bootstrap service**: a well-known directory that
  returns candidate peer addresses for the Record network.
- **Local-network discovery**: mDNS or equivalent for peers on
  the same LAN.
- **Content-network native discovery**: the underlying
  content-addressed network's own peer discovery.

A joining peer SHOULD attempt its supported mechanisms in
parallel. Implementations MUST NOT rely on a specific ordering
for correctness; the discovery guarantee is "at least one
mechanism succeeds eventually."

**Interop floor.** Every implementation MUST support
content-network native discovery. The other mechanisms are
acceleration layers on top of it.

## 5.3 Library announcement (RECORD topic)

### 5.3.1 Topic

Peers MUST publish and subscribe to the pubsub topic `RECORD`
(all uppercase, exactly 6 characters, encoded as the 6 ASCII
bytes `52 45 43 4f 52 44`).

**Per-library topics.** Replication topics (§5.4) use the library
address string verbatim as the topic name. Library names SHOULD
be kept short (§3.7 already constrains the character set). An
implementation that cannot subscribe to a topic longer than its
pubsub runtime supports MUST surface an error rather than
silently truncating or hashing the topic name.

### 5.3.2 Announcement message format

When a peer joins the topic, any already-present peer SHOULD
publish an announcement containing its own library About entry
and About entries for each of its locally-replicated, non-empty
linked libraries:

```
{
  "about": <LoadedAboutEntry>,
  "logs":  [ <LoadedAboutEntry>, ... ]
}
```

The message body MUST be JSON-encoded and published via the
pubsub layer.

**LoadedAboutEntry shape.** Each `LoadedAboutEntry` is a JSON
serialisation of a signed log entry (§4.1.1) with one
transformation: the envelope `content` field, which on the wire
is a base58btc CID string, is replaced inline by the decoded
About payload object (§2.6). The shape is:

```
{
  hash:     <string>,           // entry.hash, base58btc CID of the signed entry
  id:       <string>,           // library id
  payload: {
    op:    "PUT",
    key:   <string>,            // envelope.id (sha256 of library address)
    value: {
      id:        <string>,
      timestamp: <uint64>,
      v:         1,
      type:      "about",
      content: {                // inlined payload object from §2.6
        address:  <string>,
        name:     <string?>,
        bio:      <string?>,
        location: <string?>,
        avatar:   <string?>
      }
    }
  },
  next:    <string[]>,
  refs:    <string[]>,
  v:       2,
  clock:   { id: <string>, time: <number> },
  key:     <string>,
  sig:     <string>
}
```

The inlined `content` field lets a receiving peer display
library metadata without a secondary content fetch. Because the
inlined form differs from the on-wire envelope, receivers that
want to verify the About signature MUST re-fetch the canonical
signed entry by `hash` before treating it as authenticated. The
announcement payload is authenticated only to the degree its
signature is verified against the canonical form.

**Size and trust.** Announcement messages MUST NOT exceed 256
KiB after JSON encoding. A peer receiving a larger message MUST
drop it without processing. Senders SHOULD reference artwork and
avatars by CID rather than embedding binary blobs. Receivers
MUST treat announcement content as untrusted hints until the
underlying library's AC chain and entry signatures have been
verified per §3.

### 5.3.3 Announcement trigger

A peer SHOULD publish an announcement:

- When it joins the `RECORD` topic itself.
- When a new peer joins the `RECORD` topic.

Announcements are always broadcast on the `RECORD` topic; the
protocol does not rely on directed pubsub delivery.

**Rate limiting.** A peer MUST NOT emit more than one
announcement per `RECORD` peer-join event per 5 seconds per
target peer, and SHOULD batch simultaneous peer joins into a
single announcement. A peer MUST NOT re-announce on its own
library state changes (append, merge) via the `RECORD` topic;
state changes replicate via per-library topics (§5.4).

**Join-time race.** A new peer may miss announcements published
during the window between its subscribe call and its first
successful receive. A joining peer SHOULD actively query known
peers via whatever directory mechanism it has rather than
relying exclusively on passive receipt. A receiver MUST NOT
assume the absence of an announcement means the library does
not exist.

### 5.3.4 Announcement processing

On receiving an announcement:

1. Parse the JSON body.
2. Validate `about.content.address` is a valid library address.
3. Open a read-only handle to the advertised library (do not
   start replication yet).
4. For each entry in `logs`, do the same.
5. Record the peer-to-library mapping in an in-memory index.

## 5.4 Replication protocol

Replication is performed per-library. Peers publish to and
subscribe from a pubsub topic equal to the library address
string.

### 5.4.1 Heads exchange

On joining a library's pubsub topic, a peer receives head
messages from other replicating peers and responds with its own
heads.

**Message schema.** A heads message is a JSON object of the
form:

```
{
  "type":  "heads",
  "heads": [ <entry.hash>, ... ]   // base58btc CID strings
}
```

Each element of `heads` MUST be the base58btc CID string of a
currently-known head entry (§4.3) at send time. The array MAY be
empty; a peer with zero entries still broadcasts an empty heads
message to signal presence.

**Publication triggers.** A peer MUST publish a heads message:

- When it first subscribes to the library's topic.
- When it observes a new peer joining the topic.
- When its own heads set changes as a result of a local append
  or a merge that produced entries not known to other peers.

A peer MUST NOT publish heads messages more often than once per
1000 milliseconds per library; simultaneous trigger events MUST
be coalesced into a single message.

**Size bound.** A heads message MUST NOT exceed 256 KiB after
JSON encoding. If a library's heads set would exceed this bound,
the peer MUST split the set across multiple messages tagged with
the same trigger and MUST include an `incomplete: true` field on
all but the final message in a batch. Receivers MUST wait for a
message without `incomplete: true` before treating the batch as
a complete snapshot.

### 5.4.2 Fetch traversal

On receiving a head message, a peer fetches the referenced
entries from content-addressed storage, then recursively fetches
predecessors following the union of `next` and `refs` pointers
until the subgraph is complete.

**Bounded traversal (MUST).** The traversal is an open network
operation and MUST be bounded:

1. **Cycle detection.** The traversal MUST track the set of
   already-enqueued entry hashes and MUST NOT re-enqueue an
   entry already seen, whether or not its fetch has completed.
   Signed log entries form a DAG by construction; a cycle
   indicates either a bug or a hostile peer.
2. **Fan-out cap.** A single entry's `next` and `refs` arrays
   MUST each contain at most 256 entries. An entry with more
   MUST be rejected at signature-verification time (§3.5.4) and
   MUST NOT enqueue its children.
3. **Concurrency bound.** The peer MUST bound the number of
   in-flight fetches per library. The bound MUST be finite and
   SHOULD default to at least 4 concurrent fetches.
4. **Per-entry timeout.** Each outstanding fetch MUST have a
   finite timeout. The timeout SHOULD default to at least 30
   seconds. On timeout the peer MUST record the entry as
   unresolved, MUST NOT block the rest of the traversal waiting
   for it, and MAY retry later under a backoff schedule.
5. **Graph completeness.** A subgraph is "complete" when every
   enqueued entry has been successfully fetched or permanently
   abandoned. Merging (§5.4.3) operates only on the subset of
   entries that were successfully fetched, verified, and whose
   transitive `next` closure is also verified. Entries whose
   ancestors could not be fetched MUST NOT be merged.

The fetch SHOULD be pausable and resumable to support
disconnect semantics (§5.4.4). Resume MUST re-enter the
traversal at the earliest unresolved entry without re-fetching
entries that already landed locally.

### 5.4.3 Merge

Once a fetch task queue is idle, or once an implementation-chosen
batch boundary is reached, the peer merges the fetched entries
into its local oplog per §4.5. Implementations MAY merge
incrementally as the traversal proceeds, provided that:

- Each batch satisfies the §4.5 associativity and commutativity
  guarantee.
- Entries whose ancestors have not yet been fetched MUST NOT be
  merged.

On successful merge, the peer SHOULD:

1. Pin each newly-known signed log entry object (non-recursive).
2. Pin each entry's content CID (non-recursive).
3. Queue the entry for local indexing.

**Merge isolation.** An implementation processing multiple
concurrent heads messages for the same library MUST ensure that
the resulting oplog state is equivalent to some sequential merge
order. Serialising merges behind a per-library mutex is a
conformant strategy; parallelised merges MUST still uphold §4.5
invariants.

### 5.4.4 Replication disconnect

Implementations MUST support pausing replication for a specific
library without closing the log.

**Pause.** On pause, the implementation MUST stop publishing
heads messages, stop accepting new fetch tasks, and leave
in-flight fetches to complete or time out naturally. Entries
still in flight when the pause takes effect MUST be recorded as
unresolved so resume can pick them up.

**Resume.** On resume, the implementation MUST re-enter the
traversal for any unresolved entries recorded at pause time
before publishing a new heads message. Resume MUST NOT re-fetch
entries that already landed locally.

**Unlink.** When a library is unlinked the implementation
SHOULD pause the library, unsubscribe from its pubsub topic,
discard any unresolved-fetch state, and remove unique content
as described in §4.6.

### 5.4.5 Network partition and unreachable peers

Library replication operates over an unreliable network. A peer
MUST tolerate heads messages that reference entries whose CIDs
cannot currently be fetched from the content network.

- A per-entry fetch timeout (§5.4.2 item 4) MUST NOT stall the
  overall replicator. The peer SHOULD continue processing other
  heads and other libraries while the unresolved entry is
  retried under backoff.
- If all heads in a library cannot be fetched over an extended
  interval, the peer SHOULD treat the library as temporarily
  unreachable but MUST NOT discard its local oplog. On
  reconnection it resumes replication from the heads it last
  knew.
- A peer MUST NOT emit a "library removed" signal to local
  consumers purely because of fetch failures. Removal is an
  explicit user or API action (§5.4.4 unlink).

## 5.5 Network profile

The protocol is defined against the abstract fabric requirements
of §5.1 and the CID formats of §2.1. This section defines the
single concrete profile currently standardised. Conformant peers
MUST implement this profile. Future versions MAY define
additional profiles; inter-profile interoperability is not
guaranteed and is left to bridging implementations.

### 5.5.1 libp2p profile

Peers running on the libp2p stack MUST be configured as follows:

- **Pubsub router**: gossipsub.
- **Private network pre-shared key**: peers MUST isolate Record
  traffic from public content-addressed networks using the
  following PSK:

  ```
  /key/swarm/psk/1.0.0/
  /base16/
  cbad12031badbcad2a3cd5a373633fa725a7874de942d451227a9e909733454a
  ```

  Peers with a different PSK cannot exchange blocks with Record
  peers.
