/**
 * Generate the capability vector for spec §3.5.5 – §3.5.10.
 *
 * Covers wire-format claim sections: §3.5.4, §3.5.5, §3.5.6, §3.5.7,
 * §3.5.8, §3.5.9, §3.5.10, §4.2 (clock verification).
 *
 * Builds entries in the F3 recordstore library (owner k=1), plus a few in
 * the same owner's listens and identity libraries, as independent branches:
 *   - C: k=2 may append tracks tagged "friends-mix" until an expiry; a write
 *     under C, the owner's revocation of C, a write concurrent with it
 *     (inert), a write after it (rejected), and one reject per check
 *   - shape and fail-closed cases: a malformed capability, unknown filter,
 *     grantee, and condition types, an owner entry carrying capability_id,
 *     capability_id in listens and identity libraries, a forged clock
 *   - append_tag against a base entry, including a tombstoned one
 *   - delegation: grants within and beyond the delegator's actions, a
 *     filtered delegator, a delegated revocation (effective, then a write
 *     after it is inert), an out-of-scope revocation, a write after the
 *     owner revokes the parent, a chain of 9, and a self-revocation
 *   - two interacting delegated revocations, where the lower-clock one
 *     stays effective though a later one withdraws its authority
 *   - head fan-out: a grantee leaves 257 heads; the owner appends citing
 *     256, then converges to one head; citing all 257 is rejected
 *
 * A reference verifier in this file applies §3.5.9, §3.5.10, and the §4.2
 * clock check. The script fails unless every verdict matches the table.
 *
 * Test-only private keys k=1 to k=4. DO NOT USE for anything real.
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
const derive_address = (key, library_type, discriminator) => {
  const wrapper = { params: { address: cid({ write: [key] }) }, type: 'static' }
  return `/record/${cid({ name: discriminator, type: library_type, accessController: cid(wrapper) })}/${discriminator}`
}

const OWNER = public_key(1)
const K2 = public_key(2)
const K3 = public_key(3)
const K4 = public_key(4)
const LIBRARY = derive_address(OWNER, 'recordstore', 'library')
const LISTENS = derive_address(OWNER, 'listens', 'listens')
const IDENTITY = derive_address(OWNER, 'identity', 'identity')
const LIBRARY_TYPE = new Map([[LIBRARY, 'recordstore'], [LISTENS, 'listens'], [IDENTITY, 'identity']])
const WRITE_LIST = [OWNER]
// §2.2.1 F2 content CIDs.
const TRACK_CONTENT = 'zBwWX8s8jVcoQvakEsZzXaVeakz5eXiyaqb6jPBdQ4wYyz2LT8iKXYneYTrRWxqtEhcyyv8sMcL5ivsGosuE4saCCimeb'
const ABOUT_CONTENT = 'zBwWX7ax1zjie7XCTHyf3gyPrF56FJSZQCemrWE4CUHg2RisFqkPhXHa4F2L1YzHRXYyLvMYgHN5LebjqWfseon5TQqCg'
const TRACK_A = 'cd24f44d2ee1fb5dba99a6cac74f0398f5a909f3341688d19ea59926c8ef693f'
const TRACK_B = sha256_hex('track-b')
const TRACK_T = sha256_hex('track-t')
const T0 = 1700000000000
const EXPIRES_AT = T0 + 100000

// --- Entry construction (§3.4, §2.8.1, §4.2) ---

const entries = new Map()
const label_of = new Map()

// The clock follows §4.2 unless a case forges it.
const append = (label, { k, next = [], value, op = 'PUT', key, capability_id, library = LIBRARY, time, payload }) => {
  const body = payload ?? { op, key: key ?? sha256_hex(encode(value)), value }
  if (capability_id !== undefined) body.capability_id = capability_id
  const clock_time = time ?? (next.length ? Math.max(...next.map((h) => entries.get(h).clock.time)) + 1 : 1)
  const unsigned = { id: library, payload: body, next, refs: [], v: 2, clock: { id: public_key(k), time: clock_time } }
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
const revocation = (timestamp, revokes) => ({ type: 'revocation', v: 1, timestamp, revokes })
const grant = (key, actions, extra = {}) => ({ grantee: { type: 'key', key }, actions, ...extra })

// --- Shapes (§3.5.5, §3.5.7, §3.5.8): 'ok', 'unknown' (fail closed), or 'malformed' (reject) ---

const is_map = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const is_scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
const is_pubkey = (v) => typeof v === 'string' && /^0[23][0-9a-f]{64}$/.test(v)
const is_uint = (v) => Number.isSafeInteger(v) && v >= 0
const extra_fields = (node, keys) => Object.keys(node).some((k) => !keys.includes(k))
const worst = (...results) => (results.includes('malformed') ? 'malformed' : results.includes('unknown') ? 'unknown' : 'ok')

const filter_shape = (node, depth = 1) => {
  if (depth > 16 || !is_map(node) || typeof node.type !== 'string') return 'malformed'
  const known = (keys, ok) => (!ok ? 'malformed' : extra_fields(node, keys) ? 'unknown' : 'ok')
  switch (node.type) {
    case 'match': {
      const fields = is_map(node.fields) ? Object.values(node.fields) : []
      return known(['type', 'fields'], fields.length >= 1 && fields.length <= 16 && fields.every(is_scalar))
    }
    case 'any_of':
      return known(['type', 'field', 'values'], typeof node.field === 'string' && Array.isArray(node.values) &&
        node.values.length >= 1 && node.values.length <= 256 && node.values.every(is_scalar))
    case 'range': {
      const bounds = ['gte', 'gt', 'lte', 'lt'].filter((b) => b in node)
      return known(['type', 'field', 'gte', 'gt', 'lte', 'lt'], typeof node.field === 'string' && bounds.length >= 1 &&
        bounds.every((b) => typeof node[b] === 'number'))
    }
    case 'and':
    case 'or': {
      const ok = Array.isArray(node.filters) && node.filters.length >= 1 && node.filters.length <= 64
      return worst(known(['type', 'filters'], ok), ...(ok ? node.filters.map((f) => filter_shape(f, depth + 1)) : []))
    }
    case 'not':
      return worst(known(['type', 'filter'], 'filter' in node), filter_shape(node.filter, depth + 1))
    default:
      return 'unknown'
  }
}

const grantee_shape = (g) => {
  if (!is_map(g) || typeof g.type !== 'string') return 'malformed'
  if (g.type === 'key') return !is_pubkey(g.key) ? 'malformed' : extra_fields(g, ['type', 'key']) ? 'unknown' : 'ok'
  if (g.type === 'key_set') {
    const ok = Array.isArray(g.keys) && g.keys.length >= 1 && g.keys.length <= 256 && g.keys.every(is_pubkey)
    return !ok ? 'malformed' : extra_fields(g, ['type', 'keys']) ? 'unknown' : 'ok'
  }
  return 'unknown'
}

const condition_shape = (c) => {
  if (!is_map(c) || typeof c.type !== 'string') return 'malformed'
  if (c.type === 'expires_at') return !is_uint(c.at) ? 'malformed' : extra_fields(c, ['type', 'at']) ? 'unknown' : 'ok'
  return 'unknown'
}

const CAPABILITY_FIELDS = ['type', 'v', 'timestamp', 'grantee', 'actions', 'filter', 'conditions']
const capability_shape = (r) => {
  const conditions = r.conditions ?? []
  const base = r.v === 1 && is_uint(r.timestamp) && Array.isArray(r.actions) && r.actions.length >= 1 &&
    r.actions.length <= 16 && r.actions.every((a) => typeof a === 'string') && Array.isArray(conditions) &&
    conditions.length <= 16
  if (!base) return 'malformed'
  return worst(extra_fields(r, CAPABILITY_FIELDS) ? 'unknown' : 'ok', grantee_shape(r.grantee),
    r.filter === undefined ? 'ok' : filter_shape(r.filter), ...conditions.map(condition_shape))
}
const revocation_shape = (r) =>
  r.v === 1 && is_uint(r.timestamp) && typeof r.revokes === 'string' && !extra_fields(r, ['type', 'v', 'timestamp', 'revokes'])
    ? 'ok'
    : 'malformed'

// A record of a type this version defines must be well formed, with its derived key (§3.5.5).
const record_malformed = (payload) => {
  const { value } = payload
  if (!is_map(value) || !['capability', 'revocation'].includes(value.type)) return false
  if (payload.key !== sha256_hex(encode(value))) return true
  return (value.type === 'capability' ? capability_shape(value) : revocation_shape(value)) === 'malformed'
}

// --- Evaluation ---

const resolve = (subject, path) =>
  path.split('.').reduce((cur, step) => (is_map(cur) && step in cur ? cur[step] : undefined), subject)
const holds_value = (resolved, v) =>
  Array.isArray(resolved) ? resolved.some((x) => typeof x === typeof v && x === v) : resolved !== undefined && typeof resolved === typeof v && resolved === v
const evaluate = (node, subject) => {
  switch (node.type) {
    case 'match': return Object.entries(node.fields).every(([path, v]) => holds_value(resolve(subject, path), v))
    case 'any_of': return node.values.some((v) => holds_value(resolve(subject, node.field), v))
    case 'range': {
      const x = resolve(subject, node.field)
      return typeof x === 'number' && (!('gte' in node) || x >= node.gte) && (!('gt' in node) || x > node.gt) &&
        (!('lte' in node) || x <= node.lte) && (!('lt' in node) || x < node.lt)
    }
    case 'and': return node.filters.every((f) => evaluate(f, subject))
    case 'or': return node.filters.some((f) => evaluate(f, subject))
    case 'not': return !evaluate(node.filter, subject)
  }
}
const filter_matches = (filter, subject) => filter === undefined || (filter_shape(filter) === 'ok' && evaluate(filter, subject))
const grantee_matches = (g, key) =>
  grantee_shape(g) === 'ok' && (g.type === 'key' ? g.key === key : g.keys.includes(key))
const conditions_hold = (conditions = [], timestamp) =>
  conditions.every((c) => condition_shape(c) === 'ok' && timestamp <= c.at)

// --- Causal structure ---

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
const multihash = (h) => CID.parse(h, base58btc).multihash.bytes
const compare_bytes = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}
const value_timestamp = (e) => e.payload.value?.timestamp ?? 0
// §4.4.2: clock.time DESC, timestamp DESC, entry.hash bytes ASC.
const current_first = (a, b) =>
  entries.get(b).clock.time - entries.get(a).clock.time ||
  value_timestamp(entries.get(b)) - value_timestamp(entries.get(a)) ||
  compare_bytes(multihash(a), multihash(b))

// §3.5.6 base entry: §4.4.2 over the causal past, inertness ignored, DEL included.
const base_entry = (hash, id) => {
  const candidates = [...causal_past(hash)].filter((h) => {
    const { payload } = entries.get(h)
    return payload.key === id && (payload.op === 'DEL' ? payload.value.type === 'track' : payload.value?.type === 'track')
  })
  return candidates.sort(current_first)[0]
}

const covering_actions = (hash) => {
  const { payload } = entries.get(hash)
  const { value } = payload
  if (payload.op !== 'PUT' || !is_map(value)) return []
  switch (value.type) {
    case 'track': {
      const actions = ['library.append_track']
      const base = base_entry(hash, value.id)
      const prior = base && entries.get(base).payload
      if (prior && prior.op === 'PUT' && prior.value.content === value.content &&
        (prior.value.tags ?? []).every((t) => (value.tags ?? []).includes(t))) actions.push('library.append_tag')
      return actions
    }
    case 'about': return ['library.update_about']
    case 'capability': return ['library.grant_capability']
    default: return []
  }
}
const filter_subject = (value) => (value.type === 'track' ? { ...value, tags: value.tags ?? [] } : value)

const chain_of = (hash) => {
  const entry = entries.get(hash)
  return is_owner(entry.key) ? [hash] : [hash, ...chain_of(entry.payload.capability_id)]
}

// --- Verification (§4.2, §3.5.4, §3.5.9, §3.5.10) ---

const verify = (hash) => {
  const entry = entries.get(hash)
  const { payload } = entry
  const expected_time = entry.next.length ? Math.max(...entry.next.map((h) => entries.get(h).clock.time)) + 1 : 1
  if (entry.clock.time !== expected_time) return 'clock'
  if (entry.next.length > 256 || entry.refs.length > 256) return 'fan-out'
  const library_type = LIBRARY_TYPE.get(entry.id)
  if ('capability_id' in payload && library_type !== 'recordstore') return 'capability_id outside recordstore'
  if (record_malformed(payload)) return 'malformed'
  if (is_owner(entry.key)) return null
  if (library_type !== 'recordstore') return 'not in write list'
  if (payload.op !== 'PUT' || typeof payload.capability_id !== 'string') return 'no capability_id'
  const past = causal_past(hash)
  const c1 = entries.get(payload.capability_id)
  if (!c1 || c1.payload.value?.type !== 'capability' || !past.has(payload.capability_id)) return 'capability not in causal past'
  if (!grantee_matches(c1.payload.value.grantee, entry.key)) return 'grantee mismatch'
  const chain = chain_of(payload.capability_id)
  if (chain.length > 8) return 'chain too long'
  // Step 6: the effective set computed over the causal past alone.
  if (effective_revocations(past).some((r) => chain.includes(entries.get(r).payload.value.revokes))) {
    return 'revoked in causal past'
  }
  if (payload.value.type === 'revocation') {
    const target = payload.value.revokes
    const in_scope = past.has(target) && entries.get(target).payload.value?.type === 'capability' &&
      chain_of(target).some((h) => entries.get(h).key === entry.key)
    return in_scope ? null : 'revocation out of scope'
  }
  const actions = covering_actions(hash)
  for (const [i, c] of chain.entries()) {
    const cap = entries.get(c).payload.value
    const up = i === 0 ? '' : ' up the chain'
    if (capability_shape(cap) === 'unknown' && extra_fields(cap, CAPABILITY_FIELDS)) return 'fails closed'
    if (!cap.actions.some((a) => actions.includes(a))) return 'action not granted' + up
    if (['track', 'about'].includes(payload.value.type) && !filter_matches(cap.filter, filter_subject(payload.value))) {
      return 'filter fails' + up
    }
    if (!conditions_hold(cap.conditions, payload.value.timestamp)) return 'condition fails' + up
  }
  return null
}

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

// §3.5.10: self-reference, inertness, and the effective revocation set.
const is_revocation = (h) => entries.get(h).payload.value?.type === 'revocation'
const self_referential = (h) =>
  is_revocation(h) && !is_owner(entries.get(h).key) && chain_of(entries.get(h).payload.capability_id).includes(entries.get(h).payload.value.revokes)
// The general rule, for writes and capability records; a revocation's
// effect is decided only by effective_revocations.
const is_inert = (hash, effective) => {
  const entry = entries.get(hash)
  if (is_owner(entry.key)) return false
  return chain_of(entry.payload.capability_id).some((c) =>
    effective.some((r) => entries.get(r).payload.value.revokes === c && !causal_past(r).has(hash)))
}
const effective_revocations = (accepted) => {
  const revocations = [...accepted].filter((h) => LIBRARY_TYPE.get(entries.get(h).id) === 'recordstore' && is_revocation(h))
  const effective = revocations.filter((h) => is_owner(entries.get(h).key))
  const delegated = revocations.filter((h) => !is_owner(entries.get(h).key)).sort((a, b) =>
    entries.get(a).clock.time - entries.get(b).clock.time ||
    value_timestamp(entries.get(a)) - value_timestamp(entries.get(b)) ||
    compare_bytes(multihash(a), multihash(b)))
  for (const r of delegated) if (!self_referential(r) && !is_inert(r, effective)) effective.push(r)
  return effective
}

// --- The vector ---

const expected = new Map()
const expect = (hash, verdict) => expected.set(hash, verdict)

// Capability C and its revocation.
const C = append('C: k=2 may append tracks tagged friends-mix until an expiry', {
  k: 1,
  value: capability({
    timestamp: T0,
    ...grant(K2, ['library.append_track']),
    filter: { type: 'match', fields: { tags: 'friends-mix' } },
    conditions: [{ type: 'expires_at', at: EXPIRES_AT }]
  })
})
expect(C, 'accept')
const W = append('W: k=2 write under C', { k: 2, next: [C], key: TRACK_A, capability_id: C, value: track(TRACK_A, T0 + 1000, ['friends-mix']) })
expect(W, 'accept')
const R = append('R: owner revokes C, having seen W', { k: 1, next: [W], value: revocation(T0 + 2000, C) })
expect(R, 'accept')
expect(append('k=2 write under C, concurrent with R', {
  k: 2, next: [W], key: TRACK_B, capability_id: C, value: track(TRACK_B, T0 + 2500, ['friends-mix'])
}), 'accept, inert')
expect(append('k=2 write under C with R in its causal past', {
  k: 2, next: [R], key: TRACK_B, capability_id: C, value: track(TRACK_B, T0 + 3000, ['friends-mix'])
}), 'reject: revoked in causal past')

// One reject per check.
const under_c = (label, k, value, extra = {}) =>
  append(label, { k, next: [C], key: value.id, capability_id: C, value, ...extra })
expect(under_c('write under C signed by k=3', 3, track(TRACK_B, T0 + 1000, ['friends-mix'])), 'reject: grantee mismatch')
expect(under_c('write under C tagged other', 2, track(TRACK_B, T0 + 1000, ['other'])), 'reject: filter fails')
expect(under_c('write under C after the expiry', 2, track(TRACK_B, EXPIRES_AT + 1, ['friends-mix'])), 'reject: condition fails')
expect(under_c('About PUT under C', 2, about(T0 + 1000)), 'reject: action not granted')
expect(under_c('write under C with a forged clock.time', 2, track(TRACK_B, T0 + 1000, ['friends-mix']), { time: 9 }), 'reject: clock')
expect(append('write citing C with C outside its causal past', {
  k: 2, key: TRACK_B, capability_id: C, value: track(TRACK_B, T0 + 1000, ['friends-mix'])
}), 'reject: capability not in causal past')
expect(append('write by k=2 with no capability_id', {
  k: 2, next: [C], key: TRACK_B, value: track(TRACK_B, T0 + 1000, ['friends-mix'])
}), 'reject: no capability_id')

// Shapes and fail-closed types.
expect(append('owner capability with no actions (malformed)', {
  k: 1, value: capability({ timestamp: T0 + 1, ...grant(K2, []) })
}), 'reject: malformed')
const fail_closed = (label, fields, timestamp) => {
  const cap = append(label, { k: 1, value: capability({ timestamp, ...fields }) })
  expect(cap, 'accept')
  return cap
}
const U = fail_closed('owner capability, filter not over an unknown node', {
  ...grant(K2, ['library.append_track']), filter: { type: 'not', filter: { type: 'regex', field: 'tags', pattern: '^x' } }
}, T0 + 10)
expect(append('write under the unknown-filter capability', {
  k: 2, next: [U], key: TRACK_B, capability_id: U, value: track(TRACK_B, T0 + 1000, ['friends-mix'])
}), 'reject: filter fails')
const UG = fail_closed('owner capability with an unknown grantee type', {
  grantee: { type: 'group', name: 'friends' }, actions: ['library.append_track']
}, T0 + 11)
expect(append('write under the unknown-grantee capability', {
  k: 2, next: [UG], key: TRACK_B, capability_id: UG, value: track(TRACK_B, T0 + 1000, [])
}), 'reject: grantee mismatch')
const UC = fail_closed('owner capability with an unknown condition type', {
  ...grant(K2, ['library.append_track']), conditions: [{ type: 'before_block', height: 1 }]
}, T0 + 12)
expect(append('write under the unknown-condition capability', {
  k: 2, next: [UC], key: TRACK_B, capability_id: UC, value: track(TRACK_B, T0 + 1000, [])
}), 'reject: condition fails')
expect(append('owner track PUT carrying capability_id (ignored)', {
  k: 1, next: [C], key: TRACK_B, capability_id: C, value: track(TRACK_B, T0 + 1000, [])
}), 'accept')
expect(append('listen by k=2 carrying capability_id, listens library', {
  k: 2, library: LISTENS, payload: { trackId: TRACK_A, address: LIBRARY, timestamp: T0 }, capability_id: C
}), 'reject: capability_id outside recordstore')
expect(append('owner link PUT carrying capability_id, identity library', {
  k: 1, library: IDENTITY, key: sha256_hex(LIBRARY), capability_id: C,
  value: { type: 'link', v: 1, timestamp: T0, address: LIBRARY }
}), 'reject: capability_id outside recordstore')

// append_tag against a base entry.
const T = fail_closed('T: owner grants k=2 append_tag', grant(K2, ['library.append_tag']), T0 + 20)
const TB = append('owner track PUT tagged a (base entry)', { k: 1, next: [T], key: TRACK_T, value: track(TRACK_T, T0 + 21, ['a']) })
expect(TB, 'accept')
expect(append('k=2 adds tag b under T', {
  k: 2, next: [TB], key: TRACK_T, capability_id: T, value: track(TRACK_T, T0 + 22, ['a', 'b'])
}), 'accept')
expect(append('k=2 drops tag a under T', {
  k: 2, next: [TB], key: TRACK_T, capability_id: T, value: track(TRACK_T, T0 + 23, ['b'])
}), 'reject: action not granted')
const TD = append('owner DEL of the base track', { k: 1, next: [TB], op: 'DEL', key: TRACK_T, value: { type: 'track', timestamp: T0 + 24 } })
expect(TD, 'accept')
expect(append('k=2 adds a tag after the DEL under T', {
  k: 2, next: [TD], key: TRACK_T, capability_id: T, value: track(TRACK_T, T0 + 25, ['a', 'b'])
}), 'reject: action not granted')

// Delegation.
const D = fail_closed('D: owner grants k=2 grant and append', grant(K2, ['library.grant_capability', 'library.append_track']), T0 + 30)
const D1 = append('D1: k=2 grants k=3 append_track under D', {
  k: 2, next: [D], capability_id: D,
  value: capability({ timestamp: T0 + 31, grantee: { type: 'key_set', keys: [K3] }, actions: ['library.append_track'] })
})
expect(D1, 'accept')
const DW = append('k=3 write under D1', { k: 3, next: [D1], key: TRACK_B, capability_id: D1, value: track(TRACK_B, T0 + 32, []) })
expect(DW, 'accept')
const D2 = append('D2: k=2 grants k=3 update_about under D', {
  k: 2, next: [D], capability_id: D, value: capability({ timestamp: T0 + 33, ...grant(K3, ['library.update_about']) })
})
expect(D2, 'accept')
expect(append('k=3 About PUT under D2, which D does not cover', {
  k: 3, next: [D2], key: sha256_hex(LIBRARY), capability_id: D2, value: about(T0 + 34)
}), 'reject: action not granted up the chain')
const DR = append('DR: k=2 revokes D1, which it issued', { k: 2, next: [DW], capability_id: D, value: revocation(T0 + 35, D1) })
expect(DR, 'accept')
expect(append('k=3 write under D1 with DR in its causal past', {
  k: 3, next: [DR], key: TRACK_B, capability_id: D1, value: track(TRACK_B, T0 + 36, [])
}), 'reject: revoked in causal past')
expect(append('k=3 write under D1 concurrent with DR', {
  k: 3, next: [DW], key: TRACK_B, capability_id: D1, value: track(TRACK_B, T0 + 38, [])
}), 'accept, inert')
expect(append('k=3 revokes D2, which it did not issue', {
  k: 3, next: [D1, D2], capability_id: D1, value: revocation(T0 + 37, D2)
}), 'reject: revocation out of scope')

const F = fail_closed('F: owner grants k=2 grant and append, tagged friends-mix', {
  ...grant(K2, ['library.grant_capability', 'library.append_track']), filter: { type: 'match', fields: { tags: 'friends-mix' } }
}, T0 + 40)
const F1 = append('F1: k=2 grants k=3 append_track under the filtered F', {
  k: 2, next: [F], capability_id: F, value: capability({ timestamp: T0 + 41, ...grant(K3, ['library.append_track']) })
})
expect(F1, 'accept')
expect(append('k=3 write tagged friends-mix under F1', {
  k: 3, next: [F1], key: TRACK_B, capability_id: F1, value: track(TRACK_B, T0 + 42, ['friends-mix'])
}), 'accept')
expect(append('k=3 write tagged other under F1', {
  k: 3, next: [F1], key: TRACK_B, capability_id: F1, value: track(TRACK_B, T0 + 43, ['other'])
}), 'reject: filter fails up the chain')

const E = fail_closed('E: owner grants k=2 grant and append', grant(K2, ['library.grant_capability', 'library.append_track']), T0 + 50)
const E1 = append('E1: k=2 grants k=3 append_track under E', {
  k: 2, next: [E], capability_id: E, value: capability({ timestamp: T0 + 51, ...grant(K3, ['library.append_track']) })
})
expect(E1, 'accept')
const RE = append('owner revokes E, the parent of E1', { k: 1, next: [E1], value: revocation(T0 + 52, E) })
expect(RE, 'accept')
expect(append('k=3 write under E1 after its parent is revoked', {
  k: 3, next: [RE], key: TRACK_B, capability_id: E1, value: track(TRACK_B, T0 + 53, [])
}), 'reject: revoked in causal past')

let G = fail_closed('G1: owner grants k=2 grant and append', grant(K2, ['library.grant_capability', 'library.append_track']), T0 + 60)
for (let i = 2; i <= 9; i++) {
  G = append(`G${i}: k=2 regrants to itself under G${i - 1}`, {
    k: 2, next: [G], capability_id: G,
    value: capability({ timestamp: T0 + 60 + i, ...grant(K2, ['library.grant_capability', 'library.append_track']) })
  })
  expect(G, 'accept')
}
expect(append('k=2 write under G9, a chain of 9', {
  k: 2, next: [G], key: TRACK_B, capability_id: G, value: track(TRACK_B, T0 + 70, [])
}), 'reject: chain too long')

const S1 = fail_closed('S1: owner grants k=2 grant and append', grant(K2, ['library.grant_capability', 'library.append_track']), T0 + 80)
const S2 = append('S2: k=2 grants itself append_track under S1', {
  k: 2, next: [S1], capability_id: S1, value: capability({ timestamp: T0 + 81, ...grant(K2, ['library.append_track']) })
})
expect(S2, 'accept')
const RS = append('k=2 revokes S2 citing S2 (self-reference)', { k: 2, next: [S2], capability_id: S2, value: revocation(T0 + 82, S2) })
expect(RS, 'accept, inert')
expect(append('k=2 write under S2 after the inert self-revocation', {
  k: 2, next: [RS], key: TRACK_B, capability_id: S2, value: track(TRACK_B, T0 + 83, [])
}), 'accept')

// Two interacting delegated revocations. k=2 holds H1 from the owner and
// issues H2 to k=3; k=3 issues E to k=4. RA (k=3 revokes E, citing H2)
// and RB (k=2 revokes H2) are concurrent, and RA has the lower clock.
// Step 2 makes RA effective first; RB withdraws H2 afterwards but does
// not undo RA. Y, a write under E in RB's past but not RA's, is inert
// only because RA is effective.
const H1 = fail_closed('H1: owner grants k=2 grant and append', grant(K2, ['library.grant_capability', 'library.append_track']), T0 + 90)
const H2 = append('H2: k=2 grants k=3 grant and append under H1', {
  k: 2, next: [H1], capability_id: H1, value: capability({ timestamp: T0 + 91, ...grant(K3, ['library.grant_capability', 'library.append_track']) })
})
expect(H2, 'accept')
const HE = append('E: k=3 grants k=4 append_track under H2', {
  k: 3, next: [H2], capability_id: H2, value: capability({ timestamp: T0 + 92, ...grant(K4, ['library.append_track']) })
})
expect(HE, 'accept')
const RA = append('RA: k=3 revokes E citing H2 (clock 4)', { k: 3, next: [HE], capability_id: H2, value: revocation(T0 + 93, HE) })
expect(RA, 'accept')
const HY = append('Y: k=4 write under E, concurrent with RA', {
  k: 4, next: [HE], key: TRACK_B, capability_id: HE, value: track(TRACK_B, T0 + 94, [])
})
expect(HY, 'accept, inert')
const HW = append('k=2 write under H1', { k: 2, next: [HE], key: TRACK_A, capability_id: H1, value: track(TRACK_A, T0 + 95, []) })
expect(HW, 'accept')
const RB = append('RB: k=2 revokes H2 (clock 5), concurrent with RA', {
  k: 2, next: [HW, HY], capability_id: H1, value: revocation(T0 + 96, H2)
})
expect(RB, 'accept')

// Head fan-out (§4.2, §5.4.2 item 2).
const SP = fail_closed('SP: owner grants k=2 append_track', grant(K2, ['library.append_track']), T0 + 100)
const spam = []
for (let i = 0; i < 257; i++) {
  const id = sha256_hex(`spam-${i}`)
  spam.push(append(`spam ${i}`, { k: 2, next: [SP], key: id, capability_id: SP, value: track(id, T0 + 101 + i, []) }))
}
for (const h of spam) expect(h, 'accept')
const by_hash = [...spam].sort()
const O1 = append('owner append citing 256 of 257 heads', {
  k: 1, next: by_hash.slice(0, 256), key: sha256_hex('owner-1'), value: track(sha256_hex('owner-1'), T0 + 400, [])
})
expect(O1, 'accept')
const O2 = append('owner append citing the last spam head and O1', {
  k: 1, next: [by_hash[256], O1], key: sha256_hex('owner-2'), value: track(sha256_hex('owner-2'), T0 + 401, [])
})
expect(O2, 'accept')
expect(append('owner append citing all 257 heads', {
  k: 1, next: by_hash, key: sha256_hex('owner-3'), value: track(sha256_hex('owner-3'), T0 + 402, [])
}), 'reject: fan-out')

// --- Verdicts ---

const { accepted, verdicts } = merge_all()
const effective = effective_revocations(accepted)
const verdict = (h) => {
  if (verdicts.get(h) !== null) return 'reject: ' + verdicts.get(h)
  const no_effect = is_revocation(h) && !is_owner(entries.get(h).key) ? !effective.includes(h) : is_inert(h, effective)
  return no_effect ? 'accept, inert' : 'accept'
}

console.log('=== §3.5.5 – §3.5.10 Capability Vector ===\n')
console.log('Library (F3, owner k=1): ' + LIBRARY)
console.log('k=2: ' + K2)
console.log('k=3: ' + K3)
console.log('\nCapability id of C: ' + C)
console.log('W (write under C):  ' + W)
console.log('R (revokes C):      ' + R)
console.log('Signed dag-cbor bytes: C ' + encode(entries.get(C)).length + ', W ' + encode(entries.get(W)).length +
  ', R ' + encode(entries.get(R)).length)

console.log('\nVerdicts:')
let all_pass = true
let spam_ok = 0
for (const [hash, want] of expected) {
  const got = verdict(hash)
  const ok = got === want
  if (!ok) all_pass = false
  if (ok && label_of.get(hash).startsWith('spam ')) { spam_ok++; continue }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${label_of.get(hash)} -> ${got}${ok ? '' : ` (expected ${want})`}`)
}
console.log(`  PASS: ${spam_ok} grantee spam entries -> accept`)
const extra = [
  ['every entry has an expected verdict', expected.size === entries.size],
  ['effective revocations are R, RE, DR, RA, and RB', effective.length === 5 && [R, RE, DR, RA, RB].every((h) => effective.includes(h))],
  ['RA is effective though the general inertness rule would make it inert', !causal_past(RB).has(RA) && entries.get(RB).payload.value.revokes === H2 && chain_of(H2).includes(H2)],
  ['fan-out branch converges to one head after O2', (() => {
    const branch = [...accepted].filter((h) => h === SP || causal_past(h).has(SP))
    const cited = new Set(branch.flatMap((h) => entries.get(h).next))
    const heads = branch.filter((h) => !cited.has(h))
    return heads.length === 1 && heads[0] === O2
  })()]
]
for (const [label, ok] of extra) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + ': ' + label)
  if (!ok) all_pass = false
}
console.log(`\n${expected.size} cases. Overall:`, all_pass ? 'PASS' : 'FAIL')
if (!all_pass) process.exit(1)
