/**
 * Generate canonical envelope round-trip vectors for spec §2.2.
 *
 * Covers wire-format claim sections: §2.2, §2.4, §2.5, §2.6.
 *
 * For each of the three envelope types (track / log / about):
 *   1. Construct a canonical payload object per the §2.4 / §2.5 / §2.6 shape.
 *   2. dag-cbor encode the payload.
 *   3. sha3-512 → CIDv1 (dag-cbor codec) → base58btc → content CID.
 *   4. Assemble the envelope object per §2.2: {id, timestamp, v:1, type, content}.
 *   5. Round-trip: decode(encode(payload)) deep-equals payload.
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
const LIBRARY_ADDRESS =
  '/record/zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc/library'

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

// --- Log payload (§2.5) ---
const linkedLibrary =
  '/record/zdpuAxgMzJaTqK1HQU6CKQ9p2vUaG4eR9zUk4HwYj9Q1pK7DC/library'
const logPayload = { address: linkedLibrary, alias: 'friend' }
const logId = bytesToHex(sha256(new TextEncoder().encode(linkedLibrary)))

// --- About payload (§2.6) ---
const aboutPayload = {
  address: LIBRARY_ADDRESS,
  name: 'Spec Fixtures Library',
  bio: 'Deterministic test vectors for the Record Protocol v1 spec.',
  location: 'in vitro',
  avatar: null
}
const aboutId = bytesToHex(sha256(new TextEncoder().encode(LIBRARY_ADDRESS)))

const cases = [
  { type: 'track', id: trackId, payload: trackPayload, extras: { tags: ['downtempo', 'fixture'] } },
  { type: 'log', id: logId, payload: logPayload, extras: {} },
  { type: 'about', id: aboutId, payload: aboutPayload, extras: {} }
]

console.log('=== §2.2 Envelope Vectors ===\n')
let allPass = true

for (const c of cases) {
  const { cbor, cid } = contentCID(c.payload)
  const envelope = {
    id: c.id,
    timestamp: FIXED_TIMESTAMP,
    v: 1,
    type: c.type,
    content: cid,
    ...c.extras
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
}

// Manual cross-check against RFC 8949 deterministic encoding rules for log payload:
//   {"address": <linkedLibrary>, "alias": "friend"}
// Canonical dag-cbor rule: map with 2 entries -> a2; keys are sorted by major-type
// then by length, then lexicographically. Both keys are text strings; "alias" (5)
// is shorter than "address" (7), so "alias" comes FIRST in canonical order.
// Expected leading bytes: a2 65 "alias" -> 65 61 6c 69 61 73 ...
const logCbor = contentCID(logPayload).cbor
const expectedLead = 'a26561'
const actualLead = bytesToHex(logCbor.slice(0, 3))
const canonicalCheck = actualLead === expectedLead
console.log('Manual canonical-order check on log payload:')
console.log('  expected leading bytes (map-of-2 + shortest-key-first \"alias\"): ' + expectedLead)
console.log('  actual: ' + actualLead)
console.log('  ' + (canonicalCheck ? 'PASS' : 'FAIL'))
if (!canonicalCheck) allPass = false

console.log('\nOverall:', allPass ? 'PASS' : 'FAIL')
if (!allPass) process.exit(1)
