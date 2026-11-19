import type { FormLinkedChildOwner } from '@miniextensions/sdk/forms';
import {
    FormLinkedChildCreateDialog,
    type FormLinkedChildCreateDialogProps,
    type FormLinkedChildCreateOpening,
} from '@miniextensions/sdk/react';
import {
    createElement as h,
    Fragment,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type MouseEvent,
} from 'react';

const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

type Props = {
    owner: FormLinkedChildOwner;
    parentIsCurrent(): boolean;
    renderFields: FormLinkedChildCreateDialogProps['renderFields'];
};

/** Mount beside the parent field. The owner comes from the parent's existing bindings. */
export function LinkedChildCreateAction({
    owner,
    parentIsCurrent,
    renderFields,
}: Props) {
    const button = useRef<HTMLButtonElement>(null);
    const host = useRef({ owner, parentIsCurrent });
    const activation = useRef<object | null>(null);
    const [pending, setPending] = useState<{
        owner: FormLinkedChildOwner;
        ticket: object;
    } | null>(null);
    const [failure, setFailure] = useState<FormLinkedChildOwner | null>(null);
    const [accepted, setAccepted] = useState<{
        owner: FormLinkedChildOwner;
        opening: FormLinkedChildCreateOpening;
    } | null>(null);
    useCommitEffect(() => {
        if (host.current.owner !== owner) activation.current = null;
        host.current = { owner, parentIsCurrent };
    }, [owner, parentIsCurrent]);
    const loading =
        pending?.owner === owner && pending.ticket === activation.current;

    const open = async (opener: HTMLButtonElement) => {
        if (loading || !parentIsCurrent()) return;
        const ticket = {};
        activation.current = ticket;
        const isCurrent = () =>
            activation.current === ticket &&
            button.current === opener &&
            host.current.owner === owner &&
            host.current.parentIsCurrent();
        setFailure(null);
        setPending({ owner, ticket });
        try {
            if (!(await owner.openCreate()) || !isCurrent()) return;
            const current = owner.getSnapshot();
            if (current.intent?.type === 'create' && current.child)
                setAccepted({
                    owner,
                    opening: { opener, child: current.child, isCurrent },
                });
        } catch {
            if (isCurrent()) setFailure(owner);
        } finally {
            if (isCurrent()) setPending(null);
        }
    };

    return h(
        Fragment,
        null,
        h(
            'button',
            {
                type: 'button',
                ref: button,
                disabled: loading,
                onClick: (event: MouseEvent<HTMLButtonElement>) =>
                    void open(event.currentTarget),
            },
            'Create linked record'
        ),
        failure === owner &&
            h('p', { role: 'alert' }, 'Could not open the linked form.'),
        accepted?.owner === owner &&
            h(FormLinkedChildCreateDialog, {
                owner,
                opening: accepted.opening,
                renderFields,
            })
    );
}
