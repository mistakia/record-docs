/**
 * Generate the multi-block UnixFS import vector for spec §5.5.1 / §6.4
 * without the F7 audio toolchain.
 *
 * Covers wire-format claim sections: §5.5.1.
 *
 * The input is SYNTH_BYTES bytes where byte[i] = i mod 251, imported with
 * the unixfs-v1-2025 profile: three 1 MiB-chunked raw leaves under one
 * balanced dag-pb root. This is the same vector F7 checks after its ffmpeg
 * and fpcalc steps; it is split out here so an implementation can reproduce
 * the profile on a machine without the pinned media toolchain. The leaf CIDs
 * and root block are emitted as diagnostics for a mismatching importer.
 */

import { importer } from 'ipfs-unixfs-importer'
import { base58btc } from 'multiformats/bases/base58'
import { bytesToHex } from '@noble/hashes/utils.js'
import { write_vector_file } from './write-vector-file.mjs'

// §5.5.1: pass the profile and nothing it sets.
const IMPORT_PROFILE = { profile: 'unixfs-v1-2025' }
const SYNTH_BYTES = 2 * 1024 * 1024 + 1
const BYTE_MODULUS = 251
const EXPECTED_SYNTH_CID = 'zdj7WZqdXsKQ1j19s9xaxhLp5oFvFF51WaWK7BVLgbZvB46n5'

const synth = new Uint8Array(SYNTH_BYTES)
for (let i = 0; i < SYNTH_BYTES; i++) synth[i] = i % BYTE_MODULUS

const blocks = new Map()
const recording_blockstore = {
  put: async (cid, bytes) => {
    blocks.set(cid.toString(base58btc), { cid, bytes })
    return cid
  }
}

let root
for await (const entry of importer([{ content: synth }], recording_blockstore, IMPORT_PROFILE)) {
  root = entry.cid
}
const root_cid = root.toString(base58btc)
const leaf_cids = [...blocks.values()].filter(({ cid }) => cid.code === 0x55).map(({ cid }) => cid.toString(base58btc))
const root_block_hex = bytesToHex(blocks.get(root_cid).bytes)

console.log('=== §5.5.1 Multi-block UnixFS Vector ===\n')
console.log(`Input: ${SYNTH_BYTES} bytes, byte[i] = i mod ${BYTE_MODULUS}`)
console.log('Leaf CIDs (raw):')
for (const leaf of leaf_cids) console.log('  ' + leaf)
console.log('Root CID (dag-pb):')
console.log('  ' + root_cid)

const pass = root_cid === EXPECTED_SYNTH_CID && leaf_cids.length === 3
console.log('\nVerification (matches §6.4 embedded CID, three leaves):', pass ? 'PASS' : 'FAIL')
if (!pass) process.exit(1)

write_vector_file({
  generator_url: import.meta.url,
  fixture_id: 'F7 (multi-block step)',
  description: 'unixfs-v1-2025 import (§5.5.1) of a generated multi-block input: 1 MiB chunks, balanced, 1024 children, raw leaves, CIDv1, links-first.',
  cases: [{
    name: 'multi-block',
    inputs: { byte_length: SYNTH_BYTES, byte_rule: 'byte[i] = i mod 251', byte_modulus: BYTE_MODULUS, profile: 'unixfs-v1-2025' },
    expected: { root_cid, leaf_cids, root_block_hex }
  }]
})
