// Browser-check-only host arrangements. No transport or Save implementation.
import { createElement as h, StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createDateFieldModel } from '@miniextensions/sdk/ui';
import { renderDateTimeField } from '@miniextensions/sdk/react';

const initial = '2024-02-29T12:30:45.007+05:45';
const config = {
    type: 'dateTime',
    options: {
        dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
        timeFormat: { name: '24hour', format: 'HH:mm' },
        timeZone: 'utc',
    },
} as const;
const make = (id: string, withSubmitButton: boolean) => {
    let value: string | null = initial;
    const evidence = {
        id,
        withSubmitButton,
        writes: 0,
        parentKeyDowns: 0,
        parentCompositions: 0,
        submitButtonClicks: 0,
        submissions: [] as {
            trusted: boolean;
            defaultPreventedBeforeOwner: boolean;
            submitter: string | null;
        }[],
        keys: [] as { trusted: boolean; isComposing: boolean }[],
    };
    const model = createDateFieldModel({
        kind: 'dateTime',
        getValue: () => value,
        getConfig: () => config,
        canEdit: () => true,
        isCurrent: () => true,
        write: (next) => {
            value = next;
            evidence.writes++;
            return true;
        },
    });
    return { evidence, model, value: () => value };
};
const hosts = [make('single', false), make('submit-button', true)];
declare global {
    interface Window {
        datetimeEnterEvidence(): {
            native: string | null;
            input: string;
            id: string;
            withSubmitButton: boolean;
            writes: number;
            parentKeyDowns: number;
            parentCompositions: number;
            submitButtonClicks: number;
            submissions: {
                trusted: boolean;
                defaultPreventedBeforeOwner: boolean;
                submitter: string | null;
            }[];
            keys: { trusted: boolean; isComposing: boolean }[];
        }[];
    }
}
window.datetimeEnterEvidence = () =>
    hosts.map((host) => ({
        ...host.evidence,
        native: host.value(),
        input: host.model.getState().input,
    }));
function Host({ host }: { host: (typeof hosts)[number] }) {
    useSyncExternalStore(
        host.model.subscribe,
        () => host.model.getState().revision,
        () => host.model.getState().revision
    );
    const { evidence, model } = host;
    return h(
        'form',
        {
            id: `enter-${evidence.id}`,
            onKeyDownCapture: (event: import('react').KeyboardEvent) => {
                if (event.key === 'Enter')
                    evidence.keys.push({
                        trusted: event.nativeEvent.isTrusted,
                        isComposing: event.nativeEvent.isComposing,
                    });
            },
            onKeyDown: () => evidence.parentKeyDowns++,
            onCompositionStart: () => evidence.parentCompositions++,
            onCompositionEnd: () => evidence.parentCompositions++,
            onSubmit: (event: import('react').FormEvent) => {
                evidence.submissions.push({
                    trusted: event.nativeEvent.isTrusted,
                    defaultPreventedBeforeOwner: event.defaultPrevented,
                    submitter:
                        (event.nativeEvent as SubmitEvent).submitter?.id ??
                        null,
                });
                // Count the browser submit, then prevent navigation. This fixture
                // deliberately has no owner Save action to dispatch implicitly.
                event.preventDefault();
            },
        },
        renderDateTimeField({
            physicalKind: 'dateTime',
            presentation: { type: 'physical', config },
            fieldId: evidence.id,
            title: evidence.id,
            field: {
                id: evidence.id,
                name: evidence.id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config,
            },
            displayConfig: {},
            value: host.value(),
            context: 'form',
            computed: false,
            dirty: false,
            pending: false,
            validation: [],
            error: null,
            capability: {
                type: 'editable',
                setValue: () => {
                    throw Error('Enter must not write through raw setValue.');
                },
                date: {
                    state: model.getState(),
                    setInput: model.setInput,
                    clear: model.clear,
                },
            },
        }),
        evidence.withSubmitButton
            ? h(
                  'button',
                  {
                      id: `${evidence.id}-submit`,
                      type: 'submit',
                      onClick: () => evidence.submitButtonClicks++,
                  },
                  'Fixture submit'
              )
            : null
    );
}
createRoot(document.getElementById('enter-app')!).render(
    h(
        StrictMode,
        null,
        ...hosts.map((host) => h(Host, { key: host.evidence.id, host }))
    )
);
