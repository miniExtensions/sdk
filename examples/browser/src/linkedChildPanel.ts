import { AirtableFieldType } from '@miniextensions/sdk';
import type {
    FormFieldBindings,
    FormLinkedChildRecovery,
    FormLinkedChildSnapshot,
    FormPageOwner,
} from '@miniextensions/sdk/forms';
import { button, element } from './dom.js';
import { mountBoundFormField, type FieldControl } from './fields.js';
import { formAttachmentControl } from './attachmentPresentation.js';

type Options = {
    fields: FormFieldBindings;
    fieldId: string;
    recovery: FormLinkedChildRecovery;
    /** Accepted parent/render lease, independent of this action's busy state. */
    isCurrent(): boolean;
    /** Entry presentation only; an existing intent must retain its Close action. */
    isVisible?(): boolean;
    canStart(): boolean;
    request(
        description: string,
        work: (signal: AbortSignal, current: () => boolean) => Promise<void>
    ): void;
    changed(): void;
    reconciled?(): void;
    status(message: string, error?: boolean): void;
};

const childNotice = (state: FormLinkedChildSnapshot): string =>
    state.completion === 'saved-not-reconciled'
        ? 'The child was saved, but the parent draft was not updated. Inspect the linked record and reload before continuing; do not repeat the child Save.'
        : state.phase === 'saved'
          ? 'Child saved and reconciled with the parent draft. Save the parent Form to persist its linked selection.'
          : state.phase === 'unknown'
            ? 'The child Save outcome is unknown. Inspect the linked record before continuing; do not repeat the Save.'
            : (state.error ?? '');

/** A standalone Form host for the SDK's configured, explicitly opened child. */
export function createLinkedChildPanel(options: Options) {
    const owner = options.fields.linkedChild(options.fieldId, options.recovery);
    const node = element('section');
    node.dataset.linkedChildFieldId = options.fieldId;
    node.setAttribute('aria-label', 'Linked record actions');
    const actions = element('div', undefined, 'actions');
    const notice = element('p');
    notice.setAttribute('role', 'status');
    const pane = element('section');
    pane.dataset.linkedChildPane = '';
    pane.setAttribute('aria-label', 'Linked child Form');
    node.append(actions, notice, pane);
    // There is deliberately no nested form. Enter in a child input must not
    // submit the enclosing parent; textarea newlines keep their native meaning.
    pane.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
            event.preventDefault();
    });
    let destroyed = false;
    let mounted: FormFieldBindings | null = null;
    let pages: FormPageOwner | null = null;
    let stopChild = () => {};
    let stopPages = () => {};
    let currentState: FormLinkedChildSnapshot = owner.getSnapshot();
    let refreshing = false;
    const controls = new Map<string, FieldControl>();
    const wrappers = new Map<string, HTMLDivElement>();
    let childActions = element('div');
    let childProblems = element('p');
    let pageTitle = element('h4');
    const current = () => !destroyed && options.isCurrent();
    const unmount = () => {
        stopPages();
        stopChild();
        stopPages = stopChild = () => {};
        for (const control of controls.values()) control.destroy();
        controls.clear();
        wrappers.clear();
        mounted = null;
        pages = null;
        pane.replaceChildren();
    };
    const renderedCurrent = (revision: number) =>
        current() &&
        node.isConnected &&
        options.canStart() &&
        owner.getSnapshot().revision === revision;
    const request = (
        description: string,
        revision: number,
        work: (signal: AbortSignal) => Promise<unknown>,
        reportSave = false
    ) => {
        if (!renderedCurrent(revision)) return;
        options.request(description, async (signal, accepted) => {
            if (!current() || !accepted()) return;
            const before = owner.getSnapshot().completion;
            try {
                await work(signal);
            } catch {
                // Owner state distinguishes validation, unknown dispatch and
                // known saves; never turn an exception into a retry or success.
                if (current() && accepted())
                    options.status(
                        'The child action was not accepted. Inspect its current status before continuing.',
                        true
                    );
            } finally {
                if (current() && accepted()) {
                    refresh();
                    if (reportSave && current() && accepted()) {
                        const state = owner.getSnapshot();
                        options.status(
                            state.completion === 'reconciled'
                                ? 'Child saved and reconciled with the parent draft.'
                                : childNotice(state) ||
                                      'The child Save did not complete. Inspect its current status before continuing.',
                            state.completion !== 'reconciled'
                        );
                    }
                    if (
                        before !== 'reconciled' &&
                        owner.getSnapshot().completion === 'reconciled'
                    )
                        options.reconciled?.();
                    options.changed();
                }
            }
        });
    };
    const childCurrent = (child: FormFieldBindings) =>
        current() && mounted === child && owner.getSnapshot().child === child;
    const readChild = () => {
        if (mounted == null || pages == null) return;
        const visible = new Set(pages.getSnapshot().currentFieldIds);
        for (const [id, control] of controls) {
            const state = mounted.field(id).getSnapshot();
            if (
                visible.has(id) &&
                state.visibility.type === 'visible' &&
                !state.readOnly &&
                control.editable
            )
                control.read();
        }
    };
    const updateChild = () => {
        const child = mounted;
        const navigation = pages;
        if (child == null || navigation == null || !childCurrent(child)) return;
        const state = owner.getSnapshot();
        const page = navigation.getSnapshot();
        const available =
            current() &&
            state.child === child &&
            (state.phase === 'ready' || state.phase === 'error');
        const ids = new Set(page.currentFieldIds);
        for (const [id, wrapper] of wrappers) {
            const control = controls.get(id)!;
            const field = child.field(id).getSnapshot();
            wrapper.hidden =
                !ids.has(id) ||
                field.retired ||
                field.visibility.type !== 'visible';
            wrapper.inert = wrapper.hidden || !available;
            if (
                field.field?.fieldType ===
                AirtableFieldType.MULTIPLE_ATTACHMENTS
            )
                control.write(field.value ?? null);
            control.setActive?.(
                available && ids.has(id) && field.visibility.type === 'visible'
            );
        }
        pane.inert = !current() || !options.canStart();
        pageTitle.textContent =
            page.pages[page.activePageIndex]?.title ?? 'Child Form';
        childProblems.textContent =
            page.problems.length === 0
                ? ''
                : 'Review the indicated child fields before continuing.';
        childActions.replaceChildren();
        const revision = state.revision;
        const move = (direction: 'back' | 'next') => {
            if (
                !renderedCurrent(revision) ||
                !childCurrent(child) ||
                !available
            )
                return;
            try {
                if (direction === 'next') readChild();
                const outcome = navigation[direction](page.revision);
                if (!outcome.accepted)
                    options.status(
                        'Review the child page before continuing. No Save was sent.',
                        true
                    );
            } catch {
                options.status(
                    'Review the child page before continuing. No Save was sent.',
                    true
                );
            }
            refresh();
        };
        if (page.canBack)
            childActions.append(button('Child Back', () => move('back')));
        if (
            page.pages.some(
                (entry, index) => index > page.activePageIndex && !entry.hidden
            )
        )
            childActions.append(button('Child Next', () => move('next')));
        const save = button('Save child', () => {
            if (
                !renderedCurrent(revision) ||
                !childCurrent(child) ||
                !available
            )
                return;
            try {
                readChild();
            } catch {
                options.status('Review the child fields before saving.', true);
                return;
            }
            request(
                'Saving the linked child…',
                revision,
                (signal) => owner.save(revision, { signal }),
                true
            );
        });
        save.disabled = !available || !page.canSubmit;
        childActions.append(save);
        for (const button of childActions.querySelectorAll('button'))
            button.disabled ||= !available || !options.canStart();
    };
    const mount = (state: FormLinkedChildSnapshot) => {
        if (mounted === state.child && pages === state.pages) return;
        unmount();
        if (state.child == null || state.pages == null) return;
        const child = state.child;
        mounted = child;
        pages = state.pages;
        const loaded = child.getLoaded();
        pageTitle = element('h4');
        childProblems = element('p');
        childProblems.setAttribute('role', 'status');
        childActions = element('div', undefined, 'actions');
        pane.append(pageTitle);
        for (const id of loaded.payload.fieldIdsInForm) {
            const schema = loaded.payload.fieldIdsToSchemas[id];
            if (schema == null) continue;
            const binding = child.field(id);
            const control =
                schema.fieldType === AirtableFieldType.MULTIPLE_ATTACHMENTS
                    ? formAttachmentControl(
                          loaded,
                          id,
                          binding.getSnapshot().value
                      )
                    : mountBoundFormField(binding, schema, () => {
                          if (childCurrent(child)) updateChild();
                      });
            const admitInput = (event: Event) => {
                const field = binding.getSnapshot();
                const state = owner.getSnapshot();
                if (
                    childCurrent(child) &&
                    options.canStart() &&
                    (state.phase === 'ready' || state.phase === 'error') &&
                    pages?.getSnapshot().currentFieldIds.includes(id) &&
                    !field.retired &&
                    field.visibility.type === 'visible'
                )
                    return;
                event.preventDefault();
                event.stopImmediatePropagation();
            };
            for (const event of [
                'beforeinput',
                'input',
                'change',
                'click',
                'keydown',
                'compositionstart',
                'compositionupdate',
                'compositionend',
            ])
                control.node.addEventListener(event, admitInput, true);
            controls.set(id, control);
            const wrapper = element('div');
            wrapper.dataset.childFieldId = id;
            wrapper.append(control.node);
            wrappers.set(id, wrapper);
            pane.append(wrapper);
        }
        pane.append(childProblems, childActions);
        stopChild = child.controller.subscribe(() => updateChild());
        stopPages = state.pages.subscribe(() => updateChild());
    };
    const refresh = () => {
        if (destroyed || refreshing) return;
        refreshing = true;
        try {
            if (!current()) {
                node.hidden = false;
                node.inert = true;
                actions.replaceChildren();
                notice.textContent =
                    'This linked child Form belongs to an earlier owner or configuration. Reload the parent before continuing. No child Save is repeated automatically.';
                unmount();
                return;
            }
            const state = owner.getSnapshot();
            currentState = state;
            const field = options.fields.field(options.fieldId).getSnapshot();
            const visible =
                !field.retired &&
                field.visibility.type === 'visible' &&
                (options.isVisible?.() ?? true);
            const active =
                state.child != null ||
                state.phase === 'loading' ||
                state.phase === 'unknown' ||
                state.completion === 'saved-not-reconciled';
            node.hidden = !visible && !active;
            node.inert = false;
            actions.replaceChildren();
            const revision = state.revision;
            if (visible && state.canCreate)
                actions.append(
                    button('Create linked record', () =>
                        request(
                            'Opening the configured child Form…',
                            revision,
                            (signal) => owner.openCreate({ signal })
                        )
                    )
                );
            // Hydration is explicit and distinct from finder discovery. It is
            // also available for readonly parent fields with admitted child Edit.
            // Option replacement retires the earlier facet. Resolve the
            // current owner-held view for this rendered action and retain
            // that exact view only in its revision-fenced callback.
            const linked = options.fields.linkedRecords(options.fieldId);
            const selected = linked.getSnapshot();
            if (visible && selected.unresolvedSelectedIds.length !== 0)
                actions.append(
                    button('Load selected records', () =>
                        request(
                            'Loading selected linked records…',
                            revision,
                            (signal) => linked.readSelected({ signal })
                        )
                    )
                );
            for (const id of visible ? state.editableRecordIds : [])
                actions.append(
                    button(`Edit linked record ${id}`, () =>
                        request(
                            'Opening the configured linked record…',
                            revision,
                            (signal) => owner.openEdit(id, revision, { signal })
                        )
                    )
                );
            if (
                state.child != null ||
                state.phase === 'loading' ||
                state.phase === 'unknown'
            )
                actions.append(
                    button('Cancel child', () => {
                        if (
                            !current() ||
                            !node.isConnected ||
                            owner.getSnapshot().revision !== revision
                        )
                            return;
                        owner.close();
                        refresh();
                        options.changed();
                    })
                );
            for (const action of actions.querySelectorAll('button'))
                action.disabled =
                    action.textContent !== 'Cancel child' &&
                    !options.canStart();
            notice.textContent = childNotice(state);
            mount(state);
            updateChild();
        } finally {
            refreshing = false;
        }
    };
    let observedPhase = currentState.phase;
    let observedCompletion = currentState.completion;
    const stop = owner.subscribe((state) => {
        refresh();
        if (
            observedPhase !== state.phase ||
            observedCompletion !== state.completion
        ) {
            observedPhase = state.phase;
            observedCompletion = state.completion;
            options.changed();
        }
    });
    return {
        node,
        refresh,
        blocksParent: () =>
            !destroyed &&
            (currentState.phase === 'loading' ||
                currentState.phase === 'saving' ||
                currentState.phase === 'unknown' ||
                currentState.completion === 'saved-not-reconciled' ||
                (currentState.child != null &&
                    (currentState.phase === 'ready' ||
                        currentState.phase === 'error'))),
        // Rendering borrows core resources; only the owning parent closes them.
        close: () => owner.close(),
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            stop();
            unmount();
        },
    };
}
