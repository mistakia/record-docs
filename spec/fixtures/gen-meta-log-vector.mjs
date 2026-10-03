/**
 * Generate the identity library (meta-log) entry vector for spec §4.8.
 *
 * Covers wire-format claim sections: §4.8.1, §4.8.2.
 *
 * Signs a four-entry chain into the F0 test identity's identity library
 * (§3.6.2), each entry a §4.1.1 signed object whose payload carries an
 * inline §4.8.2 record:
 *   1. library PUT — the F3 own library
 *   2. link PUT    — the k=2 test identity's "library" library, alias "friend"
 *   3. pin PUT     — the §6.2.4 audio CID
 *   4. link DEL    — unlinks entry 2's address
 * Then resolves current state per (type, key) (§4.8.2).
 *
 * Test-only private keys k=1 and k=2. DO NOT USE for anything real.
 */

import { encode, decode, code as dagCborCode } from '@ipld/dag-cbor'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { CID } from 'multiformats/cid'
import { create as digestCreate } from 'multiformats/hashes/digest'
import { base58btc } from 'multiformats/bases/base58'

const SHA3_512_CODE = 0x14

const cid = (value) =>
  CID.createV1(dagCborCode, digestCreate(SHA3_512_CODE, sha3_512(encode(value)))).toString(base58btc)

const private_key = (k) => Uint8Array.from(Buffer.from(k.toString(16).padStart(64, '0'), 'hex'))
const public_key = (k) => bytesToHex(secp256k1.getPublicKey(private_key(k), true))

const derive_address = ({ key, library_type, discriminator }) => {
  const wrapper = { params: { address: cid({ write: [key] }) }, type: 'static' }
  return `/record/${cid({ name: discriminator, type: library_type, accessController: cid(wrapper) })}/${discriminator}`
}

// §3.4: sign dag-cbor(unsigned) with ECDSA/secp256k1 over SHA-256, DER.
const sign_entry = (unsigned, k) => {
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(sha256(encode(unsigned)), private_key(k)), 'compact')
  const signed = { ...unsigned, key: public_key(k), sig: bytesToHex(sig.toBytes('der')) }
  const bytes = encode(signed)
  return { signed, bytes, hash: cid(signed) }
}

const sha256_hex = (s) => bytesToHex(sha256(utf8ToBytes(s)))

const K = public_key(1)
const IDENTITY_LIBRARY = derive_address({ key: K, library_type: 'identity', discriminator: 'identity' })
const OWN_LIBRARY = derive_address({ key: K, library_type: 'recordstore', discriminator: 'library' })
const FRIEND_LIBRARY = derive_address({ key: public_key(2), library_type: 'recordstore', discriminator: 'library' })
// §6.2.4 audio CID of the F7 fixture.
const AUDIO_CID = 'zb2rhg3BKZhTYqV2eSH7d2LXvjDdfyJUX9izYRre6NSG4z5WG'
const T0 = 1700000000000

const operations = [
  { op: 'PUT', key: sha256_hex(OWN_LIBRARY), value: { type: 'library', v: 1, timestamp: T0, address: OWN_LIBRARY } },
  { op: 'PUT', key: sha256_hex(FRIEND_LIBRARY), value: { type: 'link', v: 1, timestamp: T0 + 1, address: FRIEND_LIBRARY, alias: 'friend' } },
  { op: 'PUT', key: sha256_hex(AUDIO_CID), value: { type: 'pin', v: 1, timestamp: T0 + 2, cid: AUDIO_CID } },
  { op: 'DEL', key: sha256_hex(FRIEND_LIBRARY), value: { type: 'link', timestamp: T0 + 3 } }
]

const entries = []
for (const [i, payload] of operations.entries()) {
  const unsigned = {
    id: IDENTITY_LIBRARY,
    payload,
    next: entries.length ? [entries[entries.length - 1].hash] : [],
    refs: [],
    v: 2,
    clock: { id: K, time: i + 1 }
  }
  entries.push(sign_entry(unsigned, 1))
}

console.log('=== §4.8 Identity Library Entry Vector ===\n')
console.log('Identity library address (§3.6.2):')
console.log('  ' + IDENTITY_LIBRARY)
for (const [i, e] of entries.entries()) {
  const { op, key, value } = e.signed.payload
  console.log(`\nEntry ${i + 1}: ${op} ${value.type} (clock.time ${e.signed.clock.time})`)
  console.log('  key: ' + key)
  console.log('  signed dag-cbor bytes: ' + e.bytes.length)
  console.log('  entry.hash: ' + e.hash)
}

// §4.8.2 current state per (type, key), by §4.4.2 order.
const current = new Map()
for (const e of entries) {
  const { key, value } = e.signed.payload
  const slot = `${value.type}:${key}`
  const prior = current.get(slot)
  if (!prior || e.signed.clock.time > prior.signed.clock.time) current.set(slot, e)
}
const state = (type, key) => current.get(`${type}:${key}`)?.signed.payload.op

console.log('\nCurrent state per (type, key):')
for (const [slot, e] of current) console.log('  ' + slot.slice(0, 20) + '... ' + e.signed.payload.op)

const checks = [
  ['every entry signs into the identity library address', entries.every((e) => e.signed.id === IDENTITY_LIBRARY)],
  ['every entry decodes back to its signed object', entries.every((e) => cid(decode(e.bytes)) === e.hash)],
  ['records are inline: no envelope content CID', entries.every((e) => !('content' in e.signed.payload.value))],
  ['own library record is a current PUT', state('library', sha256_hex(OWN_LIBRARY)) === 'PUT'],
  ['friend link is unlinked by the later DEL', state('link', sha256_hex(FRIEND_LIBRARY)) === 'DEL'],
  ['pin record is a current PUT', state('pin', sha256_hex(AUDIO_CID)) === 'PUT'],
  ['entries chain through next', entries.every((e, i) => i === 0 || e.signed.next[0] === entries[i - 1].hash)]
]

console.log('\nStructural checks:')
let all_pass = true
for (const [label, ok] of checks) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + ': ' + label)
  if (!ok) all_pass = false
}
console.log('\nOverall:', all_pass ? 'PASS' : 'FAIL')
if (!all_pass) process.exit(1)
