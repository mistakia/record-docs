/**
 * Generate a deterministic dag-cbor signing test vector for spec §3.4.5.
 *
 * Uses a fixed test-only private key (DO NOT USE for anything real).
 * Outputs:
 *   - the unsigned entry object
 *   - its canonical dag-cbor bytes (hex)
 *   - the SHA-256 of those bytes (hex)
 *   - the ECDSA/secp256k1 signature (DER-encoded, hex)
 *   - the public key (uncompressed hex)
 */

import { encode } from '@ipld/dag-cbor'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

// Fixed test-only private key (32 bytes, hex).
// DO NOT USE THIS KEY FOR ANYTHING OTHER THAN SPEC TEST VECTORS.
const TEST_PRIV_HEX =
  '0000000000000000000000000000000000000000000000000000000000000001'

const priv = Uint8Array.from(Buffer.from(TEST_PRIV_HEX, 'hex'))
const pubUncompressed = secp256k1.getPublicKey(priv, false) // 65 bytes, 0x04 prefix
const pubHex = bytesToHex(pubUncompressed) // 130 hex chars

// Build an unsigned entry per §3.4.1. This is the same shape shown in
// the spec's §3.4.5 example but with a deterministic clock id derived
// from the test key so the vector is fully self-consistent.
const unsigned = {
  hash: null,
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
  v: 2,
  clock: { id: pubHex, time: 1 }
}

function signDer (digestBytes) {
  const raw = secp256k1.sign(digestBytes, priv) // 64-byte compact r||s
  return secp256k1.Signature.fromBytes(raw, 'compact').toBytes('der')
}

const cbor = encode(unsigned)
const digest = sha256(cbor)
const sigDer = signDer(digest)

// Identity object signatures (§3.5.1)
const nodeId = bytesToHex(sha256(new TextEncoder().encode(pubHex)))
const sigIdDer = signDer(sha256(new TextEncoder().encode(nodeId)))
const sigPubDer = signDer(sha256(new TextEncoder().encode(pubHex)))
const sigIdHex = bytesToHex(sigIdDer)
const sigPubHex = bytesToHex(sigPubDer)

console.log('=== §3.4.5 Signing Test Vector ===\n')
console.log('Private key (test only):')
console.log('  ' + TEST_PRIV_HEX)
console.log('\nUncompressed public key (130 hex chars):')
console.log('  ' + pubHex)
console.log('\nNode id (sha256 of pubkey hex string):')
console.log('  ' + nodeId)
console.log('\nUnsigned entry dag-cbor (hex, ' + cbor.length + ' bytes):')
console.log('  ' + bytesToHex(cbor))
console.log('\nSHA-256 of dag-cbor bytes:')
console.log('  ' + bytesToHex(digest))
console.log('\nECDSA/secp256k1 signature (DER, hex):')
console.log('  ' + bytesToHex(sigDer))
console.log('\nIdentity.signatures.id (DER, hex):')
console.log('  ' + sigIdHex)
console.log('\nIdentity.signatures.publicKey (DER, hex):')
console.log('  ' + sigPubHex)

// Sanity: verify round-trip (convert DER back to compact for verify)
const sigForVerify = secp256k1.Signature.fromBytes(sigDer, 'der').toBytes('compact')
const ok = secp256k1.verify(sigForVerify, digest, pubUncompressed)
console.log('\nVerification round-trip:', ok ? 'PASS' : 'FAIL')
