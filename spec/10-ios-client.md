# Record Protocol Specification — iOS Application

**Version**: 1
**Status**: v1.0.0-draft

This chapter specifies the **iOS application**: a native iPhone client that
consumes a node's HTTP/WS API for browsing, playing and lightly curating a
Record library. The chapter is normative for any implementation claiming to
be a conformant Record iOS application.

The chapter is a sibling of §8 (desktop application), as §8.1.2 anticipates.
It specifies the iOS application by reference to §8: an obligation of §8 that
applies to remote mode applies here unless §10.3.2 overrides it. The
protocol-internal chapters §1–§7 govern node behavior; this chapter governs
the iOS application's behavior against a node.

## 10.1 Goals and non-goals

### 10.1.1 Goals

1. Let the user browse, search, filter and play their libraries from an
   iPhone, with lock-screen and Control Center playback.
2. Let the user curate lightly: tag, adopt, pin and remove tracks, link a
   library, edit an own library's profile, and import audio files and URLs.
3. Be a pure HTTP/WS client of one node at a time, as §8.1.1 item 4 requires
   of the desktop application.
4. Stay responsive at the library scales of §8.11.1 on a phone.

### 10.1.2 Non-goals

1. **Not a node, at version 1.** The application performs no entry signing,
   replication or peer participation. A light node embedded in the
   application is specified separately (§10.9).
2. **Not the identity's custodian.** Identity export and import (§8.5.3,
   §8.5.4), writers and capabilities (§8.6.4), creating and retiring
   libraries, and replication policy (§8.6.5a) stay on the desktop. The
   application shows the identity (§8.5.7) and never handles private key
   material.
3. **No offline library.** When the node is unreachable, the application
   surfaces that state and serves no library data in its place (§8.1.2
   item 4). It keeps no audio (§10.5).
4. **No site-specific ingest logic**, as §8.1.2 item 5.

## 10.2 Platform and distribution

- The application targets iPhone on iOS 26 or later. iPad, CarPlay and
  Android are out of scope for this chapter.
- It is built with Apple frameworks only.
- Distribution is not mandated. Version 1 ships ad-hoc signed builds.

## 10.3 Remote mode

### 10.3.1 By reference to chapter 8

The application operates in remote mode only (§8.3.2). Bundled mode
(§8.3.1) and the node lifecycle of §8.4 do not apply, since iOS cannot run
a node as a child process.

These obligations of chapter 8 apply as written:

- the library categories, reads and writes, the write targets and the
  consistency model (§8.6.1, §8.6.2, §8.6.3, §8.6.7, §8.6.8);
- the scope of tags and listens (§8.6.9);
- authentication, the endpoint surface consumed, the WebSocket lifecycle and
  connection recovery (§8.7.3, §8.7.6, §8.7.7, §8.7.8);
- the reconciliation pass and its write gate (§8.8.5);
- audio data (§8.8.7);
- logging (§8.10.11).

### 10.3.2 Overrides

| Chapter 8 obligation | iOS application |
| --- | --- |
| §8.8.3: a hibernation snapshot with a user-configurable budget, default 50MB | No snapshot at version 1 (§10.7) |
| §8.9.1: listen recording | At least once and dated by the node (§10.6) |
| §8.10.7: tokens in the macOS Keychain | Tokens in the iOS keychain |
| §8.7.4 and §8.7.2: a non-loopback node | A LAN node over plain HTTP is allowed (§10.3.3) |

### 10.3.3 Node address and transport

- The node URL is `http(s)://host:port`, with the port written out. A URL
  with a path MUST be refused.
- The application MAY reach a node over plain HTTP only at a loopback,
  private-LAN or mDNS `.local` address. It MUST refuse a plain HTTP URL for
  any other host, so a token never crosses the internet unencrypted.
- An optional chapter 7 surface that answers 404 degrades to absent, never to
  an error (§8.7.6).
- A 401 on REST or on the WebSocket upgrade deletes the token and shows that
  the token was refused (§8.7.3). Settings MUST offer an explicit log-out,
  which deletes the token.

## 10.4 Touch and remote-command model

- Touch replaces the desktop's hover and keyboard cursor. A row shows its
  pressed state while held.
- A tap on a track row plays from that row. Swipe right plays the track next
  and swipe left adds it to the queue. A long press opens the full menu: play,
  play next, add to queue, add tag, adopt, pin or unpin, remove from library,
  details, and copy the content CID.
- The application MUST route taps, the lock screen, Control Center and
  headset commands through one playback controller, so every source acts on
  the same queue.
- It MUST handle the play, pause, toggle, next, previous and seek remote
  commands, and keep the system's now-playing information current with
  title, artist, artwork, duration and position.
- Interactive targets are at least 44pt.

## 10.5 Playback

- **Streaming.** Audio is streamed from `/audio/<cid>` with Range requests
  that carry the bearer token. The application SHOULD ask for ranges of at
  least 4 MiB, since a node may read the whole blob for each range request.
- **Next track.** The application SHOULD preload the next track so that
  transitions do not wait on the network.
- **Unplayable formats.** A track whose format the platform cannot decode
  MUST be skipped with a visible notice naming the cause. It MUST NOT stop
  the queue.
- **No audio at rest.** Audio is held in memory for the current and next
  track only, and never written to disk (§8.8.7).
- **Locked playback.** Playback MUST continue while the screen is locked and
  the application is in the background (§10.8).

## 10.6 Listens

- A listen is recorded once a track has been heard for 60 seconds of actual
  playback, or to within a second of its end when it is shorter (§8.9.1). The
  playhead position does not count, only time played.
- Listens go to the identity's listens library (§8.6.9) with the library the
  track was played from.
- **At least once.** Each listen is queued on disk before it is sent, and
  sent again after a failure, a reconnect or a return to the foreground. A
  response lost in transit can therefore duplicate a listen. The queue keeps
  its newest 500 entries, and keeps them while the token is refused.
- **Dated by the node.** Version 1 sends no client timestamp, so a listen
  replayed after an outage carries the time the node received it.
- Both limits lift when chapter 7 gains client timestamps and idempotency
  keys for listens.

## 10.7 Snapshot

- The §8.8.3 budget is 0MB: the application keeps no hibernation snapshot,
  so a launch renders nothing from the library until the node answers.
- The staleness rules of §8.8.3 still apply to the time between a connect
  and the end of reconciliation. Writes MUST be refused until the
  reconciliation pass completes (§8.8.5), and a refused write MUST say why.
- Reconciliation runs on connect and on every return to the foreground. The
  desktop's periodic timer is dropped, because a phone suspends the
  application rather than leaving it running unseen.
- An HTTP cache of artwork and node answers MAY be kept. It is not a
  snapshot and MUST NOT serve library data while the node is unreachable.
  Settings MUST show its size and offer to clear it.

## 10.8 Background behaviour

- The application declares background audio, so playback, remote commands
  and listen recording continue while it is in the background or the screen
  is locked.
- iOS may suspend the event channel in the background. On return to the
  foreground the application MUST reopen it, run reconciliation (§10.7) and
  send any queued listens (§10.6).
- The application MUST NOT poll the node from the background.

## 10.9 Deferred sections

Embedded mode, in which a light node runs inside the application, and the
phone's own device key, which holds writer capabilities paired from the
desktop, are specified with that implementation. Until then, the node signs
every write made from the application.
