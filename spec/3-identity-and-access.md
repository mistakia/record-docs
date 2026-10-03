# 3. Identity and Access

## 3.1 Key pair

A Record identity is a secp256k1 key pair.

- **Curve**: secp256k1.
- **Private key**: 256-bit secret scalar.
- **Public key (canonical form)**: the **compressed** SEC1 encoding of
  the curve point, `02 || X` or `03 || X`, 33 bytes total, hex-encoded
  as a lowercase string of 66 characters.

On read, an implementation MUST reject any `entry.key` or AC
`write`-list element that is not exactly 66 lowercase hex characters
beginning with `02` or `03`. Uncompressed (`04` prefix, 130 hex
chars) and hybrid (`06`/`07` prefix) forms MUST NOT be accepted, even
if mathematically equivalent. Allowing an alternate encoding on read
would cause node-id and AC-membership computations to diverge
silently between peers.

## 3.2 Node identity

The Node ID identifies a peer within the Record network. It is the
compressed public key hex string itself:

```
node_id = compressed_pubkey_hex_lowercase
```

The identity mapping is deliberate. Anonymity is a non-goal (§1.2.3),
so there is no value in hashing the key before exposing it. Using the
key directly makes the protocol's on-wire signer and its node id the
same string, removing a class of divergence bugs between
implementations.

## 3.3 Identity persistence

Implementations SHOULD persist the identity keystore locally and SHOULD
be able to recreate an identity from its persisted private key bytes.
Implementations MAY support multiple identities per peer.

An identity MAY own any number of libraries (§3.6.1), which it
records in its identity library (§4.8). Each library's access
controller is still fixed at creation (§3.5), and an identity owns a
library when its key is in that library's `write` list. Another
identity appends to a library only under a capability the owner
issues (§3.5.5).

Identity rotation means creating a new identity and new libraries
(§1.2.3). The abandoned libraries' entries remain valid signed
objects; replicating peers MUST NOT treat an old library as
invalid merely because the writer has stopped appending.
Federation between the old and new identities, if desired, is
achieved by the new identity linking the old libraries (§4.8.4).

## 3.4 Entry signing

Entries are signed using the writer's secp256k1 identity. The signing
input is a deterministic canonical serialisation of the unsigned entry.

### 3.4.1 Unsigned entry shape

Before signing, an entry has this shape:

```
{
  id:      <string>,          // library id (the library this entry belongs to)
  payload: <operation>,       // PUT/DEL object per §2.8
  next:    <string[]>,        // hashes of parent entries
  refs:    <string[]>,        // additional reference hashes
  v:       2,                 // entry schema version
  clock:   { id: <pubkey_hex>, time: <number> }
}
```

The unsigned entry MUST NOT contain a `hash` field. The entry hash
is the CID of the signed object (§4.1.2) and is therefore undefined
at signing time.

### 3.4.2 Canonical serialisation

The unsigned entry MUST be serialised to bytes using **dag-cbor**
(IPLD canonical CBOR, RFC 8949 deterministic encoding). The dag-cbor
byte sequence of the unsigned entry object is the signing input.

Implementations MUST produce byte-identical dag-cbor output for
identical input objects, or signatures will not verify
cross-implementation.

### 3.4.3 Signed entry shape

After signing:

```
{
  hash:    <string>,          // CID of the signed entry object (set after write)
  id:      <string>,
  payload: <operation>,
  next:    <string[]>,
  refs:    <string[]>,
  v:       2,
  clock:   { id, time },
  key:     <pubkey_hex>,      // writer's compressed secp256k1 pubkey hex
  sig:     <string>           // signature over dag-cbor(unsigned entry)
}
```

The signed object as persisted and exchanged over the wire has no
`identity` field or any other wrapper around the signer. The key
itself (`entry.key`) is the identity; verifying `entry.sig` against
`entry.key` is the only step required to establish that the holder
of the private key produced the entry. The dag-cbor object actually
stored in content-addressed storage is the 8-field map
`{id, payload, next, refs, v, clock, key, sig}`; its CID is the
value assigned to `entry.hash` for local reference after write
(§4.1.2).

### 3.4.4 Signature algorithm

The signature is produced using ECDSA over secp256k1 with DER-encoded
signatures (SHA-256 digest of the dag-cbor input bytes).
Implementations MUST use ECDSA/secp256k1 with SHA-256 for
compatibility.

### 3.4.5 Test vector

This vector uses a **test-only** private key that MUST NOT be used
for any real identity. The private key is the secp256k1 generator
scalar, `k = 1`, which produces the well-known generator point `G`
as its public key:

```
private key (hex): 0000000000000000000000000000000000000000000000000000000000000001
```

The corresponding compressed public key (66 lowercase hex chars):

```
0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
```

Node id (identical to the compressed public key per §3.2):

```
0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
```

The unsigned entry object (the `content` CID is an arbitrary but
deterministic value; the signing operation is a pure function of
the unsigned entry bytes, so the CID does not need to resolve):

```
{
  id: "/record/zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc/library",
  payload: {
    op: "PUT",
    key: "cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f",
    value: {
      id: "cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f",
      timestamp: 1611272666695,
      v: 1,
      type: "track",
      content: "zBwWX5GSt1YAYJYortZ4HSkWHD2JsDLjMmo5piYyZfgPqYiNMDEdPGcGLxjmt6nhmPApErDew6eVBdGECYtF6W73kZ1dk"
    }
  },
  next: [],
  refs: [],
  v: 2,
  clock: {
    id: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    time: 1
  }
}
```

When serialised with canonical dag-cbor, the unsigned entry MUST
encode to exactly 468 bytes. The full byte sequence, as a single
line of lowercase hex:

```
a661760262696478412f7265636f72642f7a6470754171797932794c66547065765334707866566164536d5331346f524e41584d766e41596574397a4b7753715a632f6c696272617279646e6578748064726566738065636c6f636ba262696478423032373962653636376566396463626261633535613036323935636538373062303730323962666364623264636532386439353966323831356231366638313739386474696d6501677061796c6f6164a3626f7063505554636b65797840636432346634346432656531666235646261393961366361633734663033393866356139303966333334313638386431396561353939323663386566363933666576616c7565a5617601626964784063643234663434643265653166623564626139396136636163373466303339386635613930396633333431363838643139656135393932366338656636393366647479706565747261636b67636f6e74656e74785d7a4277575835475374315941594a596f72745a3448536b574844324a73444c6a4d6d6f35706959795a6667507159694e4d444564504763474c786a6d74366e686d50417045724465773665564264474543597446365737336b5a31646b6974696d657374616d701b000001772755be47
```

The SHA-256 digest of the dag-cbor bytes is:

```
fd55233a2c62c426ce45c3f7182645d0f031959dd919864030006a63e3749fc4
```

The ECDSA/secp256k1 signature over that digest, using RFC 6979
deterministic nonce generation, DER-encoded as lowercase hex:

```
3045022100ab7ece3c307e2a1061c83b93d32b62f49abf34d8d24ee167db515e23b33baec80220308677039a50f491c82d2ed95cc4df9f1bac097fa9e7089b488314180a42f6c0
```

An implementation producing a byte-identical signature for the
same unsigned entry and private key is conformant. Common
divergence sources: a non-canonical dag-cbor encoding (map key
order, integer width), including a `hash` field in the unsigned
map, a non-deterministic ECDSA nonce, or feeding the raw CBOR
bytes to ECDSA without the intermediate SHA-256 step.

`spec/fixtures/gen-signing-vector.mjs` is the generator for this
vector. It also emits the §4.1.1 / §4.1.2 signed-entry CID derived
from the 8-field signed object — one script, one private-key chain,
two related vectors.

## 3.5 Access controller

Each library is bound to an **Access Controller** (AC) — a
content-addressed object declaring which keys may append entries. The
AC reference is embedded in the library manifest at creation time and
is not mutable in this version of the protocol.

### 3.5.1 AC chain structure

The AC is actually represented by **three** content-addressed objects
forming a chain:

1. **Library manifest** (dag-cbor):

   ```
   {
     name:             <string>,
     type:             "recordstore" | "listens" | "identity",
     accessController: "<ac-wrapper-cid>"
   }
   ```

2. **AC wrapper** (dag-cbor):

   ```
   {
     params: { address: "<inner-write-list-cid>" },
     type:   "static"
   }
   ```

3. **Inner write-list** (dag-cbor):

   ```
   {
     write: [ <compressed_pubkey_hex>, ... ]
   }
   ```

Implementations MUST pin all three objects when loading a library, and
MUST NOT drop them while the library is in use.

**AC chain resolution procedure.** Given a library address
`/record/<manifest-cid>/<name>` (§3.6), an implementation
constructs the AC write-list by:

1. Fetching the manifest object at `<manifest-cid>` as a dag-cbor
   block. The object MUST decode to the shape in §3.5.1 item 1. If
   decoding fails, the field set does not match, or `name` inside
   the manifest differs from the `<name>` component of the library
   address, the library MUST be rejected.
2. Treating `manifest.accessController` as a bare CID string and
   fetching the AC wrapper at that CID. The decoded object MUST
   match §3.5.1 item 2 and its `type` field MUST be a value the
   implementation recognises (see §3.5.2).
3. Treating `wrapper.params.address` as a bare CID string and
   fetching the inner write-list at that CID. The decoded object
   MUST match §3.5.1 item 3.
4. Validating that every element of `write` is a 66-character
   lowercase hex string beginning with `02` or `03` (§3.1). Any
   element that fails this check MUST cause the library to be
   rejected.

If any fetch fails (the CID cannot be resolved within the
implementation's content-network timeout), the library MUST be
treated as unopenable. The implementation MAY retry the chain
resolution later and MUST NOT proceed without a verified AC chain.

**Reference vector.** `spec/fixtures/gen-ac-chain-vector.mjs` builds
the three-object chain using the §3.4.5 test pubkey as the sole
write-list element. The resulting CIDs and assembled address are:

| Object              | dag-cbor bytes | CID (base58btc CIDv1) |
| ------------------- | -------------- | --------------------- |
| Inner write-list    | 76             | `zBwWX55HXWPLKbELsvnimVMZhmtAiiM7vCeyLoyeP8AibJtNQ1XYD6g4rY3QMnGXVD6w5HUDH8n5DWY7KVXkzvFqaVR7K` |
| AC wrapper          | 124            | `zBwWX8Yoh5RwS7v61cXCk96SXiE7dexudEawmsr2DFswc14YmqPCfZ7w6Tf818jMAj6nSC1L14FL8dccFw5Cvh6D29RNC` |
| Library manifest    | 143            | `zBwWX6eaeb5ZhToR5AL62215fMiLTZYAtYpnDcBCebF4PJiLWK2n8MnGCArMMZc3nbLvaCGsg51etXpMrdVH5rgd9DUf8` |

Assembled library address (§3.6):

```
/record/zBwWX6eaeb5ZhToR5AL62215fMiLTZYAtYpnDcBCebF4PJiLWK2n8MnGCArMMZc3nbLvaCGsg51etXpMrdVH5rgd9DUf8/library
```

### 3.5.2 AC `type`

This version of the protocol defines exactly one AC type:
`"static"`. The `write` array in the inner write-list contains
compressed secp256k1 public key hex strings permitted to append to
the library.

An implementation that encounters an AC wrapper whose `type` is
not `"static"` MUST reject the library (refuse to open, replicate,
and append). Silently degrading to read-only or best-effort would
cause peers to disagree about which entries are authorised and
break convergence.

Capabilities (§3.5.5) are entries inside a static-AC library, not a
new AC type, so this rule is unchanged in v1.1.

### 3.5.3 Single-writer libraries

Libraries are typically created with a single-element `write`
array holding the owning identity's public key. Implementations
MUST be able to load libraries with any length `write` array and
MAY create libraries with multiple writers. Replicating
implementations MUST verify that the signer of each entry appears
in the library's `write` list.

### 3.5.4 Append verification

Before appending a remotely-received entry to the local oplog, an
implementation MUST:

1. Verify the entry signature (`entry.sig`) over the deterministic
   serialisation of the unsigned entry using `entry.key` as the
   verification key.
2. Verify that `entry.key` appears in the library's AC `write` list,
   or, in a `recordstore` library, that a capability authorises the
   entry (§3.5.9).
3. From v1.1, verify `clock.time` against `next` (§4.2).

Both `entry.key` and every `write`-list element are 66-character
lowercase compressed-pubkey hex strings (§3.1), so the comparison
is a plain string equality check.

An entry that fails any check MUST be rejected. An entry signed by
a `write`-list key passes step 2 by membership alone, as in v1.0;
chapter 8 calls this the owner shortcut.

### 3.5.5 Capabilities

A capability lets an identity outside a `recordstore` library's
`write` list append specific operations to that library. The owner,
a `write`-list key, issues a capability by appending a capability
record, and withdraws it by appending a revocation record (§3.5.10).
Both records are entries in the library they govern, so every replica
of the library holds what it needs to verify the library's entries,
and the access controller never changes (§3.5.2).

Capabilities exist only in `recordstore` libraries. An entry whose
operation carries `capability_id` in a `listens` or `identity`
library MUST be rejected.

**Capability record.** A capability is a PUT operation (§2.8.1) whose
value is:

```
{
  type:       "capability",
  v:          1,
  timestamp:  <uint64>,               // ms since the Unix epoch
  grantee:    <GranteeSpec>,          // who may use it
  actions:    <string[]>,             // what it permits (§3.5.6)
  filter:     <FilterSpec>?,          // which writes (§3.5.7)
  conditions: <ConditionSpec[]>?      // when (§3.5.8)
}
```

- `actions` MUST hold 1 to 16 strings, and `conditions` at most 16
  entries.
- An absent `filter` restricts nothing, and absent or empty
  `conditions` impose nothing.
- The operation `key` is the lowercase-hex sha256 of the dag-cbor
  encoding of the value.
- The record sits inline in the operation, with no envelope and no
  content CID, so verifying an entry never waits on a payload fetch.

The **capability id** is the `entry.hash` (§4.1.2) of the signed
entry that carries the capability record. It is unique, and fetching
it by CID returns the capability together with its issuer's
signature.

**GranteeSpec.**

```
{ type: "key",     key:  <pubkey_hex> }
{ type: "key_set", keys: <pubkey_hex[]> }     // 1 to 256 keys
```

Each key is a §3.1 compressed public key. A grantee matches a signer
when the signer's `entry.key` equals `key` or is an element of
`keys`.

**Citing a capability.** An entry written under a capability names it
in its operation as `capability_id` (§2.8.1).

**Malformed and unknown content.** Each defect has one verdict:

- **Reject the entry.** A capability or revocation record, or a
  GranteeSpec, FilterSpec node (§3.5.7), or ConditionSpec (§3.5.8) of
  a `type` this version defines, that lacks a required field, has a
  field of the wrong type, exceeds a count bound, or nests more than
  16 levels; a revocation record carrying a field this version does
  not define; and an operation `key` not derived as above. This
  matches how a malformed envelope is treated (§2.2).
- **Accept the entry, fail closed.** A GranteeSpec, FilterSpec node,
  or ConditionSpec whose `type` this version does not define, or one
  of a defined type carrying a field this version does not define,
  and a capability record carrying such a field. The entry may come
  from a later version, so it merges, but what it cannot be read as
  grants nothing: an unknown GranteeSpec matches no signer, an
  unknown FilterSpec matches nothing (§3.5.7), an unknown condition
  never holds (§3.5.8), and an unknown capability field leaves the
  capability authorising nothing.

### 3.5.6 Action vocabulary

| Action                     | Authorises                                                         | Filter subject |
| -------------------------- | ------------------------------------------------------------------ | -------------- |
| `library.append_track`     | a PUT of a Track envelope (§2.4)                                   | the envelope   |
| `library.append_tag`       | a PUT of a Track envelope that keeps the `id` and `content` of the base entry and every tag it has | the envelope |
| `library.update_about`     | a PUT of an About envelope (§2.6)                                  | the envelope   |
| `library.grant_capability` | a PUT of a capability record (§3.5.5)                              | none           |

**Base entry.** The base entry of a `library.append_tag` PUT is,
among the entries for its `id` in the PUT's **causal past** (the
entries reachable from it through `next`, transitively), the one the
§4.4.2 ordering puts first, with inertness (§3.5.10) ignored. If that
entry is a DEL, or there is none, `library.append_tag` does not
authorise the PUT. Every replica that holds the PUT holds its causal
past (§5.4.2 item 5). Ignoring inertness keeps the check a function of
that past alone, since whether an entry in it is inert can turn on a
revocation outside it.

The filter subject is the object a capability's FilterSpec is
evaluated against. An envelope is evaluated as it appears in the
operation `value`; a Track envelope without `tags` is evaluated as if
`tags` were `[]`. A filter scopes writes only. It is not applied to a
capability record, so a delegate with a filtered capability can still
grant; §3.5.9 step 5 then applies the delegate's filter to every write
under the capability it grants.

No action authorises a DEL, a Log PUT, or a listen write. In v1.1 a
grantee therefore cannot remove a track, record a link, or write a
listen.

Two verbs from the v1.1 design are reserved, and a verifier treats
each as an unknown action:

- `library.append_listen`. Listens belong to the listener alone
  (§1.2.2), and a `listens` library admits only listen writes
  (§2.8.2).
- `library.revoke_capability`. Authority to revoke comes from issuing
  a capability (§3.5.10), not from a grant.

An action a verifier does not recognise authorises nothing. The
capability's other actions still apply.

### 3.5.7 FilterSpec

A FilterSpec is a recursive predicate over a subject object. It
scopes capabilities (§3.5.6) and selects tracks for selective
replication (§4.6.1). Each node carries a `type`:

```
{ type: "match",  fields: { <field_path>: <scalar>, ... } }    // 1 to 16 fields
{ type: "any_of", field: <field_path>, values: <scalar[]> }    // 1 to 256 values
{ type: "range",  field: <field_path>, gte: <number>?, gt: <number>?,
                  lte: <number>?, lt: <number>? }               // at least one bound
{ type: "and",    filters: <FilterSpec[]> }                     // 1 to 64 filters
{ type: "or",     filters: <FilterSpec[]> }                     // 1 to 64 filters
{ type: "not",    filter:  <FilterSpec> }
```

A `field_path` is a dot-separated sequence of map keys, resolved from
the subject. It resolves to nothing if any step is missing or is not
a map. A scalar is a string, number, boolean, or null. Two scalars
are equal when they have the same type and value; numbers compare
numerically.

- `match` holds when, for every listed field, the resolved value
  equals the scalar, or is an array with an element equal to it.
- `any_of` holds when the resolved value equals one of `values`, or
  is an array sharing an element with `values`.
- `range` holds when the resolved value is a number that satisfies
  every bound given.
- `and`, `or`, and `not` are conjunction, disjunction, and negation
  of their sub-filters.
- A field that resolves to nothing fails `match`, `any_of`, and
  `range`.

**Fail closed.** A FilterSpec matches no subject when any node in it,
at any depth, has a `type` the evaluator does not recognise or
carries a field this section does not define for its type. The whole
filter fails, so `not` cannot turn an unknown node into a match. Later
versions may add node types such as `regex` or `field_exists`, or
modifiers on existing ones; failing closed means an older verifier
never authorises more than the issuer meant.

A node of a defined type that lacks a required field, has a field of
the wrong type, exceeds a count bound, or sits more than 16 levels
deep is malformed. In a capability it gets the entry rejected
(§3.5.5). As a replication filter, which is node-local configuration
(§4.6.1), an implementation MUST refuse to configure it.

### 3.5.8 Conditions

```
{ type: "expires_at", at: <uint64> }      // ms since the Unix epoch
```

A capability's conditions hold for an operation when each of them
does. `expires_at` holds when the `timestamp` of the operation's value
(the envelope or record timestamp) is at most `at`. A condition whose
`type` the verifier does not recognise does not hold, so its
capability authorises nothing.

Expiry reads a timestamp the grantee writes, so it bounds an honest
grantee only. Revocation (§3.5.10) binds a dishonest one, because it
is judged by causal order rather than by any clock the grantee sets.

### 3.5.9 Capability verification

An entry in a `recordstore` library whose signer is not in the
`write` list is authorised only by a capability. A verifier MUST
reject it unless all of the following hold:

1. Its operation is a PUT carrying `capability_id`.
2. The entry whose hash is `capability_id`, here `C1`, is a
   capability record in the same library and lies in the entry's
   causal past (§3.5.6). The verifier fetches it like any other
   ancestor (§5.4.2).
3. `C1.grantee` matches the entry's signer.
4. `C1`'s chain holds at most 8 capabilities.
5. Every capability in the chain grants an action that authorises the
   operation (§3.5.6), and has conditions that hold for it. For a
   Track or About PUT, every capability's filter also matches the
   filter subject. A revocation record is instead checked by §3.5.10.
6. No revocation signed by a `write`-list key and naming a capability
   in the chain lies in the entry's causal past.

A capability's **chain** is the capability alone when a `write`-list
key signed it. Otherwise it is the capability followed by the chain
of the capability its own entry cites.

Step 5 applies every capability in the chain, so a delegated
capability never authorises more than the capabilities above it: an
identity can pass on only actions, filters, and conditions it holds
itself. Each capability in the chain was itself verified when it was
merged, as a PUT authorised by `library.grant_capability`.

Step 6 stops a revoked grantee who has seen the owner's revocation
from appending at all. A write concurrent with that revocation is
caught by inertness instead (§3.5.10).

These checks read only the entry and its causal past, so every
replica reaches the same verdict. A rejected entry is dropped (§4.5
step 1).

An entry signed by a `write`-list key is authorised by §3.5.4 alone.
Its operation MUST NOT carry `capability_id`, and a verifier ignores
one if present.

### 3.5.10 Revocation

```
{ type: "revocation", v: 1, timestamp: <uint64>, revokes: <capability_id> }
```

A revocation record is a PUT whose `key` is the sha256 of its
dag-cbor value, as in §3.5.5.

**Who may revoke.** A `write`-list key may revoke any capability,
without `capability_id`, including one outside its causal past; that
lets an owner revoke a delegated grant it has not yet seen. Another
identity `K` may revoke capability `X` only when all of these hold,
or the revocation MUST be rejected:

- `X` is a capability record in the revocation's causal past.
- `K` signed an entry in `X`'s chain: `K` issued `X`, or a capability
  `X` descends from.
- The revocation cites, as `capability_id`, a capability `K` holds,
  and passes §3.5.9 steps 1 to 4 and 6.

No action is needed to revoke: an issuer can always withdraw what it
issued, and nothing else. A revocation is not checked against any
filter or condition, since it only reduces authority.

**Not retroactive.** A revocation `R` of capability `C` leaves valid
every entry in `R`'s causal past, which are the entries its signer had
seen. An entry that depends on `C` and is not in `R`'s causal past is
**inert**. An entry depends on `C` when `C` is in the chain of the
capability the entry cites. Inertness follows causal order, not
timestamps, so a grantee cannot escape it by backdating an entry or
by never merging `R`. An entry with an owner's revocation in its own
causal past is rejected outright (§3.5.9 step 6).

**Self-reference.** A revocation that names a capability in its own
chain is inert. It would otherwise withdraw the authority it rests on.

**Inert entries.** An inert entry stays in the oplog, because later
entries may name it in `next`, and it still counts toward heads
(§4.3). It has no state effect: current-state resolution (§4.4.2)
skips it, an inert capability authorises nothing, and an inert
revocation revokes nothing. An entry written concurrently with a
revocation can therefore be accepted and later become inert; chapter
8 requires clients to surface this (§8.6.8).

**Effective revocations.** A revocation is effective when it is
authorised and not inert. A verifier finds the effective set as
follows:

1. Every revocation signed by a `write`-list key is effective.
2. The other revocations are taken in ascending order of
   `clock.time`, then value `timestamp`, then `entry.hash` compared
   as raw multihash bytes (§4.4.2). Each is effective unless it is
   self-referential or the effective revocations found so far make it
   inert.

The order respects causality, since `clock.time` is verified to grow
along `next` (§4.2), and it is total, so every replica that holds the
same entries finds the same effective set. Inertness is then a
function of the entry set alone, which keeps merges associative and
commutative (§4.5).

**Reference vector.** `spec/fixtures/gen-capability-vector.mjs`
builds entries in the §3.5.1 library, owned by the §3.4.5 test key
(`k = 1`), with test keys `k = 2` and `k = 3` as grantees, and checks
each verdict with a reference verifier.

Capability `C` lets `k = 2` append Track envelopes tagged
`friends-mix` until an expiry. Its capability id, a write under it,
and the owner's revocation of it, which has seen that write, are:

```
C (capability id): zBwWX61Hk9TaWwav3Kd5fTzdx4TEyJTU4NzSjhqDqDjyz9UoQPm7poFUmfJMQxUQU6VCbbF53C9MJbQW8HZGdwiNSb1Y1
W (write under C): zBwWX9GLKF4xVufTPhStjkvwmB1NV2imR8QiGJD755BqTdsPc51ur6hEyS3qBoTwj9mcofwTYhPwvcSog53hmjp2f2NL8
R (revokes C):     zBwWX7UthQBfd1XSMNssAhMwaKo38puex8DcjceV4cV3Gn59nkJYyvoDivq62GeFaEeskziMh6wb5EwBuLnUcn5DUsSwx
```

The script checks 58 verdicts. They cover:

| Case | Verdict |
| ---- | ------- |
| `W`, in `R`'s causal past | accept |
| a write under `C` concurrent with `R` | accept, then inert |
| a write under `C` with `R` in its causal past | reject: step 6 |
| under `C`: signed by `k = 3`, tagged `other`, after the expiry, an About PUT | reject: steps 3, 5 |
| citing `C` from outside its causal past; no `capability_id` | reject: steps 2, 1 |
| a forged `clock.time` | reject: §4.2 |
| a capability with no actions | reject: malformed |
| under capabilities with an unknown filter node (inside `not`), grantee type, or condition type | capability accepted; write rejected |
| an owner Track PUT carrying `capability_id` | accept; field ignored |
| `capability_id` in a listens library and in an identity library | reject |
| under `library.append_tag`: adding a tag; dropping one; after the base entry's DEL | accept; reject; reject |
| a delegated grant within the delegator's actions, and a write under it | accept |
| a write under a delegated grant the delegator's capability does not cover | reject: up the chain |
| a write under a grant from a filtered delegator, tagged to match and not | accept; reject: up the chain |
| `k = 2` revoking a grant it issued; a write under that grant afterwards | accept, effective; accept, then inert |
| `k = 3` revoking a grant it did not issue | reject: out of scope |
| a write under a delegated grant after the owner revokes its parent | reject: step 6 |
| a write under a chain of 9 | reject: step 4 |
| `k = 2` revoking its own self-issued grant, citing that grant | accept, inert: self-reference |


### 3.5.11 Compatibility with v1.0 peers

Capabilities add entries to a static-AC library. They change neither
the AC nor any rule for entries signed by a `write`-list key, so every
v1.0 library and entry stays valid. A v1.0 peer handles the new
entries as follows:

- It rejects a capability or revocation record signed by the owner,
  because §2.2 admits only Track, Log, and About envelopes, and it
  rejects an entry signed by a grantee, because the signer is not in
  the `write` list (§3.5.4).
- It never merges a descendant of a rejected entry (§5.4.2 item 5).
- record-node v1.0, and any traversal that abandons a rejected entry,
  also never enqueues that entry's `next`. Entries reachable only
  through it are never fetched.

The owner appends a capability record on top of all the heads it
holds, and later entries descend from it. A v1.0 peer that replicated
the library before its first capability record keeps that state and
merges nothing after it. A v1.0 peer that first syncs afterwards
fetches nothing beneath the record either, and may see an empty
library.

A library whose owner never issues a capability stays fully readable
by v1.0 peers. An owner who needs v1.0 peers to follow a library
SHOULD NOT issue capabilities in it, and can share writing through a
separate library instead.

## 3.6 Library manifest and address

A library manifest is stored as a dag-cbor object. Writing the
manifest to content-addressed storage produces a manifest CID. The
library address string is:

```
/record/<manifest-cid>/<name>
```

- `<manifest-cid>` is the CID of the manifest.
- `<name>` is the library name from the manifest, subject to the
  character set restriction in §3.7.

Implementations MUST use this exact address form. Addresses MUST
be treated as opaque strings for transport and comparison.

The `identity` library type (§4.8) is new in v1.1. A v1.0
implementation never creates one, and refuses to open one at step 1
of the §3.5.1 resolution procedure.

### 3.6.1 Library discriminator

The manifest `name` is the library's **discriminator**: it tells
apart the libraries one identity owns. For a library whose `write`
list is the single key `K`, all three chain objects (§3.5.1) are
functions of `K`, the library type, and the discriminator, so the
address is too:

```
write_list = { write: [K] }
wrapper    = { params: { address: cid(write_list) }, type: "static" }
manifest   = { name: discriminator, type: library_type, accessController: cid(wrapper) }
address    = "/record/" + cid(manifest) + "/" + discriminator
```

`cid(x)` is the §2.1 content CID of the dag-cbor encoding of `x`,
as a base58btc string.

An implementation creating a library for identity `K` MUST derive
its address this way. A new discriminator MUST match §3.7 and MUST
be 1 to 64 characters long. Two libraries of one identity with the
same type and discriminator are the same library, so a creator MUST
NOT reuse a discriminator that the identity library records for that
type (§4.8.2), whether that library is active or retired. Reusing it
would name the retired library, which stays retired (§4.8.3), rather
than create a new one.

The discriminator is visible in the address and is not a display
name; a library's display name belongs in its About entry (§2.6).

**Compatibility.** A v1.0 library created with a single-key `write`
list already has this address: it is the derivation for its name.
record-node, for example, names its two v1.0 libraries `library`
(type `recordstore`) and `listens` (type `listens`). A v1.0 library
created another way stays valid and loadable (§3.5.3), and the
identity library records its address as it is (§4.8.3).

### 3.6.2 Identity library address

Each identity has exactly one identity library (§4.8). Its address
is the §3.6.1 derivation with library type `identity` and
discriminator `identity`:

```
manifest = { name: "identity", type: "identity", accessController: cid(wrapper) }
address  = "/record/" + cid(manifest) + "/identity"
```

The address depends on `K` alone. A device that imports a key
therefore computes the identity library address without any other
input, and from that library learns the identity's own libraries,
links, and pins. Because a v1.0 implementation cannot create a
library of type `identity`, no v1.0 library has this address.

**Reference vector.** `spec/fixtures/gen-library-address-vector.mjs`
derives four addresses for the §3.4.5 test key. All four share the
§3.5.1 write-list and wrapper CIDs, and the first equals the §3.5.1
address, so the v1.1 derivation leaves the v1.0 address unchanged.

| Type          | Discriminator | Manifest CID (base58btc CIDv1) |
| ------------- | ------------- | ------------------------------ |
| `recordstore` | `library`     | `zBwWX6eaeb5ZhToR5AL62215fMiLTZYAtYpnDcBCebF4PJiLWK2n8MnGCArMMZc3nbLvaCGsg51etXpMrdVH5rgd9DUf8` |
| `listens`     | `listens`     | `zBwWX67a7mbUHRB8maxG6K3CdGyfRLnTv2bFGhvmmpw1SA4Aqku6qy8y6FUar8S9SXrTrkokZH9jTjtQBDRZ6HpELshLu` |
| `recordstore` | `mixes`       | `zBwWX7ayGQu2GevKxpfRiHbcuNjtqkbRghTqUtCPRKbeRGLdtphXDbHThj9HcnMwMXQhF9GZY9rhYt7Yaibr4Z5Bsed4o` |
| `identity`    | `identity`    | `zBwWX5yfKGoxN42dyykh9tRxq4CjbydSPBpNkVzLe5bmjCRib33F7AiUsRGchrTCgvjDvRVJsC89Rv7Wfk17n8sqMkEFx` |

Each address is `/record/<manifest-cid>/<discriminator>`. The
identity library address of the test key is:

```
/record/zBwWX5yfKGoxN42dyykh9tRxq4CjbydSPBpNkVzLe5bmjCRib33F7AiUsRGchrTCgvjDvRVJsC89Rv7Wfk17n8sqMkEFx/identity
```

## 3.7 Library name character set

Library names MUST match the regex `^[0-9a-zA-Z-]*$`. Implementations
creating new libraries MUST enforce this character set. Implementations
loading existing libraries MAY accept any address format emitted by a
compliant creator.
