/**
 * Generate the audio-pipeline smoke vector for spec §6.1.5 + §6.2.4 +
 * §6.4.1.
 *
 * Covers wire-format claim sections: §6.1, §6.2, §6.4.
 *
 * Pipeline:
 *   (a) Version preflight — fpcalc -version, ffmpeg -version. Abort with
 *       a clear error if the runtime versions don't match the pinned
 *       values in fixtures/README.md `## Toolchain pinning`.
 *   (b) Regenerate the sine sweep from pinned ffmpeg flags into a temp
 *       file, byte-compare against the committed
 *       audio/sine-sweep-5s.flac, abort if drift.
 *   (c) fpcalc -json → fingerprint string → sha256(fingerprint) = track_id
 *       → ffmpeg tag-strip (§6.2.3 reference flags) → sha256 of tag-
 *       stripped bytes = audio identity (raw-codec sha256 deterministic
 *       proxy for the §6.2.4 audio CID; the spec leaves the exact CID
 *       format to the content-network profile).
 *
 * The cross-machine residual risk is documented in the task plan's
 * Assumptions section: this fixture verifies single-machine cross-
 * invocation determinism only.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const AUDIO_PATH = join(HERE, 'audio', 'sine-sweep-5s.flac')

const PINNED = {
  ffmpeg: '7.1.1',
  fpcalc: '1.5.1'
}

const SINE_FLAGS = [
  '-y',
  '-hide_banner',
  '-loglevel', 'error',
  '-f', 'lavfi',
  '-i', 'sine=frequency=440:duration=5:sample_rate=44100',
  '-bitexact',
  '-c:a', 'flac',
  '-map_metadata', '-1'
]

const STRIP_FLAGS = [
  '-y',
  '-hide_banner',
  '-loglevel', 'error',
  '-map', '0:a',
  '-codec:a', 'copy',
  '-bitexact',
  '-map_metadata', '-1'
]

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.error) throw r.error
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

function preflight() {
  const ffmpegV = run('ffmpeg', ['-version']).stdout.split('\n')[0] || ''
  const fpcalcV = run('fpcalc', ['-version']).stdout.split('\n')[0] || ''
  const ffmpegOk = ffmpegV.includes('version ' + PINNED.ffmpeg)
  const fpcalcOk = fpcalcV.toLowerCase().includes('fpcalc version ' + PINNED.fpcalc)
  if (!ffmpegOk) {
    console.error(`FAIL preflight: ffmpeg version mismatch.\n  pinned: ${PINNED.ffmpeg}\n  found:  ${ffmpegV}`)
    process.exit(1)
  }
  if (!fpcalcOk) {
    console.error(`FAIL preflight: fpcalc version mismatch.\n  pinned: ${PINNED.fpcalc}\n  found:  ${fpcalcV}`)
    process.exit(1)
  }
  console.log('Preflight: ffmpeg + fpcalc versions match pinned values.')
}

function regenerateAndCompare() {
  if (!existsSync(AUDIO_PATH)) {
    // First run — author mode: generate and commit the source.
    console.log('audio/sine-sweep-5s.flac not present; generating from pinned flags.')
    const r = run('ffmpeg', [...SINE_FLAGS, AUDIO_PATH])
    if (r.code !== 0) {
      console.error('FAIL: ffmpeg sine synthesis failed:\n' + r.stderr)
      process.exit(1)
    }
    return readFileSync(AUDIO_PATH)
  }
  const committed = readFileSync(AUDIO_PATH)
  const tmp = mkdtempSync(join(tmpdir(), 'f7-regen-'))
  const out = join(tmp, 'sine.flac')
  const r = run('ffmpeg', [...SINE_FLAGS, out])
  if (r.code !== 0) {
    rmSync(tmp, { recursive: true, force: true })
    console.error('FAIL: ffmpeg sine regeneration failed:\n' + r.stderr)
    process.exit(1)
  }
  const regen = readFileSync(out)
  rmSync(tmp, { recursive: true, force: true })
  if (committed.length !== regen.length || !committed.equals(regen)) {
    console.error('FAIL: regenerated sine sweep differs from committed audio/sine-sweep-5s.flac')
    console.error(`  committed length: ${committed.length}`)
    console.error(`  regenerated length: ${regen.length}`)
    process.exit(1)
  }
  return committed
}

function fpcalcFingerprint(path) {
  const r = run('fpcalc', ['-json', path])
  if (r.code !== 0) {
    console.error('FAIL: fpcalc failed:\n' + r.stderr)
    process.exit(1)
  }
  const obj = JSON.parse(r.stdout)
  return obj.fingerprint
}

function tagStrip(srcPath) {
  const tmp = mkdtempSync(join(tmpdir(), 'f7-strip-'))
  const out = join(tmp, 'stripped.flac')
  const r = run('ffmpeg', ['-i', srcPath, ...STRIP_FLAGS, out])
  if (r.code !== 0) {
    rmSync(tmp, { recursive: true, force: true })
    console.error('FAIL: ffmpeg tag-strip failed:\n' + r.stderr)
    process.exit(1)
  }
  const bytes = readFileSync(out)
  rmSync(tmp, { recursive: true, force: true })
  return bytes
}

function sha256Hex(bytes) {
  const h = createHash('sha256')
  h.update(bytes)
  return h.digest('hex')
}

preflight()
regenerateAndCompare()
const fingerprint = fpcalcFingerprint(AUDIO_PATH)
const trackId = sha256Hex(Buffer.from(fingerprint, 'utf8'))
const strippedBytes = tagStrip(AUDIO_PATH)
const audioIdentity = sha256Hex(strippedBytes)

const EXPECTED_FP = 'AQAAE0mUaEkSZSoAAAAAAAAA'
const EXPECTED_TRACK_ID = '20599ccf9f5efb8cc1d6e2ae464471f6f8fab82066a42579b07024d7673b1005'
const EXPECTED_AUDIO_IDENTITY = '8b96e6aa53240d01736fb444f55ce8184e78d32dfb2013ad48f14c3592308d69'

console.log('\n=== §6.1.5 + §6.2.4 + §6.4.1 Audio Pipeline Smoke ===\n')
console.log('Source: ' + AUDIO_PATH)
console.log('Source bytes: ' + readFileSync(AUDIO_PATH).length)
console.log('\nfpcalc fingerprint string:')
console.log('  ' + fingerprint)
console.log('Track ID = sha256(fingerprint UTF-8 bytes):')
console.log('  ' + trackId)
console.log('Tag-stripped bytes: ' + strippedBytes.length)
console.log('Audio identity = sha256(tag-stripped bytes):')
console.log('  ' + audioIdentity)

const checks = [
  ['fingerprint string matches embedded expected', fingerprint === EXPECTED_FP],
  ['track_id matches embedded expected', trackId === EXPECTED_TRACK_ID],
  ['audio-identity sha256 matches embedded expected', audioIdentity === EXPECTED_AUDIO_IDENTITY]
]
console.log('\nVerifications:')
let allPass = true
for (const [label, ok] of checks) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + ': ' + label)
  if (!ok) allPass = false
}
if (!allPass) {
  console.error('\nIf this is an initial author run, update the EXPECTED_* constants above and re-run.')
  process.exit(1)
}
console.log('\nOverall: PASS')
