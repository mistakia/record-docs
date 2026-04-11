# 5. Network Protocol

## 5.1 Transport abstraction

Record peers communicate via three logical channels:

1. **Content-addressed fetch**: on-demand retrieval of CIDs (manifest,
   AC chain, entries, payloads, audio blobs, artwork). Any
   content-addressed storage network that supports the required CID
   formats is acceptable.
2. **Publish-subscribe**: library announcement broadcast (§5.3) and
   per-library replication messaging (§5.4).
3. **Peer discovery**: a mechanism for peers to find one another's
   network addresses.

This specification describes transport choices as SHOULD-level
recommendations and observable message formats as MUST-level
requirements.

## 5.2 Peer discovery

### 5.2.1 Requirement

Peers MUST be able to discover one another to exchange addresses,
library information, and signed log entries.

### 5.2.2 Recommended mechanisms

An implementation SHOULD support at least two of the following
mechanisms, and MUST be able to bootstrap from any one of them in
isolation:

- **DHT-assisted bootstrap**: a shared bootstrap service that allows
  new peers to find existing participants. The reference
  implementation uses Bitboot under the service name `"record"` for
  this role.
- **Local-network discovery**: mDNS or equivalent for peers on the
  same LAN.
- **Content-network native discovery**: the underlying
  content-addressed network's own peer discovery (e.g. IPFS DHT).

**Fallback order.** A peer joining the network SHOULD attempt the
mechanisms it supports in parallel rather than sequentially, so that
a slow or partitioned discovery service does not block a working
one. Implementations MUST NOT rely on a specific ordering for
correctness: the protocol's discovery guarantee is "at least one
mechanism succeeds eventually," not "the same mechanism as my
peer."

**Interop floor.** To ensure two conformant peers can always meet,
every implementation MUST support content-network native discovery
(the third mechanism above). DHT-assisted bootstrap and local-network
discovery are acceleration mechanisms layered on top of it.

### 5.2.3 Bootstrap handshake (informative)

The reference implementation uses Bitboot (a TCP-based bootstrap
service) to exchange content-network peer IDs. New implementations
MAY replace this with a native DHT lookup or any mechanism that
achieves the same abstraction: discover candidate hosts, learn their
content-network peer ID, and dial them on the content network.

## 5.3 Library announcement (RECORD topic)

### 5.3.1 Topic

Peers MUST publish and subscribe to the pubsub topic `RECORD`
(all uppercase, exactly 6 characters, encoded as the 6 ASCII bytes
`52 45 43 4f 52 44`).

**Per-library topics.** Replication topics (§5.4) use the library
address string verbatim as the topic name. The library address can
be up to roughly 120 bytes for a base58btc manifest CID plus a
short name and can approach or exceed the 256-byte topic limit in
some pubsub implementations if names are long. Implementations
creating libraries SHOULD keep `<name>` short (the §3.8 character
set already constrains it); implementations that cannot subscribe
to a topic longer than their pubsub runtime supports MUST surface
this as an error rather than silently truncating or hashing the
topic name.

### 5.3.2 Announcement message format

When a peer joins the topic, any already-present peer SHOULD publish
an announcement message containing the peer's own library About
entry and About entries for each of its locally-replicated,
non-empty linked libraries:

```
{
  "about": <LoadedAboutEntry>,
  "logs":  [ <LoadedAboutEntry>, ... ]
}
```

The message body MUST be JSON-encoded (`application/json` equivalent)
and published via the pubsub layer.

**LoadedAboutEntry shape.** Each `LoadedAboutEntry` is a JSON
serialisation of a signed log entry (§4.1.1) with one transformation:
the envelope `content` field, which on the wire is a base58btc CID
string, is replaced inline by the decoded About payload object
(§2.6). The shape is:

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
  next:     <string[]>,
  refs:     <string[]>,
  v:        2,
  clock:    { id: <string>, time: <number> },
  key:      <string>,
  identity: <IdentityObject>,   // §3.5
  sig:      <string>
}
```

The inlined `content` field allows a receiving peer to display
library metadata without a secondary content fetch. Because the
inlined form differs from the on-wire envelope, receiving peers
that want to verify the About signature MUST re-fetch the canonical
signed entry by `hash` before treating it as an authenticated
record; the announcement payload is authenticated only to the
degree that its signature is verified against the canonical form.

**Size and trust.** Announcement messages MUST NOT exceed 256 KiB
after JSON encoding. A peer receiving a larger message MUST drop it
without processing. Announcement senders SHOULD prefer smaller
avatars (external CIDs rather than embedded base64 blobs) to stay
well below the limit. Receivers MUST treat announcement content as
untrusted hints until the underlying library's AC chain and entry
signatures have been verified per §3.

### 5.3.3 Announcement trigger

A peer SHOULD publish an announcement:

- When it joins the `RECORD` topic itself.
- When a new peer joins the `RECORD` topic (so the new peer
  receives the current state of known libraries).

Announcements are always broadcast on the `RECORD` topic; the
protocol does not rely on directed pubsub delivery, which is not
supported by gossipsub (the §5.5.1 required router).

**Rate limiting.** A peer MUST NOT emit more than one announcement
per `RECORD` peer-join event per 5 seconds per target peer, and
SHOULD further batch simultaneous peer joins into a single
announcement. A peer MUST NOT re-announce on its own library state
changes (append, merge) via the `RECORD` topic — state changes are
replicated via per-library topics (§5.4). This bounds `RECORD`
traffic to O(peer-join-rate) rather than O(writes).

**Join-time race.** A new peer may miss announcements published
during the window between its topic-subscribe call and its first
successful receive. A peer joining the topic SHOULD also actively
query known peers (via whatever directory or DHT mechanism it has)
rather than relying exclusively on receiving announcements. A
compliant receiver MUST NOT assume the absence of an announcement
means the library does not exist.

### 5.3.4 Announcement processing

On receiving an announcement:

1. Parse the JSON body.
2. Validate `about.content.address` is a valid library address.
3. Open a read-only handle to the advertised library (do not start
   replication yet).
4. For each entry in `logs`, do the same.
5. Record the peer-to-library mapping in an in-memory index for later
   querying.

## 5.4 Replication protocol

Replication is performed per-library. Peers publish to and subscribe
from a pubsub topic equal to the library address string.

### 5.4.1 Heads exchange

On joining a library's pubsub topic, a peer receives head messages
from other replicating peers and responds with its own heads. Heads
messages use the library's pubsub topic.

**Message schema.** A heads message is a JSON object of the form:

```
{
  "type":  "heads",
  "heads": [ <entry.hash>, ... ]   // base58btc CID strings
}
```

Each element of `heads` MUST be the base58btc CID string of a
currently-known head entry (§4.3) at the time the message is sent.
The array MAY be empty (a peer with zero entries still broadcasts
an empty heads message to signal presence).

**Publication triggers.** A peer MUST publish a heads message:

- When it first subscribes to the library's topic.
- When it observes a new peer joining the topic.
- When its own heads set changes as a result of a local append or
  a merge that produced entries not known to other peers.

A peer MUST NOT publish heads messages more often than once per
1000 milliseconds per library; if multiple trigger events occur
within the window the peer MUST coalesce them into a single
message.

**Size bound.** A heads message MUST NOT exceed 256 KiB after JSON
encoding. If a library's heads set would exceed this bound, the
peer MUST split the set across multiple heads messages tagged with
the same trigger and MUST include an `incomplete: true` field on
all but the final message in a batch. Receivers MUST wait for a
message without `incomplete: true` before treating the batch as a
complete snapshot.

### 5.4.2 Fetch traversal

On receiving a head message, a peer fetches the referenced entries
from content-addressed storage, then recursively fetches
predecessors following the union of `next` and `refs` pointers
until the subgraph is complete.

**Bounded traversal (MUST).** The traversal is an open network
operation and MUST be bounded to prevent resource exhaustion or
malicious graph expansion:

1. **Cycle detection.** The traversal MUST track the set of
   already-enqueued entry hashes and MUST NOT re-enqueue an entry
   it has already seen, whether or not the fetch for that entry
   has completed. Signed log entries form a DAG by construction,
   so a cycle indicates either a bug or a hostile peer; detection
   is the only correct response.
2. **Fan-out cap.** A single entry's `next` and `refs` arrays MUST
   each contain at most 256 entries. On receiving an entry whose
   `next.length > 256` or `refs.length > 256`, the peer MUST
   reject the entry at signature-verification time (§3.6.4) and
   MUST NOT enqueue its children.
3. **Concurrency bound.** The peer MUST bound the number of
   in-flight fetches per library. The specific bound is an
   implementation choice but MUST be finite and MUST default to a
   value that does not exceed the underlying content network's
   safe request rate.
4. **Per-entry timeout.** Each outstanding fetch MUST have a
   finite timeout. On timeout the peer MUST record the entry as
   unresolved, MUST NOT block the rest of the traversal waiting
   for it, and MAY retry later under a backoff schedule.
5. **Graph completeness.** A subgraph is "complete" when every
   enqueued entry has been successfully fetched or permanently
   abandoned (all retries exhausted). Merging (§5.4.3) operates
   only on the subset of entries that were successfully fetched,
   verified, and whose transitive `next` closure is also
   verified. Entries whose ancestors could not be fetched MUST
   NOT be merged.

The fetch SHOULD be pausable and resumable to support disconnect
semantics (§5.4.4). Resume MUST re-enter the traversal at the
earliest unresolved entry without re-fetching entries that already
landed locally.

### 5.4.3 Merge

Once a fetch task queue is idle (no in-flight fetches and no
pending enqueues), or once an implementation-chosen batch boundary
is reached, the peer merges the fetched entries into its local
oplog per §4.5. Implementations MAY merge incrementally as the
traversal proceeds, provided that:

- Each batch satisfies the §4.5 associativity/commutativity
  guarantee — the final state after merging batches A then B must
  equal the state after merging a single combined batch.
- Entries whose ancestors have not yet been fetched MUST NOT be
  merged (per §5.4.2 item 5).

On successful merge, the peer SHOULD:

1. Pin each newly-known signed log entry object (non-recursive).
2. Pin each entry's content CID (non-recursive).
3. Queue the entry for local indexing.

**Merge isolation.** An implementation processing multiple
concurrent heads messages for the same library MUST ensure that
the resulting oplog state is equivalent to some sequential merge
order. A simple conformant strategy is to serialise merges behind
a per-library mutex; implementations that parallelise merges MUST
ensure §4.5 invariants hold across the concurrent execution.

### 5.4.4 Replication disconnect

Implementations MUST support pausing replication for a specific
library without closing the log.

**Pause.** On pause, the implementation MUST:

- Stop publishing heads messages for the library.
- Stop accepting new fetch tasks for the library.
- Leave any in-flight fetch tasks to either complete naturally or
  time out. Entries that finished fetching before the pause MAY be
  merged as normal; entries still in flight when the pause takes
  effect MUST be recorded as unresolved so that resume can pick
  them up without loss.

**Resume.** On resume, the implementation MUST re-enter the
traversal for any unresolved entries recorded at pause time before
publishing a new heads message. The resume MUST NOT re-fetch
entries that already landed locally.

**Unlink.** When a library is unlinked (permanently disconnected,
not merely paused), the implementation SHOULD:

1. Pause the library's replicator per the rules above.
2. Unsubscribe from the library's pubsub topic.
3. Discard any unresolved-fetch state for the library.
4. Remove unique content as described in §4.7.

### 5.4.5 Network partition and unreachable peers

Library replication operates over an unreliable network. A peer
MUST tolerate heads messages that reference entries whose CIDs
cannot currently be fetched from the content network (because no
reachable peer holds them, or because the network is partitioned).

- A per-entry fetch that times out (§5.4.2 item 4) MUST NOT stall
  the overall replicator. The peer SHOULD continue processing
  other heads and other libraries while the unresolved entry is
  retried under backoff.
- If all heads in a library cannot be fetched over an extended
  interval, the peer SHOULD treat the library as temporarily
  unreachable but MUST NOT discard its local oplog. On
  reconnection it resumes replication from the heads it last
  knew.
- A peer MUST NOT emit a "library removed" or equivalent signal
  to local consumers purely because of fetch failures. Removal is
  an explicit user or API action (§5.4.4 unlink).

## 5.5 Content network configuration

An implementation's underlying content network MUST be configured
such that compliant peers can exchange blocks.

### 5.5.1 Required (MUST)

- **Pubsub router**: gossipsub.
- **CID formats**: dag-cbor payloads with sha3-512 hashes, dag-cbor
  entries with sha2-256 hashes, base58btc string encoding in protocol
  fields.
- **Private network pre-shared key**: the v0 protocol uses a shared
  PSK to isolate Record traffic from public content-addressed networks.
  Implementations joining the v0 network MUST use the following PSK:

  ```
  /key/swarm/psk/1.0.0/
  /base16/
  cbad12031badbcad2a3cd5a373633fa725a7874de942d451227a9e909733454a
  ```

  This value is written to the content network's swarm key file (e.g.
  `<ipfs-repo>/swarm.key` for IPFS). Peers with a different PSK (or
  no PSK) cannot exchange blocks with v0 peers. Future protocol
  versions MAY define a different PSK or remove the isolation
  requirement.

### 5.5.2 Recommended (SHOULD)

- **Datastore**: a disk-efficient backend.
- **Connection manager**: bounded concurrent connections.
- **NAT traversal**: enabled by default (UPnP / nat-pmp or
  equivalent).
- **Local discovery**: mDNS enabled.
- **Bootstrap peers**: at least one well-known peer address for
  bootstrap.

## 5.6 Event observability (informative)

Implementations SHOULD expose lifecycle events for UI layers.
Recommended event categories include: peer join/leave, indexing
progress, replication batch completion, and per-entry fetch progress.
These events are local and not part of the wire protocol.
