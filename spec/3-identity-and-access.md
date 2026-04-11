# 3. Identity and Access

## 3.1 Key pair

A Record identity is a secp256k1 key pair.

- **Curve**: secp256k1.
- **Private key**: 256-bit secret scalar.
- **Public key (canonical form)**: the **uncompressed** SEC1 encoding of
  the curve point, `04 || X || Y`, 65 bytes total, hex-encoded as a
  lowercase string of 130 characters.

Implementations MUST use the uncompressed public key form when computing
node ids and when populating access controller `write` arrays. Compressed
public keys MUST NOT be written to any on-wire or on-disk structure that
is consumed by peers.

On read, an implementation MUST reject any `entry.key`, identity
`publicKey`, or AC `write`-list element that is not exactly 130
lowercase hex characters beginning with `04` (i.e. the canonical
uncompressed SEC1 encoding). Compressed (`02`/`03` prefix, 66 hex
chars) and hybrid (`06`/`07` prefix) forms MUST NOT be accepted, even
if mathematically equivalent. This rule is an interoperability safety
net: allowing an alternate encoding on read would cause node-id and
AC-membership computations to diverge silently between peers.

## 3.2 Node identity

The Node ID identifies a peer within the Record network. It is computed
as:

```
node_id = sha256(uncompressed_pubkey_hex_lowercase)
```

Where:

- The input to sha256 is the **lowercase hex string** of the uncompressed
  public key (not the raw bytes).
- The output is the lowercase hex sha256 digest.

This computation MUST be reproducible byte-for-byte across
implementations.

### 3.2.1 Test vector

Given an uncompressed secp256k1 public key as 130 lowercase hex chars:

- Public key (130 chars): `04acd9157fa11657871091339c1063ef96d7695480a9a96dc77a0748e7fc6152127f8bd60d463c85b4fa7b12a8ec95d004333220b4e2d1d9f9c6e8cbf923ad9fb6`
- sha256 input (ASCII bytes of the above 130-char string): the bytes
  `0x30 0x34 0x61 0x63 ... 0x66 0x62 0x36` — that is, the ASCII /
  UTF-8 encoding of the lowercase hex string, NOT the 65 raw public
  key bytes.
- Node id (expected output):
  `86fee33993c19528a27385f12c224e893266aadae354968e2628389316a507c3`

Any implementation producing a different value either is hashing the
raw key bytes instead of the hex string, or is using a different
public-key encoding (compressed, hybrid, or uppercase hex). All three
are non-conformant.

## 3.3 Identity persistence

Implementations SHOULD persist the identity keystore locally and SHOULD
be able to recreate an identity from its persisted private key bytes.
Implementations MAY support multiple identities per peer but each
library has exactly one writer identity (see §3.6).

Identity rotation is modelled as creating a new identity and
abandoning the old one. Because the access controller is fixed at
library creation (§3.6), a new identity implies a new library
address. There is no in-place key rotation.

The abandoned library's entries remain valid signed objects.
Replicating peers MUST NOT treat the old library as invalid merely
because the writer has stopped appending. Federation between the
old and new libraries, if desired, is achieved by a Log entry
(§2.5) from one to the other.

## 3.4 Entry signing

Entries are signed using the writer's secp256k1 identity. The signing
input is a deterministic canonical serialisation of the unsigned entry.

### 3.4.1 Unsigned entry shape

Before signing, an entry has this shape:

```
{
  hash:    null,
  id:      <string>,          // library id (the library this entry belongs to)
  payload: <operation>,       // PUT/DEL object per §2.8
  next:    <string[]>,        // hashes of parent entries
  refs:    <string[]>,        // additional reference hashes (v >= 2)
  v:       2,                 // entry schema version
  clock:   { id: <pubkey_hex>, time: <number> }
}
```

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
  hash:     <string>,         // CID of the signed entry object
  id:       <string>,
  payload:  <operation>,
  next:     <string[]>,
  refs:     <string[]>,
  v:        2,
  clock:    { id, time },
  key:      <pubkey_hex>,     // writer's uncompressed secp256k1 pubkey hex
  identity: <Identity>,       // see §3.5
  sig:      <string>          // signature over dag-cbor(unsigned entry)
}
```

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

The corresponding uncompressed public key (130 lowercase hex chars):

```
0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8
```

Node id (`sha256` of the 130-char pubkey string per §3.2):

```
b3a373ff6d59118736ecbcc2de113504a9c4e115aede71f2384ce2890465fee7
```

The unsigned entry object (the `content` CID is an arbitrary but
deterministic value; the signing operation is a pure function of
the unsigned entry bytes, so the CID does not need to resolve):

```
{
  hash: null,
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
    id: "0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8",
    time: 1
  }
}
```

When serialised with canonical dag-cbor, the unsigned entry MUST
encode to exactly 538 bytes. The full byte sequence, as a single
line of lowercase hex:

```
a761760262696478412f7265636f72642f7a6470754171797932794c66547065765334707866566164536d5331346f524e41584d766e41596574397a4b7753715a632f6c6962726172796468617368f6646e6578748064726566738065636c6f636ba26269647882303437396265363637656639646362626163353561303632393563653837306230373032396266636462326463653238643935396632383135623136663831373938343833616461373732366133633436353564613466626663306531313038613866643137623434386136383535343139396334376430386666623130643462386474696d6501677061796c6f6164a3626f7063505554636b65797840636432346634346432656531666235646261393961366361633734663033393866356139303966333334313638386431396561353939323663386566363933666576616c7565a5617601626964784063643234663434643265653166623564626139396136636163373466303339386635613930396633333431363838643139656135393932366338656636393366647479706565747261636b67636f6e74656e74785d7a4277575835475374315941594a596f72745a3448536b574844324a73444c6a4d6d6f35706959795a6667507159694e4d444564504763474c786a6d74366e686d50417045724465773665564264474543597446365737336b5a31646b6974696d657374616d701b000001772755be47
```

The SHA-256 digest of the dag-cbor bytes is:

```
ee9f9151a7a3aad00539988ae090dd5f02b6a7f7ea6353f9c3c1a1bfad4f58cd
```

The ECDSA/secp256k1 signature over that digest, using RFC 6979
deterministic nonce generation, DER-encoded as lowercase hex:

```
3045022100a1c183d6f946d85ae69ecb07d507d4071db8bf9a1be1a2c8c014cfb18e4c8c6102206f80ec040b2d55fb2d54a572869b690332f94f81303890186c43f2744ff000d3
```

An implementation producing a byte-identical signature for the
same unsigned entry and private key is conformant with the v1
signing model. Common divergence sources: a non-canonical
dag-cbor encoding (map key order, integer width, `null` encoding
of `hash`), a non-deterministic ECDSA nonce, or feeding the raw
CBOR bytes to ECDSA without the intermediate SHA-256 step.

Implementations MAY additionally verify the accompanying identity
object signatures (§3.5.1) for the same test key. Using the node id
`b3a373ff...5fee7` and the 130-char pubkey string as signing
inputs, the expected DER signatures (RFC 6979) are:

```
signatures.id:
3045022100b012501b7b78da29125f5103af42d6acc6eabe1846e076bebe7afeddb8df610602201ae5a7af97aa56fe5e3a1ca357751b4df259d9f4eeaa9154016ef2dfd758b859

signatures.publicKey:
3045022100c7f23859eabdbd1f4235fcd9bb47f3f4dfc056539045b1fe26feeab448afd48c0220705adea4385a08b65f87116791908e46f92fa2a2eea517deb2e69d44b3a39bf8
```

## 3.5 Identity object

The `identity` field carried on a signed entry is the writer's identity
descriptor:

```
{
  id:        <string>,        // node id = sha256(pubkey_hex_lowercase)
  publicKey: <string>,        // uncompressed secp256k1 pubkey hex
  signatures: {
    id:        <string>,      // signature over `id` by the identity key
    publicKey: <string>       // signature over `publicKey` by the identity key
  },
  type: "publickey"           // identity provider type
}
```

The `signatures` object binds the identity key to the node id and
public key fields. Both signatures are produced by the same secp256k1
identity key.

### 3.5.1 Identity signature inputs

The two signatures in `identity.signatures` are ECDSA/secp256k1/
SHA-256 signatures (same algorithm as entry signatures, §3.4.4)
produced over these exact inputs:

- `signatures.id` — signature over the **UTF-8 bytes of the
  `identity.id` string** (the 64-character lowercase hex node id).
- `signatures.publicKey` — signature over the **UTF-8 bytes of the
  `identity.publicKey` string** (the 130-character lowercase hex
  uncompressed public key).

Both signatures MUST be produced with the same secp256k1 key whose
uncompressed public key is `identity.publicKey`. The signing input
MUST be the raw UTF-8 bytes of the hex string, not the decoded binary
form.

### 3.5.2 Identity signature verification

On receiving a signed entry for the first time from a given
`(entry.key, identity.id)` pair, an implementation MUST:

1. Verify that `identity.publicKey == entry.key` (same uncompressed
   hex string).
2. Verify that `identity.id == sha256(identity.publicKey)` per §3.2.
3. Verify `signatures.id` over the UTF-8 bytes of `identity.id`
   using `identity.publicKey` as the verification key.
4. Verify `signatures.publicKey` over the UTF-8 bytes of
   `identity.publicKey` using `identity.publicKey` as the verification
   key.

An implementation MAY cache successful identity-object verification
by `identity.id` and skip steps 1-4 for subsequent entries whose
embedded `identity` object hashes byte-identically to a previously
verified one. Any mismatch on a cached entry MUST invalidate the
cache entry and re-run verification.

An entry whose identity object fails any of steps 1-4 MUST be
rejected.

Implementations MAY introduce additional identity provider types by
choosing a different `type` string, but those entries will only be
verifiable by peers that recognise the new type. Peers that do not
recognise an `identity.type` MUST reject the entry.

## 3.6 Access controller

Each library is bound to an **Access Controller** (AC) — a
content-addressed object declaring which keys may append entries. The
AC reference is embedded in the library manifest at creation time and
is not mutable in this version of the protocol.

### 3.6.1 AC chain structure

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
     write: [ <uncompressed_pubkey_hex>, ... ]
   }
   ```

Implementations MUST pin all three objects when loading a library, and
MUST NOT drop them while the library is in use.

**AC chain resolution procedure.** Given a library address
`/record/<manifest-cid>/<name>` (§3.7), an implementation
constructs the AC write-list by:

1. Fetching the manifest object at `<manifest-cid>` as a dag-cbor
   block. The object MUST decode to the shape in §3.6.1 item 1. If
   decoding fails, the field set does not match, or `name` inside
   the manifest differs from the `<name>` component of the library
   address, the library MUST be rejected.
2. Treating `manifest.accessController` as a bare CID string and
   fetching the AC wrapper at that CID. The decoded object MUST
   match §3.6.1 item 2 and its `type` field MUST be a value the
   implementation recognises (see §3.6.2).
3. Treating `wrapper.params.address` as a bare CID string and
   fetching the inner write-list at that CID. The decoded object
   MUST match §3.6.1 item 3.
4. Validating that every element of `write` is a 130-character
   lowercase hex string beginning with `04` (§3.1). Any element
   that fails this check MUST cause the library to be rejected.

If any fetch fails (the CID cannot be resolved within the
implementation's content-network timeout), the library MUST be
treated as unopenable. The implementation MAY retry the chain
resolution later and MUST NOT proceed without a verified AC chain.

### 3.6.2 AC `type`

This version of the protocol defines exactly one AC type:
`"static"`. The `write` array in the inner write-list contains
uncompressed secp256k1 public key hex strings permitted to append
to the library.

An implementation that encounters an AC wrapper whose `type` is
not `"static"` MUST reject the library (refuse to open, replicate,
and append). Silently degrading to read-only or best-effort would
cause peers to disagree about which entries are authorised and
break convergence.

### 3.6.3 Single-writer libraries

In practice the reference implementation creates libraries with a
single-element `write` array (the owning identity's public key).
Implementations MUST be able to load libraries with any length `write`
array and MAY create libraries with multiple writers if the use case
requires it. However, replicating implementations MUST verify that the
signer of each entry is included in the library's `write` list.

### 3.6.4 Append verification

Before appending a remotely-received entry to the local oplog, an
implementation MUST:

1. Verify the entry signature (`entry.sig`) over the deterministic
   serialisation of the unsigned entry using `entry.key` as the
   verification key.
2. Verify that `entry.key` appears in the library's AC `write` list.

The comparison in step 2 MUST be performed against the **uncompressed
public key hex string** (`entry.key`), not against the node ID
(`identity.id`). The `write` list contains public key hex strings
(§3.6.1); the node ID is a sha256 digest of the public key and MUST
NOT be used for AC membership checks.

An entry that fails either check MUST be rejected.

## 3.7 Library manifest and address

A library manifest is stored as a dag-cbor object. Writing the
manifest to content-addressed storage produces a manifest CID. The
library address string is:

```
/record/<manifest-cid>/<name>
```

- `<manifest-cid>` is the CID of the manifest.
- `<name>` is the library name from the manifest, subject to the
  character set restriction in §3.8.

Implementations MUST use this exact address form. Addresses MUST
be treated as opaque strings for transport and comparison.

## 3.8 Library name character set

Library names MUST match the regex `^[0-9a-zA-Z-]*$`. Implementations
creating new libraries MUST enforce this character set. Implementations
loading existing libraries MAY accept any address format emitted by a
compliant creator.
