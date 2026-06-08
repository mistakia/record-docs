/**
 * Generate the AC chain vector for spec §3.5.1.
 *
 * Covers wire-format claim sections: §3.5.1, §3.6.
 *
 * Builds the three-object chain:
 *   1. inner write-list {write: [<pubkey>]}
 *   2. AC wrapper {params: {address: <write-list-cid>}, type: "static"}
 *   3. library manifest {name, type, accessController: <wrapper-cid>}
 *
 * Then assembles the library address /record/<manifest-cid>/<name> per §3.6
 * and verifies the structural invariants the chain encodes.
 *
 * Uses the F0 test-only pubkey so the write-list cross-references the
 * existing signing vector — proof that a single test identity threads
 * through both fixtures coherently.
 */

import { encode, decode, code as dagCborCode } from '@ipld/dag-cbor'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { CID } from 'multiformats/cid'
import { create as digestCreate } from 'multiformats/hashes/digest'
import { base58btc } from 'multiformats/bases/base58'

const SHA3_512_CODE = 0x14

function contentCID(payload) {
  const cbor = encode(payload)
  const digest = sha3_512(cbor)
  const mh = digestCreate(SHA3_512_CODE, digest)
  const cid = CID.createV1(dagCborCode, mh)
  return { cbor, cidStr: cid.toString(base58btc) }
}

// F0 test pubkey (secp256k1 generator point, compressed).
const TEST_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const LIBRARY_NAME = 'library'

const writeList = { write: [TEST_PUBKEY] }
const { cbor: wlCbor, cidStr: wlCid } = contentCID(writeList)

const wrapper = { params: { address: wlCid }, type: 'static' }
const { cbor: wrapCbor, cidStr: wrapCid } = contentCID(wrapper)

const manifest = {
  name: LIBRARY_NAME,
  type: 'recordstore',
  accessController: wrapCid
}
const { cbor: manCbor, cidStr: manCid } = contentCID(manifest)

const address = `/record/${manCid}/${LIBRARY_NAME}`

console.log('=== §3.5.1 AC Chain Vector ===\n')
console.log('Test pubkey (F0):')
console.log('  ' + TEST_PUBKEY)
console.log('\nInner write-list dag-cbor (hex, ' + wlCbor.length + ' bytes):')
console.log('  ' + bytesToHex(wlCbor))
console.log('Write-list CID:')
console.log('  ' + wlCid)
console.log('\nAC wrapper dag-cbor (hex, ' + wrapCbor.length + ' bytes):')
console.log('  ' + bytesToHex(wrapCbor))
console.log('Wrapper CID:')
console.log('  ' + wrapCid)
console.log('\nManifest dag-cbor (hex, ' + manCbor.length + ' bytes):')
console.log('  ' + bytesToHex(manCbor))
console.log('Manifest CID:')
console.log('  ' + manCid)
console.log('\nAssembled library address (§3.6):')
console.log('  ' + address)

// --- Verifications ---
const manDecoded = decode(manCbor)
const wrapDecoded = decode(wrapCbor)
const wlDecoded = decode(wlCbor)

const checks = [
  ['manifest.accessController equals wrapper CID', manDecoded.accessController === wrapCid],
  ['wrapper.params.address equals write-list CID', wrapDecoded.params.address === wlCid],
  ['write[0] equals F0 test pubkey (cross-fixture)', wlDecoded.write[0] === TEST_PUBKEY],
  [
    'assembled address parses back into (manifest-cid, name)',
    (() => {
      const m = address.match(/^\/record\/([^/]+)\/(.+)$/)
      return m && m[1] === manCid && m[2] === LIBRARY_NAME
    })()
  ]
]

console.log('\nStructural checks:')
let allPass = true
for (const [label, ok] of checks) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + ': ' + label)
  if (!ok) allPass = false
}
console.log('\nOverall:', allPass ? 'PASS' : 'FAIL')
if (!allPass) process.exit(1)
