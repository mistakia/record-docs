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
Implementations MAY support multiple identities per peer but each
library has exactly one writer identity (see §3.5).

Identity rotation means creating a new identity and a new library
(§1.2.3). The abandoned library's entries remain valid signed
objects; replicating peers MUST NOT treat the old library as
invalid merely because the writer has stopped appending.
Federation between the old and new libraries, if desired, is
achieved by a Log entry (§2.5) from one to the other.

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
     type:             "recordstore" | "listens",
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
2. Verify that `entry.key` appears in the library's AC `write` list.

Both `entry.key` and every `write`-list element are 66-character
lowercase compressed-pubkey hex strings (§3.1), so the comparison
is a plain string equality check.

An entry that fails either check MUST be rejected.

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

## 3.7 Library name character set

Library names MUST match the regex `^[0-9a-zA-Z-]*$`. Implementations
creating new libraries MUST enforce this character set. Implementations
loading existing libraries MAY accept any address format emitted by a
compliant creator.
