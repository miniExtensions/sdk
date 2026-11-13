import FuseModule from 'fuse.js';
import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import {
    getCollaboratorSelectionPresentation,
    removeCollaboratorSelection,
} from '../ui/collaboratorSelection.js';
import { PersonBadge } from './PersonBadge.js';
import { TextInput } from './TextInput.js';

export type CompleteCollaborator = {
    id: string;
    name: string;
    email: string;
    profilePicUrl?: string;
};

/** Caller-owned current write authority, separate from the supplied identities. */
export type CompleteCollaboratorEditOwner = {
    /** Actual field/session/record/configuration generation; never a value hash. */
    token: unknown;
    /** Recheck the current host authority immediately before proposing a write. */
    isCurrent(): boolean;
};

export type CollaboratorImageSource = {
    src: string;
    srcSet?: string;
    sizes?: string;
    loading?: 'lazy' | 'eager';
    decoding?: 'async' | 'sync' | 'auto';
};

export type CollaboratorAvatarPolicy =
    | { type: 'none' }
    | {
          type: 'direct';
          /** Exact allowed HTTP(S) origins; no network authority by default. */
          allowedOrigins: readonly string[];
      }
    | {
          type: 'source';
          /** Data-only integration for an existing optimizer/remote allow-list. */
          getSource(url: string): CollaboratorImageSource | null;
      };

export type CompleteCollaboratorLabels = {
    placeholder?: string;
    availableOptions?: string;
    noMatches?: string;
    empty?: string;
    open?: string;
    remove?: (label: string) => string;
};

type CommonProps<T extends CompleteCollaborator> = {
    /** Only these supplied objects may be newly selected, including an empty list. */
    choices: readonly T[];
    owner: CompleteCollaboratorEditOwner;
    readOnly?: boolean;
    disabled?: boolean;
    visible?: boolean;
    inputId?: string;
    formId?: string;
    ariaLabel?: string;
    labelledBy?: string;
    describedBy?: string;
    invalid?: boolean;
    title?: string;
    showLabel?: boolean;
    className?: string;
    labels?: CompleteCollaboratorLabels;
    avatarPolicy?: CollaboratorAvatarPolicy;
};

export type CompleteSingleCollaboratorFieldProps<
    T extends CompleteCollaborator = CompleteCollaborator,
> = CommonProps<T> & {
    value: T | null;
    onValueChange(value: T | null): void;
};

export type CompleteMultipleCollaboratorsFieldProps<
    T extends CompleteCollaborator = CompleteCollaborator,
> = CommonProps<T> & {
    value: readonly T[];
    onValueChange(value: T[]): void;
};

type ControlProps<T extends CompleteCollaborator> = CommonProps<T> & {
    value: readonly T[];
    onValueChange(value: T[]): void;
    single: boolean;
};
const stop = (event: SyntheticEvent) => event.stopPropagation();
const sameValues = <T>(a: readonly T[], b: readonly T[]) =>
    a.length === b.length && a.every((value, index) => value === b[index]);

// Fuse 6's legacy declarations are interpreted differently by NodeNext and
// CommonJS consumers. Both installed runtimes expose this original constructor.
function isFuseConstructor(
    value: unknown
): value is typeof import('fuse.js').default {
    return typeof value === 'function';
}

/** No identity lookup. The policy only handles the already-supplied avatar URL. */
function avatarSource(
    url: string | undefined,
    policy: CollaboratorAvatarPolicy | undefined
): CollaboratorImageSource | null {
    if (!url || !policy || policy.type === 'none') return null;
    if (policy.type === 'source') return policy.getSource(url);
    try {
        const parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            policy.allowedOrigins.includes(parsed.origin)
            ? { src: url, loading: 'lazy', decoding: 'async' }
            : null;
    } catch {
        return null;
    }
}

export type CollaboratorAvatarProps = {
    profilePicUrl?: string;
    avatarPolicy?: CollaboratorAvatarPolicy;
};

/** Supplied image data and explicit delivery policy, never an identity lookup. */
export function CollaboratorAvatar(props: CollaboratorAvatarProps): ReactNode {
    const source = avatarSource(props.profilePicUrl, props.avatarPolicy);
    return source
        ? h('img', {
              ...source,
              alt: '',
              width: 32,
              height: 32,
              className: 'mx-sdk-collaborator-avatar',
          })
        : null;
}

export type CollaboratorBadgeProps<
    T extends CompleteCollaborator = CompleteCollaborator,
> = {
    collaborator: T;
    avatarPolicy?: CollaboratorAvatarPolicy;
    className?: string;
    formId?: string;
    removeLabel?: string;
    /** A current caller action; the complete fields perform canonical admission. */
    onRemove?: (collaborator: T) => void;
};

/** Shared badge presentation; permission and canonical edits remain caller-owned. */
export function CollaboratorBadge<T extends CompleteCollaborator>(
    props: CollaboratorBadgeProps<T>
): ReactNode {
    const live = useRef<CollaboratorBadgeProps<T> | null>(null);
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        live.current = props;
        return () => {
            live.current = null;
        };
    });
    const label = props.collaborator.name || props.collaborator.email;
    return h(PersonBadge, {
        label,
        className: [
            'mx-sdk-collaborator-badge',
            'relative',
            'min-w-0',
            props.className,
        ]
            .filter(Boolean)
            .join(' '),
        avatar: h(CollaboratorAvatar, {
            profilePicUrl: props.collaborator.profilePicUrl,
            avatarPolicy: props.avatarPolicy,
        }),
        avatarClassName: 'mx-sdk-collaborator-badge-avatar',
        bodyClassName: 'mx-sdk-collaborator-badge-body',
        labelClassName: 'mx-sdk-collaborator-name',
        removeButtonClassName: 'mx-sdk-collaborator-remove',
        removeLabelClassName: 'mx-sdk-collaborator-sr-only',
        remove: props.onRemove
            ? {
                  label: props.removeLabel ?? `Remove collaborator ${label}`,
                  onClick: () => {
                      const current = live.current;
                      current?.onRemove?.(current.collaborator);
                  },
                  buttonProps: { form: props.formId },
              }
            : undefined,
    });
}

type PickerRuntime = typeof import('./completeCollaboratorPickerRuntime.js');
let pickerPromise: Promise<PickerRuntime> | null = null;
const loadPicker = () =>
    (pickerPromise ??= import('./completeCollaboratorPickerRuntime.js'));

function CollaboratorControl<T extends CompleteCollaborator>(
    props: ControlProps<T>
): ReactNode {
    const generatedId = useId();
    const id = props.inputId ?? generatedId;
    const root = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const accepted = useRef<ControlProps<T> | null>(null);
    const revoked = useRef(false);
    const [query, setQuery] = useState('');
    const [picker, setPicker] = useState<PickerRuntime | null>(null);
    const [loadError, setLoadError] = useState<{ error: unknown } | null>(null);
    const readyFocus = useRef<{
        proposal: readonly T[];
        from: Element | null;
        cleanup(): void;
    } | null>(null);
    const clearReadyFocus = () => {
        const waiting = readyFocus.current;
        readyFocus.current = null;
        waiting?.cleanup();
    };
    const [, reconcileFocus] = useState(0);
    const focusRequest = useRef<{
        proposal: readonly T[];
        target: 'selector' | 'remove';
    } | null>(null);
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        accepted.current = props;
        return () => {
            accepted.current = null;
        };
    });
    useCommitEffect(() => () => clearReadyFocus(), []);
    const current = () => {
        const value = accepted.current;
        if (
            !value ||
            revoked.current ||
            value.visible === false ||
            value.readOnly ||
            value.disabled
        )
            return null;
        if (!value.owner.isCurrent()) {
            // An observed revocation cannot be resurrected by A -> B -> A.
            // A legitimate successor must supply another owner generation.
            revoked.current = true;
            return null;
        }
        // The caller's authority predicate can synchronously publish or retire
        // its owner. Never return a snapshot replaced during that call.
        if (accepted.current !== value || revoked.current) return null;
        return value;
    };
    const propose = (next: T[], live: ControlProps<T>) => {
        if (current() !== live) return;
        clearReadyFocus();
        focusRequest.current = {
            proposal: next,
            target: live.single && next.length ? 'remove' : 'selector',
        };
        try {
            // Canonical selection is never stored here, even on refusal/throw.
            live.onValueChange(next);
        } catch (error) {
            focusRequest.current = null;
            throw error;
        } finally {
            // A refused callback must still consume its focus request now.
            if (accepted.current) reconcileFocus((version) => version + 1);
            else focusRequest.current = null;
        }
    };
    const remove = (collaboratorId: string) => {
        const live = current();
        if (!live || !live.value.some((value) => value.id === collaboratorId))
            return;
        propose(removeCollaboratorSelection(live.value, collaboratorId), live);
    };
    const choose = (proposal: T[]) => {
        const live = current();
        // An old combobox proposal cannot replace newer canonical neighbors.
        if (!live || !sameValues(props.value, live.value)) return;
        const removed = live.value.find(
            (value) =>
                proposal.filter((entry) => entry.id === value.id).length <
                live.value.filter((entry) => entry.id === value.id).length
        );
        if (removed) {
            remove(removed.id);
            return;
        }
        const added = proposal.find(
            (value) => !live.value.some((entry) => entry.id === value.id)
        );
        // Membership by reference preserves the original currently offered object.
        if (!added || !live.choices.includes(added)) return;
        propose(live.single ? [added] : [...live.value, added], live);
    };
    useCommitEffect(() => {
        const request = focusRequest.current;
        focusRequest.current = null;
        if (request) {
            clearReadyFocus();
            const live = current();
            // Refusal consumes the intent here; later external values cannot focus.
            if (!live || !sameValues(live.value, request.proposal)) return;
            const target =
                request.target === 'selector'
                    ? input.current
                    : root.current?.querySelector<HTMLButtonElement>(
                          'ul.mx-sdk-collaborator-badges button'
                      );
            if (target && !target.disabled) target.focus();
            else if (request.target === 'selector' && !picker) {
                // This write was already accepted. Wait only for its real control,
                // and never take focus back after the user moved elsewhere.
                const document = root.current?.ownerDocument;
                if (document) {
                    const cancel = () => clearReadyFocus();
                    readyFocus.current = {
                        proposal: request.proposal,
                        from: document.activeElement,
                        cleanup: () =>
                            document.removeEventListener(
                                'focusin',
                                cancel,
                                true
                            ),
                    };
                    // Observed focus movement retires the receipt even if focus
                    // later returns to body before the chunk finishes loading.
                    document.addEventListener('focusin', cancel, true);
                }
            }
            return;
        }
        const waiting = readyFocus.current;
        if (!waiting) return;
        const live = current();
        if (
            !live ||
            !sameValues(live.value, waiting.proposal) ||
            root.current?.ownerDocument.activeElement !== waiting.from
        ) {
            clearReadyFocus();
            return;
        }
        if (input.current && !input.current.disabled) {
            clearReadyFocus();
            input.current.focus();
        }
    });
    const fuse = useMemo(() => {
        const Constructor: unknown = FuseModule;
        if (!isFuseConstructor(Constructor))
            throw new TypeError('The pinned Fuse constructor is unavailable');
        return new Constructor<T>(props.choices, {
            keys: ['name', 'email'],
            threshold: 0.2,
            ignoreLocation: true,
            ignoreFieldNorm: true,
        });
    }, [props.choices]);
    const choices = query
        ? fuse.search(query).map((match) => match.item)
        : props.choices;
    const presentation = getCollaboratorSelectionPresentation({
        selectedCount: props.value.length,
        readOnly: Boolean(props.readOnly || props.disabled),
        limitToOneSelection: props.single,
    });
    useEffect(() => {
        if (props.readOnly || props.disabled) return;
        let active = true;
        loadPicker().then(
            (runtime) => {
                if (active) setPicker(runtime);
            },
            (error: unknown) => {
                if (active) setLoadError({ error });
            }
        );
        return () => {
            active = false;
        };
    }, [props.readOnly, props.disabled]);
    if (loadError) throw loadError.error;
    const labels = props.labels;
    return h(
        'div',
        {
            ref: root,
            role: 'group',
            'aria-labelledby':
                props.labelledBy ??
                (props.title && props.showLabel !== false
                    ? `${id}-label`
                    : undefined),
            'aria-label': props.labelledBy
                ? undefined
                : (props.title ?? props.ariaLabel),
            'aria-describedby': props.describedBy,
            'aria-invalid': props.invalid,
            className: ['mx-sdk-complete-collaborators', props.className]
                .filter(Boolean)
                .join(' '),
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: (event: KeyboardEvent) => {
                // Run after the combobox's key handler; do not cancel selection.
                if (event.key === 'Enter' && event.target === input.current)
                    event.preventDefault();
                event.stopPropagation();
            },
            onKeyUp: stop,
        },
        props.title && props.showLabel !== false
            ? h('label', { id: `${id}-label`, htmlFor: id }, props.title)
            : null,
        props.value.length
            ? h(
                  'ul',
                  { className: 'mx-sdk-collaborator-badges' },
                  ...props.value.map((collaborator, index) => {
                      const label = collaborator.name || collaborator.email;
                      return h(CollaboratorBadge<T>, {
                          key: `${collaborator.id}-${index}`,
                          collaborator,
                          avatarPolicy: props.avatarPolicy,
                          formId: props.formId,
                          removeLabel: labels?.remove?.(label),
                          onRemove: presentation.canRemove
                              ? (value) => remove(value.id)
                              : undefined,
                      });
                  })
              )
            : null,
        presentation.showSelector
            ? picker
                ? h(picker.CollaboratorPicker<T>, {
                      value: props.value,
                      choices,
                      query,
                      onChange: choose,
                      onQueryChange: setQuery,
                      onInputFocus: () => setQuery(''),
                      onClose: () => setQuery(''),
                      inputRef: input,
                      inputId: id,
                      formId: props.formId,
                      ariaLabel:
                          props.ariaLabel ??
                          (props.showLabel === false ? props.title : undefined),
                      labelledBy: props.labelledBy,
                      describedBy: props.describedBy,
                      invalid: props.invalid,
                      disabled: props.disabled,
                      labels,
                      avatarPolicy: props.avatarPolicy,
                  })
                : h(
                      'div',
                      {
                          className: 'mx-sdk-collaborator-picker',
                          'aria-busy': true,
                      },
                      h(TextInput, {
                          ref: input,
                          id,
                          form: props.formId,
                          value: '',
                          disabled: true,
                          readOnly: true,
                          placeholder: labels?.placeholder ?? 'Select',
                          'aria-label':
                              props.ariaLabel ??
                              (props.showLabel === false
                                  ? props.title
                                  : undefined),
                          'aria-labelledby': props.labelledBy,
                          'aria-describedby': props.describedBy,
                          'aria-invalid': props.invalid,
                          'aria-busy': true,
                      })
                  )
            : null,
        presentation.showEmpty
            ? h(
                  'p',
                  { className: 'mx-sdk-collaborator-empty' },
                  labels?.empty ?? 'No collaborators'
              )
            : null
    );
}

function OwnedControl<T extends CompleteCollaborator>(props: ControlProps<T>) {
    const boundary = useMemo(
        () => ({}),
        [
            props.owner.token,
            props.inputId,
            props.formId,
            props.readOnly === true,
            props.disabled === true,
            props.visible !== false,
            props.single,
        ]
    );
    const [generation, setGeneration] = useState({ boundary, key: 0 });
    if (generation.boundary !== boundary)
        setGeneration({ boundary, key: generation.key + 1 });
    if (props.visible === false) return null;
    return h(CollaboratorControl<T>, { ...props, key: generation.key });
}

/** Complete controlled picker; original single object/null and writes remain caller-owned. */
export function CompleteSingleCollaboratorField<T extends CompleteCollaborator>(
    props: CompleteSingleCollaboratorFieldProps<T>
): ReactNode {
    return h(OwnedControl<T>, {
        ...props,
        single: true,
        value: props.value == null ? [] : [props.value],
        onValueChange: (value) => props.onValueChange(value[0] ?? null),
    });
}

/** Complete controlled picker; ordered original objects are never normalized or cloned. */
export function CompleteMultipleCollaboratorsField<
    T extends CompleteCollaborator,
>(props: CompleteMultipleCollaboratorsFieldProps<T>): ReactNode {
    return h(OwnedControl<T>, { ...props, single: false });
}
