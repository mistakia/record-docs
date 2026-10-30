/**
 * Write a generator's cases to vectors/<generator-name>.json so non-JavaScript
 * implementations can consume the same inputs and expected outputs.
 *
 * Shape: { 'base-secret-scan', fixture_id, generator, description, cases: [{ name, inputs, expected }] }.
 * Bytes are lowercase hex strings; protocol objects are plain JSON, where an
 * integer-valued number is a CBOR integer and any other number a CBOR float,
 * matching @ipld/dag-cbor's handling of JavaScript numbers. The spec text stays
 * normative; these files are its machine-readable mirror.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const write_vector_file = ({ generator_url, fixture_id, description, cases }) => {
  const generator_path = fileURLToPath(generator_url)
  const generator = basename(generator_path)
  const vectors_directory = join(dirname(generator_path), 'vectors')
  const file_name = generator.replace(/^gen-/, '').replace(/\.mjs$/, '.json')
  mkdirSync(vectors_directory, { recursive: true })
  // The first member declares the file a synthetic corpus to the base secret
  // detector: signing cases carry private-key inputs (scalar 1) and content-hash
  // `operation_key` outputs, which read as secret-shaped hex.
  const body = { 'base-secret-scan': 'declared-fixture', fixture_id, generator, description, cases }
  writeFileSync(join(vectors_directory, file_name), JSON.stringify(body, null, 2) + '\n')
  console.log(`\nWrote vectors/${file_name} (${cases.length} cases)`)
}
