---
name: native-portal-collection
description: Maintain the additive native-compatible Portal collection transition kernel, its public package checks and the actual-native differential handoff.
---

# Native Portal collection ownership

Read `docs/native-portal-kernel.md` and `docs/native-portal-differential.md` before
changing this kernel. The additive kernel computes immutable transitions; the
host remains the only canonical state and publication owner. Do not adapt the
standalone Collection/ListOwner lifecycle as a replacement for native behavior.

Keep receipt installation before transport, exact currentness, response-only
accepted provenance, retained Next/reload rows, retained-Next retry cursor,
cleanup ordering and UI-independent read lifetime explicit. Plain receipt data
is not host authorization. Cache-owner resets retire reads; benign cache
enrichment does not.

Keep public package checks on the natural `/portals` ESM/CJS declarations and
runtime. Preserve unchanged standalone tests. For the actual-native A–H corpus,
use the real reducer/thunk/publication and valid fixtures with external transport
doubles. Record expected native divergences rather than weakening assertions or
replacing native behavior with an emulator.

Use the native checkout's maintained test entry point for the consumer revision
under review. A dependency hold applies to the operation and environment named
by its owner. When that operation is held, continue independent SDK checks.
Record the native run separately from SDK results. Coordinate changes to shared
ownership, authorization, transport, query, cell writes and child operations with
their existing owners.

On macOS, run package guards with `TMPDIR` pointing to a real directory in the
isolated task workspace. The default `/var` temp alias resolves through
`/private/var` and correctly trips the package's symlink guards. Keep those
guards unchanged; record failed environment attempts separately from qualified
results. SDK HTTP transport tests need permitted localhost listen access.
