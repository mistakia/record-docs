# 4. Library Structure

A Record library is an append-only, signed, content-addressed log of
operations. This section specifies the log structure, entry format,
and merge semantics.

**Library vs. query database.** In this specification the term
"library" refers exclusively to the signed, content-addressed oplog
(the DAG of entries described in §4.1). A "query database" (§4.7) is
an optional, implementation-local derived index populated by replaying
the oplog; it is not part of the protocol and is invisible to peers.
Two conformant peers replicate libraries, not query databases. Any
behaviour attributed to "opening" or "closing" a library in this
section applies to the oplog only; managing the associated query
database is an implementation concern.

## 4.1 Append-only log

Entries are content-addressed, signed, and form a directed acyclic
graph (DAG) via `next` and `refs` pointers.

### 4.1.1 Persisted entry shape

On the wire and at rest, each signed entry is an 8-field dag-cbor
object:

```
{
  id:      <string>,            // library id (the library this entry belongs to)
  payload: <operation>,         // §2.8 PUT/DEL operation
  next:    <string[]>,          // parent entry hashes: heads at time of creation (§4.2)
  refs:    <string[]>,          // additional reference hashes for traversal
  v:       2,                   // entry schema version
  clock:   { id, time },        // Lamport clock
  key:     <pubkey_hex>,        // writer's compressed secp256k1 pubkey
  sig:     <string>             // signature per §3.4
}
```

Each `next` and `refs` element is the parent's `entry.hash` as a
plain base58btc CID string, not an IPLD link. The signed log entry
`v` field MUST be 2.

**Reference vector.** Continuing from the §3.4.5 signing vector,
extending the unsigned entry with `{key, sig}` yields the 8-field
signed object whose canonical dag-cbor encoding is 688 bytes long
and whose sha3-512 hash, wrapped as a CIDv1 with dag-cbor codec
and encoded as base58btc, is:

```
zBwWX7sbGgnamYuFHWzehnHysmRkS9rVvdgATL8CPab1ybY1j3xyy9F7Pu9m86AgsyCWfXbBPdxXfhEFzd6fdn14uEVAF
```

This is the value `entry.hash` MUST take for the §3.4.5 vector after
write. `spec/fixtures/gen-signing-vector.mjs` emits the full byte
sequence and verifies that the CID multihash digest equals the
sha3-512 of the script's serialized signed object.

### 4.1.2 Entry hash

The entry hash is the CID of the 8-field signed dag-cbor object
above. It is computed after signing and assigned locally to
`entry.hash` for reference; `hash` is not itself part of the
stored bytes.

For the §3.4.5 vector, the entry hash MUST equal the CID embedded in
§4.1.1 above.

**Child-entry vector.** The same generator signs a second entry with
the §3.4.5 key: a `DEL` of the §3.4.5 track (`value: {type: "track",
timestamp: 1611272666696}`), `next: [<the §4.1.1 CID above>]`,
`refs: []`, `clock: {id: <§3.4.5 pubkey>, time: 2}`, same library
`id`. Its signed dag-cbor object is 606 bytes and its entry hash is:

```
zBwWX6N1WUQhrDeFC3oNsPdZx2mQT9jLiPTLBDk32c6WPDZDSEr28Nuh9DgoeXwPLjLXQY7xfFkrWihvgsTeyGQ14UMT7
```

An implementation that stores `next` elements as IPLD links (CBOR
tag 42) instead of strings produces a different hash here.

## 4.2 Lamport clock

Each entry carries a Lamport clock `{ id, time }`:

- `id` is the writer's identity public key (hex) — the same value as
  `entry.key` (§4.1.1). This scopes the clock to a specific writer
  identity, not to the library as a whole.
- `time` is a monotonically increasing unsigned integer reflecting
  that writer's view of the log at the moment the entry is produced.

**Append rule.** On append, the writer sets `next` to a non-empty
subset of the library's current heads (§4.3), of at most 256 entries
(§5.4.2 item 2), and computes `time = max(t.clock.time for t in next)
+ 1`. Only a library's first entry has an empty `next` and `time = 1`.
Heads are not filtered to entries signed by the same writer. A
library with a single writer therefore advances its clock by exactly
1 per append; a library with multiple concurrent writers may observe
time jumps as remote heads are merged.

A writer with at most 256 heads SHOULD cite them all, as v1.0 writers
do. A writer with more SHOULD cite the heads with the greatest
`clock.time` first: its entry then sorts after every entry it knows
under §4.4.2, as under v1.0. A head it does not cite stays a head and
is cited by a later append. Each append that cites 256 heads replaces
them with one, so a writer facing `n` heads reaches a single head
within ⌈n/255⌉ appends.

The subset is what keeps a library writable. Without it, any writer
able to append, such as a grantee (§3.5.5), could leave 257 heads by
appending 257 entries on one parent. Every later append would then
have to exceed the §5.4.2 fan-out cap. Inert entries (§3.5.10) still
count as heads, so revocation would not help.

**Merge rule.** Merging does not change the append rule: an append's
time follows from the heads it cites. v1.0 kept a local Lamport time,
`max(local_time, max(remote.clock.time for remote in merged_entries))`.
That value never exceeds the greatest head time, because the entry
with the greatest time has no child, so a v1.0 writer citing every
head computed the same time.

**Verification (v1.1).** A receiver MUST reject an entry whose
`clock.time` is not exactly `max(t.clock.time for t in next) + 1`, or
`1` when `next` is empty. The entries in `next` are in hand, because an
entry merges only once its `next` closure is verified (§5.4.2 item 5).
This is the append rule above, checked, so every entry a conforming
v1.0 writer produced passes. Without the check, a writer could sign
`clock.time = 2^53 - 1`: that entry would win every §4.4.2 comparison
against the owner's later PUTs and DELs, and no conforming writer
could append after it.

**Reference vector.** `spec/fixtures/gen-capability-vector.mjs` has a
grantee append 257 Track PUTs on one capability, leaving 257 heads.
The owner's next append cites 256 of them and is valid; a second
append cites the remaining head and the first append, and the library
is back to one head. An owner append citing all 257 is rejected by
the fan-out cap.

**Multiple local identities.** If one peer holds multiple identities
that write to the same library (permitted by the AC), each write
uses the clock rule above based on the current heads set; the two
identities do not share a private counter. The resulting entries
have distinct `clock.id` values and the Lamport ordering between
them is determined purely by their `clock.time` values and the head
relationships at the moment they were produced.

## 4.3 Heads

The "heads" of a log, relative to an entry set `E`, is the subset
`heads(E) = { e ∈ E : ¬∃ e' ∈ E . e.hash ∈ e'.next }`. A log may have
multiple heads at any time (concurrent writes from different
authorised writers, or concurrent writes across linked libraries).

The definition uses only `next` pointers, not `refs`. `refs` pointers
exist for fast traversal and do not affect parent/child relationships
for the purpose of head computation.

On replication, the sync protocol exchanges the current head hashes
and fetches predecessors via `next ∪ refs` until the graph is
complete. After a merge, the new head set is computed from the union
of local and remote entries as `heads(E_local ∪ E_remote)`.

## 4.4 Operations and ordering

The library is a CRDT operation log. Order of entries in the log does
not affect final state — what matters is the set of operations and
their clock relationships.

### 4.4.1 Entry dispatch

When applying an entry to local state:

1. Decode the operation from `payload`.
2. If `payload.op === "PUT"`, route to the type-specific add handler
   (add-about / add-track / add-log). A capability or revocation
   record (§3.5.5, §3.5.10) goes to the capability index used by
   §3.5.9.
3. If `payload.op === "DEL"`, route to the type-specific remove handler.
   DEL is only valid for `"track"` and `"log"` types.
4. Track the entry in a local index so the implementation can query
   "what is the current state of key K in library L?"

An inert entry (§3.5.10) is not dispatched.

A v1.1 receiver MUST merge an entry signed by a `write`-list key
whose PUT value has a `type` it does not recognise, and MUST give it
no state effect. A later minor version's records then do not stall
v1.1 replicas the way capability records stall v1.0 ones (§3.5.11).
The same entry signed by anyone else is rejected, since no action
authorises it (§3.5.6).

This dispatch applies to `recordstore` libraries. A `listens` library
holds only listen writes (§2.7), and an `identity` library dispatches
by record type (§4.8.2).

### 4.4.2 Current-state resolution

For any given `(library_address, entry_id)` tuple, the "current"
entry among a set of signed log entries is defined by sorting the set
by the three-element key

```
(clock.time DESC, envelope.timestamp DESC, entry.hash ASC)
```

and taking the first element. Implementations MUST use `clock.time`
as the primary ordering, the envelope `timestamp` as the first
tiebreaker, and `entry.hash` as the final tiebreaker. The `entry.hash`
used for the final tiebreaker is the CID of the signed dag-cbor entry
object (§4.1.2) compared as a byte string; because this CID is a pure
function of the signed bytes (all fields including `key` and
`sig`), two conformant peers that have received the same set of
signed entries MUST agree on the ordering. String comparison MUST be
performed on the raw multihash bytes of the CID (not the base58btc
string), so encoding choice cannot affect the result.

Inert entries (§3.5.10) take no part in this ordering.

A DEL entry participates in the same ordering as a PUT entry keyed
by the same `entry_id`; a DEL is "current" if it sorts first under
the above key, in which case the entry is considered tombstoned.

An implementation MUST only apply PUT/DEL effects to the "current"
entry — older entries with the same key MAY be dropped from the
query index. Recomputing the current entry on merge MUST use the
complete set of known entries for that key; partial recomputation
(looking only at newly-arrived entries) is not conformant.

**Reference vector.** `spec/fixtures/gen-current-state-vector.mjs`
builds a three-entry race set sharing one envelope.id and exercises
both tiebreakers:

| Entry | clock.time | envelope.timestamp | entry.hash (base58btc CIDv1) |
| ----- | ---------- | ------------------ | --------------------- |
| A     | 5          | 300                | `zBwWX5sj8wEnAJ8k1ZtrsqKpi6EDftGkcGjNJeepSKbU1YhnVgLaCDu9yFFjmT8MNQhnbWayLMVz93eQhgmsFzWxnVA1U` |
| B     | 7          | 200                | `zBwWX88KGtBXr3KSnx3VRFU3kAdzAcR1g4GrLCaMdLdi3BWepg4nvkcEUMDWXudVjLD9AbG6672Qzo3SYoDZJ89cfYLs1` |
| C     | 7          | 200                | `zBwWX6cFvYVau8nCB7u6v4sBWDsLJ8LNxLk8QLovwhSPPau38u8vSNxKqMy7ksxaNasfq8C5V4v9QvyDHoYp2MWz5TRDF` |

The race set exercises ordering only. Its entries have empty `next`
with clock times above 1, so they would not pass the §4.2 clock check
as received entries; the ordering result is unaffected.

A is eliminated on `clock.time` (5 < 7). B and C tie on `clock.time`
and `timestamp`; the raw-multihash-bytes ASC tiebreak picks **C** as
the winner (C's multihash sorts before B's). The fixture verifies that
swapping the two non-winner entries in the input set produces the same
winner, confirming the ordering rule is total.

## 4.5 Merge semantics

When merging a remote log into the local log:

1. For each new entry, verify its signature (§3.4.4), its
   authorisation, by AC membership or by capability (§3.5.4,
   §3.5.9), and its clock (§4.2). Any entry that fails verification MUST be
   dropped and MUST NOT appear in the merged oplog state observed
   by step 4.
2. Insert the surviving entries into the local oplog structure. The
   insertion MUST be idempotent: an entry whose `entry.hash` already
   exists locally is a no-op, not a duplicate insertion.
3. No clock state advances: an append's time follows from the heads
   it cites (§4.2).
4. Recompute the heads set as `heads(E_local ∪ E_remote_verified)`
   per §4.3. An entry that was a local head before the merge MAY
   cease to be a head after the merge if a newly merged entry
   references it in `next`.
5. For each key touched by a merged entry, or holding an entry that
   a newly effective revocation made inert (§3.5.10), re-run the
   current-state resolution (§4.4.2) over the complete set of known
   entries for that key and update the query index accordingly.

Merges MUST be associative and commutative: for any three entry
sets `A`, `B`, `C`, the oplog state resulting from
`merge(merge(A, B), C)` MUST equal the state resulting from
`merge(A, merge(B, C))` and from `merge(C, merge(B, A))`. Because
§4.4.2 defines a total order over any set of entries for a given
key, because entry verification is a pure function of the signed
bytes, the entry's causal past, and the library AC, and because
inertness is a function of the entry set (§3.5.10), this property
follows from set-union semantics on the oplog and total-order
resolution on the query index.

**Concurrent merges.** An implementation MAY process multiple merge
batches concurrently. If it does, it MUST ensure that the final
query-index state for any key is equal to the result of running
step 5 over the union of all batches; incremental per-batch updates
are permitted only if the implementation guarantees this equivalence
(for example, by recomputing state for each touched key after each
batch).

## 4.6 Per-library pinning

For each opened library, an implementation MUST pin items 1-3 (the
AC chain, per §3.5.1) and SHOULD pin items 4-5. Item 6 follows the
library's replication policy (§4.6.1) and the identity's pins
(§4.6.2):

1. The library manifest (AC chain object 1, §3.5.1).
2. The AC wrapper (chain object 2).
3. The AC inner write-list (chain object 3).
4. The signed log entry object (the dag-cbor block whose CID is
   `entry.hash`, §4.1.2) for every entry in the oplog.
5. For `recordstore` entries, the dag-cbor payload referenced by
   `envelope.content` (§2.1).
6. For Track entries: the audio blob referenced by `content.hash`
   and each CID in `content.artwork`.

Item 4 and item 5 are distinct content-addressed objects. Item 4 is
the full signed wrapper; item 5 is the application payload it points
at indirectly via the envelope. Pinning item 4 does NOT transitively
pin item 5 because `envelope.content` is a string, not an IPLD link.

Pinning MAY be non-recursive for items 1-5 (the dag-cbor objects are
leaf-level from the pinning perspective) and SHOULD be recursive for
item 6 (the audio blob is typically chunked into a UnixFS DAG by
the §5.5.1 importer, so a recursive pin is needed
to retain all blocks).

On unlink, the implementation MUST unpin items 1, 2, 3, every entry
hash the library uniquely held (not shared with another still-linked
library), and every content CID/audio/artwork that is not referenced by
another still-linked library. It MUST NOT unpin a blob that a pin
(§4.6.2) still holds.

### 4.6.1 Replication policy

An implementation holds a replication policy for each library it
links that is not an own library (§4.8.3). The policy is node-local
configuration. It is not written to any log or visible to peers, and
two devices of one identity MAY hold different policies for the same
library. It decides item 6 only: items 1-5, and replication of the
log itself (§5.4), are the same in every mode.

| Mode         | Item 6 for each live Track entry                                              |
| ------------ | ----------------------------------------------------------------------------- |
| `full`       | MUST fetch and pin                                                            |
| `selective`  | MUST fetch and pin when its track view matches the policy filter; otherwise as `index_only` |
| `index_only` | MUST NOT fetch proactively                                                    |

- A link recorded in the identity library, with no configured policy,
  is `full`, keeping the v1.0 recommendation to pin item 6 as the
  default.
- A link that §4.8.4 derives from a legacy Log entry, made before
  v1.1, defaults to `index_only`. Upgrading a node therefore does not
  start fetching every linked library's audio. Relinking it records a
  link in the identity library, which defaults to `full`.
- An own library is always replicated as `full`.
- In `index_only` mode a blob fetched on demand, for example to serve
  playback, MAY be cached without a pin and evicted. The cache MUST
  be bounded; its size is the implementation's choice (§1.7).
- When a track stops qualifying, because it is tombstoned or
  superseded, no longer matches the filter, or the mode changes, the
  implementation MAY unpin its item 6 objects, unless a pin, an own
  library, or another library's policy still holds them.
- Pausing replication (§5.4.4) suspends the fetches a policy calls
  for, and resuming restarts them. Pause and resume do not change the
  mode.

**Track view.** A `selective` filter is a FilterSpec (§3.5.7)
evaluated against this object, built for each live Track entry:

```
{
  library_address:  <string>,       // the library holding the entry
  added_by:         <pubkey_hex>,   // entry.key
  added_at:         <uint64>,       // envelope.timestamp
  tags:             <string[]>,     // envelope.tags, [] when absent
  cid:              <string>,       // content.hash
  audio_size_bytes: <uint64>,       // content.size
  duration_seconds: <number>?,      // content.audio.duration
  title:            <string>?,      // content.tags.title
  artist:           <string>?,      // content.tags.artist
  source:           <string[]>      // extractor of each content.resolver entry
}
```

A field whose source is absent or null is absent from the view.
Building the view reads item 5, the content payload, which every mode
already pins.

A filter that fails closed (§3.5.7) selects no track, so its library
behaves as `index_only`. An implementation SHOULD refuse to configure
such a filter, and SHOULD surface one it already holds.

### 4.6.2 Pins

A `pin` record in the identity library (§4.8.2) asks every device of
the identity to keep a blob, whatever any library's policy. For each
`pin` record whose current state is a PUT, every implementation
holding the identity MUST fetch the blob `cid` and pin it
recursively, and SHOULD pin the artwork of each known Track entry
whose `content.hash` matches `cid` (§4.8.2). A pin applies even when no known
library holds the track, and while the libraries that hold it are
paused (§5.4.4).

When a pin's current state becomes a DEL, the implementation MAY
unpin the blob, unless an own library or a replication policy still
holds it.

## 4.7 Query database derivability

Any local query database an implementation maintains MUST be
fully derivable from the oplog: rebuilding from scratch MUST
yield the same state as incremental maintenance. The query
database schema is not part of the protocol and is invisible
to peers.

## 4.8 Identity library

An identity library, also called the identity meta-log, records an
identity's own libraries, its links, and its pins. It is a library
in the §4.1 sense, a signed append-only log under a §3.5 access
controller, with library type `identity`, at the address §3.6.2
derives from the identity key `K`.

### 4.8.1 Writers and entries

The identity library's `write` list is exactly `[K]`. Its entries
are §4.1 signed entries whose `payload` is a PUT or DEL operation
(§2.8) carrying a record inline, with no envelope and no content CID,
as a listens library does (§2.7). Keeping each record in the signed
entry means reading the identity library takes no payload fetches.

A receiver MUST reject an entry in an identity library whose signer
is not `K` (§3.5.4) or whose operation carries `capability_id`
(§3.5.9). The size bounds of §2.8.3 apply.

### 4.8.2 Records

| Record    | PUT means                      | DEL means           | `key`             |
| --------- | ------------------------------ | ------------------- | ----------------- |
| `library` | `K` owns the library           | the library retires | `sha256(address)` |
| `link`    | `K` follows the library        | unlink              | `sha256(address)` |
| `pin`     | retain the blob (§4.6.2)       | unpin               | `sha256(cid)`     |

PUT values:

```
{ type: "library", v: 1, timestamp: <uint64>, address: <string> }
{ type: "link",    v: 1, timestamp: <uint64>, address: <string>, alias: <string>? }
{ type: "pin",     v: 1, timestamp: <uint64>, cid: <string> }
```

A DEL value is `{ type, timestamp }`, as in §2.8.2, with `type`
naming the record.

- `address` MUST be a library address (§3.6).
- `alias`, when present, MUST be at most 128 UTF-8 bytes.
- `cid` is an audio blob CID in canonical form: as CIDv1, encoded
  base32 (multibase prefix `b`). A CIDv0 converts to the CIDv1 with
  the dag-pb codec and the same multihash. Every encoding of one CID
  therefore keys one pin. A `content.hash` matches a pin when its
  canonical form equals `cid`.
- `timestamp` is milliseconds since the Unix epoch, as in §2.2.
- `key` is the lowercase-hex sha256 of the UTF-8 string, as in §2.3.

A receiver MUST reject an entry whose record has a `type` this
section defines but breaks its shape: a missing or mistyped field, a
field this section does not define, an `address` that is not a
library address, an `alias` over 128 bytes, a `cid` not in canonical
form, or a `key` not derived as the table states. This matches how a
malformed envelope is treated (§2.2).

**Current state.** For each `(type, key)` pair, the current record is
chosen by the §4.4.2 ordering, with the record `timestamp` in place
of the envelope timestamp. The exception is retirement, which is
terminal (§4.8.3). Resolution is per `(type, key)` rather than per
key, because a `library` record and a `link` record for the same
address share a key.

**Reference vector.** `spec/fixtures/gen-meta-log-vector.mjs` signs
nine entries into the identity library of the §3.4.5 test key
(§3.6.2), each with `next` naming the one before:

| Entry | Operation | Signed bytes | `entry.hash` (base58btc CIDv1) |
| ----- | --------- | ------------ | ------------------------------ |
| 1     | `library` PUT of the §3.5.1 library | 682 | `zBwWX6yJT8sDseJEr3iaGgYqsKiejaKBizBNPiSDeoV2yXHjkXXqcHL6JYF7xqGy5m9WQT1scdXRmh3BLoq7xp8K7VLZC` |
| 2     | `link` PUT of test key `k = 2`'s `library`, alias `friend` | 785 | `zBwWX6tGPpW4hsRc5AhPJJhFVopAeJXmjzj9zm1aXrvnoUo9XdGZ2gRiAcmSFdovBmfHnC8rc4ny59uWSrJGAz93gdT1J` |
| 3     | `pin` PUT of the §6.2.4 audio CID, canonical form | 719 | `zBwWX7isyhFyCGzkHqmj5XZ4Auq7rss84UsPqtb4LCXsJmJwschU9Nnpn9PkBkFnSNFX2dA8t55QbMFfmyNZUu1HmFkuB` |
| 4     | `link` DEL of entry 2's address | 650 | `zBwWX94oXV3jxM3ZchvB6FVBDJ6va4BhRvLinaHkaMGKcTrmV5fJDYtJXFGXMxB4Sra39YT1ugrBTrWjAzKtYdTV2RRSE` |
| 5     | `library` PUT of the own `mixes` library | 775 | `zBwWX8emvUUZidkjMXTqY1FkrL8Z3byJyh3Pvb3GJg613EknTdmNFM2C2yDePJ9q6biMELLiS1bwnirGC1i2NSDctnxit` |
| 6     | `link` PUT of the same `mixes` address | 772 | `zBwWX8sz9N4cENbiU15tWb1kQUeWuAM1ocugdCCh1kYjjv7r2VVP8pMXXoiKW4YEff8Vkr6LW6Vv1cJ1QHVdH7NfwKQ6n` |
| 7     | `link` DEL of `mixes` | 652 | `zBwWX9zPbVPvWVdLmxxX3JfEi9iXGsuoP9Q1SnebpU6JKU2SAjMCputjt3DPiNzsE6TAmUYAf7Kh57rJvSbKdHJd5ebGa` |
| 8     | `library` DEL of `mixes` (retire) | 655 | `zBwWX9m9dkzAdkitjJUAvBDd3zt4n9W2Y2ziGtzU5qnhRJUvNYVBjfggvBV6ZnJfHFPYmKhbh8X8QoiJJKtGx1kvD1qrf` |
| 9     | a stray `library` PUT of `mixes` | 773 | `zBwWX8M4t6XTCqyoP198pk8KUbJj3N4vWmJ6J5ST4uqsQMCCQmy9RB6p2b1ejNXbSNoVTyvMK42TpSbVMWnSGm4HApgKY` |

After all nine, the §3.5.1 library record and the pin are current
PUTs, both links are current DELs, and `mixes` is retired. Before
entry 8, the `mixes` library record is a PUT while its link record is
a DEL: the two share a key but resolve apart. The script also rejects
a pin whose `cid` is base58btc rather than canonical, and a link whose
alias is 129 bytes.

**Unknown records.** A receiver MUST merge an entry signed by `K`
whose record `type` it does not recognise, and MUST give that entry
no state effect. Later versions can then add record kinds without
stalling v1.1 replicas.

### 4.8.3 Own libraries

A library is an own library of `K` when its `library` record is a
current PUT, or it is retired, and its AC `write` list (§3.5.1) contains `K`. A reader MUST
check the write list before treating a recorded library as owned, so
an identity library cannot claim another identity's library. A
record that fails the check has no effect.

An implementation holding `K` MUST record with a `library` PUT every
library it creates for `K`. It MUST also record each own library it
created before v1.1, the first time it opens `K` at v1.1, so the
identity library lists every own library. Concurrent duplicate PUTs
from two devices resolve per §4.4.2 and are harmless.

**Retirement.** A DEL of a `library` record retires the library for
good. Once any `library` DEL for a key is in the identity library, the
library is retired, whatever PUTs for that key exist or follow, and
writers MUST NOT PUT that key again. Because a retirement can never be
undone, a stale or concurrent PUT from another device cannot revive
it, and no ordering across devices is needed.

A retired library stays a valid library (§3.3): its entries remain
valid, and peers that link it are unaffected. Implementations holding
`K` MUST refuse new local writes to a retired library and MUST NOT
count it as an own library when choosing a default write target
(chapter 7). They MAY keep replicating and announcing it.

**Listens.** An identity has at most one active own library of type
`listens`, and its listens are written there (§6.5). A writer MUST NOT
retire it: retirement is permanent, and the identity's listens would
have nowhere to go. If a retirement of it is found anyway, from a
non-conforming writer, the identity creates a new listens library
with a new discriminator (§3.6.1) before recording another listen.

### 4.8.4 Links

`K`'s link set is the set of addresses whose current `link` record is
a PUT. Writers MUST record links and unlinks in the identity library,
and MUST NOT append new Log PUTs (§2.5) to a recordstore library.

Log entries written before v1.1 stay readable as links, so no
migration is needed. Where both sources speak, the identity library
wins:

- For an address with any `link` record in the identity library, PUT
  or DEL, the current `link` record alone decides whether it is
  linked, and supplies the alias.
- For an address with no `link` record, a live Log entry in any own
  library of `K`, active or retired, links it with that entry's
  alias, as in v1.0.

The identity library wins because a v1.1 writer records every link
change there, so any record there is newer intent than a legacy Log
entry. Comparing the two by clock is not possible: Lamport clocks of
different logs are unrelated (§4.2).

When unlinking an address that a legacy Log entry in an own library
links, a writer SHOULD also append a Log DEL to that library, so v1.0
peers reading it see the unlink.

### 4.8.5 Replication across devices

Every implementation holding `K`'s private key MUST open `K`'s
identity library and replicate it per §5.4, so the identity's
libraries, links, and pins converge across its devices. Concurrent
writes from two devices holding the same key produce several heads,
which merge per §4.5. Any other peer MAY replicate an identity
library; like every library, it is public.

### 4.8.6 v1.0 peers

A v1.0 peer refuses to open an identity library, because step 1 of
the §3.5.1 resolution rejects its manifest type. Nothing a v1.0 peer
reads refers to an identity library, so the only effect is that v1.0
peers do not see the links, pins, and retirements recorded there.
They still see Log entries written before v1.1.
