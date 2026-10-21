import {
    createElement,
    useId,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import { getReadableStringFromAirtableValue } from '../formulas/valueConversion.js';
import {
    createRendererProps,
    type FieldRendererProps,
} from '../ui/rendererRegistry.js';
import { textConfiguration } from './TextField.js';

export type LookupFieldOptions = { className?: string };
type LookupControlProps = Pick<
    FieldRendererProps<'multipleLookupValues'>,
    | 'field'
    | 'title'
    | 'displayConfig'
    | 'writeConfig'
    | 'pending'
    | 'error'
    | 'validation'
> & { value: unknown } & LookupFieldOptions;

/** Lookup owns an already flat native array, never a scalar or provenance wrapper. */
function readableLookup(props: LookupControlProps): string | null {
    try {
        const accepted = createRendererProps({
            physicalKind: 'multipleLookupValues',
            fieldId: props.field.id,
            title: props.title,
            field: props.field,
            displayConfig: null,
            value: props.value,
            context: 'form',
            computed: true,
            dirty: false,
            pending: false,
            validation: [],
            error: null,
            capability: { type: 'readonly' },
        });
        if (!accepted || accepted.physicalKind !== 'multipleLookupValues')
            return null;
        if (
            accepted.presentation.type === 'computed-result' &&
            accepted.presentation.config === null
        )
            return accepted.value !== null &&
                typeof accepted.value === 'object' &&
                'error' in accepted.value
                ? accepted.value.error
                : '';
        // The canonical Lookup branch maps scalar results, but delegates an
        // array-valued result's whole flat array. Do not flatten or wrap it here.
        return getReadableStringFromAirtableValue({
            value: accepted.value ?? null,
            airtableFieldConfig: accepted.field.config,
            fieldName: accepted.field.name,
            source: {
                type: 'airtableMock',
                linkedTableStates: {},
                dateParsing: 'local',
                doNotReturnRecordIdsForLinkedRecords: true,
                unavailableLinkedRecordPlaceholder: 'Unavailable',
            },
        });
    } catch {
        return null;
    }
}

/** Selectable escaped text only; configuration and provenance grant no actions. */
export function LookupControl(props: LookupControlProps): ReactNode {
    const id = useId();
    const config = textConfiguration(props.displayConfig, props.writeConfig);
    const title = props.title.trim() ? props.title : props.field.name;
    // Do not inspect, validate or format a masked native value (including errors).
    const value = config.password ? '••••••••' : readableLookup(props);
    const feedback =
        props.error ??
        props.validation.map((item) => item.errorMessage).join('\n');
    const stop = (event: SyntheticEvent) => event.stopPropagation();
    return createElement(
        'span',
        {
            className: ['mx-sdk-lookup-field', props.className]
                .filter(Boolean)
                .join(' '),
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
        },
        config.showTitle
            ? createElement('label', { htmlFor: id }, title)
            : null,
        createElement(
            'output',
            {
                id,
                'aria-label': config.showTitle ? undefined : title,
                'aria-busy': props.pending,
                'aria-invalid':
                    props.error !== null ||
                    props.validation.length > 0 ||
                    value === null,
                'aria-describedby': feedback ? `${id}-feedback` : undefined,
                style: {
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    display: 'block',
                },
            },
            value ?? 'Unavailable'
        ),
        createElement(
            'span',
            { id: `${id}-feedback`, role: 'status', 'aria-live': 'polite' },
            feedback
        )
    );
}

/** Install in the existing renderMultipleLookupValuesField physical slot. */
export function renderLookupField(
    props: FieldRendererProps<'multipleLookupValues'>,
    options: LookupFieldOptions = {}
): ReactNode {
    return createElement(LookupControl, {
        field: props.field,
        title: props.title,
        value: props.value,
        displayConfig: props.displayConfig,
        writeConfig: props.writeConfig,
        pending: props.pending,
        error: props.error,
        validation: props.validation,
        className: options.className,
    });
}
