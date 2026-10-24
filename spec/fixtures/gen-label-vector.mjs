/**
 * Generate the label record vector for spec §2.5 and §4.4.2.
 *
 * Covers wire-format claim sections: §2.5, §2.8.1, §4.4.2.
 *
 * Signs label records into the F3 recordstore library (owner k=1):
 *   1. E1 sets three pairs: (A, mix/x), (A, lifestream-radio), (B, mix/x)
 *   2. E2 unsets (A, mix/x)
 *   3. E3a and E3b both cite E2, so they tie on clock.time, and carry the
 *      same timestamp: E3a sets (B, y), E3b unsets it, and the entry.hash
 *      tiebreak decides the pair
 *   4. E4, a DEL of track A, which leaves A's labels as they are
 * Then resolves label state per pair, checks the result does not depend
 * on the order entries arrive in, and checks each record's operation key
 * is the sha256 of its dag-cbor value.
 *
 * Test-only private key k=1. DO NOT USE for anything real.
 */

import { encode, code as dagCborCode } from '@ipld/dag-cbor'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { CID } from 'multiformats/cid'
import { create as digestCreate } from 'multiformats/hashes/digest'
import { base58btc } from 'multiformats/bases/base58'
import { write_vector_file } from './write-vector-file.mjs'

const SHA3_512_CODE = 0x14

const cid = (value) =>
  CID.createV1(dagCborCode, digestCreate(SHA3_512_CODE, sha3_512(encode(value)))).toString(base58btc)
const sha256_hex = (bytes) => bytesToHex(sha256(bytes))
const private_key = (k) => Uint8Array.from(Buffer.from(k.toString(16).padStart(64, '0'), 'hex'))
const public_key = (k) => bytesToHex(secp256k1.getPublicKey(private_key(k), true))

const OWNER = public_key(1)
// §3.5.1 F3 library address.
const LIBRARY = '/record/zBwWX6eaeb5ZhToR5AL62215fMiLTZYAtYpnDcBCebF4PJiLWK2n8MnGCArMMZc3nbLvaCGsg51etXpMrdVH5rgd9DUf8/library'
// §2.2.1 F2 track id, and a second track no library holds.
const TRACK_A = 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f'
const TRACK_B = sha256_hex(new TextEncoder().encode('track-b'))
const T0 = 1700000000000

const entries = new Map()
const sign = (name, { next = [], payload }) => {
  const time = next.length ? Math.max(...next.map((h) => entries.get(h).signed.clock.time)) + 1 : 1
  const unsigned = { id: LIBRARY, payload, next, refs: [], v: 2, clock: { id: OWNER, time } }
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(sha256(encode(unsigned)), private_key(1)), 'compact')
  const signed = { ...unsigned, key: OWNER, sig: bytesToHex(sig.toBytes('der')) }
  const hash = cid(signed)
  entries.set(hash, { name, signed, bytes: encode(signed).length })
  return hash
}
const labels = (timestamp, set = [], unset = []) => ({ type: 'labels', v: 1, timestamp, set, unset })
// §2.5: the operation key is the sha256 of the record's dag-cbor encoding.
const put_labels = (name, next, value) => sign(name, { next, payload: { op: 'PUT', key: sha256_hex(encode(value)), value } })

const E1 = put_labels('E1', [], labels(T0, [[TRACK_A, 'mix/x'], [TRACK_A, 'lifestream-radio'], [TRACK_B, 'mix/x']]))
const E2 = put_labels('E2', [E1], labels(T0 + 1, [], [[TRACK_A, 'mix/x']]))
const E3a = put_labels('E3a', [E2], labels(T0 + 2, [[TRACK_B, 'y']]))
const E3b = put_labels('E3b', [E2], labels(T0 + 2, [], [[TRACK_B, 'y']]))
const E4 = sign('E4', { next: [E3a, E3b], payload: { op: 'DEL', key: TRACK_A, value: { type: 'track', timestamp: T0 + 3 } } })

// §4.4.2: clock.time DESC, timestamp DESC, entry.hash raw multihash bytes ASC.
const multihash = (h) => CID.parse(h, base58btc).multihash.bytes
const compare_bytes = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}
const first = (a, b) => {
  const x = entries.get(a).signed
  const y = entries.get(b).signed
  return y.clock.time - x.clock.time || y.payload.value.timestamp - x.payload.value.timestamp || compare_bytes(multihash(a), multihash(b))
}

// §2.5 current state: per pair, the greatest record naming it decides.
const resolve = (hashes) => {
  const naming = new Map()
  for (const h of hashes) {
    const { payload } = entries.get(h).signed
    if (payload.op !== 'PUT' || payload.value.type !== 'labels') continue
    for (const [op, pairs] of [['set', payload.value.set], ['unset', payload.value.unset]]) {
      for (const [track_id, label] of pairs) {
        const pair = `${track_id}\n${label}`
        if (!naming.has(pair)) naming.set(pair, [])
        naming.get(pair).push({ h, op })
      }
    }
  }
  const state = {}
  for (const [pair, records] of [...naming].sort()) {
    state[pair] = records.sort((a, b) => first(a.h, b.h))[0].op === 'set'
  }
  return state
}

const all = [...entries.keys()]
const state = resolve(all)
const tie_winner = [E3a, E3b].sort(first)[0]

console.log('=== §2.5 Label Record Vector ===\n')
console.log('Library (F3, owner k=1): ' + LIBRARY)
for (const [hash, { name, signed, bytes }] of entries) {
  console.log(`\n${name}: ${signed.payload.op} ${signed.payload.value.type} (clock.time ${signed.clock.time})`)
  console.log('  key: ' + signed.payload.key)
  console.log('  signed dag-cbor bytes: ' + bytes)
  console.log('  entry.hash: ' + hash)
}
console.log('\nLabel state:')
for (const [pair, applied] of Object.entries(state)) console.log(`  ${pair.replace("\n", " ")}: ${applied ? 'applied' : 'not applied'}`)
console.log(`\nE3a/E3b tie decided by entry.hash: ${entries.get(tie_winner).name}`)

const shuffled = [E4, E3b, E1, E3a, E2]
const checks = [
  ['(A, mix/x) is not applied after E2', state[`${TRACK_A}\nmix/x`] === false],
  ['(A, lifestream-radio) stays applied after the track DEL', state[`${TRACK_A}\nlifestream-radio`] === true],
  ['(B, mix/x) is applied though no library holds B', state[`${TRACK_B}\nmix/x`] === true],
  ['(B, y) follows the entry.hash tiebreak', state[`${TRACK_B}\ny`] === (tie_winner === E3a)],
  ['the result does not depend on arrival order', JSON.stringify(resolve(shuffled)) === JSON.stringify(state)],
  ['every label record key is the sha256 of its dag-cbor value', [E1, E2, E3a, E3b].every((h) => {
    const { payload } = entries.get(h).signed
    return payload.key === sha256_hex(encode(payload.value))
  })],
  ['E3a and E3b tie on clock.time and timestamp', entries.get(E3a).signed.clock.time === entries.get(E3b).signed.clock.time]
]

console.log('\nStructural checks:')
let all_pass = true
for (const [label, ok] of checks) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + ': ' + label)
  if (!ok) all_pass = false
}
console.log('\nOverall:', all_pass ? 'PASS' : 'FAIL')
if (!all_pass) process.exit(1)

write_vector_file({
  generator_url: import.meta.url,
  fixture_id: 'F9',
  description: 'Label records (§2.5): operation keys, and per-pair current state under §4.4.2.',
  cases: [{
    name: 'label-state',
    inputs: { library: LIBRARY, entries: [...entries].map(([hash, { name, signed }]) => ({ name, entry_hash: hash, signed })) },
    expected: { label_state: Object.entries(state).map(([pair, applied]) => {
      const [track_id, label] = pair.split('\n')
      return { track_id, label, applied }
    }), tie_winner: entries.get(tie_winner).name }
  }]
})
