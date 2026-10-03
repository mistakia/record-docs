---
title: record-docs Repository Graph Entry
type: text
description: >-
  Graph entry point for the record-docs repository, which holds the canonical Record protocol
  specification (spec/) and the static site that publishes it; maps relations to implementation
  siblings and the record task directory.
base_uri: user:repository/active/record-docs/ABOUT.md
created_at: '2026-05-13T18:04:49.226Z'
entity_id: 6ce68bb3-e673-474d-8227-54baf6838c8f
observations:
  - >-
    [finding] 2026-10-03 Three errata await a record-docs v1.1.1. spec/1-overview.md reads Status
    v1.1.0-draft at the v1.1.0 tag. §3.6.1 and chapter 7 own_library_address name record-node's v1.0
    own library 'library', but record-node names it 'record'. Chapter 7 has no response for a
    resolver failure on a public URL (yt-dlp unavailable format, upstream 404, missing binary), so
    record-node answers 500 on /resolve and /import/url; a 502-class or 422 code carrying the
    resolver's error code is wanted, then the matching record-node change.
owner_identity_uri: user:identity/trashman.md
public_read: false
relations:
  - follows [[user:guideline/directory-markdown-standards.md]]
tags:
  - user:tag/record-project.md
updated_at: '2026-10-03T18:01:29.722Z'
---

## Purpose

Protocol specification and documentation site for **Record** — the distributed peer-to-peer audio file management system. The `spec/` directory is the canonical text of the protocol; the rest of the repo is the static site generator that publishes it.

For project overview and build, see [[README.md]]. For agent-facing build instructions and editing conventions, see [[CLAUDE.md]].

## Context

This repo is the **single source of truth for Record protocol semantics**. The other Record repositories (`record-app`, `record-node`, `record-resolver`, `record-chrome-extension`) implement against the spec defined here. Protocol-affecting changes should land here in coordination with the implementations.

## Notable Context

**Tag**: [[user:tag/record-project.md]] — entities across the Record ecosystem.

**Sibling repositories**:

- [[user:repository/active/record-app/ABOUT.md]] — application layer (UI, importer, player)
- `repository/active/record-node/` — node implementation (networking, storage, indexing)
- `repository/active/record-chrome-extension/` — web import tool
- `repository/active/record-resolver/` — IPFS resolution layer

**Task directory**: [[user:task/record/]] — protocol-spec work and ecosystem-wide tasks (HTTP and WebSocket API draft, identity layer rework, ipfsd exclusion).

**Spec sections** (the canonical content of this repo):

- `spec/1-overview.md` — system overview
- `spec/2-data-model.md` — data model
- `spec/3-identity-and-access.md` — identity layer
- `spec/4-library-structure.md` — library structure
- `spec/5-network-protocol.md` — wire protocol
- `spec/6-content-processing.md` — content processing
- `spec/7-http-api.yaml` — HTTP API (OpenAPI)
- `spec/8-client-application.md` — desktop application client
- `spec/9-chrome-extension.md` — chrome extension client

**Governing guidelines**:

- [[user:guideline/directory-markdown-standards.md]] — structure for this file
- [[user:guideline/single-source-of-truth.md]] — protocol semantics canonical here; implementations do not restate

## Scope

**Belongs in this repo**: protocol specification chapters, OpenAPI definition, the doc site generator, examples and fixtures.

**Belongs elsewhere**:

- Implementation code → `record-node/`, `record-app/`, `record-resolver/`, etc.
- Open work, planned features → `task/record/`
