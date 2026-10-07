import type { AirtableValue, FormLoadedResult } from '@miniextensions/sdk';
import { getFormAttachmentPolicy } from '@miniextensions/sdk/forms';
import type { FieldControl } from './fields.js';
import { element } from './dom.js';

/** Form-only presentation; native answers are never serialized into the DOM. */
export function formAttachmentControl(
    page: FormLoadedResult,
    fieldId: string,
    initialValue: AirtableValue | undefined
): FieldControl & { refresh(): void } {
    let value: AirtableValue = initialValue ?? null;
    let retired = false;
    const node = element('div');
    const title = element('p');
    const output = element('p');
    output.dataset.formAttachmentFieldId = fieldId;
    node.append(title, output);
    const refresh = () => {
        if (retired) return;
        const schema = page.payload.fieldIdsToSchemas[fieldId];
        const config = schema?.miniExtConfig;
        title.textContent =
            typeof config?.title === 'string' && config.title.trim() !== ''
                ? config.title
                : (schema?.airtableField.name ?? 'Attachments');
        output.textContent = '';
        // Canonical empty answers do not require an add-only baseline.
        if (
            value == null ||
            (typeof value === 'string' && value.trim() === '') ||
            (Array.isArray(value) && value.length === 0)
        )
            return;
        try {
            const policy = getFormAttachmentPolicy({
                loaded: page,
                fieldId,
                value,
            });
            if (policy.status !== 'ready') throw new Error();
            const showNames =
                config != null &&
                'hideAttachmentName' in config &&
                config.hideAttachmentName === false;
            output.textContent = policy.rows
                .filter((row) => row.visible)
                .map(({ attachment }) =>
                    showNames &&
                    typeof attachment.filename === 'string' &&
                    attachment.filename.trim() !== ''
                        ? attachment.filename
                        : 'Attachment — filename unavailable'
                )
                .join('\n');
        } catch {
            output.textContent = 'Attachment presentation unavailable';
        }
    };
    refresh();
    return {
        node,
        editable: false,
        read: () => value,
        write: (next) => {
            if (retired) return;
            value = next;
            refresh();
        },
        refresh,
        destroy: () => {
            retired = true;
        },
    };
}
