import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ReactElement,
} from 'react';
import {
    getAttachmentFilenameFromUrl,
    isAttachmentUploadUrlCompatible,
} from '../ui/attachmentInputCompatibility.js';
import { ActionButton } from './ActionButton.js';
import {
    resourceOwnerCurrent,
    resourceOwnerGeneration,
    watchResourceOwner,
    type ReadonlyResourceOwner,
} from './readonlyResourceOwner.js';

export type AttachmentUrlDraft = Readonly<{
    id: null;
    url: string;
    filename: string;
}>;

export type AttachmentUrlInputLabels = Readonly<{
    url: string;
    add: string;
    invalidUrl: string;
    appendRefused: string;
}>;

export type AttachmentUrlInputProps = Readonly<{
    id?: string;
    /** ID of the host field label when the surrounding Form provides one. */
    labelledBy?: string;
    labels: AttachmentUrlInputLabels;
    /** Join the URL input and icon action using the native Form presentation. */
    layout?: 'native-form';
    /** The host's captured field owner, with a new token for each lifetime. */
    owner: ReadonlyResourceOwner;
    readOnly?: boolean;
    masked?: boolean;
    full?: boolean;
    /** Recheck native admission and synchronously append to the current draft. */
    appendCurrent(attachment: AttachmentUrlDraft): boolean;
}>;

/** Stage one URL in a host draft without uploading or submitting its Form. */
export function AttachmentUrlInput(
    props: AttachmentUrlInputProps
): ReactElement | null {
    const generation = resourceOwnerGeneration(props.owner);
    const [lifetime, setLifetime] = useState({ generation, revision: 0 });
    let revision = lifetime.revision;
    if (!Object.is(lifetime.generation, generation)) {
        revision++;
        setLifetime({ generation, revision });
    }
    if (
        props.owner == null ||
        props.readOnly ||
        props.masked ||
        props.full ||
        !resourceOwnerCurrent(props.owner)
    )
        return null;
    return h(UrlDraft, { ...props, key: revision });
}

function UrlDraft(props: AttachmentUrlInputProps) {
    const [value, setValue] = useState('');
    const [error, setError] = useState<'invalidUrl' | 'appendRefused' | null>(
        null
    );
    const [retired, setRetired] = useState(false);
    const draft = useRef('');
    const adding = useRef(false);
    const live = useRef<AttachmentUrlInputProps | null>(null);
    const errorId = useId();
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        live.current = props;
        return () => {
            live.current = null;
        };
    }, [props]);
    commitEffect(
        () => watchResourceOwner(props.owner, () => setRetired(true)),
        [props.owner]
    );

    const add = () => {
        if (
            live.current !== props ||
            retired ||
            adding.current ||
            !resourceOwnerCurrent(props.owner)
        )
            return;
        const entered = draft.current;
        // Match the native URL input's surrounding ASCII whitespace removal.
        const url = entered.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
        if (url === '') return;
        if (!isAttachmentUploadUrlCompatible(url)) {
            setError('invalidUrl');
            return;
        }

        adding.current = true;
        try {
            const accepted = props.appendCurrent({
                id: null,
                url,
                filename: getAttachmentFilenameFromUrl(url),
            });
            if (live.current == null || draft.current !== entered) return;
            if (accepted !== true) {
                setError('appendRefused');
                return;
            }
            draft.current = '';
            setValue('');
            setError(null);
        } finally {
            adding.current = false;
        }
    };

    if (retired) return null;
    const nativeForm = props.layout === 'native-form';
    return h(
        'div',
        { className: 'mx-sdk-attachment-url', 'data-layout': props.layout },
        h(
            'div',
            { className: 'mx-sdk-attachment-url__controls' },
            h('input', {
                // The draft's validity must not block the host Form's Save.
                type: 'text',
                inputMode: 'url',
                id: props.id,
                className: 'mx-sdk-attachment-url__input',
                'aria-label': props.labels.url,
                'aria-labelledby': props.labelledBy,
                'aria-invalid': error != null || undefined,
                'aria-describedby': error != null ? errorId : undefined,
                placeholder: props.labels.url,
                value,
                onChange(event) {
                    if (
                        live.current !== props ||
                        retired ||
                        !resourceOwnerCurrent(props.owner)
                    )
                        return;
                    draft.current = event.currentTarget.value;
                    setValue(draft.current);
                    setError(null);
                },
                onKeyDown(event) {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing)
                        return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (!event.repeat) add();
                },
            }),
            h(
                ActionButton,
                {
                    className: 'mx-sdk-attachment-url__add',
                    'aria-label': nativeForm ? props.labels.add : undefined,
                    onClick(event) {
                        event.stopPropagation();
                        add();
                    },
                },
                nativeForm
                    ? h(
                          'svg',
                          {
                              'aria-hidden': true,
                              viewBox: '0 0 24 24',
                              fill: 'currentColor',
                              className: 'mx-sdk-attachment-url__add-icon',
                          },
                          h('path', {
                              fillRule: 'evenodd',
                              clipRule: 'evenodd',
                              d: 'M10.5 3.75a6 6 0 0 0-5.98 6.496A5.25 5.25 0 0 0 6.75 20.25H18a4.5 4.5 0 0 0 2.206-8.423 3.75 3.75 0 0 0-4.133-4.303A6.001 6.001 0 0 0 10.5 3.75Zm2.03 5.47a.75.75 0 0 0-1.06 0l-3 3a.75.75 0 1 0 1.06 1.06l1.72-1.72v4.94a.75.75 0 0 0 1.5 0v-4.94l1.72 1.72a.75.75 0 1 0 1.06-1.06l-3-3Z',
                          })
                      )
                    : props.labels.add
            )
        ),
        error != null
            ? h(
                  'p',
                  {
                      id: errorId,
                      role: 'alert',
                      className: 'mx-sdk-attachment-url__error',
                  },
                  props.labels[error]
              )
            : null
    );
}
