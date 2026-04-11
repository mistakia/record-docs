# 4. Library Structure

A Record library is an append-only, signed, content-addressed log of
operations. This section specifies the log structure, entry format,
merge semantics, and memory-scalability requirements.

**Library vs. query database.** In this specification the term
"library" refers exclusively to the signed, content-addressed oplog
(the DAG of entries described in §4.1). A "query database" (§4.8) is
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

On the wire and at rest, each signed entry is a dag-cbor object with:

```
{
  hash:     <CID>,              // hash of the entry itself (set after write)
  id:       <string>,           // library id (the library this entry belongs to)
  payload:  <operation>,        // §2.8 PUT/DEL operation
  next:     <hash[]>,           // parent entry hashes (heads at time of creation)
  refs:     <hash[]>,           // additional reference hashes for traversal
  v:        2,                  // entry schema version
  clock:    { id, time },       // Lamport clock
  key:      <pubkey_hex>,       // writer's identity public key
  identity: <IdentityObject>,   // §3.5
  sig:      <string>            // signature per §3.4
}
```

IPLD link fields MUST be `["next", "refs"]`. The signed log entry `v`
field MUST be 2. Earlier versions MAY be accepted for
backward-compatible reads but MUST NOT be produced by new writes.

### 4.1.2 Entry hash

The entry hash is the CID of the signed dag-cbor entry object,
including `key`, `identity`, and `sig` fields. It is computed during
the entry create step and then assigned to `entry.hash` for local
reference.

## 4.2 Lamport clock

Each entry carries a Lamport clock `{ id, time }`:

- `id` is the writer's identity public key (hex) — the same value as
  `entry.key` (§4.1.1). This scopes the clock to a specific writer
  identity, not to the library as a whole.
- `time` is a monotonically increasing unsigned integer reflecting
  that writer's view of the log at the moment the entry is produced.

**Append rule.** On append, the writer computes
`time = max(t for t in head_clock_times) + 1`, where
`head_clock_times` is the multiset of `clock.time` values across all
current heads of the library (§4.3) — NOT filtered to entries signed
by the same writer. A library with a single writer therefore
advances its clock by exactly 1 per append; a library with multiple
concurrent writers may observe time jumps as remote heads are
merged.

**Merge rule.** On merging remote entries, the local Lamport time is
updated to `max(local_time, max(remote.clock.time for remote in
merged_entries))`. The next local append then uses the merge rule
followed by the append rule.

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
   (add-about / add-track / add-log).
3. If `payload.op === "DEL"`, route to the type-specific remove handler.
   DEL is only valid for `"track"` and `"log"` types.
4. Track the entry in a local index so the implementation can query
   "what is the current state of key K in library L?"

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
function of the signed bytes (all fields including `key`, `identity`,
and `sig`), two conformant peers that have received the same set of
signed entries MUST agree on the ordering. String comparison MUST be
performed on the raw multihash bytes of the CID (not the base58btc
string), so encoding choice cannot affect the result.

A DEL entry participates in the same ordering as a PUT entry keyed
by the same `entry_id`; a DEL is "current" if it sorts first under
the above key, in which case the entry is considered tombstoned.

An implementation MUST only apply PUT/DEL effects to the "current"
entry — older entries with the same key MAY be dropped from the
query index. Recomputing the current entry on merge MUST use the
complete set of known entries for that key; partial recomputation
(looking only at newly-arrived entries) is not conformant.

## 4.5 Merge semantics

When merging a remote log into the local log:

1. For each new entry, verify its signature (§3.4.4), identity object
   (§3.5.2), and AC membership (§3.6.4). Any entry that fails
   verification MUST be dropped and MUST NOT appear in the merged
   oplog state observed by step 4.
2. Insert the surviving entries into the local oplog structure. The
   insertion MUST be idempotent: an entry whose `entry.hash` already
   exists locally is a no-op, not a duplicate insertion.
3. Advance the local Lamport clock time per §4.2.
4. Recompute the heads set as `heads(E_local ∪ E_remote_verified)`
   per §4.3. An entry that was a local head before the merge MAY
   cease to be a head after the merge if a newly merged entry
   references it in `next`.
5. For each key touched by a merged entry, re-run the current-state
   resolution (§4.4.2) over the complete set of known entries for
   that key and update the query index accordingly.

Merges MUST be associative and commutative: for any three entry
sets `A`, `B`, `C`, the oplog state resulting from
`merge(merge(A, B), C)` MUST equal the state resulting from
`merge(A, merge(B, C))` and from `merge(C, merge(B, A))`. Because
§4.4.2 defines a total order over any set of entries for a given
key, and because entry verification is a pure function of the
signed bytes and the library AC, this property follows from
set-union semantics on the oplog and total-order resolution on the
query index.

**Concurrent merges.** An implementation MAY process multiple merge
batches concurrently. If it does, it MUST ensure that the final
query-index state for any key is equal to the result of running
step 5 over the union of all batches; incremental per-batch updates
are permitted only if the implementation guarantees this equivalence
(for example, by recomputing state for each touched key after each
batch).

## 4.6 Memory scalability

An implementation MUST be able to operate on logs whose full entry
set does not fit in memory. The in-memory representation of
"entries present in the log" MUST be decoupled from "full entry
objects loaded into memory", so that traversal and existence
checks can run against an oplog whose entry bodies are fetched on
demand.

## 4.7 Per-library pinning

An implementation SHOULD pin all of the following content-addressed
objects for each opened library:

1. The library manifest (AC chain object 1, §3.6.1).
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
the content network's default importer, so a recursive pin is needed
to retain all blocks).

On unlink, the implementation MUST unpin items 1, 2, 3, every entry
hash the library uniquely held (not shared with another still-linked
library), and every content CID/audio/artwork that is not referenced by
another still-linked library.

## 4.8 Dual-indexing pattern (SHOULD)

Implementations with non-trivial query requirements SHOULD adopt
a dual-indexing strategy: the signed append-only log is the
authoritative source of state, and a local query database
projects that state for fast reads. Every cell in the query
database MUST be derivable from the oplog alone; rebuilding the
query database from scratch MUST yield the same state as
incremental maintenance. The query database schema is an
implementation choice and is not visible to peers.
