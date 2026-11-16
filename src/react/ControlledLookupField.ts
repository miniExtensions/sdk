import {
    Component,
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type MouseEvent,
    type SyntheticEvent,
} from 'react';
import { LinkedFinderCard, LinkedFinderRichLeaf } from './LinkedFinderCard.js';
import { CompleteReadOnlyTextField } from './CompleteReadOnlyTextField.js';
import {
    ControlledSingleSelectField,
    ControlledMultipleSelectsField,
} from './ControlledSelectField.js';
import {
    CompleteSingleCollaboratorField,
    CompleteMultipleCollaboratorsField,
    type CollaboratorAvatarPolicy,
    type CollaboratorImageSource,
} from './CompleteCollaboratorField.js';
import { ControlledFormulaField } from './FormulaField.js';
import { ControlledRollupField } from './RollupField.js';
import { ControlledRatingField } from './ControlledRatingField.js';
import { CompleteCheckboxField } from './CompleteCheckboxField.js';
import { CompleteRichTextEditor } from './CompleteRichTextEditor.js';
import { ReadOnlyURLGallery } from './ReadOnlyURLGallery.js';
import {
    resourceOwnerCurrent,
    resourceOwnerGeneration,
    watchResourceOwner,
    type ReadonlyResourceOwner,
} from './readonlyResourceOwner.js';
import type {
    ControlledLookupFieldProps,
    LookupPresentationOwner,
    LookupReadonlyCardLeaf,
    LookupReadonlyCardProjection,
    LookupReadonlyLinkedCollection,
    LookupResultPresentation,
    LookupPresentationState,
} from './lookupFieldTypes.js';
import {
    isLookupResultPresentation,
    isLookupImageSource,
} from './lookupPresentationValidation.js';

const noop = () => false;
const unavailable = 'Unavailable';
const invalidResult =
    'This field has an invalid value. Check the field in Airtable.';

function capturedOwnerCurrent(owner: LookupPresentationOwner): boolean {
    try {
        return (
            owner != null &&
            owner.token != null &&
            (owner.subscribe === undefined ||
                typeof owner.subscribe === 'function') &&
            resourceOwnerCurrent(owner)
        );
    } catch {
        return false;
    }
}

function ownerToken(owner: LookupPresentationOwner): unknown {
    try {
        return owner?.token;
    } catch {
        return undefined;
    }
}

// Each UI capture owns its pair generations. Object child captures remain weak;
// opaque primitive generations are retained only for this parent lease.
const composedGenerations = new WeakMap<
    object,
    {
        objects: WeakMap<object, object>;
        primitives: Map<unknown, object>;
    }
>();
function togetherGeneration(
    parent: LookupPresentationOwner,
    child: ReadonlyResourceOwner
): object {
    const parentKey =
        parent.token !== null &&
        (typeof parent.token === 'object' || typeof parent.token === 'function')
            ? parent.token
            : parent;
    let children = composedGenerations.get(parentKey);
    if (!children) {
        children = { objects: new WeakMap(), primitives: new Map() };
        composedGenerations.set(parentKey, children);
    }
    const generation = resourceOwnerGeneration(child);
    const table =
        generation !== null &&
        (typeof generation === 'object' || typeof generation === 'function')
            ? children.objects
            : children.primitives;
    let token = table.get(generation as object);
    if (!token) {
        token = {};
        table.set(generation as object, token);
    }
    return token;
}

function together(
    parent: LookupPresentationOwner,
    child?: ReadonlyResourceOwner
): LookupPresentationOwner {
    return {
        token:
            child === undefined
                ? parent.token
                : togetherGeneration(parent, child),
        isCurrent: () =>
            capturedOwnerCurrent(parent) && resourceOwnerCurrent(child),
        subscribe(listener) {
            const a = parent.subscribe?.(listener);
            let b: (() => void) | undefined;
            try {
                b = child?.subscribe?.(listener);
            } catch (error) {
                a?.();
                throw error;
            }
            return () => {
                a?.();
                b?.();
            };
        },
    };
}

/** Only data and existing guarded action ports cross this composition boundary. */
function scopedCardLeaf(
    leaf: LookupReadonlyCardLeaf,
    owner: LookupPresentationOwner,
    identity: unknown
): LookupReadonlyCardLeaf {
    switch (leaf.kind) {
        case 'sequence':
            return {
                ...leaf,
                leaves: leaf.leaves.map((item) =>
                    scopedCardLeaf(item, owner, identity)
                ),
            };
        case 'button': {
            const capture = together(owner, leaf.accepted.owner);
            return {
                ...leaf,
                accepted: {
                    ...leaf.accepted,
                    mode: 'controlled',
                    owner: capture,
                    onTriggerWebhook: leaf.accepted.onTriggerWebhook
                        ? () => {
                              if (capture.isCurrent())
                                  return leaf.accepted.onTriggerWebhook?.();
                          }
                        : undefined,
                },
            };
        }
        case 'singleLine':
            return {
                ...leaf,
                display: {
                    ...leaf.display,
                    resource: {
                        ...leaf.display.resource,
                        owner: together(owner, leaf.display.resource?.owner),
                        identity: leaf.display.resource?.identity ?? identity,
                    },
                },
            };
        case 'urlButton':
            return {
                ...leaf,
                display: {
                    ...leaf.display,
                    owner: together(owner, leaf.display.owner),
                    identity: leaf.display.identity ?? identity,
                },
            };
        case 'attachmentCollection': {
            const capture = together(owner, leaf.display.owner);
            return {
                ...leaf,
                display: {
                    ...leaf.display,
                    owner: capture,
                    onOpen: leaf.display.onOpen
                        ? (index) =>
                              capture.isCurrent()
                                  ? leaf.display.onOpen!(index)
                                  : { status: 'refused' }
                        : undefined,
                },
            };
        }
        default:
            return leaf;
    }
}

function scopedCard(
    card: LookupReadonlyCardProjection,
    owner: LookupPresentationOwner,
    identity: unknown
): LookupReadonlyCardProjection {
    return card.status === 'present'
        ? {
              ...card,
              fields: card.fields.map((field) => ({
                  ...field,
                  leaf: scopedCardLeaf(field.leaf, owner, identity),
              })),
          }
        : card;
}

function scopedAvatarPolicy(
    policy: CollaboratorAvatarPolicy | undefined,
    owner: LookupPresentationOwner
): CollaboratorAvatarPolicy | undefined {
    if (policy?.type !== 'source') return policy;
    return {
        type: 'source',
        getSource(url) {
            if (!capturedOwnerCurrent(owner)) return null;
            const source = policy.getSource(url);
            return isLookupImageSource(source)
                ? (source as CollaboratorImageSource)
                : null;
        },
    };
}

const validResult = isLookupResultPresentation;

function validPresentationMetadata(props: ControlledLookupFieldProps): boolean {
    try {
        return (
            (props.title === undefined || typeof props.title === 'string') &&
            (props.showTitle === undefined ||
                typeof props.showTitle === 'boolean') &&
            (props.labels === undefined ||
                (props.labels !== null &&
                    typeof props.labels === 'object' &&
                    ['empty', 'unavailable', 'invalidResult'].every((key) => {
                        const value = Reflect.get(props.labels!, key);
                        return value === undefined || typeof value === 'string';
                    })))
        );
    } catch {
        return false;
    }
}

function presentationState(input: unknown): LookupPresentationState {
    try {
        if (input === null || typeof input !== 'object' || !('status' in input))
            return { status: 'unavailable' };
        switch (input.status) {
            case 'masked':
            case 'empty':
            case 'unavailable':
            case 'invalid-result':
                return { status: input.status };
            case 'native-error':
                return 'message' in input && typeof input.message === 'string'
                    ? { status: 'native-error', message: input.message }
                    : { status: 'unavailable' };
            case 'ready': {
                const result = 'result' in input ? input.result : null;
                return validResult(result)
                    ? { status: 'ready', result }
                    : { status: 'unavailable' };
            }
            default:
                return { status: 'unavailable' };
        }
    } catch {
        return { status: 'unavailable' };
    }
}

function fieldFeedback(
    props: ControlledLookupFieldProps,
    fallback: string
): string {
    try {
        if (typeof props.error === 'string') return props.error;
        if (props.error != null) return fallback;
        if (props.validation === undefined) return '';
        if (!Array.isArray(props.validation)) return fallback;
        const messages: string[] = [];
        for (let index = 0; index < props.validation.length; index++) {
            const message = props.validation[index];
            if (!message || typeof message.errorMessage !== 'string')
                return fallback;
            messages.push(message.errorMessage);
        }
        return messages.join('\n');
    } catch {
        return fallback;
    }
}

class ResultBoundary extends Component<
    { identity: unknown; fallback: string; children?: ReactNode },
    { identity: unknown; failed: boolean }
> {
    state = { identity: this.props.identity, failed: false };
    static getDerivedStateFromProps(
        props: { identity: unknown },
        state: { identity: unknown; failed: boolean }
    ) {
        return props.identity !== state.identity
            ? { identity: props.identity, failed: false }
            : null;
    }
    static getDerivedStateFromError() {
        return { failed: true };
    }
    render() {
        return this.state.failed
            ? h('p', { role: 'alert' }, this.props.fallback)
            : this.props.children;
    }
}

function LinkedCollection({
    display,
    owner,
    identity,
}: {
    display: LookupReadonlyLinkedCollection;
    owner: LookupPresentationOwner;
    identity: unknown;
}): ReactNode {
    if (!capturedOwnerCurrent(owner))
        return h('p', { role: 'status' }, display.labels.unavailable);
    if (display.phase === 'loading' && display.rows.length === 0)
        return h('p', { role: 'status' }, display.labels.loading);
    if (display.phase === 'error')
        return h(
            'p',
            { role: 'alert' },
            display.error ?? display.labels.unavailable
        );
    if (display.rows.length === 0)
        return h(CompleteReadOnlyTextField, {
            value: null,
            language: 'en',
            emptyLabel: display.labels.empty,
        });
    const open = (row: LookupReadonlyLinkedCollection['rows'][number]) =>
        row.open
            ? h(
                  'button',
                  {
                      type: 'button',
                      onClick: (event: MouseEvent<HTMLButtonElement>) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (capturedOwnerCurrent(owner))
                              void row.open?.run(event.currentTarget);
                      },
                  },
                  row.open.label
              )
            : null;
    const content =
        display.layout === 'table'
            ? h(
                  'div',
                  { className: 'mx-sdk-lookup-linked-table' },
                  h(
                      'table',
                      null,
                      h(
                          'thead',
                          null,
                          h(
                              'tr',
                              null,
                              ...(display.columns ?? []).map((column) =>
                                  h(
                                      'th',
                                      { key: column.key, scope: 'col' },
                                      column.title
                                  )
                              ),
                              h('th', null)
                          )
                      ),
                      h(
                          'tbody',
                          null,
                          ...display.rows.map((row) =>
                              h(
                                  'tr',
                                  {
                                      key: row.key,
                                      style: display.rowHeight
                                          ? { height: display.rowHeight }
                                          : undefined,
                                  },
                                  ...(display.columns ?? []).map((column) => {
                                      const cell = row.cells?.find(
                                          (item) => item.key === column.key
                                      );
                                      return h(
                                          'td',
                                          { key: column.key },
                                          cell
                                              ? h(Result, {
                                                    result: cell.result,
                                                    owner,
                                                    identity,
                                                })
                                              : display.labels.unavailable
                                      );
                                  }),
                                  h('td', null, open(row))
                              )
                          )
                      )
                  )
              )
            : h(
                  'ul',
                  {
                      className: `mx-sdk-lookup-linked-${display.layout}`,
                      style:
                          display.layout === 'gallery'
                              ? {
                                    display: 'grid',
                                    gridTemplateColumns: `repeat(${display.columnsPerRow ?? 3}, minmax(0, 1fr))`,
                                }
                              : undefined,
                  },
                  ...display.rows.map((row) =>
                      h(
                          'li',
                          { key: row.key },
                          h(LinkedFinderCard, {
                              projection: scopedCard(row.card, owner, identity),
                          }),
                          open(row)
                      )
                  )
              );
    return h(
        'div',
        { className: 'mx-sdk-lookup-linked-collection' },
        content,
        display.phase === 'loading'
            ? h('p', { role: 'status' }, display.labels.loading)
            : null,
        display.loadMore
            ? h(
                  'button',
                  {
                      type: 'button',
                      disabled: display.loadMore.busy,
                      onClick: (event: MouseEvent<HTMLButtonElement>) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (capturedOwnerCurrent(owner))
                              void display.loadMore?.run();
                      },
                  },
                  display.labels.loadMore ?? display.labels.loading
              )
            : null
    );
}

function Result({
    result,
    owner,
    identity,
}: {
    result: LookupResultPresentation;
    owner: LookupPresentationOwner;
    identity: unknown;
}): ReactNode {
    if (!capturedOwnerCurrent(owner) || !validResult(result))
        return h('p', { role: 'alert' }, unavailable);
    switch (result.kind) {
        case 'sequence':
            return h(
                'div',
                {
                    className: 'mx-sdk-lookup-sequence',
                    style:
                        result.layout === 'wrap'
                            ? { display: 'flex', flexWrap: 'wrap' }
                            : undefined,
                },
                ...result.leaves.map((item) =>
                    h(
                        'div',
                        {
                            key: item.key,
                            className: 'mx-sdk-lookup-occurrence',
                        },
                        h(Result, { result: item.result, owner, identity })
                    )
                )
            );
        case 'singleSelect':
            return h(ControlledSingleSelectField, {
                ...result.display,
                owner,
                readOnly: true,
                allowAddingNewOptions: false,
                onValueChange: noop,
            });
        case 'multipleSelects':
            return h(ControlledMultipleSelectsField, {
                ...result.display,
                owner,
                readOnly: true,
                allowAddingNewOptions: false,
                onValueChange: noop,
            });
        case 'singleCollaborator':
            return h(CompleteSingleCollaboratorField, {
                ...result.display,
                avatarPolicy: scopedAvatarPolicy(
                    result.display.avatarPolicy,
                    owner
                ),
                owner,
                readOnly: true,
                onValueChange: noop,
            });
        case 'multipleCollaborators':
            return h(CompleteMultipleCollaboratorsField, {
                ...result.display,
                avatarPolicy: scopedAvatarPolicy(
                    result.display.avatarPolicy,
                    owner
                ),
                owner,
                readOnly: true,
                onValueChange: noop,
            });
        case 'formula':
            if (result.display.isValid && result.display.obscurePassword)
                return h(CompleteReadOnlyTextField, {
                    value: '••••••••',
                    language: result.display.language,
                });
            return h(ControlledFormulaField, {
                ...result.display,
                resource: {
                    ...result.display.resource,
                    owner: together(owner, result.display.resource?.owner),
                    identity: result.display.resource?.identity ?? identity,
                },
                gallery: {
                    ...result.display.gallery,
                    entries: result.display.gallery?.entries ?? [],
                    owner: together(owner, result.display.gallery?.owner),
                    identity: result.display.gallery?.identity ?? identity,
                },
            });
        case 'rollup':
            return h(ControlledRollupField, result.display);
        case 'checkboxField':
            return h(CompleteCheckboxField, {
                value: result.display.value,
                isInGrid: result.display.isInGrid,
                checkedStateLabel: result.display.checkedStateLabel,
                uncheckedStateLabel: result.display.uncheckedStateLabel,
                readOnly: true,
                onChange: noop,
            });
        case 'ratingField':
            return h(ControlledRatingField, {
                ...result.display,
                disabled: true,
                enableInlineEdit: false,
                owner,
                onChange: noop,
            });
        case 'richText': {
            const { emptyLabel, language, ...display } = result.display;
            return h(CompleteRichTextEditor, {
                ...display,
                readOnly: true,
                onValueChange: noop,
                emptyContent: h(CompleteReadOnlyTextField, {
                    value: null,
                    language,
                    emptyLabel,
                }),
            });
        }
        case 'urlGallery':
            return h(ReadOnlyURLGallery, {
                ...result.display,
                owner: together(owner, result.display.owner),
                identity: result.display.identity ?? identity,
            });
        case 'linkedCollection':
            return h(LinkedCollection, {
                display: result.display,
                owner,
                identity,
            });
        default:
            return h(LinkedFinderRichLeaf, {
                leaf: scopedCardLeaf(result, owner, identity),
            });
    }
}

/** Complete readonly presentation; it never acquires a field binding or writer. */
export function ControlledLookupField(
    props: ControlledLookupFieldProps
): ReactNode {
    const id = useId();
    const committedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const token = ownerToken(props.owner);
    const [scope, setScope] = useState({
        token,
        identity: props.identity,
        serial: 0,
        retired: false,
    });
    let capture = scope;
    if (
        !Object.is(scope.token, token) ||
        !Object.is(scope.identity, props.identity)
    ) {
        capture = {
            token,
            identity: props.identity,
            serial: scope.serial + 1,
            retired: false,
        };
        setScope(capture);
    }
    // A replayed UI lease is distinct from the host capture. Recreating this
    // lease never renews native authority: every callback also checks its host.
    const [committed, setCommitted] = useState(() => ({ capture, token: {} }));
    const live = useRef<typeof committed | null>(committed);
    committedEffect(() => {
        let lease = live.current;
        if (lease?.capture !== capture) {
            lease = { capture, token: {} };
            live.current = lease;
            setCommitted(lease);
        }
        return () => {
            if (live.current === lease) live.current = null;
        };
    }, [capture]);
    committedEffect(
        () =>
            watchResourceOwner(props.owner, () => {
                setScope((previous) =>
                    previous === capture && !previous.retired
                        ? { ...previous, retired: true }
                        : previous
                );
            }),
        [props.owner, capture]
    );
    const owner = useMemo<LookupPresentationOwner>(
        () => ({
            token: committed.token,
            isCurrent: () =>
                live.current === committed &&
                committed.capture === capture &&
                !capture.retired &&
                capturedOwnerCurrent(props.owner),
            subscribe: props.owner?.subscribe
                ? (listener) => props.owner.subscribe!(listener)
                : undefined,
        }),
        [capture, committed, props.owner]
    );
    const metadataValid = validPresentationMetadata(props);
    const labels = metadataValid ? props.labels : undefined;
    const title = metadataValid ? props.title : undefined;
    const showTitle = metadataValid && props.showTitle === true;
    const available = metadataValid && capturedOwnerCurrent(owner);
    const state = available
        ? presentationState(props.state)
        : { status: 'unavailable' as const };
    const label = labels?.unavailable ?? unavailable;
    let content: ReactNode;
    switch (state?.status) {
        case 'masked':
            content = h(CompleteReadOnlyTextField, {
                value: '••••••••',
                language: 'en',
            });
            break;
        case 'empty':
            content = h(CompleteReadOnlyTextField, {
                value: null,
                language: props.language ?? 'en',
                emptyLabel: labels?.empty,
            });
            break;
        case 'invalid-result':
            content = h(
                'p',
                { role: 'alert', 'aria-label': 'error-message' },
                labels?.invalidResult ?? invalidResult
            );
            break;
        case 'native-error':
            content = h(
                'p',
                { role: 'alert' },
                typeof state.message === 'string' ? state.message : label
            );
            break;
        case 'ready':
            content = validResult(state.result)
                ? h(Result, {
                      result: state.result,
                      owner,
                      identity: props.identity,
                  })
                : h('p', { role: 'alert' }, label);
            break;
        default:
            content = h('p', { role: 'status' }, label);
    }
    const feedback = fieldFeedback(props, label);
    const titleId = `${props.inputId ?? id}-title`,
        feedbackId = `${props.inputId ?? id}-feedback`;
    // Rich HTML anchors and the card's local carousel have no host action port.
    // Check the captured owner before their target handlers/default navigation;
    // keep resource-dialog Close controls usable after retirement.
    const guardResourceAction = (event: SyntheticEvent) => {
        if (capturedOwnerCurrent(owner)) return;
        if ('key' in event && event.key !== 'Enter' && event.key !== ' ')
            return;
        const target = event.target as {
            closest?: (selector: string) => unknown;
            parentElement?: { closest(selector: string): unknown } | null;
        };
        const element =
            typeof target.closest === 'function'
                ? target
                : target.parentElement;
        if (element?.closest?.('a, .mx-sdk-finder-carousel button')) {
            event.preventDefault();
            event.stopPropagation();
        }
    };
    return h(
        'div',
        {
            id: props.inputId,
            className: ['mx-sdk-controlled-lookup', props.className]
                .filter(Boolean)
                .join(' '),
            'aria-labelledby':
                props.labelledBy ?? (showTitle && title ? titleId : undefined),
            'aria-describedby':
                [props.describedBy, feedback ? feedbackId : undefined]
                    .filter(Boolean)
                    .join(' ') || undefined,
            'aria-busy': props.pending === true,
            'aria-invalid':
                Boolean(feedback) ||
                ['unavailable', 'invalid-result', 'native-error'].includes(
                    state.status
                ),
            onClickCapture: guardResourceAction,
            onAuxClickCapture: guardResourceAction,
            onContextMenuCapture: guardResourceAction,
            onKeyDownCapture: guardResourceAction,
            onErrorCapture: (event: SyntheticEvent) => {
                // Do not advance an obsolete image to another resource URL.
                if (!capturedOwnerCurrent(owner)) event.stopPropagation();
            },
            onClick: (event: SyntheticEvent) => event.stopPropagation(),
            onAuxClick: (event: SyntheticEvent) => event.stopPropagation(),
            onDoubleClick: (event: SyntheticEvent) => event.stopPropagation(),
            onPointerDown: (event: SyntheticEvent) => event.stopPropagation(),
            onKeyDown: (event: SyntheticEvent) => event.stopPropagation(),
            onKeyUp: (event: SyntheticEvent) => event.stopPropagation(),
        },
        showTitle && title
            ? h('div', { id: titleId, className: 'mx-sdk-lookup-title' }, title)
            : null,
        h(
            ResultBoundary,
            { key: capture.serial, identity: state, fallback: label },
            content
        ),
        feedback
            ? h(
                  'p',
                  { id: feedbackId, role: 'status', 'aria-live': 'polite' },
                  feedback
              )
            : null
    );
}
