/**
 * Generate canonical envelope round-trip vectors for spec §2.2.
 *
 * Covers wire-format claim sections: §2.2, §2.4, §2.6.
 *
 * The track envelope:
 *   1. Construct a canonical payload object per the §2.4 shape.
 *   2. dag-cbor encode the payload.
 *   3. sha3-512 → CIDv1 (dag-cbor codec) → base58btc → content CID.
 *   4. Assemble the envelope object per §2.2: {id, timestamp, v:1, type, content}.
 *   5. Round-trip: decode(encode(payload)) deep-equals payload.
 * And the inline About record (§2.6), its dag-cbor bytes and operation key.
 *
 * The test-only private key from F0 is reused so the writer identity in
 * derived addresses is reproducible across fixtures.
 */

import { encode, decode, code as dagCborCode } from '@ipld/dag-cbor'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { CID } from 'multiformats/cid'
import { create as digestCreate } from 'multiformats/hashes/digest'
import { base58btc } from 'multiformats/bases/base58'
import { write_vector_file } from './write-vector-file.mjs'

const SHA3_512_CODE = 0x14

function contentCID(payload) {
  const cbor = encode(payload)
  const digest = sha3_512(cbor)
  const mh = digestCreate(SHA3_512_CODE, digest)
  const cid = CID.createV1(dagCborCode, mh)
  return { cbor, cid: cid.toString(base58btc) }
}

function deepEqual(a, b) {
  return JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort())
}

const FIXED_TIMESTAMP = 1611272666695

// Deterministic stand-ins for content the spec doesn't otherwise pin.
const FIXED_AUDIO_CID =
  'zBwWX5GSt1YAYJYortZ4HSkWHD2JsDLjMmo5piYyZfgPqYiNMDEdPGcGLxjmt6nhmPApErDew6eVBdGECYtF6W73kZ1dk'
const FIXED_FP = 'AQADtEmSaImSJI+jiyiOI4+jHE+iJI/jHE+iJ4+jHE+iJ4+jHE+iJ4+jHA'

// --- Track payload (§2.4.1) ---
const trackPayload = {
  hash: FIXED_AUDIO_CID,
  size: 4321987,
  tags: {
    acoustid_fingerprint: FIXED_FP,
    title: 'Vector Track',
    artist: 'Test Vector',
    artists: ['Test Vector'],
    album: 'Spec Fixtures',
    genre: ['ambient']
  },
  audio: {
    codec: 'FLAC',
    bitrate: 1024000,
    duration: 270.5,
    lossless: true,
    container: 'FLAC',
    sampleRate: 44100,
    numberOfSamples: 11923050,
    numberOfChannels: 2
  },
  artwork: [],
  resolver: []
}
const trackId = bytesToHex(sha256(new TextEncoder().encode(FIXED_FP)))

// --- About record (§2.6), inline: no envelope, no content CID ---
const aboutRecord = { type: 'about', v: 1, timestamp: FIXED_TIMESTAMP, name: 'Spec Fixtures Library' }
const aboutKey = bytesToHex(sha256(new TextEncoder().encode('about')))

const cases = [
  { type: 'track', id: trackId, id_source: FIXED_FP, payload: trackPayload }
]

console.log('=== §2.2 Envelope Vectors ===\n')
let allPass = true
const vector_cases = []

for (const c of cases) {
  const { cbor, cid } = contentCID(c.payload)
  const envelope = {
    id: c.id,
    timestamp: FIXED_TIMESTAMP,
    v: 1,
    type: c.type,
    content: cid
  }
  // Round-trip invariant: decode(encode(payload)) deep-equals payload.
  const decoded = decode(cbor)
  const rt = deepEqual(decoded, c.payload)
  // Envelope-itself round-trip too.
  const envCbor = encode(envelope)
  const envDecoded = decode(envCbor)
  const envRt = deepEqual(envDecoded, envelope)

  console.log(`--- ${c.type} ---`)
  console.log('  payload dag-cbor bytes: ' + cbor.length)
  console.log('  payload dag-cbor (hex prefix 32B): ' + bytesToHex(cbor.slice(0, 32)) + '...')
  console.log('  content CID: ' + cid)
  console.log('  envelope.id: ' + c.id)
  console.log('  envelope dag-cbor bytes: ' + envCbor.length)
  console.log('  payload round-trip: ' + (rt ? 'PASS' : 'FAIL'))
  console.log('  envelope round-trip: ' + (envRt ? 'PASS' : 'FAIL'))
  console.log()
  if (!rt || !envRt) allPass = false
  vector_cases.push({
    name: c.type,
    inputs: { type: c.type, id_source: c.id_source, timestamp: FIXED_TIMESTAMP, payload: c.payload },
    expected: { payload_cbor_hex: bytesToHex(cbor), content_cid: cid, envelope_id: c.id, envelope_cbor_hex: bytesToHex(envCbor) }
  })
}

// The About record, and a manual cross-check against RFC 8949 deterministic
// encoding: map keys sort by length then bytewise, so "v" (1) leads, then
// "name" and "type" (4), then "timestamp" (9). Expected leading bytes:
// a4 (map of 4) 61 76 ("v").
const aboutCbor = encode(aboutRecord)
const aboutRt = deepEqual(decode(aboutCbor), aboutRecord)
const expectedLead = 'a46176'
const actualLead = bytesToHex(aboutCbor.slice(0, 3))
const canonicalCheck = actualLead === expectedLead
console.log('--- about record (inline) ---')
console.log('  record dag-cbor bytes: ' + aboutCbor.length)
console.log('  operation key: ' + aboutKey)
console.log('  record round-trip: ' + (aboutRt ? 'PASS' : 'FAIL'))
console.log('  canonical order, expected leading bytes ' + expectedLead + ', actual ' + actualLead + ': ' + (canonicalCheck ? 'PASS' : 'FAIL'))
if (!aboutRt || !canonicalCheck) allPass = false
vector_cases.push({
  name: 'about',
  inputs: { record: aboutRecord },
  expected: { record_cbor_hex: bytesToHex(aboutCbor), operation_key: aboutKey }
})
console.log('\nOverall:', allPass ? 'PASS' : 'FAIL')
if (!allPass) process.exit(1)

write_vector_file({
  generator_url: import.meta.url,
  fixture_id: 'F2',
  description: 'The track envelope (§2.2): payload content CID and envelope bytes, envelope id the sha256 hex of id_source; and the inline About record (§2.6) with its operation key.',
  cases: vector_cases
})
