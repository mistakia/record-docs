/**
 * Generate the content-CID derivation vector for spec §2.3.1.
 *
 * Covers wire-format claim sections: §2.1, §2.3.1.
 *
 * Pipeline: { hello: "world" } → canonical dag-cbor → sha3-512 → CIDv1
 * (dag-cbor codec 0x71) → base58btc.
 *
 * The expected CID string is embedded in §2.3.1; this generator regenerates
 * it from scratch so any drift between encoder, hasher, or codec choice
 * surfaces as a non-equal CID rather than silent divergence.
 */

import { encode } from '@ipld/dag-cbor'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { CID } from 'multiformats/cid'
import * as dagCbor from '@ipld/dag-cbor'
import { create as digestCreate } from 'multiformats/hashes/digest'

const EXPECTED_HEX = 'a16568656c6c6f65776f726c64'
const EXPECTED_CID =
  'zBwWX8pQhjGaQLy57vXmwHUBxxMDeft5dzud3gari9HqUpFFzqEqfLLspwfCw7k9YSNz59f5JWJZnqP8eN8SDHwEEwrFk'

const payload = { hello: 'world' }
const cbor = encode(payload)
const cborHex = bytesToHex(cbor)

if (cborHex !== EXPECTED_HEX) {
  console.error(`FAIL: dag-cbor bytes mismatch\n  expected: ${EXPECTED_HEX}\n  actual:   ${cborHex}`)
  process.exit(1)
}

const digest = sha3_512(cbor)

// Multihash code for sha3-512 is 0x14.
const SHA3_512_CODE = 0x14
const mh = digestCreate(SHA3_512_CODE, digest)

const cid = CID.createV1(dagCbor.code, mh)
const cidStr = cid.toString() // base58btc requires explicit encoder; default is base32 (b prefix)

import { base58btc } from 'multiformats/bases/base58'
const cidStrB58 = cid.toString(base58btc)

console.log('=== §2.3.1 Content CID Vector ===\n')
console.log('Input payload:')
console.log('  { "hello": "world" }')
console.log('\ndag-cbor bytes (hex, ' + cbor.length + ' bytes):')
console.log('  ' + cborHex)
console.log('\nsha3-512 digest (hex):')
console.log('  ' + bytesToHex(digest))
console.log('\nCIDv1 (dag-cbor codec 0x71, sha3-512 0x14), base58btc:')
console.log('  ' + cidStrB58)
console.log('\nDefault CID.toString() (base32 sanity, prefix b):')
console.log('  ' + cidStr)

const match = cidStrB58 === EXPECTED_CID
console.log('\nVerification (matches §2.3.1 embedded CID):', match ? 'PASS' : 'FAIL')
if (!match) {
  console.error(`  expected: ${EXPECTED_CID}\n  actual:   ${cidStrB58}`)
  process.exit(1)
}
