/**
 * Generate the current-state resolution vector for spec §4.4.2.
 *
 * Covers wire-format claim sections: §4.4.2.
 *
 * Constructs a contrived three-entry race set sharing one envelope.id
 * and applies the ordering rule:
 *
 *   (clock.time DESC, envelope.timestamp DESC, entry.hash ASC)
 *
 * where entry.hash comparison is performed on the raw multihash bytes
 * of the CID (NOT the base58btc string) per §4.4.2.
 *
 * The three entries are deliberately constructed to:
 *   - Entry A loses on clock.time (5 vs 7).
 *   - Entries B and C tie on (clock.time=7, timestamp=200); the hash
 *     ASC tiebreak decides between them.
 *
 * Verifies:
 *   - The winner emitted by the rule matches a by-hand application.
 *   - Swapping the two non-winner entries in the input does not
 *     change the winner (ordering rule is total).
 */

import { encode, code as dagCborCode } from '@ipld/dag-cbor'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { CID } from 'multiformats/cid'
import { create as digestCreate } from 'multiformats/hashes/digest'
import { base58btc } from 'multiformats/bases/base58'

const SHA3_512_CODE = 0x14
const SHARED_ENVELOPE_ID = 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f'
const LIBRARY_ID = '/record/zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc/library'
const TEST_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

function buildEntry({ tag, clockTime, envTimestamp, contentSuffix }) {
  // Sig + key are placeholders here — content-state resolution does not
  // depend on signature validity, only on hash, clock, and timestamp.
  const signed = {
    id: LIBRARY_ID,
    payload: {
      op: 'PUT',
      key: SHARED_ENVELOPE_ID,
      value: {
        id: SHARED_ENVELOPE_ID,
        timestamp: envTimestamp,
        v: 1,
        type: 'track',
        content: 'zBwWX5GSt1YAYJYortZ4HSkWHD2JsDLjMmo5piYyZfgPqYiNMDEdPGcGLxjmt6nhmPApErDew6eVBdGECYtF6W73kZ1d' + contentSuffix
      }
    },
    next: [],
    refs: [],
    v: 2,
    clock: { id: TEST_PUBKEY, time: clockTime },
    key: TEST_PUBKEY,
    sig: '00' + tag.charCodeAt(0).toString(16).padStart(2, '0')
  }
  const cbor = encode(signed)
  const digest = sha3_512(cbor)
  const mh = digestCreate(SHA3_512_CODE, digest)
  const cid = CID.createV1(dagCborCode, mh)
  return {
    tag,
    envTimestamp,
    clockTime,
    hashStr: cid.toString(base58btc),
    multihashBytes: cid.multihash.bytes,
    digest
  }
}

const A = buildEntry({ tag: 'A', clockTime: 5, envTimestamp: 300, contentSuffix: 'a' })
const B = buildEntry({ tag: 'B', clockTime: 7, envTimestamp: 200, contentSuffix: 'b' })
const C = buildEntry({ tag: 'C', clockTime: 7, envTimestamp: 200, contentSuffix: 'c' })

// §4.4.2: (clock.time DESC, envelope.timestamp DESC, entry.hash ASC)
// Compare hashes by raw multihash bytes (not base58btc string).
function cmpMhBytes(a, b) {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}
function compare(e1, e2) {
  if (e1.clockTime !== e2.clockTime) return e2.clockTime - e1.clockTime
  if (e1.envTimestamp !== e2.envTimestamp) return e2.envTimestamp - e1.envTimestamp
  return cmpMhBytes(e1.multihashBytes, e2.multihashBytes) // ASC
}
function pickWinner(set) {
  return [...set].sort(compare)[0]
}

console.log('=== §4.4.2 Current-State Resolution Vector ===\n')
for (const e of [A, B, C]) {
  console.log(
    `Entry ${e.tag}: clock.time=${e.clockTime} envelope.timestamp=${e.envTimestamp}`
  )
  console.log('  entry.hash (base58btc CIDv1):')
  console.log('    ' + e.hashStr)
  console.log('  multihash bytes (hex prefix 16B): ' + bytesToHex(e.multihashBytes.slice(0, 16)) + '...')
}

const winner = pickWinner([A, B, C])
console.log('\nWinner under (clock.time DESC, timestamp DESC, hash ASC): Entry ' + winner.tag)
console.log('  entry.hash: ' + winner.hashStr)

// By-hand application of the rule.
// Step 1: clock.time DESC — A=5, B=7, C=7. A is eliminated.
// Step 2: B and C tie on clock=7, timestamp=200. Hash ASC decides.
const cmpBC = cmpMhBytes(B.multihashBytes, C.multihashBytes)
const handWinnerTag = cmpBC < 0 ? 'B' : 'C'
console.log('\nBy-hand application:')
console.log('  Step 1 (clock.time): A=5, B=7, C=7 — A eliminated')
console.log('  Step 2 (timestamp ties): B=C=200 — hash ASC tiebreaks')
console.log('  Step 3 (hash ASC on raw multihash): B-multihash ' + (cmpBC < 0 ? '<' : '>') + ' C-multihash')
console.log('  Hand winner: Entry ' + handWinnerTag)

const check1 = winner.tag === handWinnerTag

// Totality check: swap the two non-winner entries; winner must not change.
const nonWinners = [A, B, C].filter((e) => e.tag !== winner.tag)
const swapped = [nonWinners[1], winner, nonWinners[0]]
const swappedWinner = pickWinner(swapped)
const check2 = swappedWinner.tag === winner.tag

console.log('\nVerifications:')
console.log('  ' + (check1 ? 'PASS' : 'FAIL') + ': script winner matches hand-applied rule')
console.log('  ' + (check2 ? 'PASS' : 'FAIL') + ': swapping non-winners does not change winner (rule is total)')

if (!check1 || !check2) process.exit(1)
