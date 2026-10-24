/**
 * Generate the library address derivation vector for spec §3.6.1 / §3.6.2.
 *
 * Covers wire-format claim sections: §3.6.1, §3.6.2.
 *
 * Derives /record/<manifest-cid>/<discriminator> from (K, library type,
 * discriminator) through the §3.5.1 chain, for:
 *   1. (K, recordstore, "library")  — must equal the F3 address
 *   2. (K, listens, "listens")      — the listens library
 *   3. (K, recordstore, <random>)   — a second own library, with a §3.6.1
 *      random discriminator
 *   4. (K, identity, "identity")    — the identity library (§3.6.2)
 *   5. (K, labels, "labels")        — the labels library (§4.9)
 *
 * K is the F0 test-only pubkey.
 */

import { encode, code as dagCborCode } from '@ipld/dag-cbor'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { CID } from 'multiformats/cid'
import { create as digestCreate } from 'multiformats/hashes/digest'
import { base58btc } from 'multiformats/bases/base58'
import { write_vector_file } from './write-vector-file.mjs'

const SHA3_512_CODE = 0x14

const cid = (value) => {
  const digest = sha3_512(encode(value))
  return CID.createV1(dagCborCode, digestCreate(SHA3_512_CODE, digest)).toString(base58btc)
}

// §3.6.1: the three chain objects and the address are functions of
// (K, library type, discriminator) for a single-key write list.
const derive_address = ({ key, library_type, discriminator }) => {
  const write_list = { write: [key] }
  const wrapper = { params: { address: cid(write_list) }, type: 'static' }
  const manifest = { name: discriminator, type: library_type, accessController: cid(wrapper) }
  return {
    write_list_cid: cid(write_list),
    wrapper_cid: cid(wrapper),
    manifest_cid: cid(manifest),
    manifest_bytes: encode(manifest).length,
    address: `/record/${cid(manifest)}/${discriminator}`
  }
}

// F0 test pubkey (secp256k1 generator point, compressed).
const TEST_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
// §3.5.1 F3 vector address.
const F3_ADDRESS =
  '/record/zBwWX6eaeb5ZhToR5AL62215fMiLTZYAtYpnDcBCebF4PJiLWK2n8MnGCArMMZc3nbLvaCGsg51etXpMrdVH5rgd9DUf8/library'

const cases = [
  { library_type: 'recordstore', discriminator: 'library' },
  { library_type: 'listens', discriminator: 'listens' },
  { library_type: 'recordstore', discriminator: 'q4ht7nxk2mzv6wrd3pjc5bfgya' },
  { library_type: 'identity', discriminator: 'identity' },
  { library_type: 'labels', discriminator: 'labels' }
]

console.log('=== §3.6.1 / §3.6.2 Library Address Derivation Vector ===\n')
console.log('K (F0 test pubkey):')
console.log('  ' + TEST_PUBKEY)
const results = cases.map((c) => ({ ...c, ...derive_address({ key: TEST_PUBKEY, ...c }) }))
for (const r of results) {
  console.log(`\n(K, ${r.library_type}, "${r.discriminator}"):`)
  console.log('  manifest dag-cbor bytes: ' + r.manifest_bytes)
  console.log('  manifest CID: ' + r.manifest_cid)
  console.log('  address: ' + r.address)
}

const [library, listens, random, identity, labels] = results
const checks = [
  ['(K, recordstore, "library") equals the §3.5.1 F3 address', library.address === F3_ADDRESS],
  ['every library of K shares one write-list and wrapper CID', new Set(results.map((r) => r.wrapper_cid)).size === 1],
  ['a random §3.6.1 discriminator gives a different address', /^[a-z2-7]{26}$/.test(random.discriminator) && random.address !== library.address],
  ['the library type separates equal discriminators', derive_address({ key: TEST_PUBKEY, library_type: 'listens', discriminator: 'library' }).address !== library.address],
  ['the identity library address ends in /identity', identity.address.endsWith('/identity')],
  ['derivation is deterministic', derive_address({ key: TEST_PUBKEY, ...cases[3] }).address === identity.address],
  ['listens address is distinct', listens.address !== library.address],
  ['labels address is distinct', new Set([labels, listens, library, identity].map((r) => r.address)).size === 4]
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
  fixture_id: 'F8',
  description: 'Library address derivation (§3.6.1, §3.6.2) from (key, library type, discriminator).',
  cases: results.map((r) => ({
    name: `${r.library_type}-${r.discriminator}`,
    inputs: { public_key_hex: TEST_PUBKEY, library_type: r.library_type, discriminator: r.discriminator },
    expected: { write_list_cid: r.write_list_cid, wrapper_cid: r.wrapper_cid, manifest_cid: r.manifest_cid, address: r.address }
  }))
})
