/**
 * Generate canonical network message vectors for spec §5.3.2 and §5.4.1.
 *
 * Covers wire-format claim sections: §5.3.2, §5.4.1.
 *
 * Two vectors:
 *
 *   1. LoadedAboutEntry (§5.3.2): a JSON serialisation of a signed log
 *      entry with the envelope `content` field replaced inline by the
 *      decoded About payload object (not the CID string).
 *
 *   2. Heads message (§5.4.1): {type: "heads", heads: [<entry.hash>]}.
 *
 * The LoadedAboutEntry reuses the F0 / F4 pubkey so the writer identity
 * threads through the fixtures. The signed-entry `hash` field carries
 * a placeholder CID (a real entry.hash would derive from re-signing the
 * About-shaped entry; for the §5.3.2 transform contract the load-bearing
 * invariant is the *shape* of the message, not regenerating a fresh
 * signature).
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const TEST_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const LIBRARY_ADDRESS =
  '/record/zBwWX6eaeb5ZhToR5AL62215fMiLTZYAtYpnDcBCebF4PJiLWK2n8MnGCArMMZc3nbLvaCGsg51etXpMrdVH5rgd9DUf8/library'
const ABOUT_ID = bytesToHex(sha256(new TextEncoder().encode(LIBRARY_ADDRESS)))
const PLACEHOLDER_ENTRY_HASH =
  'zBwWX7sbGgnamYuFHWzehnHysmRkS9rVvdgATL8CPab1ybY1j3xyy9F7Pu9m86AgsyCWfXbBPdxXfhEFzd6fdn14uEVAF'
const PLACEHOLDER_SIG =
  '3045022100ab7ece3c307e2a1061c83b93d32b62f49abf34d8d24ee167db515e23b33baec80220308677039a50f491c82d2ed95cc4df9f1bac097fa9e7089b488314180a42f6c0'

// §2.6 About payload, decoded (NOT a CID).
const aboutPayloadDecoded = {
  address: LIBRARY_ADDRESS,
  name: 'Spec Fixtures Library',
  bio: 'Deterministic test vectors for the Record Protocol v1 spec.',
  location: 'in vitro',
  avatar: null
}

// §5.3.2 LoadedAboutEntry — the envelope `content` is the inlined About
// payload object, not the base58btc CID string it would carry on the
// canonical wire form.
const loadedAboutEntry = {
  hash: PLACEHOLDER_ENTRY_HASH,
  id: LIBRARY_ADDRESS,
  payload: {
    op: 'PUT',
    key: ABOUT_ID,
    value: {
      id: ABOUT_ID,
      timestamp: 1611272666695,
      v: 1,
      type: 'about',
      content: aboutPayloadDecoded // inlined; not a CID string
    }
  },
  next: [],
  refs: [],
  v: 2,
  clock: { id: TEST_PUBKEY, time: 1 },
  key: TEST_PUBKEY,
  sig: PLACEHOLDER_SIG
}

// §5.4.1 heads message.
const headsMessage = {
  type: 'heads',
  heads: [PLACEHOLDER_ENTRY_HASH]
}

function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  if (typeof a === 'object') {
    const ak = Object.keys(a).sort()
    const bk = Object.keys(b).sort()
    if (ak.length !== bk.length) return false
    return ak.every((k, i) => k === bk[i] && deepEqual(a[k], b[k]))
  }
  return false
}

console.log('=== §5.3.2 LoadedAboutEntry + §5.4.1 Heads Message ===\n')

const loadedJson = JSON.stringify(loadedAboutEntry)
const loadedRoundTrip = JSON.parse(loadedJson)
const loadedRt = deepEqual(loadedAboutEntry, loadedRoundTrip)
console.log('LoadedAboutEntry JSON byte length: ' + Buffer.byteLength(loadedJson))
console.log('LoadedAboutEntry sample (first 200 chars):')
console.log('  ' + loadedJson.slice(0, 200) + '...')
console.log()

const contentIsDecoded = typeof loadedAboutEntry.payload.value.content === 'object'
const contentNotCid = typeof loadedAboutEntry.payload.value.content !== 'string'
const contentAddressMatches =
  loadedAboutEntry.payload.value.content.address === LIBRARY_ADDRESS

const headsJson = JSON.stringify(headsMessage)
const headsRoundTrip = JSON.parse(headsJson)
const headsRt = deepEqual(headsMessage, headsRoundTrip)
const headsBytes = Buffer.byteLength(headsJson)
console.log('Heads message JSON: ' + headsJson)
console.log('Heads message byte length: ' + headsBytes)

const SIZE_BOUND = 256 * 1024
const headsWithin = headsBytes <= SIZE_BOUND
const loadedWithin = Buffer.byteLength(loadedJson) <= SIZE_BOUND

console.log('\nVerifications:')
console.log('  ' + (loadedRt ? 'PASS' : 'FAIL') + ': LoadedAboutEntry JSON round-trip preserves structure')
console.log('  ' + (contentIsDecoded ? 'PASS' : 'FAIL') + ': envelope.content is a decoded object (inlined transform applied)')
console.log('  ' + (contentNotCid ? 'PASS' : 'FAIL') + ': envelope.content is NOT a CID string (would be on canonical wire)')
console.log('  ' + (contentAddressMatches ? 'PASS' : 'FAIL') + ': inlined content.address equals owning library address (§2.6)')
console.log('  ' + (headsRt ? 'PASS' : 'FAIL') + ': heads message JSON round-trip')
console.log('  ' + (headsWithin ? 'PASS' : 'FAIL') + `: heads message <= 256 KiB bound (${headsBytes} of ${SIZE_BOUND})`)
console.log('  ' + (loadedWithin ? 'PASS' : 'FAIL') + `: LoadedAboutEntry <= 256 KiB bound (${Buffer.byteLength(loadedJson)} of ${SIZE_BOUND})`)

const allPass = loadedRt && contentIsDecoded && contentNotCid && contentAddressMatches && headsRt && headsWithin && loadedWithin
console.log('\nOverall:', allPass ? 'PASS' : 'FAIL')
if (!allPass) process.exit(1)
