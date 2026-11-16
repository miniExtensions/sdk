import type * as React from 'react';
import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useId,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { ActionButton } from './ActionButton.js';
import {
    createCSVExportController,
    type CSVExportFailure,
    type CSVExportFailureReason,
    type CSVExportRequest,
} from '../portals/csvExport.js';

export type CSVExportLabels = Readonly<{
    download: string;
    warning: string;
    continue: string;
    cancel: string;
    help: string;
    pending: string;
    errors: Readonly<Record<CSVExportFailureReason, string>>;
}>;
export type CSVExportButtonProps = Readonly<{
    request: CSVExportRequest;
    labels: CSVExportLabels;
    onFailure?: (failure: CSVExportFailure) => void;
    className?: string;
}>;

function Confirmation(props: {
    labels: CSVExportLabels;
    confirm(): void;
    dismiss(): void;
}): React.ReactElement {
    const dialog = useRef<HTMLDialogElement>(null);
    const cancel = useRef<HTMLButtonElement>(null);
    const bodyId = useId();
    useEffect(() => {
        const node = dialog.current;
        if (!node) return;
        const owner = node.ownerDocument;
        const previous = owner.activeElement;
        node.showModal();
        cancel.current?.focus({ preventScroll: true });
        return () => {
            // Passive cleanup may follow removal, when native close() can no
            // longer restore the opener. Do not steal an independently moved
            // focus or focus a trigger removed by owner retirement.
            const active = owner.activeElement;
            const restore = active === owner.body || node.contains(active);
            node.close();
            if (
                restore &&
                previous instanceof HTMLElement &&
                previous.isConnected
            )
                previous.focus({ preventScroll: true });
        };
    }, []);
    return h(
        'dialog',
        {
            ref: dialog,
            className: 'mx-sdk-csv-export__dialog',
            'aria-label': props.labels.download,
            'aria-describedby': bodyId,
            onCancel: (event: React.SyntheticEvent<HTMLDialogElement>) => {
                event.preventDefault();
                props.dismiss();
            },
            onKeyDown: (event: React.KeyboardEvent<HTMLDialogElement>) => {
                if (event.key === 'Escape') event.stopPropagation();
            },
            onClick: (event: React.MouseEvent<HTMLDialogElement>) => {
                if (event.target === event.currentTarget) props.dismiss();
            },
        },
        h(
            'div',
            { className: 'mx-sdk-csv-export__content' },
            h('p', { id: bodyId }, props.labels.warning),
            h(
                'a',
                {
                    href: 'https://docs.miniextensions.com/en/articles/5132257-the-downloaded-csv-is-missing-some-records-why',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                },
                props.labels.help
            ),
            h(
                'div',
                { className: 'mx-sdk-csv-export__actions' },
                h(
                    ActionButton,
                    { ref: cancel, onClick: props.dismiss },
                    props.labels.cancel
                ),
                h(
                    ActionButton,
                    { onClick: props.confirm },
                    props.labels.continue
                )
            )
        )
    );
}

/** Complete SDK-owned control; the host supplies admitted committed inputs. */
export function CSVExportButton(
    props: CSVExportButtonProps
): React.ReactElement | null {
    const latest = useRef(props);
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommittedEffect(() => {
        latest.current = props;
    });
    const [controller] = useState(() =>
        createCSVExportController({
            readCurrent: () => latest.current.request,
            onFailure: (failure) => latest.current.onFailure?.(failure),
        })
    );
    const snapshot = useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot
    );
    useCommittedEffect(() => {
        if (
            props.request.input.admission.allowed !== true ||
            props.request.input.admission.borrowedRecords !== false
        )
            controller.dismiss();
    }, [
        controller,
        props.request.input.admission.allowed,
        props.request.input.admission.borrowedRecords,
    ]);
    const admission = props.request.input.admission;
    if (admission.allowed !== true || admission.borrowedRecords !== false)
        return null;
    return h(
        'div',
        {
            className: ['mx-sdk-csv-export', props.className]
                .filter(Boolean)
                .join(' '),
        },
        h(
            ActionButton,
            {
                className: 'mx-sdk-csv-export__trigger',
                // Pending attempts remain independent explicit invocations.
                onClick: () => void controller.request(),
            },
            h(
                'svg',
                {
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 1.5,
                    'aria-hidden': true,
                },
                h('path', {
                    d: 'M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5',
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                })
            ),
            props.labels.download
        ),
        snapshot.pendingCount > 0
            ? h('span', { role: 'status' }, props.labels.pending)
            : null,
        snapshot.failure
            ? h(
                  'p',
                  { role: 'alert' },
                  props.labels.errors[snapshot.failure.reason]
              )
            : null,
        snapshot.confirmationOpen
            ? h(Confirmation, {
                  labels: props.labels,
                  confirm: () => void controller.confirm(),
                  dismiss: controller.dismiss,
              })
            : null
    );
}
