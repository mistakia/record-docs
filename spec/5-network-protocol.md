# 5. Network Protocol

## 5.1 Transport abstraction

Record peers communicate via three logical channels:

1. **Content-addressed fetch**: on-demand retrieval of CIDs
   (manifest, AC chain, entries, payloads, audio blobs, artwork,
   avatars).
   Any content-addressed storage network that supports the
   required CID formats is acceptable.
2. **Publish-subscribe**: library announcement broadcast (§5.3)
   and per-library replication messaging (§5.4).
3. **Peer discovery**: a mechanism for peers to find one
   another's network addresses.

Transport choices are SHOULD-level recommendations; observable
message formats are MUST-level requirements.

## 5.2 Peer discovery

An implementation SHOULD support at least two of the following
mechanisms and MUST be able to bootstrap from any one in isolation:

- **Shared bootstrap service**: a well-known rendezvous that
  returns candidate peer addresses for the Record network
  (§5.2.1).
- **Local-network discovery**: mDNS or equivalent for peers on
  the same LAN.
- **Content-network native discovery**: the underlying
  content-addressed network's own peer discovery.

Every implementation MUST support content-network native discovery.
The other mechanisms are acceleration layers. A node in `masked`
or `relayed` mode (§5.6) runs only the mechanisms its mode allows.

### 5.2.1 Mainline rendezvous

The shared bootstrap service is the BitTorrent mainline DHT
(BEP 5), used as a rendezvous rather than as a server the project
runs.

- **Info hash.** The rendezvous key is the 20-byte SHA-1 of the
  17 ASCII bytes `record-network-v1`:
  `2cad0137affa3f21818be869ca2728ab2f8d76fe`.
- **Lookup.** A node SHOULD run `get_peers` on the info hash at
  start and periodically after (recommended: every 15 minutes),
  and dial each returned `<ip>:<port>` directly as
  `/ip4/<ip>/tcp/<port>` over the §5.5 profile. A returned address
  is an untrusted hint: a dial that fails the pre-shared key is
  dropped.
- **Announce.** A node MUST announce (`announce_peer`) only a TCP
  port it has confirmed is reachable from outside its network:
  one AutoNAT has confirmed, one a UPnP mapping has opened
  (§5.5.2), or one its operator configured as a reachable public
  address. A node with no confirmed port MUST NOT announce and
  only looks up. The mainline DHT stores the UDP source address
  of the announce, so announcing an unmapped internal port would
  publish an undialable address. A node SHOULD re-announce before
  the DHT's entry lifetime lapses (recommended: every 15 minutes).
- **Exposure.** A node that announces makes its public IP address
  and port visible to anyone who looks up the info hash. Mainline
  DHT queries are themselves visible to the DHT nodes they reach.
  Implementations MUST NOT forge node ids or otherwise depart from
  BEP 5 and BEP 42 to place themselves near the info hash.

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

An identity that owns several `recordstore` libraries announces one
of them as `about` and lists the others in `logs`, with its linked
libraries (§4.8.4). An identity library has no About entry and MUST
NOT be announced.

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

**Reference vector.** `spec/fixtures/gen-network-message-vector.mjs`
emits a canonical single-entry LoadedAboutEntry whose
`payload.value.content` is the decoded About payload object (not the
CID string the canonical wire form would carry) per the inline
transform contract above. The generator verifies that the inlined
`content.address` equals the owning library address (§2.6), that
JSON `parse(stringify(msg))` deep-equals `msg`, and that the encoded
message is well within the 256 KiB bound (1060 bytes for the
single-entry vector).

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

Identity libraries (§4.8) replicate by this same protocol, on the
topic equal to their address.

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

**Reference vector.** A canonical single-entry heads message is:

```
{"type":"heads","heads":["zBwWX7sbGgnamYuFHWzehnHysmRkS9rVvdgATL8CPab1ybY1j3xyy9F7Pu9m86AgsyCWfXbBPdxXfhEFzd6fdn14uEVAF"]}
```

(122 bytes; the embedded hash is the F0/F4 signed-entry CID per §4.1.2.)
`spec/fixtures/gen-network-message-vector.mjs` regenerates and
verifies it under the §5.4.1 size bound.

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
   MUST NOT enqueue its children. A writer with more heads cites a
   subset of them (§4.2).
3. **Concurrency bound.** The peer MUST bound the number of
   in-flight fetches per library. The bound MUST be finite and
   SHOULD default to at least 4 concurrent fetches.
4. **Per-entry timeout.** Each fetch MUST have a finite timeout
   (SHOULD default to at least 30 seconds). On timeout the peer
   MUST record the entry as unresolved, MUST NOT block the
   traversal, and MAY retry under backoff.
5. **Graph completeness.** A subgraph is "complete" when every
   enqueued entry has been fetched or permanently abandoned.
   Merging (§5.4.3) operates only on entries that were fetched,
   verified, and whose transitive `next` closure is also
   verified. Entries with unfetched ancestors MUST NOT be merged.

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
4. Queue the audio, artwork, and avatar fetches the library's
   replication policy calls for (§4.6.1, §5.4.6).

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

**Unlink.** When a library is unlinked (§4.8.4) the implementation
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

### 5.4.6 Content replication

Audio blobs, artwork, and avatars travel over the content-addressed fetch
channel (§5.1), not over a library's pubsub topic. A peer fetches
them when a replication policy (§4.6.1) or a pin (§4.6.2) requires
it, and on demand in `index_only` mode.

These fetches MUST be bounded as §5.4.2 bounds entry fetches: a
finite number in flight, a finite timeout per blob, and retry under
backoff for a blob that times out. A blob that cannot be fetched
MUST NOT stall log replication or other blob fetches. Its track stays
listed, and only its local availability is affected.

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
- **Content import profile**: writers MUST import audio blobs and
  artwork as UnixFS files using the IPIP-499 `unixfs-v1-2025`
  profile (https://specs.ipfs.tech/ipips/ipip-0499/). Its
  parameters are:

  | Parameter            | Value                                   |
  | -------------------- | --------------------------------------- |
  | CID version          | CIDv1                                   |
  | Hash function        | sha2-256                                |
  | Leaves               | raw                                     |
  | Chunker              | fixed-size, 1 MiB (1048576 bytes)       |
  | DAG layout           | balanced, 1024 links per node           |
  | HAMT fanout          | 256                                     |
  | HAMT threshold       | 256 KiB, estimated as block bytes       |
  | HAMT switch          | when the estimate is strictly greater   |
  | Mode and mtime       | excluded                                |

  The profile makes the CID a function of the blob bytes alone, so
  byte-identical tag-stripped audio (§6.2) yields the same
  `content.hash` on every peer.

  Implementations MUST NOT override any parameter the profile sets.
  Some importers apply a profile only to options the caller left
  unset: in the JS `ipfs-unixfs-importer`, an explicit `cidVersion`,
  `rawLeaves`, `chunker`, `layout`, or shard option wins over
  `profile`. Pass the profile and nothing it sets. Each blob is
  imported as a single file, not wrapped in a directory.

  Writers MUST store each resulting CID in `content.hash` and
  `content.artwork` as a base58btc string (§2.4.1). Readers MUST
  accept any valid CID string there. Entries written before v1.0.3 may carry a
  CIDv0 (`Qm...`) or a CIDv1 from another profile; they remain
  readable but do not dedupe against profile-conformant CIDs.

### 5.5.2 Transports and NAT traversal

- **Transport.** TCP. Every connection MUST pass the §5.5.1
  pre-shared key connection protector. A transport that skips the
  protector (QUIC and WebRTC in js-libp2p, for example) MUST NOT be
  enabled. A connection carried through a circuit relay or a SOCKS5
  proxy (§5.6) is still TCP underneath and still carries the key.
- **NAT traversal.** A `public` node (§5.6) SHOULD run this set:
  - **AutoNAT** to learn whether its listen addresses are dialable
    from outside.
  - **UPnP** port mapping on the local gateway, where one answers.
  - **Circuit relay v2**, as a client to reserve on a reachable
    peer while it is not itself reachable, and as a server with the
    default per-connection limits so that peers can coordinate a
    hole punch through it.
  - **DCUtR** to upgrade a relayed connection to a direct one by a
    synchronised TCP simultaneous open.
- A hole punch that fails, as behind a symmetric or carrier-grade
  NAT, falls back to other reachable peers holding the content. A
  `public` node's relay server MUST NOT be relied on to carry
  content between third parties; its default limits make it a
  coordination channel only.

## 5.6 Network modes

A node runs in exactly one network mode. The mode names how the
node can be reached and bounds what it advertises and dials.

| Mode | Reachable by | Advertises | Dials |
| --- | --- | --- | --- |
| `public` | anyone | its confirmed public addresses | anyone, directly |
| `masked` | no one | nothing | outbound only, through Tor |
| `relayed` | anyone, through one named relay | only its circuit address on that relay | the named relay and circuit addresses through it only |

### 5.6.1 `public`

The default. The node runs the §5.2 mechanisms including the
mainline rendezvous, the §5.5.2 NAT traversal set, and the content
network's DHT as a server.

### 5.6.2 `masked`

A masked node hides its IP address from every peer.

- Every connection MUST be opened outbound through a Tor SOCKS5
  proxy. The node MUST NOT listen on any address, advertise any
  address (including LAN addresses), or dial any address except
  through the proxy.
- The node MUST NOT run the mainline rendezvous, LAN discovery,
  UPnP, AutoNAT, DCUtR, or a relay server. It runs the content
  network's DHT as a client only, and MUST discard private and
  LAN addresses the DHT returns.
- The node MAY run a circuit relay client without reservations, so
  that it can reach a `relayed` node (§5.6.3); its connection to
  the relay goes through the proxy like any other.
- The node MUST pass a hostname address to the proxy unresolved,
  so that name resolution happens through Tor and never on the
  local resolver.
- Because the mainline DHT is UDP and Tor carries only TCP, a
  masked node bootstraps by dialing a configured `public` node
  through Tor and finds further peers through the content
  network's DHT. An implementation SHOULD ship a default bootstrap
  address for this purpose.
- A masked node is outbound-only: two masked nodes never connect
  to each other, and a masked node serves content only over
  connections it opened. Listening as a Tor onion service is not
  defined in this version.
- A masked node's traffic is still visible to the Tor exit as
  pre-shared-key-protected TCP to the peer's address. Whatever a
  library publishes (§5.3) remains public; masking hides the
  network address only.

### 5.6.3 `relayed`

A relayed node is reachable only through one named circuit relay,
which lets an operator publish a node without exposing or dialing
from its network address.

- The node MUST listen only on
  `<relay-multiaddr>/p2p/<relay-peer-id>/p2p-circuit` for its
  configured relay and MUST advertise only that circuit address.
- The node MUST refuse every outbound dial except to the named
  relay and to circuit addresses through it, LAN addresses
  included, so that no remote peer can steer it into dialing its
  own network. Peers reach it through the relay.
- The node MUST NOT run the mainline rendezvous, LAN discovery,
  UPnP, AutoNAT or DCUtR. It runs the content network's DHT in
  server mode, so that it enters peers' routing tables and is
  findable by peer id at its circuit address.
- A relay serving a relayed node SHOULD reserve only for the peer
  ids it is configured to serve and MAY lift the default
  per-connection limits for them, so that content flows over the
  relayed connection.

### 5.6.4 Agent string

A node SHOULD identify itself to peers (libp2p identify
`agentVersion`) as `record-node/<major>.<minor> (<mode>)`, for
example `record-node/1.2 (masked)`, and SHOULD NOT include its
runtime or operating system. Another implementation substitutes its
own name. A peer MAY use the mode for aggregate counts; it MUST NOT
treat the string as authenticated.
