/**
 * Generate canonical network message vectors for spec §5.3.2 and §5.4.1.
 *
 * Covers wire-format claim sections: §5.3.2, §5.4.1.
 *
 * Two vectors:
 *
 *   1. Announcement (§5.3.2): { libraries, profiles } for the F3 library,
 *      carrying a signed About entry (§2.6) from that library and a signed
 *      profile entry (§4.8.2) from the F0 identity's identity library.
 *      Both are verified from the JSON alone: re-encoding each SignedEntry
 *      with dag-cbor recovers its entry hash and signed bytes.
 *
 *   2. Heads message (§5.4.1): {type: "heads", heads: [<entry.hash>]}.
 *
 * Test-only private key k=1. DO NOT USE for anything real.
 */

import { encode, code as dagCborCode } from '@ipld/dag-cbor'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { CID } from 'multiformats/cid'
import { create as digestCreate } from 'multiformats/hashes/digest'
import { base58btc } from 'multiformats/bases/base58'
import { write_vector_file } from './write-vector-file.mjs'

const SHA3_512_CODE = 0x14

const cid = (value) =>
  CID.createV1(dagCborCode, digestCreate(SHA3_512_CODE, sha3_512(encode(value)))).toString(base58btc)
const sha256_hex = (s) => bytesToHex(sha256(utf8ToBytes(s)))
const private_key = (k) => Uint8Array.from(Buffer.from(k.toString(16).padStart(64, '0'), 'hex'))
const public_key = (k) => bytesToHex(secp256k1.getPublicKey(private_key(k), true))
const derive_address = (key, library_type, discriminator) => {
  const wrapper = { params: { address: cid({ write: [key] }) }, type: 'static' }
  return `/record/${cid({ name: discriminator, type: library_type, accessController: cid(wrapper) })}/${discriminator}`
}

const K = public_key(1)
const LIBRARY = derive_address(K, 'recordstore', 'library')
const IDENTITY_LIBRARY = derive_address(K, 'identity', 'identity')
const WRITE_LIST = { [LIBRARY]: [K] }
const T0 = 1700000000000

// §3.4: sign dag-cbor(unsigned) with ECDSA/secp256k1 over SHA-256, DER.
const sign_entry = (library, payload) => {
  const unsigned = { id: library, payload, next: [], refs: [], v: 2, clock: { id: K, time: 1 } }
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(sha256(encode(unsigned)), private_key(1)), 'compact')
  return { ...unsigned, key: K, sig: bytesToHex(sig.toBytes('der')) }
}

const about_entry = sign_entry(LIBRARY, {
  op: 'PUT', key: sha256_hex('about'), value: { type: 'about', v: 1, timestamp: T0, name: 'Spec Fixtures Library' }
})
const profile_entry = sign_entry(IDENTITY_LIBRARY, {
  op: 'PUT', key: sha256_hex('profile'), value: { type: 'profile', v: 1, timestamp: T0, name: 'Test', bio: 'A fixture identity.' }
})

// §5.3.2 announcement.
const announcement = {
  libraries: [{ address: LIBRARY, about: about_entry }],
  profiles: [profile_entry]
}

// §5.4.1 heads message.
const heads_message = { type: 'heads', heads: [cid(about_entry)] }

// §5.3.2 trust checks, from the parsed JSON alone.
const verifies = (entry) => {
  const { key, sig, ...unsigned } = entry
  return secp256k1.verify(secp256k1.Signature.fromBytes(Buffer.from(sig, 'hex'), 'der').toBytes('compact'),
    sha256(encode(unsigned)), Buffer.from(key, 'hex'))
}
const parsed = JSON.parse(JSON.stringify(announcement))
const [library] = parsed.libraries
const [profile] = parsed.profiles

const announcement_json = JSON.stringify(announcement)
const heads_json = JSON.stringify(heads_message)
const SIZE_BOUND = 256 * 1024

console.log('=== §5.3.2 Announcement + §5.4.1 Heads Message ===\n')
console.log('Library: ' + LIBRARY)
console.log('About entry.hash:   ' + cid(about_entry))
console.log('Profile entry.hash: ' + cid(profile_entry))
console.log('Announcement JSON byte length: ' + Buffer.byteLength(announcement_json))
console.log('Heads message JSON: ' + heads_json)

const checks = [
  ['announcement JSON round-trip preserves structure', JSON.stringify(parsed) === announcement_json],
  ['the About entry hash is recovered from the JSON', cid(library.about) === cid(about_entry)],
  ['the profile entry hash is recovered from the JSON', cid(profile) === cid(profile_entry)],
  ['the About signature verifies from the JSON', verifies(library.about)],
  ['the profile signature verifies from the JSON', verifies(profile)],
  ['the About entry belongs to the announced library and a write-list signer', library.about.id === library.address &&
    WRITE_LIST[library.address].includes(library.about.key)],
  ['the profile entry is in the identity library derived from its key', profile.id === derive_address(profile.key, 'identity', 'identity')],
  ['the library has a single-key write list, so the profile is its owner\'s', WRITE_LIST[library.address].length === 1 &&
    WRITE_LIST[library.address][0] === profile.key],
  ['a tampered About name fails the signature', !verifies({ ...library.about, payload: { ...library.about.payload, value: { ...library.about.payload.value, name: 'x' } } })],
  ['heads message JSON round-trip', JSON.stringify(JSON.parse(heads_json)) === heads_json],
  [`announcement <= 256 KiB bound`, Buffer.byteLength(announcement_json) <= SIZE_BOUND],
  [`heads message <= 256 KiB bound`, Buffer.byteLength(heads_json) <= SIZE_BOUND]
]

console.log('\nVerifications:')
let all_pass = true
for (const [label, ok] of checks) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + ': ' + label)
  if (!ok) all_pass = false
}
console.log('\nOverall:', all_pass ? 'PASS' : 'FAIL')
if (!all_pass) process.exit(1)

write_vector_file({
  generator_url: import.meta.url,
  fixture_id: 'F6',
  description: 'Network messages: the announcement (§5.3.2) and the heads message (§5.4.1), as UTF-8 JSON.',
  cases: [
    {
      name: 'announcement',
      inputs: { message: announcement },
      expected: {
        json: announcement_json,
        byte_length: Buffer.byteLength(announcement_json),
        about_entry_hash: cid(about_entry),
        profile_entry_hash: cid(profile_entry)
      }
    },
    { name: 'heads', inputs: { message: heads_message }, expected: { json: heads_json, byte_length: Buffer.byteLength(heads_json) } }
  ]
})
