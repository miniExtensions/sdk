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

export type RollupFieldOptions = { className?: string };
type RollupControlProps = Pick<
    FieldRendererProps<'rollup'>,
    | 'field'
    | 'title'
    | 'value'
    | 'displayConfig'
    | 'writeConfig'
    | 'pending'
    | 'error'
    | 'validation'
> &
    RollupFieldOptions;

/** Use native result formatting only; malformed data never becomes diagnostic text. */
function readableRollup(props: RollupControlProps): string | null {
    try {
        const accepted = createRendererProps({
            physicalKind: 'rollup',
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
        if (!accepted || accepted.physicalKind !== 'rollup') return null;
        const result =
            accepted.presentation.type === 'computed-result'
                ? accepted.presentation.config
                : null;
        if (result === null) {
            return accepted.value !== null &&
                typeof accepted.value === 'object' &&
                'error' in accepted.value
                ? accepted.value.error
                : '';
        }
        // Rollup scalar-array conversion cannot consume array-valued result metadata.
        // Delegate those native arrays to their existing formatter.
        const arrayResult =
            Array.isArray(accepted.value) &&
            [
                'multipleSelects',
                'multipleCollaborators',
                'multipleAttachments',
                'multipleRecordLinks',
                'multipleLookupValues',
            ].includes(result.type);
        return getReadableStringFromAirtableValue({
            value: accepted.value ?? null,
            airtableFieldConfig: arrayResult ? result : accepted.field.config,
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

/** Inert text: no editor, raw HTML, resource loading, or owner action. */
export function RollupControl(props: RollupControlProps): ReactNode {
    const id = useId();
    const config = textConfiguration(props.displayConfig, props.writeConfig);
    const title = props.title.trim() ? props.title : props.field.name;
    // Mask before formatting so the readable value is absent from the DOM too.
    const value = config.password ? '••••••••' : readableRollup(props);
    const feedback =
        props.error ??
        props.validation.map((item) => item.errorMessage).join('\n');
    const stop = (event: SyntheticEvent) => event.stopPropagation();
    return createElement(
        'span',
        {
            className: ['mx-sdk-rollup-field', props.className]
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

/** Shared Rollup slot; supplied capabilities and presentation hints grant no authority. */
export function renderRollupField(
    props: FieldRendererProps<'rollup'>,
    options: RollupFieldOptions = {}
): ReactNode {
    return createElement(RollupControl, {
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
