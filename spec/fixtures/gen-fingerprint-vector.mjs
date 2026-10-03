/**
 * Generate the degenerate-fingerprint vector for spec §6.1.6.
 *
 * Covers wire-format claim sections: §6.1.6, §6.4.1 step 1.
 *
 * Decodes Chromaprint compressed fingerprint strings into their 32-bit
 * subfingerprint values and classifies each as degenerate or not:
 *   1. the §6.1.5 F7 sine fingerprint (19 equal non-zero values) — not
 *      degenerate, so the published track id stays valid
 *   2. an all-zero fingerprint, as a silent fingerprinting window yields
 *   3. the threshold pair: 1 non-zero value in 20 (not degenerate) and
 *      1 in 21 (degenerate)
 *
 * Fingerprints 2 and 3 are built by this file's encoder, the inverse of
 * the decoder; the script checks the encoder reproduces the F7 string
 * byte for byte before trusting it. Pure JavaScript; no fpcalc needed.
 */

import { createHash } from 'node:crypto'

// Chromaprint compressed format: URL-safe base64 without padding of
// [algorithm byte][24-bit big-endian count][3-bit normal bits][5-bit exceptions].
// Each value is XORed with its predecessor; the set-bit positions of the XOR
// are written as deltas, 0 ends a value, and a delta of 7 or more writes 7
// to the normal bits and the remainder to the exceptions.
const from_base64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const to_base64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const decode_fingerprint = (fingerprint) => {
  const bytes = from_base64url(fingerprint)
  if (bytes.length < 4) throw new Error('fingerprint shorter than its header')
  const algorithm = bytes[0]
  const count = (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]
  const body = bytes.subarray(4)
  const bit = (i) => (body[i >> 3] >> (i & 7)) & 1
  const read = (pos, width) => {
    let v = 0
    for (let k = 0; k < width; k++) v |= bit(pos + k) << k
    return v
  }
  const normal = []
  let pos = 0
  let ends = 0
  while (ends < count) {
    if (pos + 3 > body.length * 8) throw new Error('truncated normal bits')
    const v = read(pos, 3)
    pos += 3
    normal.push(v)
    if (v === 0) ends++
  }
  let exception_pos = Math.ceil(pos / 8) * 8
  const values = []
  let previous = 0
  let xor = 0
  let last_bit = 0
  for (let v of normal) {
    if (v === 7) {
      v += read(exception_pos, 5)
      exception_pos += 5
    }
    if (v === 0) {
      previous = (previous ^ xor) >>> 0
      values.push(previous)
      xor = 0
      last_bit = 0
    } else {
      last_bit += v
      xor = (xor | (1 << (last_bit - 1))) >>> 0
    }
  }
  return { algorithm, values }
}

const encode_fingerprint = (values, algorithm = 1) => {
  const normal = []
  const exceptions = []
  let previous = 0
  for (const value of values) {
    let xor = (value ^ previous) >>> 0
    let position = 1
    let last_bit = 0
    while (xor) {
      if (xor & 1) {
        const delta = position - last_bit
        if (delta >= 7) {
          normal.push(7)
          exceptions.push(delta - 7)
        } else normal.push(delta)
        last_bit = position
      }
      xor >>>= 1
      position++
    }
    normal.push(0)
    previous = value
  }
  const pack = (items, width) => {
    const out = Buffer.alloc(Math.ceil((items.length * width) / 8))
    let p = 0
    for (const item of items) for (let k = 0; k < width; k++, p++) if ((item >> k) & 1) out[p >> 3] |= 1 << (p & 7)
    return out
  }
  const n = values.length
  const header = Buffer.from([algorithm, (n >> 16) & 255, (n >> 8) & 255, n & 255])
  return to_base64url(Buffer.concat([header, pack(normal, 3), pack(exceptions, 5)]))
}

// §6.1.6
const is_degenerate = (values) => values.length === 0 || 20 * values.filter((v) => v !== 0).length < values.length

const sha256_hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

const F7_FINGERPRINT = 'AQAAE0mUaEkSZSoAAAAAAAAA'
const F7_TRACK_ID = '20599ccf9f5efb8cc1d6e2ae464471f6f8fab82066a42579b07024d7673b1005'
const one_in = (n) => [558758263, ...Array(n - 1).fill(0)]

const cases = [
  { label: '§6.1.5 F7 sine (19 equal non-zero values)', fingerprint: F7_FINGERPRINT, expected: false },
  { label: 'all zero, 1000 values', fingerprint: encode_fingerprint(Array(1000).fill(0)), expected: true },
  { label: '1 non-zero value in 20', fingerprint: encode_fingerprint(one_in(20)), expected: false },
  { label: '1 non-zero value in 21', fingerprint: encode_fingerprint(one_in(21)), expected: true }
]

console.log('=== §6.1.6 Degenerate Fingerprint Vector ===\n')
let all_pass = true
const check = (label, ok) => {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + ': ' + label)
  if (!ok) all_pass = false
}

const f7 = decode_fingerprint(F7_FINGERPRINT)
console.log('F7 decodes to algorithm byte ' + f7.algorithm + ', ' + f7.values.length + ' values, first ' + f7.values[0])
check('encoder reproduces the F7 string from its decoded values', encode_fingerprint(f7.values, f7.algorithm) === F7_FINGERPRINT)
check('F7 track id is unchanged (§6.1.5)', sha256_hex(F7_FINGERPRINT) === F7_TRACK_ID)

console.log('\nClassification:')
for (const c of cases) {
  const { values } = decode_fingerprint(c.fingerprint)
  const nonzero = values.filter((v) => v !== 0).length
  const got = is_degenerate(values)
  console.log(`  ${c.label}`)
  console.log(`    fingerprint: ${c.fingerprint.length > 48 ? c.fingerprint.slice(0, 48) + '... (' + c.fingerprint.length + ' chars)' : c.fingerprint}`)
  console.log(`    values ${values.length}, non-zero ${nonzero}, degenerate ${got}`)
  console.log(`    track_id ${sha256_hex(c.fingerprint)}`)
  check(`${c.label} is ${c.expected ? '' : 'not '}degenerate`, got === c.expected)
  check(`${c.label} round-trips through the encoder`, encode_fingerprint(values) === c.fingerprint)
}

console.log('\nOverall:', all_pass ? 'PASS' : 'FAIL')
if (!all_pass) process.exit(1)
