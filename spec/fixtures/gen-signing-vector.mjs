/**
 * Generate deterministic dag-cbor test vectors for spec §3.4.5 (signing)
 * and §4.1.1 / §4.1.2 (signed-entry CID = entry.hash).
 *
 * Uses a fixed test-only private key (DO NOT USE for anything real).
 *
 * Vector 1 (signing, §3.4.5):
 *   - the compressed public key (hex)
 *   - the node id (identical to the compressed public key hex)
 *   - the unsigned entry dag-cbor bytes (hex)
 *   - the SHA-256 of those bytes (hex)
 *   - the ECDSA/secp256k1 signature (DER-encoded, hex)
 *
 * Vector 2 (signed-entry CID, §4.1.1 / §4.1.2):
 *   - the 8-field signed object's dag-cbor bytes (hex)
 *   - its CID (base58btc CIDv1, dag-cbor codec, sha3-512 multihash)
 *     — this is what gets assigned to entry.hash after write.
 *
 * Vector 3 (child entry, §4.1.1 / §4.1.2):
 *   - a second entry whose `next` holds the Vector 2 entry.hash as a
 *     plain base58btc string (not an IPLD link), signed with the same key
 *   - its signature, signed dag-cbor length, and CID (entry.hash)
 */

import { encode, code as dagCborCode, decode } from '@ipld/dag-cbor'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { CID } from 'multiformats/cid'
import { create as digestCreate } from 'multiformats/hashes/digest'
import { base58btc } from 'multiformats/bases/base58'

const TEST_PRIV_HEX =
  '0000000000000000000000000000000000000000000000000000000000000001'

const priv = Uint8Array.from(Buffer.from(TEST_PRIV_HEX, 'hex'))
const pubCompressed = secp256k1.getPublicKey(priv, true) // 33 bytes, 0x02/0x03 prefix
const pubHex = bytesToHex(pubCompressed) // 66 hex chars
const nodeId = pubHex

const unsigned = {
  id: '/record/zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc/library',
  payload: {
    op: 'PUT',
    key: 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f',
    value: {
      id: 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f',
      timestamp: 1611272666695,
      v: 1,
      type: 'track',
      content:
        'zBwWX5GSt1YAYJYortZ4HSkWHD2JsDLjMmo5piYyZfgPqYiNMDEdPGcGLxjmt6nhmPApErDew6eVBdGECYtF6W73kZ1dk'
    }
  },
  next: [],
  refs: [],
  v: 2,
  clock: { id: pubHex, time: 1 }
}

const cbor = encode(unsigned)
const digest = sha256(cbor)
const sigRaw = secp256k1.sign(digest, priv)
const sigDer = secp256k1.Signature.fromBytes(sigRaw, 'compact').toBytes('der')

console.log('=== §3.4.5 Signing Test Vector ===\n')
console.log('Private key (test only):')
console.log('  ' + TEST_PRIV_HEX)
console.log('\nCompressed public key (66 hex chars):')
console.log('  ' + pubHex)
console.log('\nNode id (= compressed public key hex):')
console.log('  ' + nodeId)
console.log('\nUnsigned entry dag-cbor (hex, ' + cbor.length + ' bytes):')
console.log('  ' + bytesToHex(cbor))
console.log('\nSHA-256 of dag-cbor bytes:')
console.log('  ' + bytesToHex(digest))
console.log('\nECDSA/secp256k1 signature (DER, hex):')
console.log('  ' + bytesToHex(sigDer))

const sigForVerify = secp256k1.Signature.fromBytes(sigDer, 'der').toBytes('compact')
const ok = secp256k1.verify(sigForVerify, digest, pubCompressed)
console.log('\nVerification round-trip:', ok ? 'PASS' : 'FAIL')

// --- F4 extension: §4.1.1 / §4.1.2 signed-entry CID ---
//
// The 8-field signed object is the same unsigned entry plus {key, sig}.
// Its CID is sha3-512 of the canonical dag-cbor of those 8 fields, wrapped
// as a CIDv1 with dag-cbor codec. This CID is locally assigned to
// entry.hash after the write completes; it is NOT part of the signed bytes.

const SHA3_512_CODE = 0x14
const signed = {
  ...unsigned,
  key: pubHex,
  sig: bytesToHex(sigDer)
}
const signedCbor = encode(signed)
const signedDigest = sha3_512(signedCbor)
const signedMh = digestCreate(SHA3_512_CODE, signedDigest)
const signedCid = CID.createV1(dagCborCode, signedMh).toString(base58btc)

console.log('\n=== §4.1.1 / §4.1.2 Signed-Entry CID Vector ===\n')
console.log('Signed object field count: ' + Object.keys(signed).length + ' (must be 8)')
console.log('Signed object dag-cbor (hex, ' + signedCbor.length + ' bytes):')
console.log('  ' + bytesToHex(signedCbor))
console.log('\nsha3-512 of signed dag-cbor (hex):')
console.log('  ' + bytesToHex(signedDigest))
console.log('\nSigned-entry CID (base58btc CIDv1, dag-cbor codec):')
console.log('  ' + signedCid)

// Independent verification: re-decode the CID's multihash and confirm the
// underlying digest equals sha3_512 of the script's serialized signed object.
const decodedCidParts = CID.parse(signedCid, base58btc)
const mhBytes = decodedCidParts.multihash.digest
const mhMatches = bytesToHex(mhBytes) === bytesToHex(signedDigest)
console.log('\nIndependent CID-multihash check:')
console.log('  CID multihash digest = sha3_512(signed dag-cbor) : ' + (mhMatches ? 'PASS' : 'FAIL'))

// Sanity: decode(encode(signed)) deep-equals signed (round-trip).
// JSON.stringify is sensitive to key order, but dag-cbor canonicalizes
// keys; compare with a sorted-key replacer so the order-agnostic
// equality is what we're checking.
const sortedReplacer = (_k, v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v
const signedDecoded = decode(signedCbor)
const signedRt = JSON.stringify(signedDecoded, sortedReplacer) === JSON.stringify(signed, sortedReplacer)
console.log('  Signed-object dag-cbor round-trip                : ' + (signedRt ? 'PASS' : 'FAIL'))

if (!mhMatches || !signedRt) process.exit(1)

// --- Child-entry extension: §4.1.1 / §4.1.2 with a non-empty `next` ---
//
// `next` and `refs` elements are plain base58btc CID strings in both the
// signing input and the stored 8-field object. Encoding them as IPLD links
// (CBOR tag 42) changes the stored bytes and therefore entry.hash.

const childUnsigned = {
  id: unsigned.id,
  payload: {
    op: 'DEL',
    key: unsigned.payload.key,
    value: { type: 'track', timestamp: 1611272666696 }
  },
  next: [signedCid],
  refs: [],
  v: 2,
  clock: { id: pubHex, time: 2 }
}
const childCbor = encode(childUnsigned)
const childDigest = sha256(childCbor)
const childSigDer = secp256k1.Signature.fromBytes(secp256k1.sign(childDigest, priv), 'compact').toBytes('der')
const childSigned = { ...childUnsigned, key: pubHex, sig: bytesToHex(childSigDer) }
const childSignedCbor = encode(childSigned)
const childMh = digestCreate(SHA3_512_CODE, sha3_512(childSignedCbor))
const childCid = CID.createV1(dagCborCode, childMh).toString(base58btc)

console.log('\n=== §4.1.1 / §4.1.2 Child-Entry Vector (non-empty next) ===\n')
console.log('next[0] (parent entry.hash, plain string):')
console.log('  ' + signedCid)
console.log('Unsigned child dag-cbor (' + childCbor.length + ' bytes), SHA-256:')
console.log('  ' + bytesToHex(childDigest))
console.log('ECDSA/secp256k1 signature (DER, hex):')
console.log('  ' + bytesToHex(childSigDer))
console.log('Signed child dag-cbor (' + childSignedCbor.length + ' bytes)')
console.log('Child entry.hash (base58btc CIDv1, dag-cbor codec):')
console.log('  ' + childCid)

const childNextIsString = typeof decode(childSignedCbor).next[0] === 'string'
console.log('\n  Child next[0] decodes as a string (no tag 42)    : ' + (childNextIsString ? 'PASS' : 'FAIL'))
if (!childNextIsString) process.exit(1)
