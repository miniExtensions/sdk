# SDK CI budget diagnostic handoff

This branch preserves optional test-only attachment timing instrumentation. It is
not a proposed optimization or a production fix. The source baseline is SDK
commit `c58ec09a172da3f451134991875c47f26ada9588`. Before this note was added,
the four-file diagnostic diff had SHA-256
`4148963726bf86ebc27d7e32e5e7cf2280de99d21aa57e280739a7b4d4da5e38`.

The detailed receipt is bounded and records only allowlisted phase labels, case
numbers, and monotonic times. The upload path records its assertion completion
before its existing continue. Initialization checkpoints are disabled after
readiness or on error, so subsequent reloads cannot be attributed to the first
load. The intervals overlap and include synchronous receipt-writing overhead.

On 2026-10-30, one local normal `check:package` run with Node 24.21.0 and pnpm
10.28.2 exited 0 after 764.515 seconds. Its preliminary checks passed 238/238;
the supervised tail reported 90/90 attachment and 51/51 Review cases. The full
CI budget includes work beyond this local package check, and the historical CI
runner used Node 24.22.1. The receipt retained two complete final Review cases;
their root-render intervals were 1019.731 and 1034.865 ms, with approximately
2 ms from render completion to observed readiness. This sample does not establish
the cause, represent all cases, or justify weakening isolation or assertions.

The external launch-group check still found three defunct `esbuild` processes
after the package command exited. The wrapper therefore returned 125 rather
than certifying complete process-group cleanup. A later runtime restart cannot
retroactively clear that observation. The package output, timestamped output,
and bounded receipt had SHA-256 values respectively:

- `736ed290a88cad58267e01ad255886284e1d76fcc891b898ed9c84af8fb205a8`
- `efcf5dc2c488da24724b25e0aa72117e19f86c9fc1b4449e8380fa65db6b040d`
- `77d6f84ff11f7c49c7f02f92ce62cc1c1bab541b32200180937b6c0a8fd7de63`

Those hashes identify historical Cloud-local evidence; this note does not embed
or preserve the raw logs. No subsequent optimization or full-CI qualification
was performed on this diagnostic successor.
