import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
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
    labels: AttachmentUrlInputLabels;
    /** The host's captured field owner, with a new token for each lifetime. */
    owner: ReadonlyResourceOwner;
    readOnly?: boolean;
    masked?: boolean;
    full?: boolean;
    /** Recheck native admission and synchronously append to the current draft. */
    appendCurrent(attachment: AttachmentUrlDraft): boolean;
}>;

/** Stage one URL in a host draft without uploading or submitting its Form. */
export function AttachmentUrlInput(props: AttachmentUrlInputProps) {
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
    return h(
        'div',
        { className: 'mx-sdk-attachment-url' },
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
                    onClick(event) {
                        event.stopPropagation();
                        add();
                    },
                },
                props.labels.add
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
