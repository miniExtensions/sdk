# Native Portal collection kernel

`@miniextensions/sdk/portals` exposes an additive, React-free transition kernel for
hosts that already own Portal collection state. Existing `PortalCollection` and
`PortalListOwner` APIs retain their standalone behavior.

The host stores the returned immutable state in its canonical publication owner.
For native Portal, that owner remains Redux. The kernel does not create a store,
subscribe to a cache, allocate transport, recover authentication, or own UI
lifetime. A new component mount does not retire a canonical read.

## Host transaction boundary

The host observes its actual session, field, configuration, query and token
ownership before each transition. Its scope contains non-secret ownership keys;
the keys must change when those observed owners change, including an observed
change away and back. A cache-owner epoch identifies a reset or replacement of
the cache owner. Ordinary cache enrichment does not change that epoch.

A read begins by calculating the next state and receipt, then installing that
state in the canonical host transaction. Only a receipt that remains current
after that transaction may reach the host's authorized transport. Rejected
admission starts no request. The host owns request construction, credentials,
transport retries and response qualification.

Settlement checks the current receipt, scope, generation, parent frame and
cursor. A receipt copied into a plain object is not a new authority. The host
must commit the returned canonical state together with cache, detail and frame
compatibility projections in one transaction. Subscribers read that complete
publication. They must not publish an older transition after a reentrant
replacement.

`runNativePortalCollectionRead(kernel, host, command)` performs that sequence
through the public `NativePortalCollectionHostPort`. `snapshot()` returns the
same immutable object until a canonical transition; `commit(expected, plan)`
compares the actual snapshot and publishes the whole plan before notifying
observers. The host isolates observer exceptions so a notification cannot make
a completed publication appear refused. This port is a contract for the
existing owner, not a supplied Redux adapter or subscription store.

The runner checks currentness after begin observers, correction observers,
notice scheduling and continuation observers. Deferred notice delivery must
call the supplied `isCurrent` predicate again before showing feedback. Cleanup
scope is calculated from the host's permitted correction and committed together
with it. A changed cleanup binding retires the old accepted frame. Native
response metadata echoes can update the binding in the same success commit;
they cannot change session, field, token owner, linked table or cache owner.

## Native collection behavior

The lifecycle distinguishes cached First, forced First, Next and reload. Loaded
rows remain available while Next or reload is pending. A null cursor ends
pagination; an empty string is still a supplied cursor. An ordinary error enters
the failed state. An explicitly admitted retained-Next error preserves rows and
the exact retry cursor.

Presentation and child eligibility require both `paging.type === 'loaded'` and
a qualified frame. Pending Next/reload retain that state; ordinary failure
suppresses presentation even if the previously accepted frame is retained for
native bookkeeping. Snapshot data must be acyclic plain objects/arrays and
primitive values; mutable Date, Map, Set and executable values are rejected.

Accepted frames use only qualified response data. The host must not fill an
omitted row, field, schema, primary field or detail from its global cache.
Legacy ID publication can retain duplicate IDs while the accepted frame uses
first-occurrence ID order and whole-row replacement. Missing, null and present
detail metadata remain distinct. An unqualified frame stays null even when
legacy compatibility publication is permitted.

An observed ownership change or an IDs-only replace, append or clear retires the
previous receipt and accepted frame. Benign cache/value echoes preserve a valid
pending read. Current cleanup applies the permitted criteria subset before
notice scheduling and a fresh forced First. Stale cleanup, success and failure
produce no compatibility publication, notice or follow-up request.

## Qualification and remaining native work

The packed consumer check exercises the public ESM and CommonJS exports,
declarations, React 18/19 server rendering and an import without browser globals.
It does not establish installed native integration, deployment or hosted
acceptance.

The actual-native differential corpus is maintained separately in
[the native differential notes](native-portal-differential.md). Its execution and
the native adapter/publication/IDs-only writer cutover remain subject to the
existing centralized native dependency hold. Do not resolve native dependencies,
substitute a detached model, introduce another gate or treat SDK qualification
as native execution. The existing whole implementation task stays open until
the real consumer and its normal exact-head checks complete.
