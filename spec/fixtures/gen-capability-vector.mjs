/**
 * Generate the capability vector for spec §3.5.5 – §3.5.10.
 *
 * Covers wire-format claim sections: §3.5.5, §3.5.6, §3.5.7, §3.5.8,
 * §3.5.9, §3.5.10.
 *
 * Builds one recordstore library (the F3 library, owner k=1) holding:
 *   - capability C (owner): k=2 may append tracks tagged "friends-mix"
 *     until an expiry
 *   - a write under C, a revocation of C that has seen it, and a second
 *     write under C concurrent with the revocation (accepted, then inert)
 *   - seven writes the verifier must reject, one per §3.5.9 check
 *   - a delegation branch: capability D (owner) lets k=2 grant and append;
 *     k=2 grants k=3 a narrower capability (accepted) and one D does not
 *     cover (accepted as a grant, but a write under it is rejected)
 *
 * A reference verifier in this file applies §3.5.9 and §3.5.10 and the
 * script fails unless every verdict matches the expected table.
 *
 * Test-only private keys k=1, k=2, k=3. DO NOT USE for anything real.
 */

import { encode, code as dagCborCode } from '@ipld/dag-cbor'
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
const sha256_hex = (s) => bytesToHex(sha256(typeof s === 'string' ? utf8ToBytes(s) : s))
const private_key = (k) => Uint8Array.from(Buffer.from(k.toString(16).padStart(64, '0'), 'hex'))
const public_key = (k) => bytesToHex(secp256k1.getPublicKey(private_key(k), true))

const OWNER = public_key(1)
const GRANTEE = public_key(2)
const OTHER = public_key(3)
const LIBRARY =
  '/record/zBwWX6eaeb5ZhToR5AL62215fMiLTZYAtYpnDcBCebF4PJiLWK2n8MnGCArMMZc3nbLvaCGsg51etXpMrdVH5rgd9DUf8/library'
const WRITE_LIST = [OWNER]
// §2.2.1 F2 content CIDs and the §3.4.5 track id.
const TRACK_CONTENT = 'zBwWX8s8jVcoQvakEsZzXaVeakz5eXiyaqb6jPBdQ4wYyz2LT8iKXYneYTrRWxqtEhcyyv8sMcL5ivsGosuE4saCCimeb'
const ABOUT_CONTENT = 'zBwWX7ax1zjie7XCTHyf3gyPrF56FJSZQCemrWE4CUHg2RisFqkPhXHa4F2L1YzHRXYyLvMYgHN5LebjqWfseon5TQqCg'
const TRACK_A = 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f'
const TRACK_B = sha256_hex('track-b')
const T0 = 1700000000000
const EXPIRES_AT = T0 + 100000

// --- Entry construction (§3.4, §2.8.1) ---

const entries = new Map()
const label_of = new Map()

const append = (label, { k, time, next, value, capability_id, key }) => {
  const payload = { op: 'PUT', key: key ?? sha256_hex(encode(value)), value }
  if (capability_id !== undefined) payload.capability_id = capability_id
  const unsigned = { id: LIBRARY, payload, next, refs: [], v: 2, clock: { id: public_key(k), time } }
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(sha256(encode(unsigned)), private_key(k)), 'compact')
  const signed = { ...unsigned, key: public_key(k), sig: bytesToHex(sig.toBytes('der')) }
  const hash = cid(signed)
  entries.set(hash, signed)
  label_of.set(hash, label)
  return hash
}

const track = (id, timestamp, tags) => ({ id, timestamp, v: 1, type: 'track', content: TRACK_CONTENT, tags })
const about = (timestamp) => ({ id: sha256_hex(LIBRARY), timestamp, v: 1, type: 'about', content: ABOUT_CONTENT })
const capability = (fields) => ({ type: 'capability', v: 1, ...fields })

// --- Reference verifier (§3.5.5 – §3.5.10) ---

const is_owner = (key) => WRITE_LIST.includes(key)

const causal_past = (hash) => {
  const seen = new Set()
  const stack = [...entries.get(hash).next]
  while (stack.length) {
    const h = stack.pop()
    if (seen.has(h) || !entries.has(h)) continue
    seen.add(h)
    stack.push(...entries.get(h).next)
  }
  return seen
}

const is_scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
const has_only = (node, keys) => Object.keys(node).every((k) => keys.includes(k))
const is_map = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// §3.5.7 fail closed: any unknown or malformed node fails the whole filter.
const filter_well_formed = (node, depth = 1) => {
  if (depth > 16 || !is_map(node)) return false
  switch (node.type) {
    case 'match': {
      const fields = Object.entries(node.fields ?? {})
      return has_only(node, ['type', 'fields']) && is_map(node.fields) && fields.length >= 1 && fields.length <= 16 && fields.every(([, v]) => is_scalar(v))
    }
    case 'any_of':
      return has_only(node, ['type', 'field', 'values']) && typeof node.field === 'string' && Array.isArray(node.values) &&
        node.values.length >= 1 && node.values.length <= 256 && node.values.every(is_scalar)
    case 'range': {
      const bounds = ['gte', 'gt', 'lte', 'lt'].filter((b) => b in node)
      return has_only(node, ['type', 'field', 'gte', 'gt', 'lte', 'lt']) && typeof node.field === 'string' &&
        bounds.length >= 1 && bounds.every((b) => typeof node[b] === 'number')
    }
    case 'and':
    case 'or':
      return has_only(node, ['type', 'filters']) && Array.isArray(node.filters) && node.filters.length >= 1 &&
        node.filters.length <= 64 && node.filters.every((f) => filter_well_formed(f, depth + 1))
    case 'not':
      return has_only(node, ['type', 'filter']) && filter_well_formed(node.filter, depth + 1)
    default:
      return false
  }
}

const resolve = (subject, path) =>
  path.split('.').reduce((cur, step) => (is_map(cur) && step in cur ? cur[step] : undefined), subject)
const scalar_equal = (a, b) => typeof a === typeof b && a === b
const holds_value = (resolved, v) =>
  Array.isArray(resolved) ? resolved.some((x) => scalar_equal(x, v)) : resolved !== undefined && scalar_equal(resolved, v)

const evaluate = (node, subject) => {
  switch (node.type) {
    case 'match':
      return Object.entries(node.fields).every(([path, v]) => holds_value(resolve(subject, path), v))
    case 'any_of':
      return node.values.some((v) => holds_value(resolve(subject, node.field), v))
    case 'range': {
      const x = resolve(subject, node.field)
      if (typeof x !== 'number') return false
      return (!('gte' in node) || x >= node.gte) && (!('gt' in node) || x > node.gt) &&
        (!('lte' in node) || x <= node.lte) && (!('lt' in node) || x < node.lt)
    }
    case 'and': return node.filters.every((f) => evaluate(f, subject))
    case 'or': return node.filters.some((f) => evaluate(f, subject))
    case 'not': return !evaluate(node.filter, subject)
  }
}

const filter_matches = (filter, subject) =>
  filter === undefined || (filter_well_formed(filter) && evaluate(filter, subject))

const grantee_matches = (grantee, key) => {
  if (!is_map(grantee)) return false
  if (grantee.type === 'key') return grantee.key === key
  if (grantee.type === 'key_set') return Array.isArray(grantee.keys) && grantee.keys.length <= 256 && grantee.keys.includes(key)
  return false
}

// §3.5.8: every condition must be known and hold.
const conditions_hold = (conditions = [], timestamp) =>
  conditions.every((c) => c?.type === 'expires_at' && Number.isInteger(c.at) && timestamp <= c.at)

// §3.5.6: the actions that cover an operation, and its filter subject.
const covering_actions = (hash) => {
  const { value } = entries.get(hash).payload
  switch (value.type) {
    case 'track': {
      const actions = ['library.append_track']
      const prior = [...causal_past(hash)].map((h) => entries.get(h))
        .filter((e) => e.payload.value.type === 'track' && e.payload.value.id === value.id)
        .sort((a, b) => b.clock.time - a.clock.time)[0]
      const kept = prior && prior.payload.value.content === value.content &&
        (prior.payload.value.tags ?? []).every((t) => (value.tags ?? []).includes(t))
      if (kept) actions.push('library.append_tag')
      return actions
    }
    case 'about': return ['library.update_about']
    case 'capability': return ['library.grant_capability']
    case 'revocation': return ['library.revoke_capability']
    default: return []
  }
}
const filter_subject = (value) => (value.type === 'track' ? { ...value, tags: value.tags ?? [] } : value)

// The chain of a capability (§3.5.9): itself, then the chain of what it cites.
const chain_of = (hash) => {
  const entry = entries.get(hash)
  return is_owner(entry.key) ? [hash] : [hash, ...chain_of(entry.payload.capability_id)]
}

// §3.5.9 static checks. Returns null when authorised, else the failing check.
const verify = (hash) => {
  const entry = entries.get(hash)
  if (is_owner(entry.key)) return null
  const { payload } = entry
  if (payload.op !== 'PUT' || typeof payload.capability_id !== 'string') return 'no capability_id'
  const c1 = entries.get(payload.capability_id)
  if (!c1 || c1.payload.value.type !== 'capability' || !causal_past(hash).has(payload.capability_id)) {
    return 'capability not in causal past'
  }
  if (!grantee_matches(c1.payload.value.grantee, entry.key)) return 'grantee mismatch'
  const chain = chain_of(payload.capability_id)
  if (chain.length > 8) return 'chain too long'
  const actions = covering_actions(hash)
  for (const c of chain) {
    const cap = entries.get(c).payload.value
    if (!cap.actions.some((a) => actions.includes(a))) return 'action not granted' + (c === chain[0] ? '' : ' up the chain')
    if (!filter_matches(cap.filter, filter_subject(payload.value))) return 'filter fails'
    if (!conditions_hold(cap.conditions, payload.value.timestamp)) return 'condition fails'
  }
  return null
}

// Merge in clock order: an entry needs a verified next closure (§5.4.2
// item 5). Returns each entry's verdict: null when accepted, else the
// failing check.
const merge_all = () => {
  const accepted = new Set()
  const verdicts = new Map()
  for (const hash of [...entries.keys()].sort((a, b) => entries.get(a).clock.time - entries.get(b).clock.time)) {
    const reason = entries.get(hash).next.every((h) => accepted.has(h)) ? verify(hash) : 'ancestor rejected'
    verdicts.set(hash, reason)
    if (reason === null) accepted.add(hash)
  }
  return { accepted, verdicts }
}

// §3.5.10: inertness and the effective revocation set.
const multihash = (h) => CID.parse(h, base58btc).multihash.bytes
const compare_bytes = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}
const is_inert = (hash, effective) => {
  const entry = entries.get(hash)
  if (is_owner(entry.key)) return false
  return chain_of(entry.payload.capability_id).some((c) =>
    effective.some((r) => entries.get(r).payload.value.revokes === c && !causal_past(r).has(hash)))
}
const effective_revocations = (accepted) => {
  const revocations = [...accepted].filter((h) => entries.get(h).payload.value.type === 'revocation')
  const effective = revocations.filter((h) => is_owner(entries.get(h).key))
  const delegated = revocations.filter((h) => !is_owner(entries.get(h).key)).sort((a, b) => {
    const x = entries.get(a)
    const y = entries.get(b)
    return x.clock.time - y.clock.time || x.payload.value.timestamp - y.payload.value.timestamp ||
      compare_bytes(multihash(a), multihash(b))
  })
  for (const r of delegated) if (!is_inert(r, effective)) effective.push(r)
  return effective
}

// --- The vector ---

const C = append('C: capability (owner)', {
  k: 1, time: 1, next: [],
  value: capability({
    timestamp: T0,
    grantee: { type: 'key', key: GRANTEE },
    actions: ['library.append_track'],
    filter: { type: 'match', fields: { tags: 'friends-mix' } },
    conditions: [{ type: 'expires_at', at: EXPIRES_AT }]
  })
})
const W = append('W: write under C', {
  k: 2, time: 2, next: [C], key: TRACK_A, capability_id: C, value: track(TRACK_A, T0 + 1000, ['friends-mix'])
})
const R = append('R: revocation of C (owner, has seen W)', {
  k: 1, time: 3, next: [W], value: { type: 'revocation', v: 1, timestamp: T0 + 2000, revokes: C }
})
const X = append('X: write under C, concurrent with R', {
  k: 2, time: 3, next: [W], key: TRACK_B, capability_id: C, value: track(TRACK_B, T0 + 2500, ['friends-mix'])
})
const U = append('U: owner capability with an unknown filter node', {
  k: 1, time: 2, next: [C],
  value: capability({
    timestamp: T0 + 10,
    grantee: { type: 'key', key: GRANTEE },
    actions: ['library.append_track'],
    filter: { type: 'not', filter: { type: 'regex', field: 'tags', pattern: '^x' } }
  })
})
const rejects = [
  append('reject: signed by a non-grantee', {
    k: 3, time: 2, next: [C], key: TRACK_B, capability_id: C, value: track(TRACK_B, T0 + 1000, ['friends-mix'])
  }),
  append('reject: filter mismatch', {
    k: 2, time: 2, next: [C], key: TRACK_B, capability_id: C, value: track(TRACK_B, T0 + 1000, ['other'])
  }),
  append('reject: expired', {
    k: 2, time: 2, next: [C], key: TRACK_B, capability_id: C, value: track(TRACK_B, EXPIRES_AT + 1, ['friends-mix'])
  }),
  append('reject: capability not in causal past', {
    k: 2, time: 1, next: [], key: TRACK_B, capability_id: C, value: track(TRACK_B, T0 + 1000, ['friends-mix'])
  }),
  append('reject: action not granted', {
    k: 2, time: 2, next: [C], key: sha256_hex(LIBRARY), capability_id: C, value: about(T0 + 1000)
  }),
  append('reject: no capability_id', {
    k: 2, time: 2, next: [C], key: TRACK_B, value: track(TRACK_B, T0 + 1000, ['friends-mix'])
  }),
  append('reject: unknown filter node fails closed', {
    k: 2, time: 3, next: [U], key: TRACK_B, capability_id: U, value: track(TRACK_B, T0 + 1000, ['friends-mix'])
  })
]
const D = append('D: capability (owner) to grant and append', {
  k: 1, time: 1, next: [],
  value: capability({
    timestamp: T0 + 20,
    grantee: { type: 'key', key: GRANTEE },
    actions: ['library.grant_capability', 'library.append_track']
  })
})
const D1 = append('D1: k=2 grants k=3 append_track under D', {
  k: 2, time: 2, next: [D], capability_id: D,
  value: capability({ timestamp: T0 + 30, grantee: { type: 'key_set', keys: [OTHER] }, actions: ['library.append_track'] })
})
const DW = append('DW: k=3 write under D1', {
  k: 3, time: 3, next: [D1], key: TRACK_B, capability_id: D1, value: track(TRACK_B, T0 + 40, [])
})
const D2 = append('D2: k=2 grants k=3 update_about under D', {
  k: 2, time: 2, next: [D], capability_id: D,
  value: capability({ timestamp: T0 + 31, grantee: { type: 'key', key: OTHER }, actions: ['library.update_about'] })
})
const DA = append('reject: k=3 about under D2, which D does not cover', {
  k: 3, time: 3, next: [D2], key: sha256_hex(LIBRARY), capability_id: D2, value: about(T0 + 41)
})

const { accepted, verdicts } = merge_all()
const effective = effective_revocations(accepted)
const verdict = (h) => (verdicts.get(h) === null ? (is_inert(h, effective) ? 'accept, inert' : 'accept') : 'reject: ' + verdicts.get(h))

const expected = new Map([
  [C, 'accept'],
  [W, 'accept'],
  [R, 'accept'],
  [X, 'accept, inert'],
  [U, 'accept'],
  [rejects[0], 'reject: grantee mismatch'],
  [rejects[1], 'reject: filter fails'],
  [rejects[2], 'reject: condition fails'],
  [rejects[3], 'reject: capability not in causal past'],
  [rejects[4], 'reject: action not granted'],
  [rejects[5], 'reject: no capability_id'],
  [rejects[6], 'reject: filter fails'],
  [D, 'accept'],
  [D1, 'accept'],
  [DW, 'accept'],
  [D2, 'accept'],
  [DA, 'reject: action not granted up the chain']
])

console.log('=== §3.5.5 – §3.5.10 Capability Vector ===\n')
console.log('Library (F3, owner k=1): ' + LIBRARY)
console.log('Grantee k=2: ' + GRANTEE)
console.log('Other   k=3: ' + OTHER)
console.log('\nCapability C record key: ' + entries.get(C).payload.key)
console.log('Capability id of C (entry.hash): ' + C)
console.log('Revocation R entry.hash:          ' + R)
console.log('Write W entry.hash:               ' + W)
console.log('Signed dag-cbor bytes: C ' + encode(entries.get(C)).length + ', W ' + encode(entries.get(W)).length +
  ', R ' + encode(entries.get(R)).length)

console.log('\nVerdicts:')
let all_pass = true
for (const [hash, want] of expected) {
  const got = verdict(hash)
  const ok = got === want
  if (!ok) all_pass = false
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${label_of.get(hash)} -> ${got}${ok ? '' : ` (expected ${want})`}`)
}
const extra = [
  ['every entry has an expected verdict', expected.size === entries.size],
  ['R is the only effective revocation', effective.length === 1 && effective[0] === R]
]
for (const [label, ok] of extra) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + ': ' + label)
  if (!ok) all_pass = false
}
console.log('\nOverall:', all_pass ? 'PASS' : 'FAIL')
if (!all_pass) process.exit(1)
