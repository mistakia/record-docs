/**
 * Generate the identity library (meta-log) entry vector for spec §4.8.
 *
 * Covers wire-format claim sections: §4.8.1, §4.8.2.
 *
 * Signs a nine-entry chain into the F0 test identity's identity library
 * (§3.6.2), each entry a §4.1.1 signed object whose payload carries an
 * inline §4.8.2 record:
 *   1. library PUT — the F3 own library
 *   2. link PUT    — the k=2 test identity's "library" library, alias "friend"
 *   3. pin PUT     — the §6.2.4 audio CID, in canonical form (CIDv1 base32)
 *   4. link DEL    — unlinks entry 2's address
 *   5-7. library PUT, link PUT, link DEL of the own "mixes" library: the
 *      library and link records share a key, and the link DEL leaves the
 *      library record a PUT, since state is per (type, key)
 *   8-9. library DEL of "mixes", then a stray library PUT: retirement is
 *      terminal (§4.8.3), so "mixes" stays retired
 * Then resolves current state, and rejects two malformed records: a pin
 * whose cid is not canonical, and a link whose alias exceeds 128 bytes.
 *
 * Test-only private keys k=1 and k=2. DO NOT USE for anything real.
 */

import { encode, decode, code as dagCborCode } from '@ipld/dag-cbor'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { CID } from 'multiformats/cid'
import { base32 } from 'multiformats/bases/base32'
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
const MIXES_LIBRARY = derive_address({ key: K, library_type: 'recordstore', discriminator: 'mixes' })
// §4.8.2 canonical pin form: CIDv1, base32. The §6.2.4 audio CID, stored
// in content.hash as base58btc, is the same CID.
const canonical_cid = (s) => CID.parse(s, s.startsWith('z') ? base58btc : undefined).toV1().toString(base32)
const AUDIO_CID = canonical_cid('zb2rhWrAP3dch4trZWGArAEEN8mqFPhsQ2Jojbedxdq8MtCgH')
const T0 = 1700000000000

const operations = [
  { op: 'PUT', key: sha256_hex(OWN_LIBRARY), value: { type: 'library', v: 1, timestamp: T0, address: OWN_LIBRARY } },
  { op: 'PUT', key: sha256_hex(FRIEND_LIBRARY), value: { type: 'link', v: 1, timestamp: T0 + 1, address: FRIEND_LIBRARY, alias: 'friend' } },
  { op: 'PUT', key: sha256_hex(AUDIO_CID), value: { type: 'pin', v: 1, timestamp: T0 + 2, cid: AUDIO_CID } },
  { op: 'DEL', key: sha256_hex(FRIEND_LIBRARY), value: { type: 'link', timestamp: T0 + 3 } },
  { op: 'PUT', key: sha256_hex(MIXES_LIBRARY), value: { type: 'library', v: 1, timestamp: T0 + 4, address: MIXES_LIBRARY } },
  { op: 'PUT', key: sha256_hex(MIXES_LIBRARY), value: { type: 'link', v: 1, timestamp: T0 + 5, address: MIXES_LIBRARY } },
  { op: 'DEL', key: sha256_hex(MIXES_LIBRARY), value: { type: 'link', timestamp: T0 + 6 } },
  { op: 'DEL', key: sha256_hex(MIXES_LIBRARY), value: { type: 'library', timestamp: T0 + 7 } },
  { op: 'PUT', key: sha256_hex(MIXES_LIBRARY), value: { type: 'library', v: 1, timestamp: T0 + 8, address: MIXES_LIBRARY } }
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

// §4.8.2 current state per (type, key), by §4.4.2 order; a library
// record with any DEL is retired for good (§4.8.3).
const resolve_state = (upto) => {
  const current = new Map()
  const retired = new Set()
  for (const e of entries.slice(0, upto)) {
    const { op, key, value } = e.signed.payload
    const slot = `${value.type}:${key}`
    const prior = current.get(slot)
    if (!prior || e.signed.clock.time > prior.signed.clock.time) current.set(slot, e)
    if (value.type === 'library' && op === 'DEL') retired.add(key)
  }
  return (type, key) => (type === 'library' && retired.has(key) ? 'retired' : current.get(`${type}:${key}`)?.signed.payload.op)
}
const state = resolve_state(entries.length)
const before_retire = resolve_state(7)

// §4.8.2 shape check for the records this version defines.
const is_address = (a) => typeof a === 'string' && /^\/record\/[^/]+\/[0-9a-zA-Z-]*$/.test(a)
const well_formed = ({ op, key, value }) => {
  const only = (keys) => Object.keys(value).every((k) => keys.includes(k))
  if (op === 'DEL') return only(['type', 'timestamp']) && Number.isSafeInteger(value.timestamp)
  if (value.v !== 1 || !Number.isSafeInteger(value.timestamp)) return false
  switch (value.type) {
    case 'library': return only(['type', 'v', 'timestamp', 'address']) && is_address(value.address) && key === sha256_hex(value.address)
    case 'link': return only(['type', 'v', 'timestamp', 'address', 'alias']) && is_address(value.address) &&
      key === sha256_hex(value.address) && (value.alias === undefined || utf8ToBytes(value.alias).length <= 128)
    case 'pin': return only(['type', 'v', 'timestamp', 'cid']) && typeof value.cid === 'string' &&
      canonical_cid(value.cid) === value.cid && key === sha256_hex(value.cid)
    default: return true
  }
}
const base58_pin = 'zb2rhWrAP3dch4trZWGArAEEN8mqFPhsQ2Jojbedxdq8MtCgH'
const malformed = [
  ['pin whose cid is not canonical', { op: 'PUT', key: sha256_hex(base58_pin), value: { type: 'pin', v: 1, timestamp: T0, cid: base58_pin } }],
  ['link whose alias exceeds 128 bytes', { op: 'PUT', key: sha256_hex(FRIEND_LIBRARY), value: { type: 'link', v: 1, timestamp: T0, address: FRIEND_LIBRARY, alias: 'x'.repeat(129) } }]
]

console.log('\nCanonical pin cid: ' + AUDIO_CID)
console.log('\nCurrent state:')
for (const [label, type, address] of [['library', 'library', OWN_LIBRARY], ['link (friend)', 'link', FRIEND_LIBRARY],
  ['library (mixes)', 'library', MIXES_LIBRARY], ['link (mixes)', 'link', MIXES_LIBRARY]]) {
  console.log(`  ${label}: ${state(type, sha256_hex(address))}`)
}
console.log(`  pin: ${state('pin', sha256_hex(AUDIO_CID))}`)

const checks = [
  ['every entry signs into the identity library address', entries.every((e) => e.signed.id === IDENTITY_LIBRARY)],
  ['every entry decodes back to its signed object', entries.every((e) => cid(decode(e.bytes)) === e.hash)],
  ['records are inline: no envelope content CID', entries.every((e) => !('content' in e.signed.payload.value))],
  ['every chained record is well formed', entries.every((e) => well_formed(e.signed.payload))],
  ['pin cid equals the §6.2.4 base32 form', AUDIO_CID === 'bafkreiadbncfqhr7bpdxib72v44vrxtyvfnsk6yuow7quzo4jjo7iwtvbi'],
  ['own library record is a current PUT', state('library', sha256_hex(OWN_LIBRARY)) === 'PUT'],
  ['friend link is unlinked by the later DEL', state('link', sha256_hex(FRIEND_LIBRARY)) === 'DEL'],
  ['pin record is a current PUT', state('pin', sha256_hex(AUDIO_CID)) === 'PUT'],
  ['mixes link DEL leaves the mixes library record a PUT (per type, key)', before_retire('library', sha256_hex(MIXES_LIBRARY)) === 'PUT' && before_retire('link', sha256_hex(MIXES_LIBRARY)) === 'DEL'],
  ['mixes stays retired after a later library PUT', state('library', sha256_hex(MIXES_LIBRARY)) === 'retired'],
  ...malformed.map(([label, payload]) => [`reject: ${label}`, !well_formed(payload)]),
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
