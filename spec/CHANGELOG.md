# Record Protocol Specification — Changelog

## v1.2.2 — 2026-10-09

Content-processing clarification and API addition, no protocol or vector change.

- **Decoded fields.** §6.3.2 derives `duration`, `numberOfSamples`, and `bitrate` from the decoded audio: the decoded duration, the decoded sample count per channel, and the blob's average bitrate `round(size × 8 / duration)`. A container's own figures can be several times off. A VBR MP3 without a VBR header reports its first frame's bitrate, and a deployed library held 239 entries whose container-estimated durations were 5 to 10 times too long.
- **Audio re-derivation.** New §6.4.4 recomputes those three fields from the audio blob an entry already names and, when any differs, appends a superseding PUT with only them changed. Re-deriving an entry a second time appends nothing.
- **Chapter 7** is version 1.5.0: `POST /tracks/{id}/rederive`.

## v1.2.1 — 2026-10-09

Erratum to §5.6 from a second review of the v1.2.0 modes, no vector or API change.

- **`relayed`** runs the content-network DHT in server mode, so peers find it by peer id at its circuit address; v1.2.0 had it a client, which left it unfindable. It drops LAN discovery and refuses LAN dials as well as public ones, dialing only its relay and circuit addresses through it, so a remote peer cannot steer it into its own network.
- **`masked`** discards private addresses the DHT returns, may run a circuit relay client without reservations so it can reach a relayed node, and passes hostnames to the SOCKS5 proxy unresolved.

## v1.2.0 — 2026-10-09

Minor version: network discovery, reachability and masking. No data-model, entry, or vector change; every v1.1 node interoperates with a v1.2 `public` node.

- **Mainline rendezvous.** §5.2.1 makes the BitTorrent mainline DHT the shared bootstrap service, on the info hash `sha1("record-network-v1")`. A node announces only a TCP port AutoNAT confirmed, UPnP mapped, or its operator configured as reachable, and otherwise only looks up; found addresses are dialed directly. Announcing makes a node's IP public, and the section says so.
- **Transports and NAT traversal.** §5.5.2 keeps TCP as the transport and forbids any transport that skips the pre-shared key protector, such as QUIC and WebRTC. A `public` node runs AutoNAT, UPnP, circuit relay v2 and DCUtR, and its relay server keeps the default limits so it coordinates hole punches rather than carrying content.
- **Network modes.** New §5.6 defines `public`, `masked` and `relayed`. A masked node dials every connection outbound through a Tor SOCKS5 proxy, listens on and advertises nothing, and bootstraps by dialing a public node through Tor; onion-service listening is not defined. A relayed node listens and advertises only a circuit address on one named relay and dials only that relay and LAN addresses. §5.6.4 sets the identify agent string to `record-node/<major>.<minor> (<mode>)`.
- **Chapter 7** is version 1.4.0: `Settings.network_mode`.
- **Chapter 8.** §8.3.5 adds a bundled-mode network privacy selector, Public or Masked through Tor. §8.2.6 bundles a Tor client the application runs only while masked. §8.4.2 passes the mode and the SOCKS5 address to the node and holds a masked node until Tor accepts connections. §8.2.5 notes that the update check stays direct.

## v1.1.4 — 2026-10-04

Client change, no protocol, API, or vector change. §8.2.4 no longer requires a Developer ID signature and notarization, because a Developer ID certificate puts the account holder's legal name into every copy of the app. A release build must still carry a code signature that seals the whole bundle, which an ad-hoc signature meets, and its install instructions must explain the first-launch approval macOS then asks for. §8.2.3 drops "signed and notarized" from the `.dmg`. Update integrity is unchanged: §8.10.10 already verifies every update against a pinned key.

## v1.1.3 — 2026-10-03

API addition, no protocol or vector change. Chapter 7 is version 1.3.0, with two fields record-app asked for. `Track.library_addresses` lists the libraries, among those a request covers, that hold a live PUT of the track; a list folds such a track into one item, so a client could not tell which libraries hold it. `Library.audio_size_bytes` totals the audio of the library's live tracks, for the §8.9.1 replication-policy storage estimate.

## v1.1.2 — 2026-10-03

API addition, no protocol or vector change. Chapter 7 is version 1.2.0. It adds `PATCH /tracks/{id}`, which corrects a track's audio metadata: the node writes a new content object for the same audio with `content.tags` changed and appends a superseding PUT of the same id. Before this, a label fix after ingest needed a delete and a re-import, which leaves a tombstone. Each given tag is set, `null` removes one, and `acoustid_fingerprint` cannot change. The audio, artwork, resolver records, and envelope labels are kept. §2.4.3 now says how a `content.tags` correction differs from relabelling.

## v1.1.1 — 2026-10-03

Erratum, no vector change.

- **Overview status.** `spec/1-overview.md` read "v1.1.0-draft" at the v1.1.0 release. It now reads v1.1.1.
- **record-node's own library name.** §3.6.1 and the chapter 7 `own_library_address` fallback said record-node names its v1.0 own recordstore library `library`. record-node names it `record`, so the fallback named a library record-node never creates. Both now say `record`. The §3.6.2 and §4.8.2 vectors keep the test library's discriminator `library`.
- **Resolver failures.** Chapter 7 had no response for a resolver failure on a URL the resolver accepts as input: a missing resolver binary, an unavailable format, an upstream 404, a timeout. Implementations answered 500. `/resolve` and `/import/url` now answer 502 with the new code `RESOLVER_FAILED`, and the error's new `resolver_code` field carries the resolver's own code. A URL the resolver refuses as input stays 400 `VALIDATION_ERROR`. Chapter 7 is version 1.1.1.

## v1.1.0 — 2026-10-03

Minor version, per task `user:task/record/record-protocol-v1-1-multi-library-and-capabilities.md`. Every v1.0 library, entry, address, and track id from a conforming writer stays valid. New entry kinds are additive, and §3.5.11 and §4.8.6 state what a v1.0 peer does with each. Two v1.0 vectors change status: the §6.1.5 sine source is replaced because its fingerprint is degenerate, and the §4.4.2 race set's inputs, which have empty `next` above clock 1, are ordering inputs only and would not pass the new clock check.

- **Clock verification.** §4.2 makes the append rule a receive-time MUST: `clock.time` is `max(next times) + 1`, or 1 with empty `next`. Every conforming v1.0 writer already produces this. It stops a writer forging a clock that wins every §4.4.2 comparison, or one that misorders revocations. A writer now cites a non-empty subset of at most 256 of its heads, preferring the highest clocks, so a grantee leaving more than 256 heads cannot lock the owner out under the §5.4.2 fan-out cap.
- **Multi-library per identity.** §3.6.1 names the manifest `name` the library discriminator and derives the address from the key, library type, and discriminator; a v1.0 single-key library already has that address. §3.6.2 derives the identity library address from the key alone. §4.8 defines the identity library, of the new type `identity`: `library`, `link`, and `pin` records, current state per type and key, owned-library verification, terminal retirement, and replication across the identity's devices. Pins key on the CIDv1 base32 form of the CID. New links go to the identity library; a v1.0 Log entry still links its address when the identity library has no `link` record for it. Malformed records of a defined type are rejected.
- **Capabilities.** §3.5.5 to §3.5.10 define capability and revocation records in recordstore libraries, GranteeSpec, the action vocabulary, FilterSpec (moved from §8.6.6), the `expires_at` condition, verification with delegation chains of up to 8, and revocation. A grant is checked against the actions and conditions above it; filters scope writes. Only the owner, or an identity that issued a capability or one above it, may revoke it. Revocation is not retroactive and is judged by causal order: an entry with a revocation that is effective within its causal past is rejected, and one concurrent with a revocation becomes inert. Whether a revocation is effective is decided only by the ordered effective-set procedure; one naming a capability in its own chain never is. Unknown types and fields fail closed; shape violations of defined types reject. `library.append_listen` and `library.revoke_capability` are reserved. §2.8.1 adds `capability_id` to PUT, and §4.4 and §4.5 skip inert entries. A v1.0 peer merges nothing past a library's first capability record, and one that first syncs afterwards may see the library empty (§3.5.11).
- **Replication policy and pins.** §4.6.1 makes `full`, `selective`, and `index_only` node-local per-library configuration over audio and artwork. A link recorded in the identity library defaults to `full`; a link carried over from a v1.0 Log entry defaults to `index_only`. §4.6.1 defines the track view a selective filter reads. §4.6.2 makes identity-library pins binding on every device of the identity. §5.4.6 bounds content fetches.
- **Track-id collisions.** §6.1.6 defines a degenerate fingerprint: empty, or one subfingerprint value filling at least 19 in 20 positions, as silence and steady tones produce. §6.4.1 rejects ingesting one, and refuses an ingest whose decoded duration (decoded samples over sample rate) differs by more than 30 seconds from the existing entry's stored duration. Existing ids are unchanged.
- **Forward compatibility.** §4.4.1 has a v1.1 receiver merge an owner-signed PUT of an unknown record type with no state effect, and §4.8.2 does the same for identity-library records.
- **Chapter 7** is version 1.1.0: `library_address` and `capability_id` on writes, own-library create and retire, capability issue, revoke, and list, held capabilities, identity-library read, replication policy, pins, `Library.heads`, bearer auth on REST and the `bearer.<token>` WebSocket subprotocol with the query-parameter token removed, and events for identity-library, capability, and inert-entry changes. A capability's `expired` status is advisory. `GET /identity` returns the public key in compressed form, so clients never call `/identity/export` to display it (§8.5.7 now forbids that outside an explicit export). `Library.connected` reports whether replication is running or paused.
- **Vectors.** F7's source is now a 10-second chirp, regenerated under the pinned toolchain. New: F8 address derivation, F9 identity-library entries, F10 capability verification with a reference verifier (327 cases, including head fan-out and interacting revocations), F11 degenerate fingerprints including the real silence fingerprint shared by 172 files of a deployed library.
- **Chapter 8** refers to the normative sections instead of restating them. §8.4.2 drops the `--loopback-only` flag: the bundled node's HTTP and WebSocket API MUST bind only to loopback under configuration the client pins, and the libp2p listener is excluded so the node can replicate. §8.4.6 moves the data-directory lock to the node: the node MUST hold an exclusive lock that the OS releases on process death, and the client relies on it rather than keeping its own lock file.

### Implementation notes

For record-node, when it adopts v1.1:

- `merge_entries` verifies a batch before inserting it. Under the §4.2 clock check, an entry whose parents arrive in the same batch needs them verified first, so the batch must be verified in topological order.
- `test/conformance/merge-ordering.test.ts` merges entries shaped like the §4.4.2 race set, with empty `next` and clock times above 1. They fail the clock check; the test needs real `next` chains.
- The node takes no data-directory lock. §8.4.6 requires one, taken before opening anything in the directory and released by the OS on process death, with a distinct error and exit when it is already held. record-app's own lock file can then go.
- `append_entry` cites every head. It must cite at most 256, the highest clocks first (§4.2), or a grantee leaving 257 heads makes every owner write fail with `size_exceeded`.

## v1.0.6 — 2026-10-03

Erratum, no vector change. §8.7.5 said the node's API spec defines an explicit CORS allowlist including known clients, and no chapter defined either. §8.7.5 now requires the node to refuse with 403 a request or WebSocket upgrade from an origin off its allowlist, and defines the known-client default allowlist, used when the operator configures none, as empty at v1. An operator-configured list, including an empty one, replaces the default, and the origin `null` is never allowed. A renderer-based client reaches the node from its main process, which sends no `Origin` (§8.10.7).

## v1.0.5 — 2026-10-02

Erratum, no vector change. The chapter 7 `ResolverEntry` schema, which declares itself the canonical §2.4.2 shape, named the duration field `duration_seconds` where §2.4.2 names it `duration`. The schema now uses `duration`. The flattened `Track` view keeps `duration_seconds`, since it is an API projection rather than the §2.4.2 object.

## v1.0.4 — 2026-10-02

Erratum, no vector change. §2.4.1 typed `content.hash` and `content.artwork` as `<CID>` while the published F2 vector stores `hash` as a base58btc string and §2.1 makes base58btc the CID encoding in entries. Both fields are now base58btc CID strings, which §5.5.1 and §6.2.4 restate as the stored form; readers still accept any valid CID string. §2.2.1 notes that the F2 `hash` is a placeholder, not a profile-conformant audio CID. F7 asserts the base58btc form, with base32 printed as an informative equivalent.

## v1.0.3 — 2026-10-02

Erratum. §2.10, §1.2, and §6.6 require `content.hash` to be stable across peers, while §2.1 and §6.2.4 left the audio CID to each peer's content-network import defaults, so two conformant peers could write different CIDs for byte-identical audio. §5.5.1 now pins the IPIP-499 `unixfs-v1-2025` import profile for audio blobs and artwork, forbids overriding its parameters, and requires readers to accept any valid CID, so legacy CIDv0 entries stay readable. §2.1, §4.6, §6.2.4, §6.6, and §1.2.4 now reference the profile. §6.2.4 drops its "anchored to the stripped bytes" paragraph and prints the fixture's audio CID and a multi-block vector. `/audio/{cid}` accepts CIDv0 as well as CIDv1. F7 asserts both CIDs and pins `ipfs-unixfs-importer`.

## v1.0.2 — 2026-10-02

Erratum. §4.1.1 called `next` and `refs` "IPLD link fields" while §3.4.1, §3.4.3, and §5.3.2 type them `string[]`; the two readings hash every non-root entry differently. They are plain base58btc strings, and §4.1.2 adds a child-entry vector with a non-empty `next`. §4.6 now states that AC chain objects 1-3 are a MUST pin, matching §3.5.1. The §6.1.5 test procedure passes `-algorithm 2` to fpcalc, as §6.1.2 requires.

## v1.0.1 — 2026-10-02

Erratum, no wire change. §4.4.2 listed `identity` among the signed-entry fields hashed for the current-state tiebreaker; signed entries carry no `identity` field (§3.4). The text now names `key` and `sig`.

## v1.0.0 — 2026-06-08

Finalized per task `user:task/record/finalize-record-protocol-v1-spec.md`.
