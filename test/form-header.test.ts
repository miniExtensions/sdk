import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    resolveFormDisplayText,
    resolveFormHeaderTitle,
    resolveFormLogo,
    type FormDisplaySource,
} from '../src/forms/index.js';
import {
    AirtableFieldType,
    type AirtableField,
    type AirtableValue,
} from '../src/formulas/index.js';
import {
    linkedField,
    numberField,
    syntheticLinkedRecordId,
    syntheticMissingRecordId,
    textField,
} from './fixtures.js';

const missing: FormDisplaySource = {
    type: 'field',
    field: { status: 'missing' },
};
const fieldSource = (
    value: AirtableValue,
    field: AirtableField = textField,
    linkedRecordLabels?: Readonly<Record<string, string | null>>
): FormDisplaySource => ({
    type: 'field',
    field: { status: 'resolved', field, value, linkedRecordLabels },
});
const formulaField: AirtableField = {
    id: 'fld_formula_header',
    name: 'Formula title',
    config: {
        type: AirtableFieldType.FORMULA,
        options: { isValid: true, result: textField.config },
    },
};
const logoField: AirtableField = {
    id: 'fld_logo_header',
    name: 'Logo',
    config: { type: AirtableFieldType.MULTIPLE_ATTACHMENTS, options: null },
};

describe('complete Form display source selection', () => {
    it('has no browser or side-effect dependency', () => {
        assert.equal(typeof window, 'undefined');
        assert.equal(typeof document, 'undefined');
        assert.equal(resolveFormDisplayText({ type: 'none' }), null);
        assert.equal(resolveFormLogo({ type: 'none' }), null);
        assert.equal(resolveFormHeaderTitle({ type: 'none' }, 'Form'), null);
    });

    it('preserves authored nonblank static bytes', () => {
        const source: FormDisplaySource = {
            type: 'static',
            value: '  Authored title\nwith a second line  ',
        };
        assert.equal(
            resolveFormHeaderTitle(source, 'Extension fallback'),
            '  Authored title\nwith a second line  '
        );
        assert.equal(
            resolveFormDisplayText(source),
            '  Authored title\nwith a second line  '
        );
    });

    for (const value of [undefined, null, '', '  \n\t ']) {
        it(`uses the extension name for static empty title ${JSON.stringify(value)}`, () => {
            assert.equal(
                resolveFormHeaderTitle({ type: 'static', value }, 'Extension'),
                'Extension'
            );
        });
    }

    it('distinguishes missing schema from a resolved blank or hidden field', () => {
        assert.equal(resolveFormHeaderTitle(missing, 'Extension'), 'Extension');
        assert.equal(resolveFormDisplayText(missing), null);
        for (const value of [undefined, null, '']) {
            const source = fieldSource(value);
            assert.equal(resolveFormHeaderTitle(source, 'Extension'), '');
            assert.equal(
                resolveFormDisplayText(source),
                value == null ? null : ''
            );
        }
    });

    it('keeps exact source choice through static, field and static transitions', () => {
        const sources: FormDisplaySource[] = [
            { type: 'static', value: 'Static A' },
            fieldSource('Field B'),
            { type: 'static', value: 'Static A' },
        ];
        assert.deepEqual(sources.map(resolveFormDisplayText), [
            'Static A',
            'Field B',
            'Static A',
        ]);
    });

    it('formats accepted values from structural field metadata', () => {
        assert.equal(
            resolveFormDisplayText(fieldSource(12.5, numberField)),
            '12.50'
        );
    });

    it('removes Formula Markdown without losing later lines', () => {
        assert.equal(
            resolveFormHeaderTitle(
                fieldSource(
                    '**First**\nSecond\nThird\nFourth\nFifth\nLast',
                    formulaField
                ),
                'Extension'
            ),
            'First\n\nSecond\n\nThird\n\nFourth\n\nFifth\n\nLast'
        );
        assert.equal(
            resolveFormHeaderTitle(
                fieldSource('<p>Formula title</p>', formulaField),
                'Extension'
            ),
            'Formula title'
        );
    });

    it('keeps ordinary title HTML as plain text rather than interpreting it', () => {
        assert.equal(
            resolveFormHeaderTitle(
                fieldSource('<b>Literal title</b>'),
                'Extension'
            ),
            '<b>Literal title</b>'
        );
    });

    it('uses admitted linked display labels and never unresolved record IDs', () => {
        assert.equal(
            resolveFormDisplayText(
                fieldSource(
                    [syntheticLinkedRecordId, syntheticMissingRecordId],
                    linkedField,
                    { [syntheticLinkedRecordId]: 'Readable related item' }
                )
            ),
            'Readable related item'
        );
        assert.equal(
            resolveFormHeaderTitle(
                fieldSource([syntheticLinkedRecordId], linkedField),
                'Extension'
            ),
            ''
        );
    });

    it('uses linked display metadata through a computed linked result', () => {
        const lookup: AirtableField = {
            id: 'fld_lookup_header',
            name: 'Related lookup',
            config: {
                type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
                options: { isValid: true, result: linkedField.config },
            },
        };
        assert.equal(
            resolveFormDisplayText(
                fieldSource([syntheticLinkedRecordId], lookup, {
                    [syntheticLinkedRecordId]: 'Current linked label',
                })
            ),
            'Current linked label'
        );
    });

    it('selects the first attachment original URL instead of thumbnail or later attachment', () => {
        const source = fieldSource(
            [
                {
                    id: 'att_first',
                    url: 'https://cdn.example.invalid/original.png',
                    filename: 'original.png',
                    thumbnails: {
                        full: {
                            url: 'https://cdn.example.invalid/thumbnail.png',
                            width: 300,
                            height: 200,
                        },
                    },
                },
                {
                    id: 'att_second',
                    url: 'https://cdn.example.invalid/second.png',
                },
            ],
            logoField
        );
        assert.equal(
            resolveFormLogo(source),
            'https://cdn.example.invalid/original.png'
        );
        assert.equal(resolveFormLogo(source, true), null);
    });

    for (const value of [
        undefined,
        null,
        '',
        [],
        'https://cdn.example.invalid/not-an-array.png',
        [{ label: 'Facet only', url: null }],
    ] satisfies AirtableValue[]) {
        it(`does not recover a field logo from invalid attachment shape ${JSON.stringify(value)}`, () => {
            assert.equal(resolveFormLogo(fieldSource(value, logoField)), null);
        });
    }

    it('suppresses static logos for child Forms independently of source selection', () => {
        const source: FormDisplaySource = {
            type: 'static',
            value: 'https://cdn.example.invalid/static.png',
        };
        assert.equal(
            resolveFormLogo(source),
            'https://cdn.example.invalid/static.png'
        );
        assert.equal(resolveFormLogo(source, true), null);
        assert.equal(resolveFormLogo(missing), null);
    });
});
