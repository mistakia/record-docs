/**
 * Counter-vector: what @orbitdb/core 3.0 actually signs for the same
 * unsigned Record Protocol entry.
 *
 * Produced to support the §3.4.5 interop analysis in
 * spec/review-notes/round-2-findings.md. DO NOT use this as the
 * canonical vector until the spec/OrbitDB divergence is resolved.
 *
 * Differences from gen-signing-vector.mjs (the current spec vector):
 *   - OrbitDB 3.0 does NOT include `hash: null` in the signing input.
 *   - OrbitDB 3.0 stores `identity.publicKey` as a **compressed**
 *     secp256k1 pubkey (33 bytes, 66 hex chars).
 *   - `clock.id` on an entry equals `identity.publicKey`, so the
 *     clock id is also the compressed form.
 *   - OrbitDB 3.0's `identity.id` is the compressed pubkey hex,
 *     not `sha256(pubkey_hex)`.
 *   - `entry.identity` on the signed entry is a CID hash string
 *     (base58btc) of a separately-stored identity object, not the
 *     full identity object inline.
 */

import { encode } from '@ipld/dag-cbor'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const TEST_PRIV_HEX =
  '0000000000000000000000000000000000000000000000000000000000000001'

const priv = Uint8Array.from(Buffer.from(TEST_PRIV_HEX, 'hex'))
const pubCompressed = secp256k1.getPublicKey(priv, true) // 33 bytes, 02/03 prefix
const pubCHex = bytesToHex(pubCompressed) // 66 hex chars

// OrbitDB 3.0 entry.js: the object passed to Block.encode for signing
// contains { id, payload, next, refs, clock, v } — no hash field.
const unsigned = {
  id: '/orbitdb/zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc/record',
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
  clock: { id: pubCHex, time: 1 },
  v: 2
}

const cbor = encode(unsigned)
const digest = sha256(cbor)
const sigRaw = secp256k1.sign(digest, priv)
const sigDer = secp256k1.Signature.fromBytes(sigRaw, 'compact').toBytes('der')

console.log('=== OrbitDB 3.0 counter-vector ===\n')
console.log('Compressed public key (66 hex, OrbitDB identity.publicKey):')
console.log('  ' + pubCHex)
console.log('\nUnsigned entry dag-cbor (hex, ' + cbor.length + ' bytes):')
console.log('  ' + bytesToHex(cbor))
console.log('\nSHA-256 of dag-cbor bytes:')
console.log('  ' + bytesToHex(digest))
console.log('\nECDSA/secp256k1 signature (DER, hex):')
console.log('  ' + bytesToHex(sigDer))

// Sanity check
const ok = secp256k1.verify(
  secp256k1.Signature.fromBytes(sigDer, 'der').toBytes('compact'),
  digest,
  pubCompressed
)
console.log('\nVerification round-trip:', ok ? 'PASS' : 'FAIL')
