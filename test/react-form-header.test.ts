import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h, useLayoutEffect, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CompleteFormHeader,
    CompleteFormFooterDescription,
    CompleteFormCover,
} from '../src/react/index.js';
import type { FormDisplaySource } from '../src/forms/index.js';
import {
    AirtableFieldType,
    type AirtableField,
    type AirtableValue,
} from '../src/formulas/index.js';
import { textField } from './fixtures.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

// These are DOM assembly controls. Geometry belongs to the shared external DOM
// fixture; they do not claim browser paint, print layout or provider loading.
type HeaderProps = Parameters<typeof CompleteFormHeader>[0];
type FooterProps = Parameters<typeof CompleteFormFooterDescription>[0];
const identity = {
    owner: 'session-header',
    configuration: 'config-a',
    record: 'tbl:record-a',
};
const none: FormDisplaySource = { type: 'none' };
const staticSource = (value: string | null): FormDisplaySource => ({
    type: 'static',
    value,
});
const dynamicSource = (
    value: AirtableValue,
    field: AirtableField = textField
): FormDisplaySource => ({
    type: 'field',
    field: { status: 'resolved', field, value },
});
const missing: FormDisplaySource = {
    type: 'field',
    field: { status: 'missing' },
};
const defaults: HeaderProps = {
    identity,
    title: none,
    extensionName: 'Extension name',
};
const preview = { showPlaceholders: true, showFieldSources: true };
const longHTML = Array.from(
    { length: 8 },
    (_, index) => `<p>Shared record description ${index}</p>`
).join('');

type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;
function button(fixture: Fixture, text: string) {
    const found = [...fixture.container.querySelectorAll('button')].find(
        (entry) => entry.textContent === text
    );
    assert.ok(found, `Expected button ${text}`);
    return found;
}
function footer(props: Partial<FooterProps> = {}) {
    return h(CompleteFormFooterDescription, {
        identity,
        enabled: true,
        source: none,
        ...props,
    });
}

it('server-renders the full default header family without effects or a browser', () => {
    assert.equal(typeof window, 'undefined');
    const html = renderToStaticMarkup(
        h(
            'main',
            null,
            h(CompleteFormHeader, {
                ...defaults,
                title: staticSource('Public title'),
                description: {
                    enabled: true,
                    source: staticSource(
                        '<strong>Safe description</strong><script>bad()</script>'
                    ),
                },
            }),
            footer({ source: staticSource('<p>Public footer</p>') }),
            h(CompleteFormCover, {
                identity,
                src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
            })
        )
    );
    assert.match(html, /<h1[^>]*>Public title<\/h1>/);
    assert.match(html, /<strong>Safe description<\/strong>/);
    assert.match(html, /Public footer/);
    assert.match(html, /alt=""/);
    assert.doesNotMatch(html, /<script|bad\(\)|Add logo|Add footer|Form title/);
});

it('renders nothing when every public header source is absent', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert.ok(f.window instanceof Window);
    await f.render(h(CompleteFormHeader, defaults));
    assert.equal(f.container.childElementCount, 0);
});

it('distinguishes missing, valid blank and restored dynamic titles in one mounted header', async (t) => {
    const f = await htmlPresentationFixture(t);
    for (const [source, expected] of [
        [missing, 'Extension name'],
        [dynamicSource(''), null],
        [dynamicSource(undefined), null],
        [dynamicSource('Current title'), 'Current title'],
        [missing, 'Extension name'],
    ] as const) {
        await f.render(h(CompleteFormHeader, { ...defaults, title: source }));
        assert.equal(
            f.container.querySelector('h1')?.textContent ?? null,
            expected
        );
        assert.equal(f.container.querySelector('button'), null);
    }
});

it('preserves selected source and config A–B–A without retaining obsolete content', async (t) => {
    const f = await htmlPresentationFixture(t);
    for (const [configuration, title, description, expected] of [
        [
            'a',
            staticSource('Static A'),
            staticSource('<p>Description A</p>'),
            'Static ADescription A',
        ],
        [
            'b',
            dynamicSource('Field B'),
            dynamicSource('<p>Description B</p>'),
            'Field BDescription B',
        ],
        [
            'a',
            staticSource('Static A'),
            staticSource('<p>Description A</p>'),
            'Static ADescription A',
        ],
    ] as const) {
        await f.render(
            h(CompleteFormHeader, {
                ...defaults,
                identity: { ...identity, configuration },
                title,
                description: { enabled: true, source: description },
            })
        );
        assert.equal(f.container.textContent, expected);
    }
});

it('renders Formula multiline titles as plain text using the complete SDK header', async (t) => {
    const f = await htmlPresentationFixture(t);
    const field: AirtableField = {
        id: 'fld_formula',
        name: 'Formula title',
        config: {
            type: AirtableFieldType.FORMULA,
            options: { isValid: true, result: textField.config },
        },
    };
    await f.render(
        h(CompleteFormHeader, {
            ...defaults,
            title: dynamicSource(
                '**First**\nSecond\nThird\nFourth\nFifth\nLast',
                field
            ),
        })
    );
    assert.equal(
        f.container.querySelector('h1')?.textContent,
        'First\n\nSecond\n\nThird\n\nFourth\n\nFifth\n\nLast'
    );
    assert.equal(f.container.querySelector('strong'), null);
    await f.render(
        h(CompleteFormHeader, {
            ...defaults,
            title: dynamicSource('<b>Literal</b>'),
        })
    );
    assert.equal(
        f.container.querySelector('h1')?.textContent,
        '<b>Literal</b>'
    );
    assert.equal(f.container.querySelector('b'), null);
});

for (const sourceType of ['static', 'field'] as const) {
    it(`enforces description master disable over retained ${sourceType} content and preview field name`, async (t) => {
        const f = await htmlPresentationFixture(t);
        const source =
            sourceType === 'static'
                ? staticSource('<p>Retained secret description</p>')
                : dynamicSource('<p>Retained secret description</p>');
        await f.render(
            h(CompleteFormHeader, {
                ...defaults,
                title: staticSource('Adjacent title'),
                description: { enabled: false, source },
                preview,
            })
        );
        assert.equal(f.container.querySelector('section'), null);
        assert.doesNotMatch(
            f.container.textContent ?? '',
            /Retained secret description|Description from Airtable/
        );
        assert.ok(button(f, 'Add form description'));
        await f.render(
            h(CompleteFormHeader, {
                ...defaults,
                title: staticSource('Adjacent title'),
                description: { enabled: false, source },
            })
        );
        assert.equal(f.container.textContent, 'Adjacent title');
    });
}

for (const html of [
    '',
    ' \n\t&nbsp; ',
    '<p><br></p>',
    '<p>\u200b</p>',
    '<script>bad()</script>',
]) {
    it(`suppresses sanitized empty description and footer ${JSON.stringify(html)}`, async (t) => {
        const f = await htmlPresentationFixture(t);
        for (const source of [staticSource(html), dynamicSource(html)]) {
            await f.render(
                h(
                    'div',
                    null,
                    h(CompleteFormHeader, {
                        ...defaults,
                        title: staticSource('Adjacent title'),
                        description: { enabled: true, source },
                    }),
                    footer({ source })
                )
            );
            assert.equal(f.container.textContent, 'Adjacent title');
            assert.equal(f.container.querySelector('section'), null);
            assert.equal(f.container.querySelector('script'), null);
        }
    });
}

it('keeps meaningful media-only descriptions and footer content without provider requests', async (t) => {
    const f = await htmlPresentationFixture(t);
    const source = dynamicSource(
        '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="Record media">'
    );
    await f.render(
        h(
            'div',
            null,
            h(CompleteFormHeader, {
                ...defaults,
                description: { enabled: true, source },
            }),
            footer({ source })
        )
    );
    assert.equal(f.container.querySelectorAll('img').length, 2);
    assert.equal(
        f.container.querySelectorAll('img[alt="Record media"]').length,
        2
    );
    f.unchangedEffects();
});

it('sanitizes record-authored description and footer through the real shared HTML component', async (t) => {
    const f = await htmlPresentationFixture(t);
    const source = dynamicSource(
        '<p>Safe <strong>record content</strong></p><script>bad()</script><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" onerror="bad()">'
    );
    await f.render(
        h(
            'div',
            null,
            h(CompleteFormHeader, {
                ...defaults,
                description: { enabled: true, source },
            }),
            footer({ source })
        )
    );
    assert.equal(f.container.querySelectorAll('strong').length, 2);
    assert.equal(f.container.querySelector('script'), null);
    assert.equal(f.container.querySelector('[onerror]'), null);
});

it('updates and removes dynamic title, logo and description when admitted values are hidden', async (t) => {
    const f = await htmlPresentationFixture(t);
    const logoField: AirtableField = {
        id: 'fld_logo',
        name: 'Logo',
        config: { type: AirtableFieldType.MULTIPLE_ATTACHMENTS, options: null },
    };
    const render = (value: string | undefined) =>
        f.render(
            h(CompleteFormHeader, {
                ...defaults,
                title: dynamicSource(value),
                logo: dynamicSource(
                    value
                        ? [{ url: `https://cdn.example.invalid/${value}.png` }]
                        : undefined,
                    logoField
                ),
                description: {
                    enabled: true,
                    source: dynamicSource(
                        value ? `<p>${value}</p>` : undefined
                    ),
                },
            })
        );
    await render('First');
    assert.equal(f.container.querySelector('h1')?.textContent, 'First');
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        'https://cdn.example.invalid/First.png'
    );
    await render('Updated');
    assert.equal(f.container.querySelector('h1')?.textContent, 'Updated');
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        'https://cdn.example.invalid/Updated.png'
    );
    await render(undefined);
    assert.equal(f.container.textContent, '');
    assert.equal(f.container.querySelector('h1, img, section, button'), null);
    await render('First');
    assert.equal(f.container.querySelector('h1')?.textContent, 'First');
});

it('suppresses and restores legacy logo through root–child–root while retaining title and description', async (t) => {
    const f = await htmlPresentationFixture(t);
    for (const child of [false, true, false]) {
        await f.render(
            h(CompleteFormHeader, {
                ...defaults,
                isChildForm: child,
                logo: staticSource('https://cdn.example.invalid/logo.png'),
                title: staticSource('Retained title'),
                description: {
                    enabled: true,
                    source: staticSource('<p>Retained description</p>'),
                },
                preview,
            })
        );
        assert.equal(f.container.querySelectorAll('img').length, child ? 0 : 1);
        assert.match(
            f.container.textContent ?? '',
            /Retained titleRetained description/
        );
        assert.doesNotMatch(
            f.container.textContent ?? '',
            /Add logo|Logo from Airtable/
        );
        if (!child)
            assert.equal(
                f.container.querySelector('img')?.getAttribute('alt'),
                ''
            );
    }
});

it('shows source-specific preview placeholders only for enabled resolved fields', async (t) => {
    const f = await htmlPresentationFixture(t);
    const calls: string[] = [];
    await f.render(
        h(CompleteFormHeader, {
            ...defaults,
            title: dynamicSource(''),
            logo: dynamicSource(undefined),
            description: {
                enabled: true,
                source: dynamicSource('<p><br></p>'),
            },
            preview: {
                ...preview,
                onOpenSettings: (target) => calls.push(target),
            },
        })
    );
    await f.click(button(f, 'Logo from Airtable: Title'));
    await f.click(button(f, 'Title from Airtable: Title'));
    await f.click(button(f, 'Description from Airtable: Title'));
    assert.deepEqual(calls, ['logo', 'title', 'description']);
    await f.render(
        h(CompleteFormHeader, {
            ...defaults,
            title: none,
            logo: missing,
            description: { enabled: true, source: missing },
            preview,
        })
    );
    assert.ok(button(f, 'Add logo'));
    assert.ok(button(f, 'Form title'));
    assert.ok(button(f, 'Add form description'));
    assert.doesNotMatch(f.container.textContent ?? '', /from Airtable/);
});

it('keeps omitted or disabled preview settings capabilities inert', async (t) => {
    const f = await htmlPresentationFixture(t);
    const calls: string[] = [];
    const onOpenSettings = (target: string) => calls.push(target);
    await f.render(
        h(CompleteFormHeader, {
            ...defaults,
            preview: {
                showPlaceholders: false,
                showFieldSources: true,
                onOpenSettings,
            },
        })
    );
    assert.equal(f.container.querySelector('button'), null);
    await f.render(
        h(CompleteFormHeader, {
            ...defaults,
            title: dynamicSource(''),
            description: { enabled: true, source: dynamicSource(null) },
            preview: {
                showPlaceholders: true,
                showFieldSources: false,
            },
        })
    );
    assert.doesNotMatch(f.container.textContent ?? '', /from Airtable/);
    await f.click(button(f, 'Form title'));
    await f.click(button(f, 'Add form description'));
    assert.deepEqual(calls, []);
});

it('uses current preview callbacks and retires removed or no-longer-authorized controls', async (t) => {
    const f = await htmlPresentationFixture(t);
    const calls: string[] = [];
    let current = true;
    const render = (configuration: string, callbackName: string) =>
        f.render(
            h(CompleteFormHeader, {
                ...defaults,
                identity: { ...identity, configuration },
                preview: {
                    ...preview,
                    isCurrent: () => current,
                    onOpenSettings: (target) =>
                        calls.push(`${callbackName}:${target}`),
                },
            })
        );
    await render('a', 'first');
    await f.click(button(f, 'Add logo'));
    await render('a', 'current');
    const retiredButton = button(f, 'Add logo');
    await f.click(retiredButton);
    current = false;
    await f.click(retiredButton);
    assert.deepEqual(calls, ['first:logo', 'current:logo']);
    current = true;
    await render('b', 'second-owner');
    await f.render(h(CompleteFormHeader, defaults));
    await f.click(retiredButton);
    assert.deepEqual(calls, ['first:logo', 'current:logo']);
    await render('a', 'returned-owner');
    await f.click(button(f, 'Add logo'));
    assert.deepEqual(calls, [
        'first:logo',
        'current:logo',
        'returned-owner:logo',
    ]);
});

it('resets description expansion on actual record A–B–A despite identical HTML', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    const render = (record: string) =>
        f.render(
            h(CompleteFormHeader, {
                ...defaults,
                identity: { ...identity, record },
                description: {
                    enabled: true,
                    source: staticSource(longHTML),
                    truncate: true,
                },
            })
        );
    await render('record-a');
    await f.click(button(f, 'Read more'));
    assert.equal(button(f, 'Show less').getAttribute('aria-expanded'), 'true');
    await render('record-b');
    assert.equal(button(f, 'Read more').getAttribute('aria-expanded'), 'false');
    await f.click(button(f, 'Read more'));
    await render('record-a');
    assert.equal(button(f, 'Read more').getAttribute('aria-expanded'), 'false');
    assert.match(f.container.textContent ?? '', /Shared record description 7/);
});

it('uses localized disclosure labels without replacing truncation state ownership', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    await f.render(
        h(CompleteFormHeader, {
            ...defaults,
            language: 'es',
            description: {
                enabled: true,
                source: staticSource(longHTML),
                truncate: true,
            },
        })
    );
    await f.click(button(f, 'Leer más'));
    assert.ok(button(f, 'Mostrar menos'));
});

it('replaces missing and blank footer fields with the proper preview placeholder', async (t) => {
    const f = await htmlPresentationFixture(t);
    for (const source of [
        missing,
        dynamicSource(undefined),
        dynamicSource(null),
        dynamicSource(''),
        dynamicSource('<p><br></p>'),
    ]) {
        await f.render(footer({ source }));
        assert.equal(f.container.childElementCount, 0);
        await f.render(footer({ source, preview }));
        const expected =
            source.type === 'field' && source.field.status === 'resolved'
                ? 'Footer from Airtable: Title'
                : 'Add footer';
        assert.ok(button(f, expected));
    }
});

it('enforces footer master authority with retained static and dynamic values', async (t) => {
    const f = await htmlPresentationFixture(t);
    const calls: string[] = [];
    for (const source of [
        staticSource('<p>Retained static footer</p>'),
        dynamicSource('<p>Retained field footer</p>'),
    ]) {
        await f.render(footer({ enabled: false, source }));
        assert.equal(f.container.childElementCount, 0);
        await f.render(
            footer({
                enabled: false,
                source,
                preview: {
                    ...preview,
                    onOpenSettings: (target) => calls.push(target),
                },
            })
        );
        assert.equal(f.container.textContent, 'Add footer');
        await f.click(button(f, 'Add footer'));
    }
    assert.deepEqual(calls, ['footer', 'footer']);
});

it('updates footer source/config/record A–B–A and removes a condition-hidden value', async (t) => {
    const f = await htmlPresentationFixture(t);
    for (const [configuration, record, source, expected] of [
        [
            'a',
            'record-a',
            staticSource('<p>Static footer A</p>'),
            'Static footer A',
        ],
        [
            'b',
            'record-b',
            dynamicSource('<p>Field footer B</p>'),
            'Field footer B',
        ],
        [
            'a',
            'record-a',
            staticSource('<p>Static footer A</p>'),
            'Static footer A',
        ],
        ['a', 'record-a', dynamicSource(undefined), ''],
    ] as const) {
        await f.render(
            footer({ identity: { ...identity, configuration, record }, source })
        );
        assert.equal(f.container.textContent, expected);
    }
});

it('keeps footer preview actions current and inert when authority is absent', async (t) => {
    const f = await htmlPresentationFixture(t);
    const calls: string[] = [];
    let current = true;
    await f.render(
        footer({
            source: dynamicSource(''),
            preview: {
                ...preview,
                isCurrent: () => current,
                onOpenSettings: (target) => calls.push(`first:${target}`),
            },
        })
    );
    await f.click(button(f, 'Footer from Airtable: Title'));
    current = false;
    await f.click(button(f, 'Footer from Airtable: Title'));
    await f.render(
        footer({
            source: dynamicSource(''),
            preview: {
                ...preview,
                onOpenSettings: (target) => calls.push(`current:${target}`),
            },
        })
    );
    await f.click(button(f, 'Footer from Airtable: Title'));
    await f.render(
        footer({
            source: dynamicSource(''),
            preview: {
                showPlaceholders: true,
                showFieldSources: false,
            },
        })
    );
    await f.click(button(f, 'Add footer'));
    assert.deepEqual(calls, ['first:footer', 'current:footer']);
});

it('preserves direct cover image dimensions and decorative semantics', async (t) => {
    const f = await htmlPresentationFixture(t);
    await f.render(
        h(CompleteFormCover, {
            identity,
            src: 'https://cdn.example.invalid/cover.png',
            testId: 'cover-qualification',
        })
    );
    const image = f.container.querySelector('img');
    assert.ok(image instanceof f.window.HTMLImageElement);
    assert.equal(
        image.getAttribute('src'),
        'https://cdn.example.invalid/cover.png'
    );
    assert.equal(image.getAttribute('alt'), '');
    assert.equal(image.getAttribute('data-testid'), 'cover-qualification');
    assert.equal(image.style.height, '216px');
    assert.equal(image.style.width, '100%');
    assert.equal(image.style.objectFit, 'cover');
    const wrapper = image.parentElement;
    assert.ok(wrapper instanceof f.window.HTMLElement);
    assert.equal(wrapper.style.height, '136px');
});

it('suppresses cover in child and modal presentations independently of header logo', async (t) => {
    const f = await htmlPresentationFixture(t);
    for (const props of [{ isChildForm: true }, { isModal: true }]) {
        await f.render(
            h(CompleteFormCover, {
                identity,
                src: 'https://cdn.example.invalid/cover.png',
                preview,
                ...props,
            })
        );
        assert.equal(f.container.childElementCount, 0);
    }
    await f.render(
        h(CompleteFormCover, {
            identity,
            src: 'https://cdn.example.invalid/cover.png',
        })
    );
    assert.ok(f.container.querySelector('img'));
});

it('admits an empty cover placeholder only for the current visible root preview', async (t) => {
    const f = await htmlPresentationFixture(t);
    const calls: string[] = [];
    await f.render(h(CompleteFormCover, { identity, src: null }));
    assert.equal(f.container.childElementCount, 0);
    const capability = {
        showPlaceholders: true,
        showFieldSources: false,
        onOpenSettings: (target: string) => calls.push(target),
    };
    await f.render(
        h(CompleteFormCover, { identity, src: null, preview: capability })
    );
    assert.equal(f.container.querySelector('img'), null);
    await f.click(button(f, 'Add cover image'));
    assert.deepEqual(calls, ['cover']);
    for (const policy of [{ isChildForm: true }, { isModal: true }]) {
        await f.render(
            h(CompleteFormCover, {
                identity,
                src: null,
                preview: capability,
                ...policy,
            })
        );
        assert.equal(f.container.childElementCount, 0);
    }
    await f.render(
        h(CompleteFormCover, {
            identity,
            src: '',
            preview: { ...capability, showPlaceholders: false },
        })
    );
    assert.equal(f.container.childElementCount, 0);
    assert.deepEqual(calls, ['cover']);
    f.unchangedEffects();
});

for (const boundary of ['owner', 'configuration', 'record'] as const) {
    it(`retires an in-flight preview command across synchronous ${boundary} A–B–A with the same capability`, async (t) => {
        const f = await htmlPresentationFixture(t);
        const { flushSync } = await import('react-dom');
        const calls: string[] = [];
        let commitIdentity: ((next: typeof identity) => void) | undefined;
        let transitionDuringCheck = true;
        const capability = {
            ...preview,
            isCurrent: () => {
                if (transitionDuringCheck) {
                    transitionDuringCheck = false;
                    const changeIdentity = commitIdentity;
                    assert.ok(changeIdentity);
                    const otherIdentity = {
                        ...identity,
                        [boundary]: `different-${boundary}`,
                    };
                    flushSync(() => changeIdentity(otherIdentity));
                    assert.equal(
                        f.container.querySelector('output')?.textContent,
                        otherIdentity[boundary]
                    );
                    flushSync(() => changeIdentity(identity));
                    assert.equal(
                        f.container.querySelector('output')?.textContent,
                        identity[boundary]
                    );
                }
                return true;
            },
            onOpenSettings: (target: string) => calls.push(target),
        };
        function Host() {
            const [acceptedIdentity, setIdentity] = useState(identity);
            useLayoutEffect(() => {
                commitIdentity = (next) => setIdentity(next);
                return () => {
                    commitIdentity = undefined;
                };
            }, []);
            return h(
                'div',
                null,
                h('output', null, acceptedIdentity[boundary]),
                h(CompleteFormHeader, {
                    ...defaults,
                    identity: acceptedIdentity,
                    preview: capability,
                })
            );
        }
        await f.render(h(Host));
        await f.click(button(f, 'Add logo'));
        assert.equal(transitionDuringCheck, false);
        assert.deepEqual(calls, []);
        await f.click(button(f, 'Add logo'));
        assert.deepEqual(calls, ['logo']);
        f.unchangedEffects();
    });
}

it('scopes create-record truncation to its owner while retaining expansion through configuration-only changes', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    const render = (owner: string, configuration: string) =>
        f.render(
            h(CompleteFormHeader, {
                ...defaults,
                identity: { owner, configuration, record: 'create' },
                description: {
                    enabled: true,
                    source: staticSource(longHTML),
                    truncate: true,
                },
            })
        );
    await render('owner-a', 'config-a');
    await f.click(button(f, 'Read more'));
    assert.equal(button(f, 'Show less').getAttribute('aria-expanded'), 'true');
    await render('owner-a', 'config-b');
    assert.equal(button(f, 'Show less').getAttribute('aria-expanded'), 'true');
    await render('owner-a', 'config-a');
    assert.equal(button(f, 'Show less').getAttribute('aria-expanded'), 'true');
    await render('owner-b', 'config-a');
    assert.equal(button(f, 'Read more').getAttribute('aria-expanded'), 'false');
    await f.click(button(f, 'Read more'));
    assert.equal(button(f, 'Show less').getAttribute('aria-expanded'), 'true');
    await render('owner-a', 'config-a');
    assert.equal(button(f, 'Read more').getAttribute('aria-expanded'), 'false');
    assert.match(f.container.textContent ?? '', /Shared record description 7/);
    f.unchangedEffects();
});
