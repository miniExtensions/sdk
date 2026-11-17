# Live Form pages and Review

`createNativeFormPages` owns one page index and a live Review presentation over
an existing host. `CompleteFormPageNavigation`, `FormPageNavigationButton` and
`CompleteFormReview` provide the complete page header, controls and dialog.
Import `form-pages.css`; it includes the HTML description styles.

```tsx
import {
    createElement,
    useId,
    useSyncExternalStore,
    type FormEvent,
} from 'react';
import {
    createNativeFormPages,
    type NativeFormPages,
} from '@miniextensions/sdk/ui';
import {
    CompleteFormPageNavigation,
    FormPageNavigationButton,
    CompleteFormReview,
    type FormReviewItem,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/form-pages.css';

// These ports come from the actual accepted host. They are not a new draft,
// validation engine, permission decision or transport.
declare const host: {
    owner: object;
    configuration: object;
    isCurrent(): boolean;
    validateNext(pageIndex: number, advance: () => void): void;
    submit(): Promise<unknown>;
};

const controller = createNativeFormPages<FormReviewItem>({
    owner: host.owner,
    configuration: host.configuration,
    isCurrent: () => host.isCurrent(),
    multiple: true,
    pages: [
        {
            title: 'Contact',
            description: '<p>Check your contact details.</p>',
            fieldIds: ['name'],
            hidden: false,
        },
        {
            title: 'Details',
            description: null,
            fieldIds: ['details'],
            hidden: false,
        },
    ],
    reviewItems: [
        {
            id: 'name',
            title: 'Name',
            semanticTitle: 'Name',
            value: 'An already admitted value',
        },
    ],
    onNext: ({ pageIndex, advance }) => host.validateNext(pageIndex, advance),
});

function LiveFormPages(props: { controller: NativeFormPages<FormReviewItem> }) {
    const snapshot = useSyncExternalStore(
        props.controller.subscribe,
        props.controller.getSnapshot,
        props.controller.getSnapshot
    );
    const formId = useId();
    if (snapshot.retired) return null;
    return createElement(
        'div',
        null,
        createElement(CompleteFormPageNavigation, {
            pages: snapshot.pages,
            activePageIndex: snapshot.activePageIndex,
        }),
        createElement('form', {
            id: formId,
            onSubmit(event: FormEvent<HTMLFormElement>) {
                event.preventDefault();
                if (snapshot.isLastPage)
                    snapshot.actions.openReview(() => host.submit());
                else snapshot.actions.next();
            },
        }),
        !snapshot.isFirstPage
            ? createElement(FormPageNavigationButton, {
                  direction: 'back',
                  label: 'Back',
                  onClick: snapshot.actions.back,
              })
            : null,
        createElement(FormPageNavigationButton, {
            direction: 'next',
            label: snapshot.isLastPage ? 'Review' : 'Next',
            form: formId,
        }),
        createElement(CompleteFormReview, {
            open: snapshot.reviewing,
            items: snapshot.reviewItems,
            title: 'Please review your submission',
            editLabel: 'Edit',
            confirmLabel: 'Submit',
            emptyLabel: 'No set values',
            onEdit: snapshot.actions.dismissReview,
            onDismiss: snapshot.actions.dismissReview,
            onConfirm: snapshot.actions.confirmReview,
        })
    );
}

createElement(LiveFormPages, { controller });
```

## Host authority and publications

Supply a fresh immutable publication through `controller.update()` after the
host commits new presentation facts. Page descriptors contain only ordered
field IDs, title, HTML description and hidden state. Review rows contain only
already admitted readonly leaf presentation. Native adapters may reuse their
existing readonly leaf components; the SDK still owns the modal, list, labels,
empty state and Edit/Confirm controls. Do not pass an entire native Review UI.
An empty visual title keeps its supplied semantic title associated with the
value. Values must already be filtered and masked by the host.

The SDK normalizes hidden pages and resets single-page mode to the first visible
page. An empty or all-hidden list has index zero. A `controlledPageIndex` mirrors
an existing authoring selection, including intentionally hidden preview pages;
Back/Next then wait for the authoritative host publication. Supplying that fact
does not add another preview index. `onSelectTitle` is an optional admitted
authoring action; ordinary public views omit it.

Back does not submit. Next is associated with the existing form and preserves
its one submit route. `onNext` receives a one-use `advance` callback; call it only
after the host's actual validation accepts navigation. Native validation,
Compute scheduling and side effects stay in those existing callbacks. Do not
infer admission from a canonical value or a presentation-only `pending: false`.
If an application needs additional raw/pending facts, obtain them from the real
input producer rather than copying an input buffer or sampling DOM state.

## Live Review and one-shot submission

Opening Review captures the supplied callback, not a field-value snapshot.
Same-owner publications continue updating the visible Review rows. Edit and
dismiss close that opening; reopening creates a new opening. A retained old
Edit, dismiss or Confirm action cannot consume a later Review.

Confirm consumes its opening and closes the dialog before invoking the captured
host callback. Its return value is unchanged. There is no second Save call,
transport, payload builder or retry loop in this lifecycle. If the host waits
for Compute before allocation, later same-owner edits remain the host's concern:
the host chooses the current canonical payload and final admission at its real
allocation point. A resolved promise is not proof of a successful Save.

An observed owner/configuration mismatch, failed `isCurrent()` predicate or
`dispose()` permanently retires that lifecycle, including A–B–A restoration.
Previously allocated work still settles through the original host; retirement
does not cancel or reinterpret it. Create a lifecycle only from a genuinely new
accepted host and dispose it when that owner ends. Keep old actions attached to
their original lifecycle rather than looking up a successor owner at click time.

The existing detached `createFormPageOwner` API under `/forms` is unchanged. It
uses its own real bindings and approval contract; do not pair it with fabricated
native bindings to implement live Review.

## Package qualification

`scripts/native-form-pages-consumer-checks.mjs` installs one immutable archive
under the maintained 48-hour dependency policy for React 18.3.1 and 19.2.0. It
checks public ESM/CommonJS declarations, negative authority boundaries, this
guide's imports, the packaged CSS and HTML closure, and browser bundles. It runs
the same 31 lifecycle/presentation cases in each of four installed profiles
(124 test cases), plus four SSR/hydration consumers with 13 checkpoints each.
Those consumers exercise real dialog focus, the host form's Next route, live
Review updates, one-shot Confirm, post-confirm host allocation and retirement,
with no network or storage effects. Consumer directories are removed afterward.

The DOM consumer uses a synthetic browser boundary; it does not certify real
browser geometry or native Redux/backend integration. Those remain separate
native and browser acceptance work. Package verification does not change the
host's authorization, validation, persistence or cleanup obligations.

## Existing native modal stacks

`CompleteFormReview` supplies the complete header, readonly definition list,
empty state, Edit control and Confirm footer. A host whose readonly leaves open
framework-owned portaled dialogs may supply `dialogFrame` to retain that existing
modal stack. The frame receives only `title`, `onDismiss` and the complete SDK
panel as `children`; it does not receive a draft, validation callback or Save
capability. The native Form adapter uses its existing modal primitive so linked
child and attachment dialogs remain interactive above Review. Standalone
consumers use the built-in accessible HTML dialog by default.

Rows may provide `labelId` to preserve an existing host label relationship; the
host must keep those IDs unique in its document. Otherwise, the SDK generates
an instance-scoped label ID and associates each readonly value with that label.
