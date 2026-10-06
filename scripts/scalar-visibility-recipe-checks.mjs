import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

/** Evaluate the actual packed docs recipe against installed public exports. */
export async function checkScalarVisibilityRecipe({
    consumerDirectory,
    guideSources,
}) {
    const root = realpathSync(consumerDirectory);
    const installed = realpathSync(
        join(root, 'node_modules/@miniextensions/sdk')
    );
    const require = createRequire(join(root, 'package.json'));
    for (const subpath of ['forms', 'formulas'])
        assert(
            realpathSync(
                require.resolve(`@miniextensions/sdk/${subpath}`)
            ).startsWith(`${installed}/dist/`)
        );
    const matches = guideSources
        .map((name) => resolve(root, name))
        .filter((source) => {
            assert.equal(dirname(source), root);
            return readFileSync(source, 'utf8').includes(
                'export function scalarVisibility('
            );
        });
    assert.equal(
        matches.length,
        1,
        'Missing unique shipped scalar visibility recipe'
    );
    const { code } = await transform(readFileSync(matches[0], 'utf8'), {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
    });
    const compiled = `${matches[0]}.scalar-visibility.mjs`;
    writeFileSync(
        compiled,
        `${code}\nexport const recipeFormsUrl = import.meta.resolve('@miniextensions/sdk/forms');\nexport const recipeFormulasUrl = import.meta.resolve('@miniextensions/sdk/formulas');\n`
    );
    const {
        scalarVisibility,
        exampleConditions,
        recipeFormsUrl,
        recipeFormulasUrl,
    } = await import(pathToFileURL(compiled).href);
    for (const url of [recipeFormsUrl, recipeFormulasUrl])
        assert(
            realpathSync(fileURLToPath(url)).startsWith(`${installed}/dist/`)
        );
    assert.equal(typeof scalarVisibility, 'function');
    assert.equal(exampleConditions.logicalOperator, 'and');
    const fields = [
        {
            id: 'fld_title',
            name: 'Title',
            config: { type: 'singleLineText', options: null },
        },
        {
            id: 'fld_quantity',
            name: 'Quantity',
            config: { type: 'number', options: { precision: 2 } },
        },
        {
            id: 'fld_approved',
            name: 'Approved',
            config: {
                type: 'checkbox',
                options: { icon: 'check', color: 'greenBright' },
            },
        },
    ].map((field) => ({
        ...field,
        description: null,
        isComputed: false,
        isPrimaryField: false,
    }));
    const context = (values) => ({
        record: { id: 'rec_recipe_synthetic', fields: values },
        airtableFields: fields,
        linkedTableLoadingStates: {},
    });
    const condition = (fieldType, type, value, id = 'fld_title') => ({
        logicalOperator: 'and',
        conditions: [
            {
                id: 'recipe-boundary',
                type: 'singleCondition',
                setting: {
                    fieldType,
                    type,
                    value,
                    idOrName: { type: 'id', id },
                },
            },
        ],
    });
    const cases = [];
    const check = (name, actual, expected) => {
        assert.deepEqual(actual, expected, name);
        cases.push(name);
    };
    const before = JSON.stringify({ fields, exampleConditions });
    check(
        'actual default nested recipe visible on quantity',
        scalarVisibility(
            fields,
            context({
                fld_title: 'READY to go',
                fld_quantity: 2,
                fld_approved: false,
            })
        ),
        { type: 'visible' }
    );
    check(
        'actual default recipe hidden when both OR alternatives fail',
        scalarVisibility(
            fields,
            context({
                fld_title: 'ready',
                fld_quantity: 1,
                fld_approved: false,
            })
        ),
        { type: 'hidden' }
    );
    check(
        'actual default recipe visible on native checkbox',
        scalarVisibility(
            fields,
            context({ fld_title: 'ready', fld_quantity: 1, fld_approved: true })
        ),
        { type: 'visible' }
    );
    check(
        'fresh accepted context recomputes hidden title condition',
        scalarVisibility(
            fields,
            context({
                fld_title: 'waiting',
                fld_quantity: 9,
                fld_approved: true,
            })
        ),
        { type: 'hidden' }
    );
    check(
        'missing metadata preserves false leaf instead of truthy fallback',
        scalarVisibility(
            fields.filter((field) => field.id !== 'fld_title'),
            context({ fld_title: 'ready', fld_quantity: 2, fld_approved: true })
        ),
        { type: 'hidden' }
    );
    check(
        'unsupported richer field blocks presentation',
        scalarVisibility(
            fields,
            context({}),
            condition('multipleLookupValues', 'contains', 'ready')
        ),
        { type: 'blocked', code: 'unsupported' }
    );
    check(
        'invalid regex blocks presentation',
        scalarVisibility(
            fields,
            context({}),
            condition('singleLineText', 'matchesRegex', '[')
        ),
        { type: 'blocked', code: 'invalid' }
    );
    check(
        'strict incomplete operand blocks presentation',
        scalarVisibility(
            fields,
            context({}),
            condition('singleLineText', 'is', null)
        ),
        { type: 'blocked', code: 'invalid' }
    );
    check(
        'native field error preserves typed runtime fault',
        scalarVisibility(
            fields,
            context({
                fld_title: { error: 'synthetic native error' },
                fld_quantity: 2,
                fld_approved: true,
            })
        ),
        { type: 'blocked', code: 'runtime-error' }
    );
    check(
        'ordinary error-looking text reaches only successful-value falsiness',
        scalarVisibility(
            fields,
            context({
                fld_title: '#ERROR!',
                fld_quantity: 2,
                fld_approved: true,
            })
        ),
        { type: 'hidden' }
    );
    // Deliberately malformed JavaScript caller context exercises the documented
    // exception policy; this is outside the typed native-record input contract.
    check(
        'malformed external context remains blocked on evaluation exception',
        scalarVisibility(fields, {
            record: null,
            airtableFields: fields,
            linkedTableLoadingStates: {},
        }),
        { type: 'blocked', code: 'evaluation-exception' }
    );
    assert.equal(JSON.stringify({ fields, exampleConditions }), before);
    return { checks: cases.length, cases };
}
