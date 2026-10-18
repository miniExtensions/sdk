import {
    createElement as h,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type { AttachmentPhase } from '../forms/attachmentController.js';
import type {
    AttachmentRendererActions,
    FieldRendererProps,
} from '../ui/rendererRegistry.js';
import { FieldRendererSource } from './fieldRendererSource.js';

export type MultipleAttachmentsFieldOptions = { className?: string };
export type MultipleAttachmentsFieldProps = MultipleAttachmentsFieldOptions & {
    /** Borrow an accepted slot snapshot; never construct a controller or queue. */
    field: FieldRendererProps<'multipleAttachments'>;
};

type Row = { nativeIndex: number; label: string; removeAllowed: boolean };
type View =
    | { type: 'masked' | 'unavailable' | 'retired' }
    | {
          type: 'ready';
          available: boolean;
          rows: Row[];
          count: number;
          phase: AttachmentPhase;
          busy: boolean;
          pending: boolean;
          invalid: boolean;
          actions: Omit<AttachmentRendererActions, 'state'>;
      };

const stop = (event: SyntheticEvent) => event.stopPropagation();
const unavailable: View = { type: 'unavailable' };
const plain = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};
const revision = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Inspect only the filtered facet. The native value is never read, even when editable. */
function presentation(props: MultipleAttachmentsFieldProps['field']): View {
    try {
        let readOnly = false;
        for (const config of [props.displayConfig, props.writeConfig]) {
            if (config == null) continue;
            const candidate: unknown = config;
            if (!plain(candidate)) return unavailable;
            const obscure = candidate.obscurePassword;
            const loginMask = candidate.maskPasswordOnLoginScreen;
            if (
                (obscure !== undefined && obscure !== false) ||
                (loginMask !== undefined && loginMask !== false)
            )
                return { type: 'masked' };
            const configuredReadOnly = candidate.readOnly;
            if (
                configuredReadOnly !== undefined &&
                configuredReadOnly !== false
            )
                readOnly = true;
        }
        if (
            readOnly ||
            props.physicalKind !== 'multipleAttachments' ||
            props.field.config.type !== 'multipleAttachments' ||
            props.presentation.type !== 'physical' ||
            props.presentation.config.type !== 'multipleAttachments' ||
            props.computed !== false ||
            props.context !== 'form'
        )
            return unavailable;
        const capability = props.capability;
        if (!plain(capability) || capability.type !== 'editable')
            return unavailable;
        const facet = capability.attachment;
        if (!plain(facet)) return unavailable;
        const state = facet.state;
        if (!plain(state)) return unavailable;
        const retired = state.retired;
        const phase = state.phase;
        if (retired === true || phase === 'retired') return { type: 'retired' };
        const status = state.presentation;
        const busy = state.busy;
        const pending = props.pending;
        if (
            retired !== false ||
            (status !== 'ready' && status !== 'unavailable') ||
            typeof busy !== 'boolean' ||
            typeof pending !== 'boolean' ||
            ![
                'idle',
                'selected',
                'uploading',
                'accepted',
                'uncertain',
            ].includes(phase as string) ||
            !revision(state.revision) ||
            !revision(state.valuesRevision)
        )
            return unavailable;
        // An unavailable projection retains only queue activity; no rows are inspected.
        const rows = status === 'ready' ? state.rows : [];
        const files = state.files;
        const error = state.error;
        const validation = props.validation;
        if (
            !Array.isArray(rows) ||
            !Array.isArray(files) ||
            (error !== null && typeof error !== 'string') ||
            !Array.isArray(validation)
        )
            return unavailable;
        // Pending File identities and metadata remain entirely controller-owned.
        const count = files.length;
        const rowCount = rows.length;
        if (!revision(count) || !revision(rowCount)) return unavailable;
        for (let index = 0; index < count; index++)
            if (!Object.hasOwn(files, index)) return unavailable;
        const captured: Row[] = [];
        let previous = -1;
        for (let index = 0; index < rowCount; index++) {
            if (!Object.hasOwn(rows, index)) return unavailable;
            const row = rows[index];
            if (!plain(row)) return unavailable;
            const nativeIndex = row.nativeIndex;
            const label = row.label;
            const removeAllowed = row.removeAllowed;
            if (
                !revision(nativeIndex) ||
                (nativeIndex as number) <= previous ||
                typeof label !== 'string' ||
                typeof removeAllowed !== 'boolean'
            )
                return unavailable;
            previous = nativeIndex as number;
            captured.push({ nativeIndex: previous, label, removeAllowed });
        }
        const { select, clear, remove, upload, cancel } = facet;
        if (
            [select, clear, remove, upload, cancel].some(
                (action) => typeof action !== 'function'
            )
        )
            return unavailable;
        return {
            type: 'ready',
            available: status === 'ready',
            rows: captured,
            count,
            phase: phase as AttachmentPhase,
            busy,
            pending,
            invalid:
                error !== null || props.error !== null || validation.length > 0,
            actions: { select, clear, remove, upload, cancel } as Omit<
                AttachmentRendererActions,
                'state'
            >,
        };
    } catch {
        return unavailable;
    }
}

/** A thin slot adapter: the existing owner retains admission, queue and uncertainty. */
export function MultipleAttachmentsField({
    field,
    className,
}: MultipleAttachmentsFieldProps): ReactNode {
    const id = useId();
    const source = useContext(FieldRendererSource) ?? field;
    const lifetime = useRef({ source, field, token: {} });
    if (lifetime.current.source !== source || lifetime.current.field !== field)
        lifetime.current = { source, field, token: {} };
    const token = lifetime.current.token;
    const mounted = useRef(true);
    const flight = useRef<object | null>(null);
    const [operation, setOperation] = useState({
        token,
        pending: false,
        failed: false,
    });
    const input = useRef<HTMLInputElement>(null);
    const section = useRef<HTMLElement>(null);
    const choose = useRef<HTMLButtonElement>(null);
    const upload = useRef<HTMLButtonElement>(null);
    const cancel = useRef<HTMLButtonElement>(null);
    const focus = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const current = () => mounted.current && lifetime.current.token === token;
    const view = presentation(field);
    const localBusy = operation.token === token && operation.pending;
    const localFailed = operation.token === token && operation.failed;
    useLayoutEffect(() => {
        const node = section.current;
        const previous = focus.current;
        if (!node || !previous) return;
        const active = node.ownerDocument.activeElement;
        if (
            active !== previous &&
            !(active === node.ownerDocument.body && !previous.isConnected)
        )
            return;
        if (previous.isConnected && !previous.disabled) return;
        const rows = Array.from(
            node.querySelectorAll<HTMLButtonElement>(
                'button[data-attachment-row]:not(:disabled)'
            )
        );
        const index = previous.dataset.attachmentRow;
        const nextRow =
            index === undefined
                ? null
                : (rows.find(
                      (button) =>
                          Number(button.dataset.attachmentRow) >= Number(index)
                  ) ?? rows.at(-1));
        const next =
            nextRow ??
            [cancel.current, upload.current, choose.current].find(
                (button) => button && !button.disabled
            );
        (next ?? node).focus();
    });
    let title = 'Attachments';
    let showTitle = true;
    try {
        if (typeof field.title === 'string' && field.title.trim())
            title = field.title;
        else if (typeof field.field.name === 'string') title = field.field.name;
        showTitle = !(
            field.displayConfig &&
            'showTitle' in field.displayConfig &&
            field.displayConfig.showTitle === false
        );
    } catch {
        /* Generic title needs no attachment metadata. */
    }
    if (view.type === 'retired') return null;
    if (
        view.type !== 'ready' ||
        (!view.available &&
            view.count === 0 &&
            !view.busy &&
            view.phase !== 'uncertain')
    )
        return h(
            'span',
            {
                className: ['mx-sdk-multiple-attachments-field', className]
                    .filter(Boolean)
                    .join(' '),
                onClick: stop,
                onAuxClick: stop,
                onDoubleClick: stop,
                onPointerDown: stop,
                onPointerUp: stop,
                onKeyDown: (event: import('react').KeyboardEvent) => {
                    stop(event);
                    if (event.key === 'Enter') event.preventDefault();
                },
                onKeyUp: stop,
            },
            h(
                'output',
                { 'aria-label': title },
                view.type === 'masked'
                    ? '••••••••'
                    : 'Attachment presentation unavailable'
            )
        );
    const uncertain = view.phase === 'uncertain';
    const busy = view.busy || localBusy;
    const chooseDisabled =
        !view.available || view.pending || (uncertain && !view.busy);
    const uploadDisabled =
        !view.available ||
        view.pending ||
        busy ||
        uncertain ||
        view.count === 0;
    const invoke = (action: () => unknown) => {
        if (!current()) return;
        try {
            action();
        } catch {
            if (current())
                setOperation({ token, pending: false, failed: true });
        }
    };
    const startUpload = () => {
        if (!current() || uploadDisabled || flight.current === token) return;
        flight.current = token;
        setOperation({ token, pending: true, failed: false });
        const finish = (failed: boolean) => {
            if (current() && flight.current === token) {
                flight.current = null;
                setOperation({ token, pending: false, failed });
            }
        };
        try {
            void Promise.resolve(view.actions.upload()).then(
                (result) => finish(result !== true),
                () => finish(true)
            );
        } catch {
            finish(true);
        }
    };
    const message = uncertain
        ? 'Upload outcome uncertain. Inspect the upload before continuing; it was not added or retried automatically.'
        : busy
          ? 'Uploading one attachment. Wait for confirmation before uploading the next file.'
          : view.phase === 'accepted'
            ? 'Attachment accepted into the draft. Save to submit your changes.'
            : view.count > 0
              ? 'Files selected. Upload each file explicitly, then Save.'
              : 'No pending files. Choose files to begin.';
    return h(
        'section',
        {
            ref: section,
            tabIndex: -1,
            className: ['mx-sdk-multiple-attachments-field', className]
                .filter(Boolean)
                .join(' '),
            'aria-label': title,
            'aria-describedby': `${id}-status`,
            'aria-busy': busy || view.pending,
            'aria-invalid': view.invalid || localFailed,
            style: {
                display: 'grid',
                gap: '0.75rem',
                minWidth: 0,
                overflowWrap: 'anywhere',
            },
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onPointerUp: stop,
            onKeyUp: stop,
            onKeyDown: (event: import('react').KeyboardEvent<HTMLElement>) => {
                stop(event);
                if (
                    event.key === 'Enter' &&
                    !(event.target as HTMLElement).closest?.('button')
                )
                    event.preventDefault();
            },
            onChange: stop,
            onCancel: stop,
            onDragOver: (event: SyntheticEvent) => {
                stop(event);
                event.preventDefault();
            },
            onDrop: (event: SyntheticEvent) => {
                stop(event);
                event.preventDefault();
            },
            onFocusCapture: (
                event: import('react').FocusEvent<HTMLElement>
            ) => {
                focus.current =
                    event.target.tagName === 'BUTTON'
                        ? (event.target as HTMLButtonElement)
                        : null;
            },
            onBlurCapture: (event: import('react').FocusEvent<HTMLElement>) => {
                if (
                    event.relatedTarget &&
                    !event.currentTarget.contains(event.relatedTarget)
                )
                    focus.current = null;
            },
        },
        showTitle ? h('strong', null, title) : null,
        !view.available
            ? h('p', null, 'Attachment presentation unavailable')
            : h(
                  'ul',
                  {
                      'aria-label': 'Existing attachments',
                      style: { margin: 0, paddingInlineStart: '1.5rem' },
                  },
                  ...view.rows.map((row, index) =>
                      h(
                          'li',
                          { key: row.nativeIndex },
                          h(
                              'span',
                              {
                                  style: {
                                      whiteSpace: 'pre-wrap',
                                      overflowWrap: 'anywhere',
                                  },
                              },
                              row.label
                          ),
                          h(
                              'button',
                              {
                                  type: 'button',
                                  'data-attachment-row': index,
                                  'aria-label': `Remove attachment ${index + 1}`,
                                  disabled:
                                      view.pending ||
                                      busy ||
                                      uncertain ||
                                      !row.removeAllowed,
                                  onClick: () => {
                                      if (
                                          !view.pending &&
                                          !busy &&
                                          !uncertain &&
                                          row.removeAllowed
                                      )
                                          invoke(() =>
                                              view.actions.remove(
                                                  row.nativeIndex
                                              )
                                          );
                                  },
                              },
                              'Remove attachment'
                          )
                      )
                  )
              ),
        h('input', {
            ref: input,
            type: 'file',
            multiple: true,
            hidden: true,
            disabled: chooseDisabled,
            'aria-label': `Choose files for ${title}`,
            onChange: (
                event: import('react').ChangeEvent<HTMLInputElement>
            ) => {
                stop(event);
                if (current() && !chooseDisabled) {
                    const files = Array.from(event.currentTarget.files ?? []);
                    if (files.length > 0)
                        invoke(() => view.actions.select(files));
                }
                event.currentTarget.value = '';
            },
            onCancel: stop,
        }),
        h(
            'div',
            {
                id: `${id}-status`,
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': true,
            },
            h(
                'p',
                null,
                `${view.count} pending ${view.count === 1 ? 'file' : 'files'}.`
            ),
            h('p', null, message),
            view.invalid || localFailed
                ? h(
                      'p',
                      null,
                      'Attachment activity could not be completed. Review the field before continuing.'
                  )
                : null
        ),
        busy
            ? h('progress', {
                  'aria-label': uncertain
                      ? 'Awaiting upload outcome'
                      : 'Uploading attachment',
              })
            : null,
        h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' } },
            h(
                'button',
                {
                    ref: choose,
                    type: 'button',
                    disabled: chooseDisabled,
                    'aria-describedby': `${id}-status`,
                    onClick: () => {
                        if (current() && !chooseDisabled)
                            input.current?.click();
                    },
                },
                'Choose files'
            ),
            h(
                'button',
                {
                    ref: upload,
                    type: 'button',
                    disabled: uploadDisabled,
                    'aria-describedby': `${id}-status`,
                    onClick: startUpload,
                },
                'Upload next file'
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: view.count === 0,
                    onClick: () => {
                        if (view.count > 0) invoke(view.actions.clear);
                    },
                },
                'Clear pending files'
            ),
            h(
                'button',
                {
                    ref: cancel,
                    type: 'button',
                    disabled: !view.busy,
                    onClick: () => {
                        if (view.busy) invoke(view.actions.cancel);
                    },
                },
                'Cancel upload'
            )
        )
    );
}

/** Existing Form slot only; readonly/missing facets never expose native metadata. */
export function renderMultipleAttachmentsField(
    props: FieldRendererProps<'multipleAttachments'>,
    options: MultipleAttachmentsFieldOptions = {}
): ReactNode {
    return h(MultipleAttachmentsField, {
        field: props,
        className: options.className,
    });
}
