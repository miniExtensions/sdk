import {
    createElement as h,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactElement,
    type SyntheticEvent,
} from 'react';
import {
    createImageAnnotationSession,
    type ImageAnnotationAppend,
    type ImageAnnotationFailure,
    type ImageAnnotationOwner,
    type ImageAnnotationSource,
    type ImageAnnotationSourceLease,
    type ImageAnnotationStorage,
} from './imageAnnotationSession.js';
import {
    openImageAnnotationMarkerEditor,
    type ImageAnnotationEditorLabels,
} from './imageAnnotationMarkerDriver.js';

export type ImageAnnotationRequest = ImageAnnotationSource & {
    /** A real host selection identity, stable through benign value/render echoes. */
    token: object;
};

export type ImageAnnotationFieldLabels = {
    selectImage: string;
    dropHint: string;
    saving: string;
    decodeError: string;
    editorError: string;
    renderError: string;
    storageError: string;
    attribution: string;
    editor: ImageAnnotationEditorLabels;
};

const defaultLabels: ImageAnnotationFieldLabels = {
    selectImage: 'Select an image to annotate',
    dropHint: 'or drag and drop.',
    saving: 'Saving...',
    decodeError: 'Failed to load the image.',
    editorError: 'Failed to open the annotation editor. Please try again.',
    renderError: 'Failed to render the annotated image. Please try again.',
    storageError: 'Failed to save the annotated image. Please try again.',
    attribution: 'Image annotation powered by marker.js',
    editor: {
        title: 'Annotate image',
        moreTools: 'More annotation tools',
    },
};

export type ImageAnnotationFieldProps<Upload> = {
    owner: ImageAnnotationOwner;
    /** Captured original transport/append ports. Replace owner on authority change. */
    storage: ImageAnnotationStorage<Upload>;
    appendCurrent: ImageAnnotationAppend;
    remoteSource?: ImageAnnotationRequest | null;
    /** UI close only; never an upload or record-Save success callback. */
    onEditorClose?: () => void;
    /** Nonthrowing host observer. Raw errors are never rendered or logged by SDK. */
    onError?: (phase: ImageAnnotationFailure, error: unknown) => void;
    labels?: ImageAnnotationFieldLabels;
    disabled?: boolean;
    readOnly?: boolean;
    id?: string;
    name?: string;
    form?: string;
    ariaLabel?: string;
    ariaDescribedBy?: string;
    className?: string;
};

/** Explicit host-authorized Form annotation, separate from bound upload admission.
 * The host alone authorizes temporary storage and appends under its current owner.
 */
export function ImageAnnotationField<Upload>(
    props: ImageAnnotationFieldProps<Upload>
): ReactElement {
    const generatedId = useId();
    const id = props.id ?? 'mx-image-annotation-' + generatedId;
    const errorId = id + '-error';
    const labels = props.labels ?? defaultLabels;
    const attribution = labels.attribution.trim()
        ? labels.attribution
        : defaultLabels.attribution;
    const latest = useRef(props);
    latest.current = props;
    const input = useRef<HTMLInputElement>(null);
    const installed = useRef<ReturnType<
        typeof createImageAnnotationSession<Upload>
    > | null>(null);
    const sourceRef = useRef<ImageAnnotationSourceLease | null>(null);
    const lastRemote = useRef<ImageAnnotationRequest | null>(null);
    const remoteLease = useRef<object | null>(null);
    const initializing = useRef(new WeakSet<object>());
    const nextSourceKey = useRef(0);
    const [sourceKey, setSourceKey] = useState(0);
    const [source, setSource] = useState<ImageAnnotationSourceLease | null>(
        null
    );
    const [saving, setSaving] = useState(false);
    const [pickerKey, setPickerKey] = useState(0);
    const [failure, setFailure] = useState<ImageAnnotationFailure | null>(null);
    const disabled = props.disabled === true;
    const readOnly = props.readOnly === true;
    const eventSession = installed.current;
    const lifetime = useMemo(
        () => ({
            token: props.owner.token,
            disabled,
            readOnly,
        }),
        [props.owner.token, disabled, readOnly]
    );

    useLayoutEffect(() => {
        const captured = latest.current;
        if (captured.owner.token !== lifetime.token) return;
        const session = createImageAnnotationSession({
            owner: captured.owner,
            storage: captured.storage,
            appendCurrent: captured.appendCurrent,
            releaseObjectUrl: (url) => URL.revokeObjectURL(url),
            onSavingChange(next) {
                if (installed.current === session) setSaving(next);
            },
            onClose(token) {
                if (
                    installed.current !== session ||
                    sourceRef.current?.token !== token
                )
                    return;
                sourceRef.current = null;
                setSource(null);
                if (input.current) input.current.value = '';
                captured.onEditorClose?.();
            },
            onFailure(phase, error) {
                if (installed.current !== session) return;
                setFailure(phase);
                captured.onError?.(phase, error);
            },
        });
        installed.current = session;
        setPickerKey((key) => key + 1);
        sourceRef.current = null;
        lastRemote.current = null;
        remoteLease.current = null;
        setSource(null);
        setSaving(false);
        setFailure(null);
        return () => {
            if (installed.current === session) installed.current = null;
            try {
                session.dispose();
            } catch (error) {
                captured.onError?.('editor', error);
            }
        };
    }, [lifetime]);

    useLayoutEffect(() => {
        const session = installed.current;
        if (!session || !session.isCurrent()) return;
        const request = props.remoteSource ?? null;
        if (!request) {
            // Parent clears its selection on normal close. The rendered upload
            // continues; an externally removed still-open source is retired.
            if (
                lastRemote.current &&
                sourceRef.current?.token === remoteLease.current &&
                sourceRef.current?.isCurrent()
            ) {
                session.clearSource();
                sourceRef.current = null;
                setSource(null);
            }
            lastRemote.current = null;
            remoteLease.current = null;
            return;
        }
        if (lifetime.disabled || lifetime.readOnly) return;
        if (
            lastRemote.current?.token === request.token &&
            lastRemote.current.url === request.url &&
            lastRemote.current.filename === request.filename
        )
            return;
        lastRemote.current = request;
        setFailure(null);
        const lease = session.beginSource({
            ...request,
            ownedObjectUrl: false,
        });
        remoteLease.current = lease?.token ?? null;
        sourceRef.current = lease;
        setSourceKey(++nextSourceKey.current);
        setSource(lease);
    }, [lifetime, props.remoteSource]);

    const open = (
        lease: ImageAnnotationSourceLease,
        image: HTMLImageElement
    ) => {
        if (!lease.isCurrent() || initializing.current.has(lease.token)) return;
        initializing.current.add(lease.token);
        void openImageAnnotationMarkerEditor({
            image,
            lease,
            labels: latest.current.labels?.editor ?? defaultLabels.editor,
        });
    };
    const feedback =
        failure === 'decode'
            ? labels.decodeError
            : failure === 'editor'
              ? labels.editorError
              : failure === 'render'
                ? labels.renderError
                : labels.storageError;
    const describedBy =
        [props.ariaDescribedBy, failure ? errorId : undefined]
            .filter(Boolean)
            .join(' ') || undefined;

    return h(
        'div',
        {
            className: ['mx-sdk-image-annotation', props.className]
                .filter(Boolean)
                .join(' '),
        },
        failure
            ? h(
                  'p',
                  {
                      id: errorId,
                      role: 'alert',
                      className: 'mx-sdk-image-annotation-error',
                  },
                  feedback
              )
            : null,
        saving
            ? h(
                  'p',
                  {
                      role: 'status',
                      'aria-live': 'polite',
                      className: 'mx-sdk-image-annotation-saving',
                  },
                  labels.saving
              )
            : null,
        h(
            'div',
            { className: 'mx-sdk-image-annotation-picker' },
            h('input', {
                key: pickerKey,
                ref: input,
                id,
                type: 'file',
                accept: 'image/*',
                name: props.name,
                form: props.form,
                disabled: lifetime.disabled || lifetime.readOnly || saving,
                'aria-label': props.ariaLabel ?? labels.selectImage,
                'aria-describedby': describedBy,
                onChange(event) {
                    const file = event.currentTarget.files?.[0];
                    if (!file || !file.type.startsWith('image/')) return;
                    if (lifetime.disabled || lifetime.readOnly || saving)
                        return;
                    const session = installed.current;
                    if (
                        !session ||
                        session !== eventSession ||
                        !session.isCurrent()
                    )
                        return;
                    setFailure(null);
                    try {
                        const lease = session.beginSource({
                            url: URL.createObjectURL(file),
                            filename: file.name,
                            ownedObjectUrl: true,
                        });
                        remoteLease.current = null;
                        sourceRef.current = lease;
                        setSourceKey(++nextSourceKey.current);
                        setSource(lease);
                    } catch (error) {
                        setFailure('decode');
                        latest.current.onError?.('decode', error);
                    }
                },
            }),
            h('label', { htmlFor: id }, labels.selectImage),
            h('span', { 'aria-hidden': true }, labels.dropHint)
        ),
        h(
            'p',
            { className: 'mx-sdk-image-annotation-credit' },
            h(
                'a',
                {
                    href: 'https://markerjs.com',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                },
                attribution
            )
        ),
        source
            ? h(
                  'div',
                  {
                      className: 'mx-sdk-image-annotation-source',
                      'aria-hidden': true,
                  },
                  h('img', {
                      key: sourceKey,
                      src: source.source.url,
                      crossOrigin: 'anonymous',
                      alt: '',
                      onLoad(event: SyntheticEvent<HTMLImageElement>) {
                          open(source, event.currentTarget);
                      },
                      onError() {
                          source.fail(
                              'decode',
                              new Error('Annotation image decode failed')
                          );
                      },
                  })
              )
            : null
    );
}

/** Compatibility alias; natural public name is ImageAnnotationField. */
export const CompleteImageAnnotationField = ImageAnnotationField;
