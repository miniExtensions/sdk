import {
    AirtableFieldType,
    type AirtableValue,
    type RuntimeFieldSchema,
} from '@miniextensions/sdk';
import { FormulaRunner } from '@miniextensions/sdk/formulas';
import {
    createSelectControl,
    createSelectionModel,
    mountSelectionControl,
    type SelectControl,
    type SelectionLoader,
    type SelectionModelOptions,
    type SelectionOption,
    type SelectionRequest,
} from '@miniextensions/sdk/ui';

// Synthetic metadata for a self-contained, offline UI interaction example.
// A real application uses only fields returned by its loaded Form or Portal.
const priorityField: RuntimeFieldSchema = {
    fieldType: AirtableFieldType.SINGLE_SELECT,
    airtableField: {
        id: 'fldSyntheticPriority',
        name: 'Priority',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: AirtableFieldType.SINGLE_SELECT,
            options: {
                choices: [
                    { id: 'selRoutine', name: 'Routine' },
                    { id: 'selSoon', name: 'Soon' },
                    { id: 'selUrgent', name: 'Urgent' },
                ],
            },
        },
    },
};
const tagsField: RuntimeFieldSchema = {
    fieldType: AirtableFieldType.MULTIPLE_SELECTS,
    airtableField: {
        id: 'fldSyntheticTags',
        name: 'Request tags',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: AirtableFieldType.MULTIPLE_SELECTS,
            options: {
                choices: [
                    { id: 'selDesign', name: 'Design' },
                    { id: 'selSupport', name: 'Support' },
                    { id: 'selOperations', name: 'Operations' },
                ],
            },
        },
    },
};

function requiredElement<T extends HTMLElement>(
    id: string,
    type: { new (): T }
): T {
    const element = document.getElementById(id);
    if (!(element instanceof type)) throw new Error(`Missing element: ${id}`);
    return element;
}

const singleHost = requiredElement('single-host', HTMLDivElement);
const multiHost = requiredElement('multi-host', HTMLDivElement);
const linkedHost = requiredElement('linked-host', HTMLDivElement);
const nativeState = requiredElement('native-state', HTMLPreElement);
const linkedState = requiredElement('linked-state', HTMLPreElement);
const requestLog = requiredElement('request-log', HTMLPreElement);
const scopeStatus = requiredElement('scope-status', HTMLSpanElement);
const harnessError = requiredElement('harness-error', HTMLParagraphElement);
const visitorSelect = requiredElement('visitor', HTMLSelectElement);
const disabledInput = requiredElement('disabled', HTMLInputElement);
const readOnlyInput = requiredElement('read-only', HTMLInputElement);
const singleInput = requiredElement('linked-single', HTMLInputElement);
const emptyInput = requiredElement('empty', HTMLInputElement);

let visitor = 'Alice';
let scopeGeneration = 1;
let requestNumber = 0;
let failNextRequest = false;
let nativeDraft: Record<string, AirtableValue> = {};
let single: SelectControl;
let multi: SelectControl;
const log: string[] = [];

function writeLog(message: string): void {
    log.unshift(message);
    log.splice(12);
    requestLog.textContent = log.join('\n');
}

function reportUnexpected(error: unknown): void {
    harnessError.textContent =
        error instanceof Error ? error.message : 'Unexpected harness error';
}

function updateNativeDraft(): void {
    nativeState.textContent = JSON.stringify(nativeDraft, null, 2);
}

function mountNativeControls(): void {
    nativeDraft = {
        [priorityField.airtableField.id]: null,
        [tagsField.airtableField.id]: [],
    };
    single = createSelectControl({
        field: priorityField,
        value: null,
        placeholder: 'Choose a priority',
        onChange(value) {
            nativeDraft[priorityField.airtableField.id] = value;
            updateNativeDraft();
        },
    });
    multi = createSelectControl({
        field: tagsField,
        value: [],
        onChange(value) {
            nativeDraft[tagsField.airtableField.id] = value;
            updateNativeDraft();
        },
    });
    singleHost.replaceChildren(single.element);
    multiHost.replaceChildren(multi.element);
    updateNativeDraft();
}

function delay(
    milliseconds: number,
    signal: AbortSignal,
    ignoreAbort: boolean
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted && !ignoreAbort) {
            reject(new DOMException('Request cancelled', 'AbortError'));
            return;
        }
        const onAbort = (): void => {
            window.clearTimeout(timer);
            reject(new DOMException('Request cancelled', 'AbortError'));
        };
        const timer = window.setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        if (!ignoreAbort)
            signal.addEventListener('abort', onAbort, { once: true });
    });
}

function createSyntheticLoader(scopeVisitor: string): SelectionLoader {
    return async (request: SelectionRequest) => {
        const number = ++requestNumber;
        const empty = emptyInput.checked;
        const shouldFail = failNextRequest;
        failNextRequest = false;
        const search = request.searchTerm.trim().toLowerCase();
        const race = search === 'slow' || search === 'fast';
        const milliseconds = search === 'slow' ? 1200 : 220;
        writeLog(
            `#${number} start ${scopeVisitor} search=${JSON.stringify(search)} offset=${request.offset ?? 'first'}`
        );
        try {
            // For slow/fast only, deliberately ignore AbortSignal to prove the
            // model's generation guard also rejects uncooperative stale work.
            await delay(milliseconds, request.signal, race);
        } catch (error) {
            writeLog(`#${number} cancelled ${scopeVisitor}`);
            throw error;
        }
        if (shouldFail) {
            writeLog(`#${number} synthetic failure`);
            throw new Error('Synthetic request failed. Retry is safe.');
        }
        const source: SelectionOption[] = race
            ? [
                  {
                      value: `rec${scopeVisitor}${search}`,
                      label: `${scopeVisitor} ${search} result`,
                  },
              ]
            : [
                  'Design',
                  'Support',
                  'Operations',
                  'Research',
                  'Finance',
                  'Delivery',
              ]
                  .map((name, index) => ({
                      value: `rec${scopeVisitor}${index + 1}`,
                      label: `${scopeVisitor} ${name}`,
                      disabled: name === 'Finance',
                  }))
                  .filter((option) =>
                      option.label.toLowerCase().includes(search)
                  );
        const start = request.offset == null ? 0 : Number(request.offset);
        if (!Number.isInteger(start) || start < 0) {
            throw new Error('Invalid synthetic page offset');
        }
        const options = empty ? [] : source.slice(start, start + 2);
        if (!empty && start > 0 && source[start - 1]) {
            options.unshift(source[start - 1]!);
        }
        const offset =
            !empty && start + 2 < source.length ? String(start + 2) : null;
        writeLog(
            `#${number} complete ${scopeVisitor}: ${options.map((option) => option.label).join(', ') || '(empty)'}`
        );
        return { options, offset };
    };
}

function linkedOptions(withPersistedValue = false): SelectionModelOptions {
    const retained = {
        value: `rec${visitor}Archived`,
        label: `${visitor} previously selected record`,
    };
    return {
        multiple: !singleInput.checked,
        value: withPersistedValue ? [retained.value] : [],
        selectedOptions: withPersistedValue ? [retained] : [],
        loadOptions: createSyntheticLoader(visitor),
        disabled: disabledInput.checked,
        readOnly: readOnlyInput.checked,
        onChange(value) {
            writeLog(`User selection for ${visitor}: ${JSON.stringify(value)}`);
        },
    };
}

mountNativeControls();
const model = createSelectionModel(linkedOptions(true));
const mounted = mountSelectionControl(model, {
    label: 'Related requests',
    description: 'Synthetic visitor-specific choices. Finance is disabled.',
    messages: { more: 'Load another page' },
});
linkedHost.replaceChildren(mounted.element);
const unsubscribe = model.subscribe((state) => {
    linkedState.textContent = JSON.stringify(
        {
            visitor,
            scopeGeneration,
            ...state,
        },
        null,
        2
    );
});

function applyFlags(): void {
    for (const controlModel of [single.model, multi.model, model]) {
        controlModel.setDisabled(disabledInput.checked);
        controlModel.setReadOnly(readOnlyInput.checked);
    }
}

function showScope(): void {
    scopeStatus.textContent = `${visitor} · scope generation ${scopeGeneration}`;
}

disabledInput.addEventListener('change', applyFlags);
readOnlyInput.addEventListener('change', applyFlags);
emptyInput.addEventListener(
    'change',
    () => void model.reload().catch(reportUnexpected)
);
singleInput.addEventListener('change', () => {
    model.reset(linkedOptions());
    void model.reload().catch(reportUnexpected);
});
visitorSelect.addEventListener('change', () => {
    visitor = visitorSelect.value;
    scopeGeneration++;
    failNextRequest = false;
    harnessError.textContent = '';
    log.length = 0;
    single.destroy();
    multi.destroy();
    mountNativeControls();
    model.reset(linkedOptions());
    applyFlags();
    showScope();
    writeLog(
        `Visitor changed to ${visitor}; old selections and labels discarded`
    );
    void model.reload().catch(reportUnexpected);
});

requiredElement('error-once', HTMLButtonElement).addEventListener(
    'click',
    () => {
        failNextRequest = true;
        void model.reload().catch(reportUnexpected);
    }
);
requiredElement('race', HTMLButtonElement).addEventListener('click', () => {
    emptyInput.checked = false;
    void model.setSearchTerm('slow').catch(reportUnexpected);
    // Let the slow loader dispatch before the fast request supersedes it.
    queueMicrotask(() => {
        void model.setSearchTerm('fast').catch(reportUnexpected);
    });
});
requiredElement('reset-search', HTMLButtonElement).addEventListener(
    'click',
    () => {
        void model.setSearchTerm('').catch(reportUnexpected);
    }
);
requiredElement('restore-id', HTMLButtonElement).addEventListener(
    'click',
    () => {
        model.setValue([`rec${visitor}SavedWithoutLabel`]);
    }
);
requiredElement('hydrate-label', HTMLButtonElement).addEventListener(
    'click',
    () => {
        const value = `rec${visitor}SavedWithoutLabel`;
        model.setValue(
            [value],
            [{ value, label: `${visitor} hydrated saved record` }]
        );
    }
);

const quantity = requiredElement('quantity', HTMLInputElement);
const formulaOutput = requiredElement('formula-result', HTMLOutputElement);
const formula = new FormulaRunner('{Quantity} * 3');
function updateFormula(): void {
    const numeric = quantity.valueAsNumber;
    if (!Number.isFinite(numeric)) {
        formulaOutput.textContent = 'Enter a number';
        return;
    }
    formula.context = {
        record: {
            id: 'recSyntheticEstimate',
            fields: { fldSyntheticQuantity: numeric },
        },
        airtableFields: [
            {
                id: 'fldSyntheticQuantity',
                name: 'Quantity',
                config: {
                    type: AirtableFieldType.NUMBER,
                    options: { precision: 0 },
                },
            },
        ],
        linkedTableLoadingStates: {},
    };
    formulaOutput.textContent = String(formula.run());
}
quantity.addEventListener('input', updateFormula);
updateFormula();
showScope();
void model.reload().catch(reportUnexpected);

window.addEventListener(
    'pagehide',
    () => {
        unsubscribe();
        mounted.destroy();
        model.destroy();
        single.destroy();
        multi.destroy();
    },
    { once: true }
);
