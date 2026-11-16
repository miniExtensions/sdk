# Form CAPTCHA

`FormCaptcha` is the reusable visible CAPTCHA widget and inert configuration
preview. Import it from `@miniextensions/sdk/react` and opt into
`@miniextensions/sdk/react/form-captcha.css`. It owns the DOM mount, presentation,
loading/unavailable states, callback admission, reset latch and exact-instance
retirement. It does not own a token store, verified-session state, Form draft,
Save request, deployment account or backend security policy.

```ts
import { createElement } from 'react';
import {
    FormCaptcha,
    type FormCaptchaHost,
    type FormCaptchaProvider,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/form-captcha.css';

declare const host: FormCaptchaHost<string, { theme: 'light' | 'dark' }>;
createElement(FormCaptcha<string, { theme: 'light' | 'dark' }>, {
    mode: 'controlled',
    host,
    labels: {
        title: 'CAPTCHA',
        loading: 'Loading…',
        unavailable: 'Unavailable',
    },
});
createElement(FormCaptcha, {
    mode: 'preview',
    labels: { preview: 'CAPTCHA preview' },
});
```

Preview accepts no host, loads no script and renders no interactive challenge.
SSR performs no provider load, subscription or write. Closed enabled/editable/
verified gates are hidden during SSR too. The live provider is loaded only after
the committed component mounts. The provider's own keyboard and accessibility
behavior remains its adapter's responsibility; the SDK does not manufacture
challenge controls or claim a solved widget is a verified session.

## Host authority

`FormCaptchaHost<Proof, Options>` exposes immutable committed snapshots through
`read()` and synchronous change notifications through `subscribe()`. `read()`
must be a pure, current read. The host snapshot contains:

- An opaque `owner` lease. Every accepted session/context replacement, including
  A→B→A, uses a fresh lease. Display labels, callback function identity and React
  render identity are not owner identity.
  Opaque stamps use `Object.is` identity (including stable `NaN` stamps); host
  admission must use the same identity comparison rather than coercion.
- A nonnegative safe-integer `configurationRevision`, monotonically advancing
  within that lease for every accepted effective provider/script/render option
  change, including configuration A→B→A. Equal sitekeys cannot detect ABA.
- `provider`, immutable `options`, `enabled`, `editable`, and canonical `verified`.
- The current canonical `token` receipt: `value`, opaque `revision`, `owner` and
  `configurationRevision` provenance. This receipt is compare authority, not a
  second SDK token store.
  Each canonical publication or clear issues a fresh revision, including when
  proof bytes repeat, so an old receipt cannot acquire successor authority.

`publish(scope, value)` returns synchronous `{status:'admitted'}` or
`{status:'refused'}`. It must atomically check the captured owner, configuration
revision and current enabled/editable/unverified gate before publishing. Token
publication does not set verified-session state.

`invalidate(scope, expectedToken)` must additionally compare the canonical token
revision and provenance, and check the current owner. This clears only the old
configuration's _future_ token. A replacement config cannot load until its prior
same-owner proof is null or has been guardedly invalidated. The same comparison
applies after remount, even when this widget did not observe the old config.
Reentrant successor publication cannot be cleared by an old invalidation.

`notify({kind,cause})` owns localized notifications. Expiry publishes canonical
null before notifying, including when a custom notification exists. Provider
error only notifies; it does not expire proof or change verification. Provider
load/render failure retires the failed instance and presents unavailable. It does
not silently retry on every host notification; a new accepted configuration,
owner, or closed-and-reopened gate can admit a fresh instance.

Gate closure and owner replacement retire before cleanup and do not clear a
successor token. Old change/expiry/error/reset/load callbacks are inert. Cosmetic
port/label rerenders with the same committed owner/config do not recreate a
widget. The host must notify for canonical-null and gate changes even when its
React parent does not rerender.

## Provider resources

`createRecaptchaV2Provider({registry, scope, configuration, load})` is the
SDK-owned visible reCAPTCHA v2 adapter. `load` supplies the accepted external
provider API (`render` and ID-scoped `reset`); it does not render native JSX.
The SDK maps its change/expiry/error callbacks, retains the exact widget ID
(including zero), resets that ID and clears only its isolated mount on removal.
Native consumers supply provider configuration and the admitted script/API
loader, rather than a second widget implementation. Script URLs, keys and
provider account/domain setup remain deployment-owned.

This first-party MIT adapter adds no third-party React wrapper dependency. Its
v2 boundary matches the visible render/reset surface inspected in native's
locked `react-google-recaptcha@2.1.0`; it does not upgrade that package, copy its
class lifecycle, expose invisible execution or remove shared globals. Synthetic
API-port tests establish SDK behavior, not actual remote provider behavior.

`FormCaptchaProvider.load()` returns (or asynchronously resolves) a renderer.
`render(container, options, callbacks)` returns (or resolves) an exact widget
handle with `reset()` and `remove()`. Each render receives its own detachable
mount node. Late handles are removed even if their instance retired before the
promise settled. `remove()` must remove only that handle's listeners/resources;
it must never delete shared provider globals, shared scripts or another widget.
Renderers must clean up allocations if they throw/reject before returning a
handle. Provider cleanup must be idempotent and nonthrowing.

Adapters that share a process-global loader use one shared
`createFormCaptchaProviderRegistry()` and the same opaque `scope` for that
provider/global. Its stable `configuration` key covers every effective shared
script option. Matching requests share the reserved load; a conflicting key is
explicitly refused before calling its loader. Failure remains admitted to that
key and cannot be replaced by a conflicting loader. The registry never removes
global scripts, and contains no form/token/verification state. It performs no
load until `provider.load()` is called, so module import and SSR remain inert.

Accepted change callbacks arm the reset latch _before_ host publication,
including accepted null. Initial canonical null does not reset. A subsequent
canonical null consumes the latch before resetting exactly once. Synchronous
callbacks produced by reset do not rearm it. If render emits before its handle
returns, the reset waits for that exact current handle.

## Native checkpoint still remaining

Task `recDO17N1aXHEg6ml` remains Blocked for the complete native extraction.
This SDK checkpoint does not integrate `FormLoaded`, Redux token/result
authority, native footer, retained-child scopes, preflight, or Save. Those need
current shared-hunk custody and separate native qualification. Existing native
background Compute waits silently without a token; foreground actions prompt
before allocation; only the accepted canonical response grants verification.

The host must capture complete options for each future submission through the
existing public FormController Save boundary. Widget events never call
`controller.reset()`, abort/replay allocated transport, change a captured request,
clear dirty draft state, or infer verification from generic completion.

All authored SDK tests and package fixtures use synthetic providers and opaque
proof objects. They do not request a real challenge, accept live token input,
contact a provider, allocate Airtable fixtures, or establish hosted/native
security acceptance. See [testing](testing.md) for executed-proof boundaries.
