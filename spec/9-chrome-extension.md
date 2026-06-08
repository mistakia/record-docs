# Record Protocol Specification — Chrome Extension

**Version**: 1
**Status**: v1.0.0-draft

This chapter specifies the **chrome extension** — a minimal browser-extension
client whose single job is one-click ingest of a URL from any web page into
a user-configured node. The chapter is normative for any implementation
claiming to be a conformant Record chrome extension.

The chapter is paired with §8 (desktop application), which specifies a
separate, much larger class of client. The protocol-internal chapters §1–§7
govern node behavior; this chapter governs the chrome extension's behavior
against a node.

## 9.1 Goals and non-goals

### 9.1.1 Goals

1. Provide one-click ingest of an audio URL from any web page into a
   user-configured node.
2. Operate with the minimum permission surface required for the task: declare
   no broad host permissions; activate only on user gesture.
3. Communicate exclusively with a single user-configured node via HTTP; have
   no protocol-level responsibilities.

### 9.1.2 Non-goals

1. **Not a content script.** No DOM injection, no site-specific selectors,
   no per-site logic. The node's resolver (typically yt-dlp) decides what
   is and is not resolvable.
2. **Not a playback or browsing surface.** The extension does not display
   the user's library, play audio, or expose any library-management UI. Use
   the desktop application (§8) for that.
3. **Not a node manager.** The extension cannot start, stop, configure, or
   install a node. It only talks to a node it is told to connect to.
4. **Not multi-browser at v1.** Chrome only (Manifest V3). Firefox and Safari
   support is a possible future scope, not a v1 commitment.

## 9.2 Packaging

- **Manifest version**: Manifest V3.
- **Minimum Chrome version**: 88 (where Manifest V3 stabilized).
- **Distribution**: Chrome Web Store as the primary channel. Signed `.crx`
  for direct sideload is a development convenience only.
- **Updates**: governed by Chrome Web Store auto-update. The extension does
  not implement its own update mechanism.
- **Versioning**: semantic versioning (`MAJOR.MINOR.PATCH`) in
  `manifest.json`.

## 9.3 Permissions model

The extension MUST declare exactly these permissions in its manifest:

- `activeTab` — read the current tab's URL only when the user activates the
  extension via icon click or context menu.
- `storage` — persist the configured node URL and bearer token.
- `contextMenus` — register a "Import to Record" right-click entry on link
  targets.
- `notifications` — surface success/failure of background ingest actions
  (context-menu invocations do not open a popup).

The extension MUST NOT declare:

- `host_permissions` for arbitrary origins. Manifest V3 service-worker fetch
  to the user-configured node URL works without host permissions.
- `tabs` — `activeTab` is sufficient.
- `scripting` or `webNavigation` — no DOM injection per §9.1.2.
- `cookies` or `webRequest` — not needed.

## 9.4 Connection model

- The extension does not spawn or bundle a node. It connects exclusively to
  a user-configured node URL.
- URL scheme MUST be `http://` (with the same warning posture as §8.7.4) or
  `https://`.
- The extension MUST validate the URL format before persisting it and before
  issuing requests.
- A "Test Connection" affordance in the options page issues `GET /settings`
  against the configured URL and reports success or failure.
- When the configured node is unreachable, the popup MUST show a clear
  "Record node is not running or unreachable" state with a link to the
  options page.

## 9.5 Functional surface

The extension provides exactly two user-facing affordances. The functional
surface is intentionally minimal; no additional affordances may be added
without violating §9.1.2.

### 9.5.1 Browser action popup

Triggered by clicking the extension icon:

1. Displays the current tab's URL (truncated for display).
2. Shows an "Import to Record" button.
3. On click:
   - Button transitions to "Importing…" state.
   - Service worker issues `POST {node_url}/api/import/url` with
     `{ url: tab_url }` and the configured bearer token (if any).
   - On success: displays the ingested track title and artist from the
     response. Optionally auto-closes after a configurable delay.
   - On resolvable-but-failed: displays "Could not resolve this URL."
   - On connection error: displays "Record node is unreachable" with a link
     to the options page.
   - On auth error (401): clears the persisted token and displays a
     "re-authenticate in options" message.

### 9.5.2 Context menu on links

Registered via `chrome.contextMenus.create({ id: 'record-import-link',
title: 'Import to Record', contexts: ['link'] })`.

- On click: service worker issues the same `POST /api/import/url` against
  the link's target URL.
- Result surfaced via `chrome.notifications` (success carries track title;
  failure carries error message).
- The context menu MUST be registered on extension install and on browser
  startup; the service worker MUST be event-driven (no persistent
  background state).

### 9.5.3 Options page

A single options page exposes:

- Node URL configuration with format validation.
- Bearer-token configuration.
- "Test Connection" action.
- Last-known connection status.
- Documentation of the at-rest-token limitation (§9.6).

## 9.6 Authentication

The extension uses the same bearer-token model as §8.7.3:

- Bearer token configured by the user in the options page.
- Stored in `chrome.storage.local`.
- Sent as `Authorization: Bearer <token>` on every request to the node.
- A 401 response clears the stored token and surfaces a re-authenticate
  prompt.

The extension MUST NOT support any other authentication scheme at v1.

**At-rest token limitation.** Unlike the desktop application's macOS
Keychain (§8.7.3), `chrome.storage.local` is not protected by an additional
secret. The extension's options page MUST surface this limitation in
user-readable text: the stored token is protected only by the Chrome
profile's isolation; if the Chrome profile is compromised, the token is
too.

## 9.7 Security model

### 9.7.1 No content scripts

The extension MUST NOT register content scripts in its manifest and MUST
NOT inject scripts into web pages.

### 9.7.2 No host permissions

The extension declares no `host_permissions`. Service-worker fetch requests
to the user-configured node URL are subject to the node's CORS policy.

### 9.7.3 Content Security Policy

The extension uses Manifest V3's default CSP for extension pages
(`script-src 'self'; object-src 'self'`). The extension MUST NOT relax this
via `content_security_policy` overrides in `manifest.json`.

### 9.7.4 External requests

The extension MUST issue requests only to the user-configured node URL. The
popup, options page, and service worker MUST NOT issue requests to any
other origin. The extension MUST NOT include analytics, telemetry, or any
third-party network calls.

### 9.7.5 Untrusted-content rendering

The popup renders only data returned from the configured node (track title
and artist from the import response). This data MUST be rendered as plain
text; the popup MUST NOT interpret it as HTML or Markdown. Same posture as
§8.10.6.

### 9.7.6 Update integrity

Provided by Chrome Web Store's signed update mechanism. The extension does
not implement its own signature verification.

### 9.7.7 Logging

The extension's service worker MAY log operational events (connection
state, import results) to the extension's console. It MUST NOT log:

- The bearer token.
- Full URLs containing query-string secrets.
- Any user-credential material.

## 9.8 Conformance

### 9.8.1 Applicability

An implementation is conformant to this chapter iff:

- It uses Manifest V3.
- It declares exactly the §9.3 permission set (no broader).
- It implements exactly the §9.5 functional surface (no broader).
- It uses only the §9.6 bearer-token auth model.
- It satisfies §9.7's security posture: no content scripts, no host
  permissions, default Manifest V3 CSP unrelaxed, no third-party requests,
  plain-text rendering of node-returned data.

An implementation MUST NOT advertise itself as a conformant Record chrome
extension without satisfying the above.

### 9.8.2 Required disclosure

A conformant extension MUST disclose to the user:

- The required permissions (Chrome Web Store does this automatically at
  install time).
- The configured node URL is a target the user trusts (the options page
  surfaces this framing).
- The at-rest token limitation per §9.6.

### 9.8.3 Out of scope of conformance

The following are NOT conformance obligations:

- Specific popup or options page layout, styling, or theming.
- Specific build tooling (Vite, webpack, esbuild, etc.).
- Specific UI framework choices (plain DOM, lightweight framework).
- Specific notification text or copy.
