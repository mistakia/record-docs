/**
 * Generate a deterministic dag-cbor signing test vector for spec §3.4.5.
 *
 * Uses a fixed test-only private key (DO NOT USE for anything real).
 * Outputs:
 *   - the compressed public key (hex)
 *   - the node id (identical to the compressed public key hex)
 *   - the unsigned entry dag-cbor bytes (hex)
 *   - the SHA-256 of those bytes (hex)
 *   - the ECDSA/secp256k1 signature (DER-encoded, hex)
 */

import { encode } from '@ipld/dag-cbor'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

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
