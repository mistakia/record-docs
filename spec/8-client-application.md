# Record Protocol Specification — Desktop Application

**Version**: 1
**Status**: v1.0.0-draft

This chapter specifies the **desktop application** — a client that consumes a
node's HTTP/WS API to provide a headed, interactive music-library experience.
The chapter is normative for any implementation claiming to be a conformant
Record desktop application.

The chapter is paired with §9 (chrome extension), which specifies a separate
class of client. The protocol-internal chapters §1–§7 govern node behavior;
this chapter governs client behavior against a node.

## 8.1 Goals and non-goals

### 8.1.1 Goals

1. Provide a locally-running music-library application that lets a single user
   manage, browse, and play their Record library.
2. Operate against a node in either *bundled mode* (the application spawns and
   manages a co-located node child process) or *remote mode* (the application
   connects to a user-configured node URL).
3. Deliver a playback experience comparable to native desktop music players:
   gapless transitions, OS media-key integration, lock-screen metadata,
   low-latency seek.
4. Be a pure HTTP/WS client of the node. The application owns no protocol-level
   logic, holds no protocol-level state, and surfaces a clear node-unreachable
   state rather than attempting independent operation.
5. **Be offline-first relative to the peer network.** All user-facing
   operations (library reads, writes, playback, local-file ingest) MUST succeed
   against a reachable node without requiring connectivity to other peers.
   Only inter-node replication and URL-source ingest require external network
   access. In bundled mode this means full application functionality without
   any internet connection; in remote mode this means full functionality
   whenever the configured node is reachable.
6. Maintain a derived-state layer (caches and snapshots) sufficient to keep UI
   interactions responsive at the library scales specified in §8.11.
7. Provide an identity-management surface that lets the user export, import,
   and inspect the keypair under which their libraries are written, including
   the affordances required for moving to a new device.

### 8.1.2 Non-goals

1. **Not a node.** The application is not a node implementation; it performs
   no protocol-level entry signing, replication, or peer participation. Where
   the application bundles a node, that node is an independent process.
2. **Not a mobile client.** Native mobile clients (iOS, Android), if produced,
   are separate applications conforming to sibling chapters.
3. **Not a multi-user product.** The application is single-user per
   installation. Multiple users on one machine run separate installations with
   separate node data directories.
4. **No degraded standalone operation.** When no node is reachable, the
   application surfaces a clear error state and MUST NOT serve library data
   from its derived caches as a substitute. Caches MAY persist last-seen state
   for snappy startup but are not a fallback for node availability.
5. **No site-specific ingest logic.** Ingest is delegated to the node's import
   API; the application does not implement scrapers, extractors, or
   site-specific DOM logic.
6. **Not a content-discovery product.** The application surfaces the user's
   own libraries and libraries the user has explicitly linked; it does not
   provide global search, recommendations, or any feature requiring
   participation beyond the user's own peer graph.
7. **Shared libraries with multiple writers are deferred to v1.1.** The
   protocol's capability primitive (§3) enables shared write; v1 of this
   chapter assumes that primitive but the UX may land in v1.1.

## 8.2 Application surface and packaging

### 8.2.1 Platform support

The desktop application targets **macOS only** at v1. Minimum: macOS 12
Monterey. Universal binary covering Apple Silicon (arm64) and Intel (x86_64).

Linux and Windows are out of scope for this chapter. If produced, they are
sibling targets added by spec amendment.

### 8.2.2 Mobile

Native mobile applications (iOS, Android) are out of scope for this chapter.
React Native, nodejs-mobile, and Android build artifacts present in the
legacy record-app are not part of this specification.

### 8.2.3 Distribution

- Signed and notarized `.dmg` for direct download.
- `.zip` of the `.app` bundle for auto-update payloads.
- Universal binary covering Apple Silicon and Intel.
- Distribution via download page. Mac App Store distribution is out of scope:
  its sandboxing model conflicts with the bundled-node lifecycle of §8.4.

### 8.2.4 Code signing

- Builds MUST be signed with a Developer ID certificate and notarized via
  Apple's notary service before release.
- Unsigned builds MAY be produced for development only.

### 8.2.5 Auto-update

- The application MUST support over-the-air updates that check for new
  releases at startup and at a recurring interval (recommended: every 4 hours).
- Updates MUST be downloaded in the background and applied on the next
  user-initiated restart. The application MUST NOT silently restart
  mid-session — playback continuity takes precedence over update urgency.
- The update channel (stable, beta) is user-configurable.
- The update server, signing keys, and delta-update format are implementation
  details.

### 8.2.6 Bundled-node packaging

The application bundles an executable that exposes the node HTTP/WS API.

- The bundled-node executable ships in the application's resources directory
  and is launched as a child process per §8.4.
- The executable is built per supported architecture and included in the
  universal application package.
- The runtime, compilation method, and source language of the bundled-node
  executable are out of scope of this chapter (they are concerns of the node
  spec).
- The application MUST treat the bundled binary as an opaque executable:
  it spawns, monitors, and tears down the process via OS primitives and
  communicates with it only via the HTTP/WS API.

### 8.2.7 Application identity and versioning

- macOS bundle identifier: a reverse-DNS identifier owned by the project (e.g.
  `org.record.app`).
- Semantic versioning (`MAJOR.MINOR.PATCH`) for the application.
- The application ships with a specific pinned version of the bundled node.
  The bundled-node version MUST be inspectable via the application's
  diagnostics surface (§8.9).
- In remote mode, the application connects to a node whose version may differ
  from the application's pinned bundled-node version. API compatibility
  between application and remote node is governed by the node's API
  versioning policy (defined in the node spec).

## 8.3 Operating modes

The application operates in exactly one of two modes at any time.

### 8.3.1 Bundled mode

The application spawns and manages a child node process per §8.4. The
application's HTTP/WS client targets the spawned node at `127.0.0.1:<port>`.

### 8.3.2 Remote mode

The application does not spawn a node. It connects to a user-configured node
URL with bearer-token authentication per §8.7.3.

### 8.3.3 Mode selection

- Mode is determined at application launch from persisted application-private
  state (§8.8.4).
- First-launch default is bundled mode.
- The user changes mode via the connection settings surface (§8.9.1).

### 8.3.4 Mode switching

Switching modes requires the application to tear down its current node
connection (terminate the bundled child if in bundled mode; close the WS/HTTP
session if in remote mode) and reinitialize against the new target.

- The application MUST surface a confirmation dialog before performing the
  switch.
- Switching from bundled to remote does not migrate data; the bundled node's
  library remains on disk but unused while in remote mode.
- Switching modes wipes the hibernation snapshot per §8.8.3.

### 8.3.5 Mode-switch surface

The connection settings surface exposes:

- A two-option selector: `bundled` or `remote`.
- For remote: a text input for the node URL (validated as a well-formed
  `http://` or `https://` URL per §8.7.2) and a bearer-token input.
- For bundled: read-only display of the bundled node's port, data-directory
  path, and pinned version.
- A "test connection" action that issues `GET /settings` against the
  configured target and reports success or specific failure (network error,
  TLS error, auth failure, HTTP status).
- Save and cancel actions; save triggers the teardown-and-reinitialize flow.

### 8.3.6 Single-node constraint

The application MUST NOT support simultaneous bundled and remote connections.
There is one node at a time.

## 8.4 Node lifecycle (bundled mode)

This section applies only in bundled mode. Remote-mode connection management
is covered by §8.7.

### 8.4.1 Spawn

- The application MUST spawn the bundled-node executable as a child process
  during application startup, after rendering the hibernation snapshot UI
  (§8.8.3) but before issuing the first node query.
- The application chooses an available TCP port on `127.0.0.1` and passes it
  to the child via command-line argument. Port selection: try the
  application's last-known port from application-private state; if in use,
  scan for an available port in an implementation-defined range.
- The application MUST pass the bundled node's data-directory path as a
  command-line argument. The path:
  - MUST be inside the user's home directory by default (e.g.
    `~/Library/Application Support/Record/node-data/`).
  - MUST be stable across application restarts.
  - MUST be distinct from any remote-mode-related state.
- The application MUST expose a user-configurable data-directory location via
  the diagnostics surface to support external-volume placement. A
  user-changed location requires the user to either move the existing data
  directory manually or accept that a fresh library is created at the new
  location.

### 8.4.2 Configuration handoff

The application invokes the bundled-node executable with normative arguments:

- `--port <port>`: the loopback port the node binds to.
- `--data-dir <path>`: the data directory the node uses for its logs, blobs,
  derived state, and identity keypair.
- `--loopback-only`: the node MUST bind only to `127.0.0.1` per §8.7.2.

Additional arguments (logging level, advanced tuning) are
implementation-defined and MUST NOT contradict the above.

### 8.4.3 Health check

- After spawn, the application MUST issue a health-check probe (`GET
  /settings`) at a fixed interval (recommended: every 250ms) until the node
  responds 200 OK or a timeout (recommended: 30s) elapses.
- If the timeout elapses without a 200 response, the application MUST report
  a "bundled node failed to start" error to the user with: the captured
  stderr tail from the child process, the data-directory path, and an
  affordance to retry or open the data directory for inspection.
- Once the node responds 200, the application transitions to its normal
  operating state and begins reconciliation per §8.8.5.

### 8.4.4 Monitoring

- The application MUST monitor the child process's exit.
- Unexpected exit (non-zero status, signal kill) is treated as a crash.
- Crash handling: exponential-backoff restart — first retry immediately, then
  1s, 2s, 4s, 8s, capped at 30s.
- After 5 consecutive failed restart attempts, the application MUST stop
  auto-restarting and surface a persistent error state with a manual restart
  affordance.
- The application MUST tee child stdout and stderr to a rotating log file in
  the application's logs directory (e.g.
  `~/Library/Logs/Record/node.log`). Log rotation policy is
  implementation-defined; logs MUST NOT grow unbounded.

### 8.4.5 Shutdown

On application quit (user-initiated or OS shutdown), the application MUST
initiate graceful shutdown of the child:

- Send `SIGTERM` to the child process.
- Wait up to 10 seconds for clean exit.
- On timeout, send `SIGKILL`.

The application MUST NOT exit before the child has terminated (graceful or
forced). This prevents orphaned node processes from persisting across
application restarts.

On OS-level force quit, the application MUST register a process-exit signal
handler that sends `SIGTERM`/`SIGKILL` synchronously. Full force-quit may
leak the child, in which case the next application startup MUST detect a
stale data-directory lock file (per §8.4.6) and either reuse it or terminate
the orphan before spawning a new child.

### 8.4.6 Data directory and lock file

- The bundled node MUST hold an exclusive lock on its data directory while
  running. Two bundled nodes MUST NOT share a data directory.
- On startup, the application MUST detect a stale lock (lock file present
  but holding PID not alive) and clean it up before spawning a new child.
- The application MUST NOT attempt to share a data directory between bundled
  and remote mode. The bundled node's data directory is private to the
  bundled mode of this specific application installation.

### 8.4.7 Single-instance enforcement

- The application MUST be single-instance per user account. A second launch
  attempt while an instance is running MUST raise the existing window rather
  than starting a second application + second bundled node.
- Single-instance enforcement uses the OS-provided facility (macOS:
  the standard Cocoa single-instance pattern).

## 8.5 Identity model

### 8.5.1 Identity custody

The private key of the writer identity is held by the node, not by the
application. The node uses it to sign every entry appended to its library
logs. The application accesses the public key for display, accesses the
private key only during explicit export and import actions, and at no other
time. This is a consequence of the protocol: writes are signed at the node,
so the signing key MUST be available to the node.

**Trust scope.** The operator of a node has full control over the identities
that node holds. In bundled mode this is the user (the bundled node's data
directory is on the user's machine). In remote mode this is whoever operates
the node the application is connected to. The application's identity surface
(§8.5.7) MUST surface this distinction so the user can recognize when they
are operating against an identity they fully control versus one held by
another operator.

### 8.5.2 Identity creation

**Bundled mode**: on first launch, the application starts its bundled node,
which generates a new secp256k1 keypair on its first run if no existing
keypair is found in its data directory. The application surfaces a welcome
affordance acknowledging the new identity has been created and prompting the
user to back it up (§8.5.3).

**Remote mode**: the application does not create identities. It connects to
a node that already has one.

The application MUST NOT expose "create a new identity" as a runtime action
distinct from "this is the identity of the node I'm connected to." There is
one identity per node, held by the node, and the application surfaces it for
inspection.

### 8.5.3 Identity export (backup)

The application provides an export affordance on its identity surface:

- Calls the node's `/identity/export` endpoint.
- Returns the private key in the portable format specified by the protocol.
- Application surfaces this as a copy-to-clipboard or download-as-file action,
  with explicit "this is your private key, anyone with this controls your
  library" warning UX.
- The application MUST NOT log, transmit, or persist the exported key
  anywhere outside the export action's UI surface.

**First-launch backup prompt.** The application MUST prompt the user to
perform an export at least once during the first session after a new
identity is created in bundled mode. The prompt is dismissable but SHOULD
re-surface periodically until acknowledged.

### 8.5.4 Identity import (restore)

The application provides an import affordance:

- Accepts a previously-exported private key from user input (paste or file).
- Calls the node's `/identity/import` endpoint.
- The application MUST warn the user explicitly that importing replaces the
  current node's identity and require typed confirmation (typing a known
  phrase, not just clicking a button) before invoking import.
- Identity import is only available in bundled mode. In remote mode, the
  application does not import keys into a remote node it does not control;
  the user performs that action out-of-band against the remote node.

### 8.5.5 Multi-device

The spec recognizes two paths:

**Path 1 — single-identity-across-devices (key portability).** The user
exports their identity from device A and imports on device B. Both devices
now hold the same private key. Implication: simultaneous writes from both
devices produce divergent log heads, resolved per the protocol's replication
mechanism. The application surfaces no special coordination UI; this is a
"two installations sharing one identity" model and the user is expected to
use one device at a time.

**Path 2 — one-canonical-node-many-clients (remote mode).** The user runs
one node (e.g. on a NAS or always-on machine) and connects from multiple
application instances in remote mode. All writes route through the one
node; no divergence. This is the spec-preferred multi-device path because
it has no concurrent-write hazard.

The application MUST NOT assume only one of these paths is in use. The
identity surface (§8.5.7) surfaces enough information for the user to
recognize which model they are operating under.

### 8.5.6 Identity rotation and loss

Per protocol §1.2.3, in-place key rotation is a non-goal. The application
reflects this:

- The application provides no "rotate my keypair" affordance.
- If the user loses their private key without a backup, the library written
  under that key continues to exist but cannot be written to again. A new
  identity is created by clearing the node's data directory and restarting;
  previous library content is recoverable only via federation with another
  peer that has replicated it.
- The application MUST NOT silently let the user discard an identity. Clearing
  the data directory is an explicit action with a warning that names the
  consequences.

### 8.5.7 Identity display

The application's identity surface shows:

- The current identity's compressed secp256k1 public key (the 66-character
  hex string per protocol §3.1).
- A truncated form for inline display (first 6 + last 6 of the hex).
- The current node's URL (so the user distinguishes bundled from remote at
  a glance).
- The set of own libraries owned by this identity (per the multi-library
  amendment).
- Last-known export action timestamp.
- A **key-holder indicator**: in bundled mode displays "this device"; in
  remote mode displays "the node at `<url>`" with explicit framing that the
  operator of that URL controls the identity.

## 8.6 Library interaction

### 8.6.1 Library categories

The application surfaces three categories of library:

- **Own libraries.** Libraries owned by the identity the connected node
  holds. The identity may own one or many; all are writable without explicit
  capabilities (the owner shortcut of the protocol's verification rules).
- **Shared libraries.** Libraries owned by other identities where this
  identity holds at least one active write capability. Writable to the extent
  the capability's actions, filters, and conditions permit.
- **Linked libraries.** Libraries followed without any held capability.
  Read-only.

The application MUST surface the category of every visible library and, for
shared libraries, MUST surface the scope of held capabilities (which actions,
any active filters, any expiration). The user MUST be able to tell at a
glance whether a library is writable, partially writable, or read-only.

### 8.6.2 Read operations

The application reads from the node:

- Track lists, scoped to a single library or aggregated across all libraries,
  with pagination, filter, sort, and search parameters.
- Track detail — full metadata for a single track, including all libraries
  that hold it.
- Tag taxonomy across visible libraries.
- Per-library `about` metadata.
- Per-library replication state (entries loaded vs total, connection state).
- Listen history scoped to own libraries.
- Peer presence and per-peer libraries.

All reads route through the node's HTTP query API per §8.7.6. The application
MUST NOT read directly from any underlying storage.

### 8.6.3 Write operations

Writes target a specific `library_address`. Every write action carries a
target library identifier.

- **Own libraries**: writes succeed under the owner shortcut.
- **Shared libraries**: writes carry the `capability_id` of the capability
  authorizing them. The application MUST select an active applicable
  capability automatically when the user initiates a permitted write. If
  multiple capabilities authorize the same action, the application chooses
  one (implementation-defined). The application MUST NOT prompt the user to
  choose a capability for routine writes.
- **Linked libraries**: writes are not exposed in the UI. Any write
  affordance is hidden or disabled.

Write categories:

- Add a track via ingest (`/import/file`, `/import/url`).
- Remove a track from an own library.
- Add or remove a tag.
- Adopt a track from another library into a writable library.
- Edit per-library `about`.
- Link or unlink a library (writes the link entry to the identity meta-log).
- Connect or disconnect replication of a linked library.
- Record a listen.
- Issue or revoke a capability (own libraries only; library owner).
- Pin or unpin a track (writes to identity meta-log).

**Write target selector.** Write actions that could plausibly target multiple
libraries MUST expose a target-library selector. The default is
implementation-defined; recommended: most-recently-active writable library.

**Listens.** Listens land in a designated own library (a user-marked primary
or the most-recently-active own library when none is marked). Listens MUST
NOT be written to shared libraries.

**Identity meta-log writes.** Creating a new own library, retiring an own
library, linking, unlinking, and pinning are identity-meta-log writes. These
are owner-implicit and require no capability.

### 8.6.4 Capability management

The application provides a capability management surface accessible from
each library's settings (for owned libraries) and from the identity surface
(for capabilities held by this identity from others).

**For an owned library, the owner can:**

- View all capabilities ever issued for this library with grantee, actions,
  filter, conditions, issued-at, and status (active, expired, revoked).
- Issue a new capability:
  - Select grantee: a single identity (pubkey) or a set of identities.
  - Select actions from the protocol's action vocabulary.
  - Optionally add a filter using the FilterSpec primitive (§8.6.6).
  - Optionally add conditions (v1 UI exposes `expires_at`).
- Revoke an active capability: one-click action with explicit confirmation.
  The application MUST warn that revocation invalidates entries written
  after the revoke under that capability (the capability is not
  retroactively void for already-cited entries).

**For capabilities this identity holds from others:**

- View list with: granter, library address, actions, filter, conditions,
  issued-at, expires-at.
- "Leave shared library" action: stops the application from offering writes
  against that library. This does NOT revoke the capability (only the granter
  can); the capability remains valid and the user can re-engage later.

**Forward-compatibility.**

- The capability management UI MUST handle unknown action verbs by rendering
  them with an opaque label (e.g. `(unknown action: <verb>)`).
- The UI MUST handle unknown `GranteeSpec` / `FilterSpec` / `ConditionSpec`
  `type` values by rendering them as opaque labels.
- The UI MUST NOT crash, hide, or silently rewrite unknown content from
  newer protocol versions.

### 8.6.5 Link and unlink

Linking and unlinking write to the identity meta-log. The link is durable
state replicated with the identity.

- Linking does NOT immediately fetch content. After linking, the node begins
  replication subject to the configured replication policy (§8.6.5a). The
  application MUST surface this — a freshly-linked library MUST NOT appear
  empty in the UI without an indication that replication is in progress.
- Unlinking does NOT immediately delete replicated content. Whether the node
  garbage-collects unlinked library data is a node concern; the application's
  contract is that the linked library disappears from its surfaces.
- Unlinking a library where this identity holds a capability does NOT revoke
  the capability. The capability remains valid; the user has only stopped
  following the library locally.

### 8.6.5a Replication policy

For each linked library, the application maintains a per-node replication
policy with three modes:

- **`index_only`**: log replicated; no audio proactively fetched. Playback
  fetches audio on-demand from peers, subject to a node-side LRU cache.
- **`selective`**: log replicated; audio for entries matching a FilterSpec
  filter (§8.6.6) is proactively fetched and retained. Audio not matching
  the filter behaves as `index_only`.
- **`full`**: log replicated; all audio proactively fetched and retained.

**Default mode** for a new link is `full` (lowest-surprise migration). The
application MUST display the current mode prominently per linked library
and MUST surface a one-action mode-change affordance.

**Orthogonal controls (apply in any mode):**

- **Connect / disconnect.** Runtime pause of all replication for a library.
  Mode is preserved; reconnect resumes from where the node left off.
- **Pinned tracks.** User-selected tracks marked for permanent local
  retention regardless of mode. Pinned tracks are identity-meta-log state
  (replicate across the user's devices).

**Durability.**

- Link itself is identity-meta-log state (durable, replicated across
  devices).
- Replication mode is node-local config (per-device; the user's laptop and
  NAS can hold different modes for the same library).
- Connect/disconnect is node-local runtime state.
- Pinned tracks are identity-meta-log state.

**API.**

- `GET /libraries/{address}/replication-policy` returns `{mode, filter?,
  connected}`.
- `PUT /libraries/{address}/replication-policy` sets the policy.
- `POST /tracks/{cid}/pin` / `DELETE /tracks/{cid}/pin` for pin/unpin.

### 8.6.6 FilterSpec primitive

A `FilterSpec` is a recursive predicate used by both capability scoping
(§8.6.4) and selective replication policy (§8.6.5a). v1 vocabulary:

- `match`: equality on one or more named fields.
- `any_of`: a field's value is in a set.
- `range`: numeric or timestamp range on a field (`gte`, `lte`, `gt`, `lt`).
- `and`: all sub-filters match.
- `or`: any sub-filter matches.
- `not`: the sub-filter does not match.

`field_path` is a dot-separated accessor against the target object's shape.
Value scalars are JSON scalars; collections (e.g. `tags`) follow membership
semantics for `match` and intersection semantics for `any_of`.

**Forward-compatibility.** New `type` values may be added in future versions
(`regex`, `full_text`, `contains`, `starts_with`, `ends_with`,
`field_exists`, etc.). Verifiers and replicators that encounter an unknown
`type` MUST treat the filter as failing closed.

**Filterable-field vocabulary** is consumer-specific:

- Selective replication: track entry attributes (`tags`, `source`,
  `audio_size_bytes`, `duration_seconds`, `added_at`, `artist`, `title`,
  `cid`, `library_address`, `added_by`).
- Capability scoping: action parameters, per action verb.

### 8.6.7 Multi-library aggregation

When the application displays aggregated views (across own + shared +
linked), the query MUST be served by a node-side endpoint that performs
the aggregation. The application MUST NOT client-side-join across libraries.

Aggregated views MUST surface, per track, which libraries contributed the
track and at which categories (e.g. "in 2 own libraries, 1 shared, 3
linked").

Adoption affordances:

- "Adopt to own library X" — copy the track entry into a specific own
  library.
- "Adopt to shared library Y" — copy into a shared library where this
  identity has `library.append_track` capability.

The target-library selector applies. The application MUST NOT silently
default to a single target when the user has multiple writable libraries.

### 8.6.8 Consistency model

- **Own-library writes (synchronous from the application's perspective).**
  When the application performs a write, the node signs and appends. The
  application observes the resulting state via the API response and via a
  WebSocket event. The application MUST treat the API response as the
  durable confirmation; once 2xx returns, the write is committed locally.
- **Replication lag (asynchronous).** Writes propagate to peers per the
  protocol's replication mechanism. The application does NOT wait for peer
  replication before considering a write complete.
- **Replicated state from linked or shared libraries.** Arrives via
  WebSocket events as the node replicates. The application MUST NOT promise
  or imply real-time visibility of linked-library state.
- **No multi-device concurrent-write coordination.** Concurrent writes from
  key-portable devices are resolved at the protocol level. The application
  surfaces no application-level conflict detection.
- **Write gating during stale snapshot.** Per §8.8.3, the application MUST
  gate writes until reconciliation completes.
- **Capability revocation lag.** When a library owner revokes a capability,
  the revoke entry propagates via replication. A holder writing between the
  revoke entry's creation and their own node observing it may have writes
  accepted locally but later invalidated. The application MUST surface this
  to the user when it occurs.
- **Capability expiration.** Writes attempted under an expired capability
  MUST be rejected by the local node and surfaced as "the capability
  authorizing this action has expired."

### 8.6.9 Scope of tags and listens

- **Tags** are per-library: a tag is an association between a track and a
  tag name within a specific library's log. Aggregated tag views merge by
  tag name across libraries.
- **Listens** are per-identity (logged into a designated own library), not
  per-library.
- **`about` metadata** is per-library: each own library has its own name,
  bio, avatar.

## 8.7 Networking and authentication

### 8.7.1 Transport

- HTTP over TCP for request/response (REST endpoints).
- WebSocket for server-pushed events.
- HTTP version is implementation detail; the application MUST work over
  HTTP/1.1.

### 8.7.2 Bind address and network exposure

**Bundled mode.**

- The bundled node MUST bind to `127.0.0.1` (loopback) only, on a port
  chosen at spawn time and passed via §8.4.2.
- The application MUST NOT expose configuration that allows the bundled
  node to bind to non-loopback interfaces. A user wanting the bundled node
  reachable from another machine should switch to remote mode.

**Remote mode.**

- The application accepts a node URL of the form `<scheme>://<host>:<port>`.
- Scheme MUST be `http` or `https`.
- The application MUST NOT modify the bind behavior of the remote node.

### 8.7.3 Authentication

**Bundled mode.**

- No authentication is required on the application↔bundled-node channel.
  The loopback-only bind is the security boundary.
- The bundled node MUST refuse connections from non-loopback origins.

**Remote mode.**

- The application MUST support bearer-token authentication via the
  `Authorization: Bearer <token>` HTTP header on every REST request and via
  a token-presentation mechanism on WebSocket upgrade (§8.7.7).
- The token is opaque to the application: a string the user pastes into the
  connection settings, originally generated by the operator of the remote
  node via the node's out-of-band token-management surface.
- The application MUST persist the token in the macOS Keychain — not in
  application preferences, not in any plaintext storage.
- The application MUST surface an explicit "log out" affordance that deletes
  the persisted token.
- On a 401 response, the application MUST treat the token as invalid: clear
  it from the Keychain, surface a re-authenticate prompt, and do not retry
  until the user provides a new token.

The application MUST NOT implement any other authentication scheme at v1.

### 8.7.4 TLS

- Bundled mode: no TLS. Loopback only.
- Remote mode `http://` scheme: permitted, but the application MUST surface
  a visible warning in the connection-settings UI that traffic is
  unencrypted.
- Remote mode `https://` scheme: the application MUST validate the TLS
  certificate against the system trust store. The application MUST NOT
  expose a "trust all certificates" or "skip TLS verification" option.
  Self-signed certificate support is via the user adding the certificate
  to the system trust store, out-of-band.

### 8.7.5 CORS

CORS is a node concern. The chrome extension (§9) consumes the same API and
IS subject to CORS; the node's API spec defines an explicit allowlist
including known clients. This is normative on the node, not the application.

### 8.7.6 Endpoint surface consumed

The application consumes the HTTP/WS API defined in protocol §7 with the
multi-library and capability extensions of §3, §4. No subset; no additional
endpoints beyond the spec.

The application MUST gracefully handle endpoints returning 404 (the node may
be a version that does not implement a newer endpoint) and degrade the
affected feature rather than crash. This is the spec-level expression of
application↔node version-skew tolerance in remote mode (§8.2.7).

### 8.7.7 WebSocket connection lifecycle

- The application opens a single WebSocket connection at startup and
  maintains it for the application's lifetime.
- **Authentication on WebSocket.** In remote mode, the application presents
  its bearer token via the `Sec-WebSocket-Protocol` header (specifically, a
  subprotocol of the form `bearer.<token>`). Query-parameter token-passing
  is forbidden — query parameters are routinely logged by HTTP
  infrastructure. Bundled mode does not require WS authentication.
- The application MUST handle disconnects via exponential-backoff reconnect
  (starting at 1s, capping at 30s, with jitter), with the connection state
  visible in the UI.
- On WebSocket reconnect, the application MUST trigger a full reconciliation
  (§8.8.5) of the affected derived state.
- The application MUST NOT assume WebSocket events are exactly-once. The
  design MUST tolerate event replay and missed events alike.

### 8.7.8 Connection failure and recovery

When the node is unreachable:

- The application MUST display a node-unreachable state across the UI.
- The application MUST periodically retry connection in the background
  (exponential backoff per the WebSocket policy).
- The application MUST NOT serve library data from its hibernation snapshot
  as a fallback. The snapshot may render last-known state visually but MUST
  be marked stale per §8.8.3.

## 8.8 Derived state and indexing

### 8.8.1 Three layers of state

The application interacts with three distinct layers, each with different
ownership, durability, and freshness semantics:

- **Layer A — node-side derived state.** Indexes and derived databases the
  node builds over its append-only logs. Authoritative for every cross-track,
  cross-library, search, and filter query. Owned by the node; consumed by
  the application via the HTTP/WS API of §8.7.
- **Layer B — hibernation snapshot.** A bounded application-side snapshot of
  the most-recently-visible UI surface, persisted locally so the application
  can render last-known UI immediately on cold launch or transient
  disconnect. Not a query result cache. Marked stale until reconciled.
- **Layer C — application-private state.** Playback queue, UI preferences,
  window geometry, sort/filter UI choices, last-visited page, dismissed help
  panels. Owned by the application outright; not derived from node state.

### 8.8.2 Layer A consumption contract

- The application MUST NOT implement a client-side query index over
  node-served data. All cross-track, cross-library, search, and filter
  operations issue against the node's HTTP API.
- The application MUST handle node-side queries returning paginated results
  and MUST NOT request unbounded result sets.
- The application MAY hold the current query's most-recent result set in
  memory for UI rendering. This MUST NOT be persisted to disk and MUST NOT
  outlive the active page.
- Cross-library queries MUST be served by node-side endpoints; the
  application MUST NOT client-side-join state across libraries.

### 8.8.3 Layer B — hibernation snapshot

**Purpose.** Eliminate blank-screen time on cold launch and transient
reconnect. The snapshot lets the application render last-known UI within
~100ms of launch.

**Contents.** The snapshot holds the minimum state needed to render the
application's primary surfaces:

- Linked-library list and per-library `about` metadata.
- For the most-recently-active library: the first page of tracks (ID,
  title, artist, duration, tag IDs, library address).
- Current playback queue and position.
- Last-visited route/page identity.
- Per-library last-known head hash, used for reconciliation (§8.8.5).

The snapshot MUST NOT hold full track-list state for non-active libraries,
search result sets, or paginated reads beyond the first page of the active
surface.

**Persistence.**

- Written on clean application shutdown.
- Written periodically while running (recommended: every 30s if the active
  surface has changed since the last write).
- Read on application startup, before any node query is issued.
- Wiped on logout, on switching the configured node URL, and on
  user-initiated cache reset.

**Storage budget — user-configurable.**

- The application MUST expose a user-configurable upper bound on snapshot
  size.
- Default: 50MB.
- Allowed range: 0MB (snapshot disabled; cold launch renders blank until
  first node query) through 1GB.
- The application MUST evict snapshot content via an LRU or similar policy
  if writes would exceed the configured upper bound. The linked-library list
  and per-library `about` metadata MUST NOT be evicted; pagination content
  MAY be evicted.
- The application MUST surface the current snapshot size alongside the
  configured limit.

**Storage technology.** Not mandated. Storage MUST be private to the
application (not shared with the node's data directory) and MUST be on local
disk.

**Staleness handling.** The snapshot is stale by definition relative to
Layer A. The UI MUST:

- Render the snapshot immediately on startup or reconnect.
- Visibly mark the rendered state as stale until reconciliation confirms
  freshness.
- Gate all writes on reconciliation completion. Writes against stale state
  are forbidden because they may produce node-side conflicts.
- Permit reads on stale state with the staleness indicator visible.

### 8.8.4 Layer C — application-private state

The application owns Layer C outright:

- Playback queue and current position.
- Sort and filter UI choices per route.
- Last-visited page.
- Window geometry, sidebar state, theme.
- Hotkey mappings.
- Dismissed help panels and onboarding flags.

**Persistence.** Persisted across application restarts in the application's
preferences store. Survives node-switches, identity changes, snapshot
resets, and application major-version upgrades (subject to schema
migration).

**Bounds.** Bounded by natural content cardinality (hundreds of KB at most).
No user-configurable budget.

### 8.8.5 Reconciliation

The application MUST keep its rendered state consistent with Layer A via
two mechanisms:

**WebSocket-driven incremental updates.** The application subscribes to the
node's event stream (§8.7.7); on each event, it invalidates the affected
portion of the displayed surface and refetches it. Layer B is updated to
reflect the new state.

**Periodic and on-reconnect head-check.** On every successful connection and
every 5 minutes during normal operation, the application issues a head-check
query: asks the node for the current log head of each linked library,
compares to the snapshot's last-known heads, and refetches any library whose
head has advanced. This defends against missed WebSocket events between
disconnect and reconnect.

**Stale → fresh transition.**

1. On startup, render Layer B; UI shows staleness; writes are gated.
2. Issue head-check; mark libraries whose heads match snapshot as fresh.
3. For libraries whose heads have advanced, refetch the active surface's
   affected entries.
4. Once all visible surfaces are confirmed fresh, clear the staleness
   indicator and unblock writes.

The application MUST NOT block UI rendering on the transition.

### 8.8.6 Latency between layers

- Layer A internal (log append → index update): ~10ms in-process at the
  node. Application-invisible.
- Layer A → application observation (via WS event): typically <100ms in
  practice; bounded by network RTT plus event-processing time.
- Layer B → Layer A delta: unbounded. Managed via staleness indicator and
  write gate.
- Layer C: no canonical state to be stale against.

### 8.8.7 Audio data

The application MUST NOT cache audio blob data persistently. Audio is
streamed on demand from the node's `/audio/<cid>` endpoint. The application
MAY hold an in-memory buffer for the currently-playing and pre-buffered next
track only; this buffer MUST NOT outlive the playback session.

## 8.9 Feature surface

§8.9 commits to capability categories. Specific UX layouts, component
choices, keyboard mappings, animation timings, and pagination sizes are
owned by implementations.

### 8.9.1 MVP capability surface

The following capabilities MUST be present in any v1-conformant
implementation.

- **Library browsing.** Aggregated and per-library track views with
  pagination, sort, and basic filter (by library, by tag).
- **Search.** Full-text search via the node's query API with
  search-as-you-type or equivalent debounced UX.
- **Playback.** Play, pause, next, previous, seek, volume, queue management
  (add, remove, reorder), and **gapless transitions** between adjacent
  tracks. Repeat (off / one / all) and shuffle. Crossfade is NOT a v1
  requirement.
- **OS media integration.** macOS Media Session API integration: lock-screen
  and Control Center metadata, play/pause/next/previous from system controls
  and keyboard media keys.
- **Tagging.** Add and remove tags on tracks in writable libraries.
- **Ingest.** File import (drag-and-drop and file picker) and URL import,
  with real-time per-item ingest progress via WebSocket events.
- **Identity management.** Display pubkey, list of owned libraries, list of
  capabilities held and granted. Export and import private key with §8.5.3
  / §8.5.4 affordances. First-launch backup prompt.
- **Own-library management.** Create, edit `about`, retire.
- **Library linking.** Link, unlink, view linked libraries with replication
  state. Connect / disconnect.
- **Replication-policy editor.** Per-library mode selection
  (`index_only`/`selective`/`full`), filter editor for selective,
  visible storage estimate per library, per-track pinning.
- **Filter editor.** Structured FilterSpec builder shared by replication
  policy and capability management. An advanced JSON editor MAY be exposed
  for complex filters.
- **Capability management.** Issue, revoke, view active and revoked
  capabilities for owned libraries; view held capabilities.
- **Adoption.** Adopt a track from any visible library into a chosen
  writable library.
- **Listen recording.** Background recording after a configurable threshold
  (recommended 60s). Listen history view.
- **Profile editing.** Per own library: edit `about` (name, bio, avatar).
- **Connection settings.** Mode selector, URL input, bearer-token input,
  test-connection, save/cancel per §8.3.5.
- **Storage controls.** Hibernation-snapshot budget, visible cache size,
  cache reset.
- **Diagnostics.** Application version, bundled-node version, data directory
  path, log directory path, current operating mode, current resident
  memory, WebSocket connection state, child-process PID and uptime.
- **Node-unreachable state.** Clear, persistent indication when the node is
  unreachable.
- **Staleness indication.** Visible when derived state is stale; writes
  gated until reconciliation completes.

### 8.9.2 Non-features (out of scope at v1)

- Crossfade.
- Equalizer or DSP effects.
- Visualizations beyond static cover art.
- Lyrics display.
- **Named playlists.** Tags fill the playlist role across the system.
- Direct peer-to-peer connections from the application.
- Content discovery beyond the user's linked graph.
- Mobile or browser variants.
- Multi-user-on-one-machine.
- Offline-mode-without-a-node.
- Web-based playback via shared URL.

### 8.9.3 Optional features (MAY ship without violating conformance)

- Theming (light, dark, system-following).
- Keyboard shortcut customization.
- Per-library configurable storage budgets distinct from the global cache
  budget.
- Auto-pin recently-played tracks.
- Per-library notification preferences.
- Application-level analytics opt-in (default off; operational metrics
  only, never user content).

## 8.10 Security model

### 8.10.1 Threat model

The application defends against:

1. **Renderer-to-main privilege escalation.** Malicious content reaching the
   renderer MUST NOT execute Node APIs, read arbitrary files, or perform
   system actions.
2. **Untrusted-origin navigation.** Renderer attempts to navigate away from
   the bundled HTML MUST be blocked or redirected to the OS browser.
3. **Untrusted-content rendering.** Library `about` fields, peer-provided
   track metadata, and any data ultimately sourced from a remote peer is
   treated as untrusted input. The renderer MUST NOT interpret it as code.
4. **Capability-token exfiltration.** Bearer tokens and exported private
   keys MUST NOT be exfiltratable via renderer-side compromise.
5. **Supply-chain compromise.** A malicious dependency MUST NOT be able to
   read user files, exfiltrate keys, or escalate beyond the application's
   own permissions.

The application does NOT defend against:

- A local attacker with read access to the user's home directory.
- A compromised remote node operator (per §8.5.1 trust scope).
- Audio playback fingerprinting attacks.

### 8.10.2 Renderer configuration

Every Electron `BrowserWindow` instance MUST be configured with:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `enableRemoteModule: false`
- `webSecurity: true`
- `allowRunningInsecureContent: false`
- `experimentalFeatures: false`

The application MUST NOT contain any `BrowserWindow` instance deviating from
these settings, including hidden background windows or helpers.

### 8.10.3 Preload script and IPC surface

The renderer communicates with the main process exclusively via a preload
script using `contextBridge.exposeInMainWorld`:

- MUST expose ONLY the specific functions the renderer needs.
- MUST NOT expose `ipcRenderer` directly.
- MUST validate every parameter passed from the renderer before forwarding
  to main.
- MUST NOT expose any function that takes an arbitrary command, path, URL,
  or evaluated string as input.

Main-process IPC handlers:

- MUST treat all renderer-originated parameters as untrusted regardless of
  preload-side validation.
- MUST NOT pass renderer-supplied strings to `child_process.exec`, `eval`,
  `Function`, dynamic `require`, uncanonicalized file paths, or any other
  shell-execution sink.
- MUST scope filesystem access to a small allowlist of application-owned
  paths.

### 8.10.4 Content Security Policy

The renderer's HTML MUST carry a strict CSP via
`<meta http-equiv="Content-Security-Policy">`:

- `default-src 'self'`
- `script-src 'self'` — no `unsafe-inline`, no `unsafe-eval`.
- `style-src 'self'` — `'unsafe-inline'` permitted only with explicit
  documented justification.
- `img-src 'self' data: http://127.0.0.1:* https:`
- `media-src 'self' http://127.0.0.1:* https:`
- `connect-src 'self' http://127.0.0.1:* https: wss:` — `ws://` permitted
  only to `127.0.0.1:*`.
- `object-src 'none'`
- `frame-src 'none'`
- `base-uri 'self'`
- `form-action 'self'`

The application MUST NOT relax these directives for development convenience
in shipped builds.

### 8.10.5 Navigation guards

Every `BrowserWindow` MUST register:

- A `will-navigate` handler that prevents navigation to any URL whose origin
  is not the application's bundled HTML origin. External links MUST be
  opened via `shell.openExternal` after URL validation.
- A `setWindowOpenHandler` that denies all `window.open` calls by default,
  then explicitly opens validated external URLs via `shell.openExternal`.

`shell.openExternal` calls MUST validate:

- Scheme is in the allowlist (`https:`, `http:`, `mailto:`).
- URL is parseable.
- URL contains no control characters or shell metacharacters.

### 8.10.6 Untrusted-content rendering

- Library `about` text, track metadata, tag names, and any text from a peer
  MUST be rendered as plain text by default. No HTML interpretation.
- If Markdown rendering is desired for `about`, the implementation MUST use
  a sanitizing renderer with an explicit tag and attribute allowlist. No
  raw HTML passthrough.
- Image URLs in user-content fields MUST be validated against the
  `img-src` CSP. Remote non-loopback `http:` images MUST NOT be loaded.
- Audio metadata extracted from imported files is treated as untrusted; the
  application displays the result as plain text.

### 8.10.7 Token and key storage

- Remote-mode bearer tokens MUST be stored in the macOS Keychain.
- The application MUST NOT write tokens to logs, telemetry, application
  preferences, or any persisted state outside the Keychain.
- The application MUST NOT pass tokens through environment variables or
  command-line arguments.
- The application MUST NOT expose token values via any IPC channel the
  renderer can call directly. The main process holds tokens; the renderer
  asks the main process to make authenticated requests on its behalf.

Private keys exported via §8.5.3 are surfaced to the user as a one-time
display or download. The application MUST NOT persist exported key material
in any application-owned storage.

### 8.10.8 Supply-chain posture

- Release builds MUST be reproducible: a given source commit plus dependency
  lockfile produces a byte-identical artifact (within tolerable
  build-system non-determinism).
- `package.json` MUST pin all dependencies to exact versions (no `^`, no
  `~`). The lockfile is the authoritative dependency manifest.
- Release process MUST include a dependency audit step that fails the build
  on known high-severity vulnerabilities. Suppression of specific advisories
  requires explicit per-advisory justification recorded in the repository.
- Production builds MUST NOT include source maps.
- Production builds MUST NOT bundle development tooling (e.g.
  webpack-dev-server, hot-reload runtimes).

### 8.10.9 Local data directory permissions

- The bundled node's data directory MUST be created with permissions
  restricting access to the current user (`0700` on macOS).
- The application MUST NOT create data-directory contents with looser
  permissions.
- The application MUST NOT follow symlinks pointing outside the data
  directory; data-directory paths MUST be canonicalized before any
  filesystem operation.

### 8.10.10 Update integrity

- Update payloads MUST be served over HTTPS.
- Updates MUST be signed; signature verification is performed before
  applying the update.
- The application MUST NOT apply an update whose signature does not verify
  against a pinned public key.
- The application MUST NOT downgrade across major versions automatically;
  major-version updates require user opt-in.

### 8.10.11 Logging

- The application MUST NOT log private key material, bearer tokens,
  capability tokens, or any user-credential data, even at debug levels.
- The application MUST NOT log library content (track titles, listen events,
  peer pubkeys) at default log levels. These MAY be logged only at explicit
  debug or verbose levels enabled by the user via settings.
- Logs MAY include connection state, error codes, application lifecycle
  events, and node-process diagnostics.

### 8.10.12 Audit affordances

A conformant implementation MUST provide automated checks sufficient to
verify the structural conformance items:

- A check that every `BrowserWindow` instance is constructed with §8.10.2
  webPreferences.
- A check that the renderer HTML carries the §8.10.4 CSP meta tag.
- A check that bundled-node spawn arguments include `--loopback-only`.
- A check that the dependency lockfile is exact-pinned.
- A check that the test suite exercises update signature verification.

These checks gate releases.

## 8.11 Performance and resource budgets

### 8.11.1 Library-scale assumptions

The application MUST remain functional and usable at:

- Per-library track count: up to 100,000 tracks.
- Linked library count: up to 50 libraries.
- Aggregated corpus: up to 500,000 unique track entries across own + shared
  + linked.
- Tag taxonomy: up to 10,000 distinct tags.
- Listen history: up to 1,000,000 listen events.

These are floor targets. Higher scales are not guaranteed.

### 8.11.2 Application memory budget

- **Steady-state resident memory**: target ≤500MB. Excludes the bundled-node
  child process.
- **Peak transient memory during playback**: ≤800MB. The transient overage
  accounts for at most two simultaneously-decoded audio tracks (current and
  pre-buffered next). Decoded buffers MUST be released promptly after the
  playback slot is retired.
- **Cache memory in-process**: not normatively bounded by a specific number,
  but the application MUST NOT hold the full track list of any library in
  memory at once. Pagination and virtualization are required.

### 8.11.3 Storage budgets

- **Hibernation snapshot**: user-configurable per §8.8.3, default 50MB,
  range 0–1GB.
- **Application binary install**: target ≤200MB including the bundled-node
  executable per architecture. Soft target.
- **Application logs**: bounded by rotation (per §8.4.4). Recommended 100MB
  total.
- **Application preferences and Layer C state**: hundreds of KB max.

The application MUST NOT cache audio data persistently (§8.8.7).

### 8.11.4 Latency targets

These are user-perceived budgets; the application MUST hit them in bundled
mode and SHOULD hit them in remote-LAN mode. Remote-internet mode is
best-effort with the warning surface of §8.7.4.

| Operation | Bundled budget | Remote-LAN budget |
| --- | --- | --- |
| Render initial UI from snapshot on cold launch | ≤100ms after process start | ≤100ms |
| Bundled node ready (HTTP 200 to first probe) | ≤30s (timeout) | n/a |
| Stale → fresh reconciliation visible | ≤500ms after node ready | ≤1s |
| Track-list scroll (per-frame render) | ≤16ms | ≤16ms |
| Search results update after keystroke (debounced) | ≤150ms | ≤200ms |
| Tag filter toggle | ≤100ms | ≤150ms |
| Library tab switch | ≤100ms | ≤150ms |
| Track click → first audio sample | ≤500ms | ≤800ms |
| Gapless transition | sample-accurate; no audible gap | same |

### 8.11.5 Startup time

- **Cold launch** (no warm OS file cache): application window visible with
  snapshot-rendered UI ≤2s after activation. In bundled mode the bundled
  node continues coming up in the background.
- **Warm launch**: ≤1s.
- **Resume from sleep**: functional UI within 500ms of the OS wake event.
  WebSocket reconnect runs in background.

### 8.11.6 Indexing budget

The application MUST NOT maintain client-side indexes over node-served data
(§8.8.2). Index-related cost lives at the node.

### 8.11.7 Observability

The application MUST surface, in its diagnostics surface:

- Current resident memory (or a proxy if direct measurement is impractical).
- Current hibernation snapshot size and configured limit.
- Current WebSocket connection state and last reconnect timestamp.
- Bundled-node child PID and uptime (bundled mode only).

## 8.12 Conformance

### 8.12.1 Applicability

An implementation is conformant to this chapter iff:

- It satisfies every MUST clause in §8.1 through §8.11.
- It does not exhibit behavior explicitly prohibited as a non-goal in §8.1
  or as a "MUST NOT" clause elsewhere.
- If claiming partial conformance, it explicitly enumerates the MUST
  clauses it does not satisfy and the reason, in user-accessible
  documentation.

An implementation MUST NOT advertise itself as a conformant Record desktop
application without satisfying the above.

### 8.12.2 Categories of conformance obligation

For audit and self-verification, the MUST clauses across §8 group into:

- **Architectural**: §8.3, §8.4 (operating modes, node lifecycle,
  single-instance, one-node-at-a-time).
- **Identity**: §8.5 (custody, creation, backup, import, rotation, display).
- **Library**: §8.6 (multi-library, capability management, replication
  policy, FilterSpec, aggregation, consistency).
- **Networking**: §8.7 (loopback bind, bearer-token, Keychain, TLS,
  WebSocket auth).
- **Derived state**: §8.8 (three layers, no client-side index,
  configurable snapshot, reconciliation, no audio caching).
- **Security**: §8.10 (sandboxed renderers, preload IPC, CSP, navigation,
  untrusted content, token storage, supply chain, updates, logging).
- **Resource**: §8.11 (scale floors, memory, storage, latency, startup).
- **Feature surface**: §8.9 (MVP capabilities present; non-features absent).

### 8.12.3 Automated-audit affordances

Per §8.10.12, a conformant implementation provides automated checks for the
structural items. These checks gate releases.

### 8.12.4 Non-conformance disclosure

An implementation that knowingly diverges from a MUST clause:

- MUST disclose the divergence in user-accessible documentation.
- MUST disclose the reason (technical limitation, alternative satisfying the
  underlying goal, deliberate scope reduction).
- SHOULD NOT silently downgrade. Development builds that disable security
  features for convenience MUST NOT be the build distributed to end users.

### 8.12.5 Out of scope of conformance

For clarity, the following are not conformance obligations:

- Specific UX layouts, themes, and component choices.
- Specific build tooling and language choices.
- Specific persistence technologies for Layers B and C.
- Specific filter-builder UI design.
- Specific keyboard-shortcut mappings beyond the requirement that they exist
  for play/pause/next/previous.
