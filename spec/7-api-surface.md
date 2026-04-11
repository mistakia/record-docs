# 7. API Surface

This section describes the local REST API exposed by the reference
implementation. The API surface is **SHOULD-level** — implementations
are free to expose different interfaces (GraphQL, RPC, SDK, etc)
without affecting interop, as long as the underlying data model and
wire protocol (§2-§6) are respected.

This section is normative only for implementations claiming
"reference-API-compatible".

## 7.1 Transport

- **Protocol**: HTTP/1.1
- **Bind**: localhost (`127.0.0.1`) by default. The reference
  implementation binds to all interfaces for development but
  production deployments SHOULD restrict to localhost unless the
  deployment enables the §7.6 auth scheme.
- **Port**: 3000 by default.
- **Content type**: `application/json` for request and response
  bodies unless otherwise specified (e.g. `/file/:cid` streams
  binary content with the content network's native media type).
- **CORS**: when bound to localhost, implementations MAY send
  `Access-Control-Allow-Origin: *`. When bound to a non-loopback
  interface, implementations MUST NOT send a wildcard CORS header
  without also enforcing the §7.6 auth scheme; doing so would
  allow any origin to invoke mutating endpoints via a victim
  browser.

## 7.2 Route groups

Fifteen route groups are mounted:

| Path prefix   | Purpose                                          |
|---------------|--------------------------------------------------|
| `/about`      | Own About entry updates                          |
| `/connect`    | Start replicating a library                      |
| `/disconnect` | Pause replication for a library                  |
| `/export`     | Export log content                               |
| `/file`       | Fetch a content-addressed file by CID             |
| `/import`     | Import file blob                                 |
| `/importer`   | Background importer status and control           |
| `/listens`    | Listen history                                   |
| `/log`        | Log info and deletion                            |
| `/logs`       | Library federation (link / unlink / query)       |
| `/peers`      | Peer list                                        |
| `/resolve`    | URL → resolver metadata                          |
| `/settings`   | Local config query and importer settings         |
| `/tags`       | Library-scoped tag add/remove/list               |
| `/tracks`     | Track add/remove/list                            |

## 7.3 Canonical endpoints

### 7.3.1 Tracks

```
GET /tracks
  query:
    start       <number?>      // pagination offset, default 0
    limit       <number?>      // pagination size, default implementation-defined
    tags        <string[]?>    // library-scoped tag filter, repeated param
    shuffle     <boolean?>     // if true, sort/order are ignored
    query       <string?>      // substring match across title/artist/album/remixer/resolver fulltitle
    sort        <string?>      // column name; default "timestamp"
    order       <"asc"|"desc"?> // default "desc"
    addresses   <string[]?>    // library address filter, repeated param
  200: {
    "tracks": LoadedTrackEntry[],
    "total":  <number>,        // total matches before pagination
    "start":  <number>,
    "limit":  <number>
  }

POST /tracks
  headers:
    Idempotency-Key <string?>  // optional; see 7.3.1.1
  body (exactly one of):
    { "cid":  <string> }       // addTrackFromCID
    { "file": <string> }       // addTracksFromFS (path)
    { "url":  <string> }       // addTrackFromUrl
  200: LoadedTrackEntry
  400: { "error": "Body missing one of 'cid', 'url', or 'file'", "code": "INVALID_REQUEST" }
  409: { "error": "Duplicate track", "code": "DUPLICATE_ENTRY",
         "trackId": <string> }
  500: { "error": <string>, "code": <string?> }

DELETE /tracks
  query: { trackId: <string> }
  200: { "trackId": <string>, "hash": <string> }   // hash is the DEL oplog entry hash
  404: { "error": "Track not found", "code": "NOT_FOUND", "trackId": <string> }
```

**7.3.1.1 Query parameter encoding.** Array-valued query parameters
(`tags`, `addresses`) MUST be encoded as repeated query keys in
standard `application/x-www-form-urlencoded` form
(e.g. `?tags=a&tags=b`). Comma-separated encodings MUST NOT be
assumed by the implementation and SHOULD be rejected with a 400
response. The `query` parameter MUST be treated as a literal
substring; implementations MUST NOT interpret it as SQL, regex, or
any other query language.

**7.3.1.2 Pagination determinism.** When `shuffle` is false (the
default), the returned ordering MUST be determined solely by
`(sort, order)` followed by a stable tiebreaker on `entry.hash`
ascending. Two successive `GET /tracks` calls with the same
parameters and no intervening writes MUST return the same ordering.
When `shuffle` is true, `sort` and `order` MUST be ignored and the
ordering is non-deterministic between calls.

**7.3.1.3 Idempotency and retries.** `POST /tracks` is NOT
naturally idempotent because the internal dedup-by-track-id check
runs only after the fingerprint step has started. Clients that
need safe retry semantics SHOULD include an `Idempotency-Key`
header; the implementation SHOULD cache the response for at least
5 minutes keyed by the tuple `(method, path, Idempotency-Key)` and
return the cached response on retry. Clients that do not send the
header MUST expect that a timed-out or disconnected request may
have succeeded, and SHOULD check for existing tracks by
fingerprint before retrying blindly.

`DELETE /tracks` MUST be idempotent at the protocol level: a
second DELETE for an already-deleted `trackId` MUST return the
same 200 response body (with the original DEL entry's hash) if
the DEL entry can be located, and 404 otherwise. Implementations
MUST NOT return 500 purely because the target no longer exists.

### 7.3.2 Logs

```
GET /logs/all
  200: LoadedLogSummary[]

GET /logs/:address(*)
  200: LoadedLogSummary

POST /logs
  body: { address <string?>, linkAddress <string>, alias <string?> }
  200: LoadedLogSummary

DELETE /logs
  query: { linkAddress: <string> }
  200: { "id": <string>, "linkAddress": <string> }
```

### 7.3.3 About

```
POST /about
  body: { name?, bio?, location?, avatar? }
  200: LoadedAboutEntry
```

### 7.3.4 Tags

```
GET /tags
  200: string[]

POST /tags
  body: { trackId, tags: string[], address? }
  200: LoadedTrackEntry

DELETE /tags
  body: { trackId, tags: string[], address? }
  200: LoadedTrackEntry
```

### 7.3.5 Listens

```
GET /listens
  200: Listen[]

POST /listens
  body: { trackId, address }
  200: { "hash": <string> }
```

### 7.3.6 Connect / Disconnect / Log management

```
GET /connect/:address(*)       200: { "address" }
GET /disconnect/:address(*)    200: { "address" }

GET /log/:address(*)           200: LoadedLogSummary
DELETE /log/:address(*)        200: { "address" }
```

### 7.3.7 File

```
GET /file/:cid
  200: <binary content>         // streams the content-addressed file
       Content-Type: best-effort guess from file contents or
                     application/octet-stream if unknown
```

Implementations SHOULD accept any valid CID string. The response
body is the raw bytes stored at the CID with no framing or JSON
envelope; callers are expected to handle audio, image, or other
binary content based on their own knowledge of what the CID
points at. Implementations SHOULD set a `Content-Length` header
when the size is known and a `Content-Disposition: inline` header
for browser playback.

### 7.3.8 Resolve

```
GET /resolve?url=<string>
  200: ResolverEntry[]
```

### 7.3.9 Peers

```
GET /peers
  200: LoadedLogSummary[]        // peer libraries known from RECORD announcements
```

### 7.3.10 Settings / Importer

```
GET /settings                   200: { <config subset> }
POST /settings/importer         body: { ... }, 200: { ... }

GET /importer                   200: { status, pending, ... }
POST /importer                  body: { paths? }, 200: { ... }
```

### 7.3.11 Export / Import

```
GET /export                     200: <exported log data>
                                Content-Type: application/octet-stream
POST /import                    body: <blob>, 200: { imported: <number> }
                                Content-Type: application/octet-stream
```

The export/import format is implementation-defined in v1 and is
NOT guaranteed to be portable between implementations. The
intended use case is local backup/restore within a single
implementation. An implementation that wishes to offer portable
export MAY define a documented serialisation, but such a format
is out of scope for this specification. Implementations SHOULD
reject an import blob that does not match their own export
format with a clear error rather than silently corrupting the
local oplog.

## 7.4 Error handling

All error responses MUST be JSON bodies of the form:

```
{
  "error": <string>,       // human-readable message; free-form, do not parse
  "code":  <string>,       // machine-readable code; see below
  ...extras                // endpoint-specific fields (e.g. trackId)
}
```

The `code` field is the programmatic identifier clients MUST
prefer for branching; the `error` string is for logging and user
display only.

**HTTP status mapping.**

| Status | When to use                                             |
|--------|---------------------------------------------------------|
| 400    | Request validation failed (missing or malformed field)  |
| 401    | Missing or invalid auth token (§7.6)                    |
| 403    | Auth token does not grant access to the resource        |
| 404    | Referenced resource does not exist                      |
| 409    | Request conflicts with current state (duplicate, lock)  |
| 422    | Request was syntactically valid but semantically wrong (e.g. fingerprinting failed) |
| 500    | Unhandled internal error                                |
| 503    | Dependency temporarily unavailable (e.g. log open timeout) |

**Defined error codes.** Implementations claiming reference-API
compatibility MUST use these codes where applicable:

| Code                    | Status | Meaning                                     |
|-------------------------|--------|---------------------------------------------|
| `INVALID_REQUEST`       | 400    | Body or query parameter validation failed   |
| `UNAUTHORIZED`          | 401    | Auth required but not provided or invalid   |
| `FORBIDDEN`             | 403    | Caller is authenticated but not permitted   |
| `NOT_FOUND`             | 404    | Target resource not found                   |
| `DUPLICATE_ENTRY`       | 409    | `beforePut` rejected a duplicate write      |
| `INVALID_ENTRY_TYPE`    | 422    | Operation referenced an unknown entry type  |
| `INGEST_FAILED`         | 422    | Fingerprinting, tag-stripping, or metadata extraction failed |
| `ERR_CAN_NOT_OPEN_LOG`  | 503    | A log open timed out or failed              |

Implementations MAY define additional codes but SHOULD prefix
vendor-specific codes to avoid collision with future codes
defined by this specification.

## 7.5 Stability

The REST API surface is unstable. Implementations SHOULD consider:

- Structured error codes in responses.
- Versioned paths (`/v1/tracks`, etc).
- Input validation on query parameters.
- Authentication for non-localhost deployments (see §7.6).

## 7.6 Authentication (non-localhost deployments)

An implementation binding the API to anything other than a
loopback interface MUST enforce a bearer-token authentication
scheme on all endpoints except `GET /file/:cid`, which MAY be
unauthenticated to permit direct media playback from browser or
native players.

**Scheme.** Clients authenticate by sending an `Authorization`
header:

```
Authorization: Bearer <token>
```

**Token format.** The token is an opaque, implementation-
generated, high-entropy string (at least 256 bits of entropy,
encoded as base64url or similar URL-safe alphabet). Tokens MUST
be treated as shared secrets and MUST NOT be logged.

**Provisioning.** Implementations SHOULD generate an initial
token at first launch, write it to a user-readable file in the
implementation's data directory with filesystem permissions that
restrict it to the owning user, and print its location to
stdout. Implementations MAY support additional tokens via a
`POST /settings/auth-tokens` administrative endpoint; that
endpoint MUST itself require authentication.

**Verification.** On each request, the implementation MUST:

1. Extract the `Authorization` header.
2. Reject with `401 UNAUTHORIZED` if the header is missing,
   malformed, or does not begin with `Bearer `.
3. Compare the token to the configured set in constant time.
4. Reject with `401 UNAUTHORIZED` on mismatch.

Implementations MUST NOT fall back to unauthenticated access if
the `Authorization` header is merely absent. Implementations
binding to loopback MAY skip auth entirely and MUST NOT require
`Authorization` on loopback requests.

**Transport.** Non-loopback deployments SHOULD serve the API
over TLS. Sending bearer tokens over plaintext HTTP on a shared
network is a known insecure configuration and implementations
SHOULD warn (or refuse) on such deployments.

**Scope.** v1 does not define scoped or per-library tokens — a
valid token authorises all endpoints. Finer-grained authorisation
is out of scope for v1 and MAY be added in a future version.
