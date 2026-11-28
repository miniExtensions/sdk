import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    FormulaField,
    type ControlledFormulaFieldProps,
    type FormulaFieldProps,
} from '../src/react/index.js';

type ValidFormula = Extract<ControlledFormulaFieldProps, { isValid: true }>;
// Existing wrappers index this published binding type. Controlled props are
// additive and must not turn its binding into an optional union property.
type PublishedBinding = FormulaFieldProps['binding'];
const bindingTypeIsPreserved = (_binding: PublishedBinding) => undefined;
void bindingTypeIsPreserved;

const url = 'https://example.invalid/formula-image.png';
const choices = [
    {
        id: 'sel_ready',
        name: 'Ready',
        displayName: 'Ready for review',
        color: '#124329',
        backgroundColor: '#d8f2df',
    },
];
const valid = (overrides: Partial<ValidFormula> = {}): ValidFormula => ({
    mode: 'controlled',
    language: 'en',
    isValid: true,
    resultType: 'singleLineText',
    value: 'Native answer',
    formattedValue: 'Native answer',
    ...overrides,
});

async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, i) => {
            if (originals[i])
                Object.defineProperty(globalThis, key, originals[i]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        window,
        container,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        formula: async (props: ControlledFormulaFieldProps) => {
            await act(async () =>
                root.render(h(StrictMode, null, h(FormulaField, props)))
            );
        },
    };
}

it('retains metadata validity and current formatted answers across one Formula mount', async (t) => {
    const f = await fixture(t);
    await f.formula(
        valid({ resultType: 'currency', value: 12.3, formattedValue: '€12.30' })
    );
    assert.equal(f.container.textContent, '€12.30');
    await f.formula({ mode: 'controlled', language: 'en', isValid: false });
    assert.match(
        f.container.querySelector('[role="alert"]')?.textContent ?? '',
        /invalid value.*Airtable/
    );
    assert.equal(f.container.textContent?.includes('€12.30'), false);
    await f.formula(
        valid({ resultType: 'currency', value: -4, formattedValue: '-£4.00' })
    );
    assert.equal(f.container.querySelector('[role="alert"]'), null);
    assert.equal(f.container.textContent, '-£4.00');
    await f.formula(
        valid({ value: null, formattedValue: null, language: 'fr' })
    );
    assert.equal(f.container.textContent, 'Pas de Valeur');
    await f.formula(valid({ value: 0, formattedValue: '0.00' }));
    assert.equal(f.container.textContent, '0.00');
    await f.formula(valid({ value: false, formattedValue: '' }));
    assert.equal(f.container.textContent, 'No Value');
    await f.formula(valid({ value: false, formattedValue: 'false' }));
    assert.equal(f.container.textContent, 'false');
});

it('composes effective Select, sanitized HTML, URL gallery, URL button and text in legacy priority order', async (t) => {
    const f = await fixture(t);
    const conflict = valid({
        resultType: 'singleSelect',
        value: 'Ready',
        formattedValue: 'Ready',
        select: { choices },
        renderFormulaAsHTML: true,
        renderFormulaAsAttachment: true,
        displayAsButton: true,
        gallery: { entries: [{ url }], disableDownloadFiles: true },
    });
    await f.formula(conflict);
    assert.equal(
        f.container.querySelector('.mx-sdk-select-selected')?.textContent,
        'Ready for review'
    );
    assert.equal(
        f.container.querySelector(
            '.mx-sdk-html,.mx-sdk-url-gallery,a,button,input'
        ),
        null
    );

    const markup =
        '<strong>Formula HTML</strong><script>forbidden()</script><img src="x" onerror="forbidden()">';
    await f.formula({
        ...conflict,
        resultType: 'singleLineText',
        value: markup,
    });
    assert.equal(
        f.container.querySelector('strong')?.textContent,
        'Formula HTML'
    );
    assert.equal(
        f.container.querySelector('script,[onerror],.mx-sdk-url-gallery,a'),
        null
    );

    await f.formula({
        ...conflict,
        resultType: 'singleLineText',
        value: url,
        renderFormulaAsHTML: false,
    });
    assert.ok(f.container.querySelector('.mx-sdk-url-gallery'));
    assert.equal(f.container.querySelector('.mx-sdk-html,a'), null);

    await f.formula({
        ...conflict,
        resultType: 'singleLineText',
        value: url,
        renderFormulaAsHTML: false,
        renderFormulaAsAttachment: false,
    });
    assert.equal(f.container.querySelector('a')?.getAttribute('href'), url);
    assert.equal(
        f.container.querySelector('.mx-sdk-url-gallery,.mx-sdk-html'),
        null
    );

    await f.formula({
        ...conflict,
        resultType: 'singleLineText',
        value: markup,
        formattedValue: markup,
        renderFormulaAsHTML: false,
        renderFormulaAsAttachment: false,
        displayAsButton: false,
    });
    assert.equal(f.container.textContent, markup);
    assert.equal(f.container.querySelector('strong,script,img,a,button'), null);
});

it('uses current URL labels and disables invalid or nonstring Formula buttons', async (t) => {
    const f = await fixture(t);
    const props = valid({
        displayAsButton: true,
        value: url,
        validUrlButtonLabel: '  View computed document  ',
        invalidUrlButtonLabel: '  Computed URL unavailable  ',
    });
    await f.formula(props);
    assert.equal(
        f.container.querySelector('a')?.textContent,
        'View computed document'
    );
    assert.equal(
        f.container.querySelector('a')?.getAttribute('target'),
        '_blank'
    );
    assert.equal(
        f.container.querySelector('a')?.getAttribute('rel'),
        'noreferrer'
    );
    for (const value of [
        'javascript:forbidden()',
        null,
        0,
        false,
        { error: '#ERROR!' },
        { specialValue: 'NaN' },
    ]) {
        await f.formula({ ...props, value });
        const button = f.container.querySelector('button');
        assert.ok(button);
        assert.equal(button.disabled, true);
        assert.equal(button.type, 'button');
        assert.equal(button.textContent, 'Computed URL unavailable');
        assert.equal(f.container.querySelector('a'), null);
    }
    await f.formula({
        ...props,
        value: null,
        invalidUrlButtonLabel: ' ',
        buttonLabels: { invalidLink: 'Lien invalide' },
    });
    assert.equal(
        f.container.querySelector('button')?.textContent,
        'Lien invalide'
    );
    await f.formula({
        ...props,
        validUrlButtonLabel: ' ',
        buttonLabels: { openLink: 'Ouvrir le lien' },
    });
    assert.equal(f.container.querySelector('a')?.textContent, 'Ouvrir le lien');
});

it('rejects nonstring rich values before error and special envelopes can become resources', async (t) => {
    const f = await fixture(t);
    const envelopes = [
        [null, ''],
        [0, '0.00'],
        [false, ''],
        [{ error: '#ERROR!' }, '#ERROR!'],
        [{ specialValue: 'NaN' }, 'NaN'],
        [{ specialValue: 'Infinity' }, 'Infinity'],
        [{ specialValue: '-Infinity' }, '-Infinity'],
    ] as const;
    for (const [value, formattedValue] of envelopes) {
        for (const configuration of [
            { renderFormulaAsHTML: true },
            {
                renderFormulaAsAttachment: true,
                gallery: { entries: [{ url }] },
            },
            { resultType: 'singleSelect', select: { choices } },
        ]) {
            await f.formula(valid({ value, formattedValue, ...configuration }));
            // A null Select result retains the native empty display; HTML and
            // media reject null rather than coercing it into resource input.
            if (value === null && configuration.resultType === 'singleSelect')
                assert.equal(f.container.textContent, 'No Value');
            else
                assert.match(
                    f.container.querySelector('[role="alert"]')?.textContent ??
                        '',
                    /unexpected value/
                );
            assert.equal(
                f.container.querySelector(
                    'script,img,iframe,video,audio,a,button'
                ),
                null
            );
        }
        await f.formula(valid({ value, formattedValue }));
        assert.equal(f.container.textContent, formattedValue || 'No Value');
        assert.equal(
            f.container.querySelector('script,img,iframe,video,audio,a,button'),
            null
        );
    }
});

it('keeps failed text conversion from preempting opted-in rich presentation', async (t) => {
    const f = await fixture(t);
    const props = valid({
        resultType: 'number',
        value: '<strong>Explicit Formula HTML</strong><script>forbidden()</script>',
        formattedValue: null,
        formattingFailed: true,
        renderFormulaAsHTML: true,
    });
    await f.formula(props);
    assert.equal(
        f.container.querySelector('strong')?.textContent,
        'Explicit Formula HTML'
    );
    assert.equal(f.container.querySelector('[role="alert"],script'), null);

    await f.formula({
        ...props,
        value: url,
        renderFormulaAsHTML: false,
        renderFormulaAsAttachment: true,
        gallery: { entries: [{ url }], disableDownloadFiles: true },
    });
    assert.ok(f.container.querySelector('button[aria-label="' + url + '"]'));
    assert.equal(f.container.querySelector('[role="alert"]'), null);

    await f.formula({ ...props, renderFormulaAsHTML: false });
    assert.match(
        f.container.querySelector('[role="alert"]')?.textContent ?? '',
        /unexpected value/
    );
    assert.equal(f.container.textContent?.includes('No Value'), false);
    assert.equal(f.container.querySelector('strong,script,a,img'), null);
    await f.formula(
        valid({ resultType: 'number', value: 4.5, formattedValue: '4.50' })
    );
    assert.equal(f.container.textContent, '4.50');
    assert.equal(f.container.querySelector('[role="alert"]'), null);
});

it('masks before every rich mode and preserves configured size, height and accessible associations', async (t) => {
    const f = await fixture(t);
    const sensitive = '<img src="https://private.invalid/secret.png">secret';
    await f.formula(
        valid({
            value: sensitive,
            formattedValue: sensitive,
            resultType: 'singleSelect',
            select: { choices: [{ id: 'secret', name: sensitive }] },
            obscurePassword: true,
            renderFormulaAsHTML: true,
            renderFormulaAsAttachment: true,
            displayAsButton: true,
            gallery: {
                entries: [{ url: 'https://private.invalid/secret.png' }],
            },
            textSize: 'large',
        })
    );
    assert.equal(f.container.textContent, '••••••••');
    assert.equal(f.container.innerHTML.includes('secret'), false);
    assert.equal(
        f.container.querySelector('img,a,button,iframe,video,audio'),
        null
    );
    assert.ok(f.container.querySelector('.read-only-text.text-lg'));

    await f.formula(
        valid({
            renderFormulaAsHTML: true,
            value: '<p>Height</p>',
            heightForFormulaFieldHTML: 180,
        })
    );
    assert.equal(
        (f.container.querySelector('.mx-sdk-html') as unknown as HTMLElement)
            ?.style.height,
        '180px'
    );
    await f.formula(
        valid({
            renderFormulaAsHTML: true,
            value: '<p>Current height</p>',
            heightForFormulaFieldHTML: '12rem',
        })
    );
    assert.equal(
        (f.container.querySelector('.mx-sdk-html') as unknown as HTMLElement)
            ?.style.height,
        '12rem'
    );

    const association = {
        inputId: 'formula-answer',
        formId: 'native-form',
        labelledBy: 'formula-title',
        describedBy: 'formula-help',
    };
    for (const props of [
        valid(association),
        {
            ...association,
            mode: 'controlled' as const,
            language: 'en' as const,
            isValid: false as const,
        },
        valid({
            ...association,
            resultType: 'singleSelect',
            select: { choices },
            value: 'Ready',
        }),
    ]) {
        await f.formula(props);
        const group = f.container.querySelector('#formula-answer');
        assert.ok(group);
        assert.equal(group.getAttribute('aria-labelledby'), 'formula-title');
        assert.equal(group.getAttribute('aria-describedby'), 'formula-help');
    }
});

it('numbers only Formula Grid attachment actions and keeps exact duplicate occurrences', async (t) => {
    const f = await fixture(t);
    const entries = [{ url }, { url }];
    const formula = valid({ value: url, renderFormulaAsAttachment: true });
    const buttons = () => [
        ...f.container.querySelectorAll('.mx-sdk-url-gallery__open'),
    ];
    const names = () =>
        buttons().map((button) => button.getAttribute('aria-label'));
    await f.formula({ ...formula, gallery: { entries } });
    const rootButtons = buttons();
    assert.deepEqual(names(), [url, url]);
    await f.formula({ ...formula, gallery: { entries, isInGrid: true } });
    assert.deepEqual(names(), ['Open attachment 1', 'Open attachment 2']);
    await f.formula({
        ...formula,
        language: 'es',
        gallery: {
            entries,
            isInGrid: true,
            labels: { openAttachment: 'Abrir archivo' },
        },
    });
    assert.deepEqual(names(), ['Abrir archivo 1', 'Abrir archivo 2']);
    buttons().forEach((button, index) =>
        assert.equal(button, rootButtons[index])
    );
    await f.formula({ ...formula, gallery: { entries } });
    assert.deepEqual(names(), [url, url]);
});

it('keeps Formula gallery controls readonly and isolated from sibling values and implicit Form submit', async (t) => {
    const f = await fixture(t);
    let submits = 0;
    let siblingWrites = 0;
    const props = valid({
        value: url,
        renderFormulaAsAttachment: true,
        gallery: {
            entries: [{ url }, { url: 'https://example.invalid/second.png' }],
            labels: {
                attachments: 'Documents calculés',
                close: 'Fermer',
                next: 'Suivant',
            },
            disableDownloadFiles: true,
        },
    });
    await f.render(
        h(
            'form',
            {
                id: 'native-form',
                onSubmit: (
                    event: import('react').FormEvent<HTMLFormElement>
                ) => {
                    event.preventDefault();
                    submits++;
                },
            },
            h('input', {
                name: 'neighbor',
                value: 'Sibling value',
                onChange: () => {
                    siblingWrites++;
                },
            }),
            h(FormulaField, props)
        )
    );
    const sibling = f.container.querySelector('input');
    assert.ok(sibling);
    const open = f.container.querySelector('button[aria-label="' + url + '"]');
    assert.ok(open);
    await act(async () => (open as unknown as HTMLButtonElement).click());
    assert.equal(
        f.container
            .querySelector('[role="dialog"]')
            ?.getAttribute('aria-label'),
        'Documents calculés'
    );
    const next = f.container.querySelector('button[aria-label="Suivant"]');
    assert.ok(next);
    await act(async () => (next as unknown as HTMLButtonElement).click());
    assert.match(
        f.container.querySelector('[role="dialog"]')?.textContent ?? '',
        /2 \/ 2/
    );
    const close = Array.from(f.container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Fermer'
    );
    assert.ok(close);
    await act(async () => close.click());
    assert.equal(f.container.querySelector('[role="dialog"]'), null);
    assert.equal(sibling.value, 'Sibling value');
    assert.equal(submits, 0);
    assert.equal(siblingWrites, 0);
    assert.equal(
        f.container.querySelector('input[type="file"],button[type="submit"]'),
        null
    );
    for (const button of f.container.querySelectorAll('button'))
        assert.equal(button.type, 'button');
});
