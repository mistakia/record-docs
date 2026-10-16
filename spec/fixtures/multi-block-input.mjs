/**
 * The multi-block UnixFS input and its expected CID (§6.4), shared by the
 * F7 audio pipeline generator and the toolchain-free gen-unixfs-vector.mjs
 * so the two cannot drift.
 */

// §5.5.1: pass the profile and nothing it sets. In this importer an
// explicit option (cidVersion, rawLeaves, chunker, layout, ...) wins
// over the profile.
export const IMPORT_PROFILE = { profile: 'unixfs-v1-2025' }

export const SYNTH_BYTES = 2 * 1024 * 1024 + 1
export const SYNTH_BYTE_MODULUS = 251
export const EXPECTED_SYNTH_CID = 'zdj7WZqdXsKQ1j19s9xaxhLp5oFvFF51WaWK7BVLgbZvB46n5'

// byte[i] = i mod 251
export const synth_bytes = (length = SYNTH_BYTES) => {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) out[i] = i % SYNTH_BYTE_MODULUS
  return out
}
