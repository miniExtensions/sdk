import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const field = (multiple) => ({
    fieldType: multiple ? 'multipleSelects' : 'singleSelect',
    airtableField: {
        id: 'fld_choices',
        name: 'Choices',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: multiple ? 'multipleSelects' : 'singleSelect',
            options: {
                choices: [
                    { id: 'sel_alpha', name: 'Alpha' },
                    { id: 'sel_beta', name: 'Beta' },
                    { id: 'sel_gamma', name: 'Gamma' },
                ],
            },
        },
    },
    miniExtConfig: {
        enableConditionalOptions: true,
        singleOrMultiSelectLimitSelectionOptions: ['sel_alpha', 'sel_beta'],
        maxNumberOfSelections: 2,
        conditionsForOptions: [
            {
                id: 'private-rule-id',
                config: {
                    optionForConditions: 'sel_beta',
                    name: 'Conditional Beta',
                    conditionsForOption: {
                        logicalOperator: 'and',
                        conditions: [
                            {
                                id: 'private-condition-id',
                                type: 'singleCondition',
                                setting: {
                                    type: 'contains',
                                    fieldType: 'singleLineText',
                                    idOrName: { type: 'id', id: 'fld_driver' },
                                    value: 'allowed',
                                },
                            },
                        ],
                    },
                },
            },
        ],
    },
});
const driver = {
    id: 'fld_driver',
    name: 'Driver',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: { type: 'singleLineText', options: null },
};
const record = (value) => ({
    id: 'rec00000000000001',
    fields: { fld_driver: value },
});

/** Executes the actual shipped doc fence against the exact installed archive. */
export async function checkSelectAvailabilityRecipe({
    consumerDirectory,
    guideSources,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const require = createRequire(join(consumer, 'package.json'));
    const installed = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    assert.ok(
        realpathSync(require.resolve('@miniextensions/sdk/ui')).startsWith(
            `${installed}/dist/`
        )
    );
    const sources = guideSources
        .map((path) => resolve(consumer, path))
        .filter((path) => {
            assert.equal(dirname(path), consumer);
            return readFileSync(path, 'utf8').includes(
                'export function mountConfiguredScalarChoice('
            );
        });
    assert.equal(
        sources.length,
        1,
        'Expected one actual shipped configured-choice recipe'
    );
    const source = sources[0];
    const { code } = await transform(readFileSync(source, 'utf8'), {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
    });
    const compiled = `${source}.availability.mjs`;
    writeFileSync(compiled, code);
    const { mountConfiguredScalarChoice } = await import(
        pathToFileURL(compiled).href
    );
    const { Window } = await import(pathToFileURL(happyDomModulePath).href);
    let checks = 0;
    for (const multiple of [false, true]) {
        const window = new Window({ url: 'https://choice.example.test' });
        try {
            const host = window.document.createElement('div');
            window.document.body.append(host);
            const schema = field(multiple);
            const changes = [];
            let current = true;
            const mounted = mountConfiguredScalarChoice(host, {
                field: schema,
                airtableFields: [driver, schema.airtableField],
                recordForConditionEvaluation: record('denied'),
                value: multiple ? [] : null,
                mode: 'runtime',
                invalidConditionMode: 'compatibility',
                isCurrent: () => current,
                onChange: (value) => changes.push(structuredClone(value)),
            });
            const select = host.querySelector('select');
            assert.ok(select);
            const names = () =>
                Array.from(select.options)
                    .map((option) => option.value)
                    .filter(Boolean);
            const selected = () =>
                Array.from(select.selectedOptions)
                    .map((option) => option.value)
                    .filter(Boolean);
            const change = () =>
                select.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
            assert.deepEqual(names(), ['Alpha']);
            assert.deepEqual(changes, []);
            assert.equal(mounted.updateRecord(record('allowed')), 'ready');
            assert.deepEqual(names(), ['Alpha', 'Beta']);
            const beta = Array.from(select.options).find(
                (option) => option.value === 'Beta'
            );
            assert.equal(beta.textContent, 'Conditional Beta');
            beta.selected = true;
            change();
            assert.deepEqual(changes, [multiple ? ['Beta'] : 'Beta']);
            assert.equal(mounted.updateRecord(record('denied again')), 'ready');
            assert.deepEqual(selected(), ['Beta']);
            assert.equal(
                beta.disabled,
                false,
                'Retained unavailable selection must remain removable'
            );
            assert.deepEqual(changes, [multiple ? ['Beta'] : 'Beta']);
            for (const option of select.options) option.selected = false;
            if (!multiple) select.value = '';
            change();
            assert.deepEqual(selected(), []);
            assert.deepEqual(names(), ['Alpha']);
            assert.deepEqual(changes, [
                multiple ? ['Beta'] : 'Beta',
                multiple ? [] : null,
            ]);
            // Injecting a native option cannot turn a denied name into eligibility.
            const injected = window.document.createElement('option');
            injected.value = 'Beta';
            injected.selected = true;
            select.append(injected);
            change();
            assert.deepEqual(selected(), []);
            assert.equal(changes.length, 2);
            checks++;

            mounted.updateRecord(record('allowed'));
            Array.from(select.options).find(
                (option) => option.value === 'Beta'
            ).selected = true;
            change();
            assert.equal(mounted.updateRecord(null), 'blocked');
            assert.deepEqual(selected(), ['Beta']);
            assert.equal(
                select.disabled,
                false,
                'Blocked current field must permit retained removal'
            );
            for (const option of select.options) option.selected = false;
            if (!multiple) select.value = '';
            change();
            assert.deepEqual(selected(), []);
            assert.equal(changes.length, 4);
            checks++;

            current = false;
            assert.equal(mounted.updateRecord(record('allowed')), 'blocked');
            assert.equal(select.disabled, true);
            injected.selected = true;
            select.append(injected);
            change();
            assert.equal(changes.length, 4);
            mounted.dispose();
            mounted.dispose();
            change();
            assert.equal(changes.length, 4);
            assert.equal(host.children.length, 0);
            checks++;
        } finally {
            await window.happyDOM.close();
        }
    }
    return checks;
}
