import {
    createFormFieldBindings,
    RecoveryJournal,
} from '@miniextensions/sdk/forms';
import {
    CompleteFormComposition,
    FormLinkedChildCreateDialog,
} from '@miniextensions/sdk/react';
import { CompleteDateField } from '@miniextensions/sdk/react/date';
import { createElement as h, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { childForm, parentForm } from './linked-child-data.mjs';

const fieldId = 'fld_shared_date';
const date = {
    type: 'date',
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
};

function addDate(loaded, value) {
    const schema = {
        fieldType: 'date',
        airtableField: {
            id: fieldId,
            name: 'Appointment date',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: date,
        },
        miniExtConfig: { required: true },
    };
    const payload = loaded.payload;
    payload.fieldIdsInForm.push(fieldId);
    payload.fieldIdsToSchemas[fieldId] = schema;
    payload.fieldNamesToSchemas[schema.airtableField.name] = schema;
    payload.formRecord.data[fieldId] = value;
    return loaded;
}

export function mountLinkedChild(root) {
    const calls = {
        loads: 0,
        saves: 0,
        submits: [],
        writes: [],
        parentFocus: 0,
    };
    const client = {
        getSession: () => ({}),
        async loadExtension() {
            calls.loads++;
            return addDate(childForm(), null);
        },
        forms: {
            async save() {
                calls.saves++;
                throw Error('Unexpected Save during validation link proof');
            },
        },
    };
    const parent = createFormFieldBindings({
        client,
        loaded: addDate(parentForm(), '2026-03-14'),
        getScope: () => ({ ownerId: 'validation-link-parent', revision: 0 }),
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    const owner = parent.linkedChild('fld_children_a', {
        journal: new RecoveryJournal(),
        loadVersion: 1,
    });

    function Composition({ fields, pages, name }) {
        const [diagnostics, setDiagnostics] = useState([]);
        const [dateMounted, setDateMounted] = useState(true);
        const inputRef = useRef(null);
        const formId = name + '-proof-form';
        const binding = fields.field(fieldId);
        const validate =
            pages &&
            h(
                'button',
                {
                    type: 'button',
                    onClick() {
                        setDiagnostics(
                            pages
                                .getSnapshot()
                                .problems.map(({ fieldId, code }) => ({
                                    fieldId,
                                    fieldTitle: 'Child appointment date',
                                    errorMessage:
                                        code === 'required'
                                            ? 'Date is required'
                                            : code,
                                }))
                        );
                    },
                },
                'Validate child'
            );
        return h(
            'div',
            { id: name + '-proof-scroll' },
            h(CompleteFormComposition, {
                formId,
                items: dateMounted
                    ? [
                          {
                              kind: 'field',
                              key: fieldId,
                              node: h(CompleteDateField, {
                                  id: fieldId,
                                  formId,
                                  airtableDateConfig: date,
                                  value: binding.getSnapshot().value,
                                  setValue(value) {
                                      calls.writes.push(name);
                                      return binding.setValue(value).accepted;
                                  },
                                  language: 'en',
                                  title:
                                      name === 'child'
                                          ? 'Child Date'
                                          : 'Parent Date',
                                  inputRef,
                                  inputTestId: name + '-proof-date',
                              }),
                          },
                      ]
                    : [],
                afterFields: h(
                    'div',
                    { className: 'proof-gap' },
                    pages &&
                        h(
                            'button',
                            {
                                type: 'button',
                                onClick: () => setDateMounted(false),
                            },
                            'Remove child Date'
                        ),
                    validate
                ),
                validation: {
                    heading: 'Check child fields',
                    diagnostics,
                    resolveFieldTarget: pages
                        ? (id) => (id === fieldId ? inputRef.current : null)
                        : undefined,
                },
                onSubmit: () => calls.submits.push(name),
            })
        );
    }

    function App() {
        const [opening, setOpening] = useState(null);
        return h(
            'main',
            null,
            h(Composition, { fields: parent, name: 'parent' }),
            h(
                'button',
                {
                    type: 'button',
                    async onClick(event) {
                        const opener = event.currentTarget;
                        if (await owner.openCreate()) {
                            setOpening({
                                opener,
                                child: owner.getSnapshot().child,
                                isCurrent: () => true,
                            });
                        }
                    },
                },
                'Open linked child'
            ),
            opening &&
                h(FormLinkedChildCreateDialog, {
                    owner,
                    opening,
                    renderFields: (fields, pages) =>
                        h(Composition, { fields, pages, name: 'child' }),
                })
        );
    }

    root.addEventListener('focusin', (event) => {
        if (event.target.dataset.testid === 'parent-proof-date')
            calls.parentFocus++;
    });
    document.addEventListener(
        'submit',
        (event) => {
            calls.submits.push(event.target.id);
        },
        true
    );
    window.readLinkedValidation = () => {
        const parentInput = document.querySelector(
            '[data-testid="parent-proof-date"]'
        );
        const childInput = document.querySelector(
            '[data-testid="child-proof-date"]'
        );
        const parentScroll = document.querySelector('#parent-proof-scroll');
        const childScroll = document.querySelector('#child-proof-scroll');
        return {
            parentFirst: document.getElementById(fieldId) === parentInput,
            sharedId: parentInput.id === childInput?.id,
            parentValue: parentInput.value,
            childValue: childInput?.value ?? null,
            parentDraft: parent.field(fieldId).getSnapshot().value,
            childDraft: owner.getSnapshot().child.field(fieldId).getSnapshot()
                .value,
            focus:
                document.activeElement === childInput
                    ? 'child'
                    : document.activeElement === parentInput
                      ? 'parent'
                      : document.activeElement?.tagName,
            childVisible:
                !!childInput &&
                childInput.getBoundingClientRect().top >=
                    childScroll.getBoundingClientRect().top &&
                childInput.getBoundingClientRect().bottom <=
                    childScroll.getBoundingClientRect().bottom,
            parentScroll: parentScroll.scrollTop,
            childScroll: childScroll.scrollTop,
            pageScroll: window.scrollY,
            calls: structuredClone(calls),
            url: location.href,
            historyLength: history.length,
        };
    };
    createRoot(root).render(h(App));
}
