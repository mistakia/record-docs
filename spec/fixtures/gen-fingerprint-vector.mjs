/**
 * Generate the degenerate-fingerprint vector for spec §6.1.6.
 *
 * Covers wire-format claim sections: §6.1.6, §6.4.1 step 1.
 *
 * Decodes Chromaprint compressed fingerprint strings into their 32-bit
 * subfingerprint values and classifies each as degenerate or not, by the
 * share of positions holding the most common value:
 *   1. the silence fingerprint: what fpcalc -json -algorithm 2 emits for a
 *      silent first 120 s; 172 files of the canonical library share it
 *      (track id b8702767...) — degenerate, a reject case
 *   2. the v1.0 §6.1.5 sine — also degenerate: a steady tone fingerprints
 *      to one repeated value, like silence; v1.1 replaced it
 *   2b. the v1.1 §6.1.5 chirp — not degenerate
 *   3. a commercial demo track (Pioneer DJ "Demo Track 1", bundled with
 *      rekordbox), fingerprinted with fpcalc 1.6.1 — not degenerate
 *   4. the threshold pair: 19 of 20 values equal (degenerate) and 18 of
 *      20 (not)
 *
 * Fingerprints 1 to 3 and 2b are literal fpcalc output; the pair is built by this
 * file's encoder, the inverse of the decoder, which the script first
 * checks against the literal strings. Pure JavaScript; no fpcalc needed.
 */

import { createHash } from 'node:crypto'

// Chromaprint compressed format: URL-safe base64 without padding of
// [algorithm byte][24-bit big-endian count][3-bit normal bits][5-bit exceptions].
// Each value is XORed with its predecessor; the set-bit positions of the XOR
// are written as deltas, 0 ends a value, and a delta of 7 or more writes 7
// to the normal bits and the remainder to the exceptions.
const from_base64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const to_base64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const decode_fingerprint = (fingerprint) => {
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

// §6.1.6: degenerate when empty, or when the most common value fills at
// least 19 in 20 positions.
const mode_count = (values) => {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return Math.max(0, ...counts.values())
}
const is_degenerate = (values) => values.length === 0 || 20 * mode_count(values) >= 19 * values.length

const sha256_hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

const F7_FINGERPRINT = 'AQAAE0mUaEkSZSoAAAAAAAAA'
const F7_TRACK_ID = '20599ccf9f5efb8cc1d6e2ae464471f6f8fab82066a42579b07024d7673b1005'
const CHIRP_FINGERPRINT =
  'AQAAO9HSRskFaTmP8EezzAze486RpyfSE7ObBPc0_DixJ9QkDfWNRM-Rf_jx46mO_kj6Bcdd7McTQvuRPjLKHKc_JD-iF19jXMV_MFHiwPlxRMqN48Fz42eO5Sc2Pxl-4eGPq4uR20JDyzjc-NjvoHkWMN-ywyfGD-mPZN7RPwBAjAUEIWIINgJwoSQilCgPmBDMeSMAEo4yQhQjUBIiBFRUVAKIAMAwgAAwSKAgBCKAAUIBIAA'
const CHIRP_TRACK_ID = '13f92b74d4d33accd2424b87914fbc6d087b7557fb2166330756bdcddcd8b6db'
const SILENCE_FINGERPRINT =
  'AQADtEmUaEkSRZEGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const SILENCE_TRACK_ID = 'b8702767c27bedd78aad13742796018136471b82d99e931db8304472c3a69304'
const MUSIC_FINGERPRINT =
  'AQADtEkySYkSJVKU4EXzo8dDo2-H5sWZg-Xxo-HQP8LDDu0LfyaOh8WP5vnwXOhb-Bk-NviDi_Bz9MdDo9YJV_lwnMWPxsmH53iWDu3gZ0Zf42gHLYdO40fzoGco9DlM9Mcp9Id541nRp0Z_mPzQp_iOeoP1HB-NHzZaPsONPlEMSzv6zDiFH-3ROB-uhMbpoTn6LCX-BGioHF0_PFkaoROaZ3iZ4EeLxvlwpcYzE82PPiweoOGO_vhCozf8zOhL4TRaDs0_XBRaHj7e7NBeotdhfkFnWbhYQjtMHj3DBD9aNIfeQfaF7kbzpcFJo0d69Dny7OhzaHlxzxGe4Rxs8XgCPZnR6WieGa_xo0Xz42GDEw2PPsRzDX0Okx_6FO2ODz5OCz8MrdIz3EYPS2mgbxf6oj8aSscb4Tw6ZjmaZ3iLP2jRHGc-nAkboT2aZ8Zr_EF4hPHx1MLzDM2HPjTeDC2HxiK-BLKUzOjRPPNwxviDhhx6sdArXEo-NCf6sHjwo-GO_gseGm0aD65oInxo_EFjoQ9D5EefHL6HPuzwJgJMFc8yXHMErTMaNTNeC2eDljsaix0u6MmMRtrRz3iNHw2H_nhC4zQajujD4k9wNNzR46TRw2eJnkYfmDx6sbiOfjEsRTRq5cKLBn2OX_jEoNHRR3jaCP_QohmPq8WZXegPc3lwHb8AP0XPQ3vgF-GP92gvNCuRJ_iUCRp5ImUU-OiPM-jnIf2F10M_FQ-NH41E9Do-Gy-aG6divMd5fCELH28M8cePC_9goeWJN9CFWvRgLmtwHYeNvkUfWfjho9dxG9_R_CiPj8YfDw2HK2twDj8MvYP25OhfND8E7Yd59Cx-9DTM0ehz4UVj9B-eo6MZ-Eef4zX6B6Z09GKHH12kfEi54cqDH7-QHi_67NAeUmg-_HiOlkOzsvgFXVE8NOODNsrQwz764g-6zoFt9BHe4g_Cohnx4wodlLJhaZGR58I_lIe2w1eO8HrQG81xdBrRrAwe5MpUaMszmFF05Dx89OizFHYu5Df6Fk8IHX0Okx_0HR9hHTmjNDCP63iOHI-hwy6LHj8ueIXO4Mpx6UPDsUGtHCW8HW-Lr4K_GBeeozf-oUUzCXmOMxbKH2aUB_nwDxqPPvAl5EmOc2h0I0fDC2XJQPeFMyXCqHPwKIP3Ix9jvIW_F7_w5tAT3PhhHu-HUD16CpexZ7iDoz_yomoOUc02aB9eoc_RkMR3_B9K2WhkQteDtxEatMIfvBnMIz-eB29h4sf-IORyTOEqyJaKkqwE-8JxG4_hf9C248HDwE5wvHqE_kOYsTgfhE89NLoh3Fk6NGeFsKqHHHoiI-fRpNGKKjpxfA7sRCV-RN8DLf8QntRQHdZTRI90vHHx4c0CURdaJTjePGh-tEPsPME7pMaDJ2SCJkfxfPiDHo0SCz-ORtmhlegdeAsv_AKeJthpQZmaoxdeoW_RkDiuo3mLdsMfPG0GUTiFL0_Qo-mhLzueB7nhpBPeEveC3kOYhzgF_WgeMkSf4Z-hu0HnD1puvMJzmMTH4v9QykYjQ5eLl4nQoMeXB3-Ghkd_I39wV4OzHT92HeEfTBkryKJUlK8EOxeO29iNfYYW7cWDN2icEC3-4dEjNDvCLg_y1EOjGxruLB16VkipegiLJzKSH1W3okl0XPgOX5WwK0f-QMv1ITypofphXUYeKSLW5vjwZhD1o1ViHPeD5j3a4c6DvEHq43jIoA-a4Pnwo0cjUcKP_-hYQ8tC_CjJSvB2AbewMw6UPR-6C6_QFw0X4HqE_kPzCeeDtxm0iKiFb3nQP2ha4Tl0hcadw07x6MT_CBqPMM-Ch7jRPEqsoD9yPoSOUGaKRmnk4IwmTMlL9EepBw2XH-fxS8h1HSLPIN8HslKOSzEyHZd0qGKWg85RMrvha3hiPBCPZomNkzGeC36Q70jaIa9y_KieHiH3QE-O8A_8FD6O5omTCOeFXEfy4_nx57iUwcnl48c1I38aiIuS4z9OhDnR_OB1_MajdUnQPB_sHmcG5RecZBH6YDwjwj-eo5l0lOFxFjEdaLxyNNSnIOvxJiuyZ_ChUuGJ82CY6IWfnXhU6MJxlBlTvDt-Be4O9cgXvDruGKctI1ceaMyP9HOOEz6ay8KZJxGOXEiuEJfxLTqqZ0OjH_-FFwk5psF14zv6I8zhHyylmPi5CE0nLzj8bAifUUgiNbDio3dCTHpINEepCw33HK9xRkIsmYIWnjlC7gNZKcelGFly1BRUdTlBH6WU3fA1PDEOPShl41mNZxaaB_UOtUP-HOdRvQi5PoWeHOEf-Cl8HM0TJxHOC9eRPBzyJcfj4ZEyOJeP5_hx-zCXU_gefEmC_jCaMZeQ502C5xB_5MiX4V-N9yl-482DLJQJLyt6NriP7hlubQi_I7mUK3hO3MPjwrmIdw-eKMeVH9R41JTxB_kFoVI-5A-epQp8xDz0BfmkH4-N05bxPciTI1k-B8eP_sKTJ8KPvEfyjBEAC5hlAhCCJBCGASGaUYAwI4BhRgEFEDNEPKOIQgwIUJUBQAhCiCUEMEAIAQYJghwRFjBhmVHGMCAYIUYBxowxDBEBijBGAcEEkQoJIABhSinBDJCGAGMVMEgIAoQ3whsJGDPAMQaEIoIQgBxyjghFCGBECGsIAYwZIIwAgDEikGKCCoodYIwAKAgQoBEiDBOMCCgAAYJaxRjxhhHGDECKCUZQs0YBQgVQRggLjDPMCsUMQwQgIBBSBAkgIFDCAC6IBYgRQJRgzABCCDKCEESQEoAS0YywCiEwhICKAGUMYA4RgKhCEhghEBBGEWeEEFYYZowRhAkiAIEECQoUQVYAQClgRDhCMBKOCMYMMwgZoighABhjwTcMKECBIIAI5QUhQCEoJEJKSKowM0I6QIxBwgHJCFNIEQaAEExQBRChRAECiBFAMEEYUcJYRzghihBAlSAUWQoMIkQAYZgTVirACCMAEUMIooIYUA0BwhgBCAAEKQDAM5AAgIQlBAhODRhEEWGVkowoRAQUCQGiqFGSCrAMcEIBIywQRBkJnAIUAiCAMQRRZRARQDBgBDNCAEYAIIAQYYQgCCIDKnEMEIEIEAwCwB0QQCEDiBAGIMSpIWAQQICgjjHLiFKWOEGABIQaQBhliggDjGBAIMCUoAAAAIgDkgIiBBLMMKCIIAAgYYgRCCiAFIACQAYII9hAACgwggFHCBKoIIGYAEoICIgEBFglhEIOOC4IYYQYIABDwCJEKECUKSGkEAQQyYCAzCECmEEeCYGAYIwI4ThBACXBoSCAAkCUUggxQgYxQCEhlFHKAMIMQEABIAWADBGGIQCAASSAIwQJVJBQDAjgoSCAOqIAUQYpRITgQgCDgBDGIaAIoAAQAAhBjgpBGADAISCAMQIyYQ0QgALChBLWMSMgQEowAA'
const SILENCE_VALUE = decode_fingerprint(SILENCE_FINGERPRINT).values[0]
const equal_of_20 = (k) => [...Array(k).fill(SILENCE_VALUE), ...Array.from({ length: 20 - k }, (_, i) => 0x10000 + i)]

const cases = [
  { label: 'silence (track id b8702767...)', fingerprint: SILENCE_FINGERPRINT, expected: true },
  { label: 'v1.0 §6.1.5 sine', fingerprint: F7_FINGERPRINT, expected: true },
  { label: 'v1.1 §6.1.5 chirp', fingerprint: CHIRP_FINGERPRINT, expected: false },
  { label: 'demo track (music)', fingerprint: MUSIC_FINGERPRINT, expected: false },
  { label: '19 of 20 values equal', fingerprint: encode_fingerprint(equal_of_20(19)), expected: true },
  { label: '18 of 20 values equal', fingerprint: encode_fingerprint(equal_of_20(18)), expected: false }
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
check('v1.0 sine track id is unchanged', sha256_hex(F7_FINGERPRINT) === F7_TRACK_ID)
check('chirp track id matches §6.1.5', sha256_hex(CHIRP_FINGERPRINT) === CHIRP_TRACK_ID)
check('silence fingerprint hashes to track id b8702767...', sha256_hex(SILENCE_FINGERPRINT) === SILENCE_TRACK_ID)
for (const [label, fp] of [['silence', SILENCE_FINGERPRINT], ['demo track', MUSIC_FINGERPRINT], ['chirp', CHIRP_FINGERPRINT]]) {
  const { algorithm, values } = decode_fingerprint(fp)
  check(`encoder reproduces the ${label} string`, encode_fingerprint(values, algorithm) === fp)
}

console.log('\nClassification:')
for (const c of cases) {
  const { values } = decode_fingerprint(c.fingerprint)
  const distinct = new Set(values).size
  const top = mode_count(values)
  const got = is_degenerate(values)
  console.log(`  ${c.label}`)
  console.log(`    fingerprint: ${c.fingerprint.length > 48 ? c.fingerprint.slice(0, 48) + '... (' + c.fingerprint.length + ' chars)' : c.fingerprint}`)
  console.log(`    values ${values.length}, distinct ${distinct}, most common ${top} (${(top / values.length).toFixed(3)}), degenerate ${got}`)
  console.log(`    track_id ${sha256_hex(c.fingerprint)}`)
  check(`${c.label} is ${c.expected ? '' : 'not '}degenerate`, got === c.expected)
  check(`${c.label} round-trips through the encoder`, encode_fingerprint(values) === c.fingerprint)
}

console.log('\nOverall:', all_pass ? 'PASS' : 'FAIL')
if (!all_pass) process.exit(1)
