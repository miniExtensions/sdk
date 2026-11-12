import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, useState, type ReactNode } from 'react';
import { FormGroup, type FormGroupProps } from '../src/react/FormGroup.js';
import { CompleteMultilineTextField } from '../src/react/CompleteMultilineTextField.js';
import { ThemeBoundary } from '../src/react/ThemeBoundary.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

/* Native FormFieldOrGroup.tsx blob 0eb4a5dbfe05445256d993504980e2ca49f051fc,
 * real regression blob ecf052514b1802a4aecef4ac896762a4ac0bb1fe, group cases
 * 6594–6810. These port presentation oracles onto real SDK components. The
 * canonical-value consumer below owns one host state outside the disclosure;
 * it is synthetic DOM evidence, not native Redux/Save or browser acceptance.
 * These tests use FormGroup in synthetic one-page composition. Native
 * multipage/all-page readonly adoption requires separate native regressions.
 */
type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;
function group(
    overrides: Partial<FormGroupProps> = {},
    children: ReactNode = h('span', { id: 'fld_email' }, 'ada@example.com')
) {
    return h(FormGroup, {
        title: 'Contact',
        description: '<p>Contact details</p>',
        isExpanded: false,
        isReadOnlyPage: false,
        allFieldsHidden: false,
        hasError: false,
        children,
        ...overrides,
    });
}
function publicToggle(f: Fixture) {
    const button = f.container.querySelector(
        'button.mx-sdk-form-group__disclosure'
    );
    assert.ok(button instanceof f.window.HTMLButtonElement);
    return button;
}
function panel(f: Fixture) {
    return f.container.querySelector('.mx-sdk-form-group__panel');
}

it('renders native metadata, the supplied error dot and the existing Quill HTML description', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert.ok(f.window instanceof Window);
    const node = h('span', { id: 'fld_email' }, 'ada@example.com');
    await f.render(
        group(
            {
                title: '<b>Contact</b>',
                isExpanded: true,
                hasError: true,
                description:
                    '<p><strong>Contact details</strong> <a href="https://example.com/help">Help</a></p><script>unexpected()</script>',
            },
            node
        )
    );
    assert.equal(publicToggle(f).textContent, '<b>Contact</b>');
    assert.equal(publicToggle(f).querySelector('b'), null);
    assert.ok(f.container.querySelector('.mx-sdk-quill strong'));
    const link = f.container.querySelector('.mx-sdk-quill a');
    assert.ok(link);
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(f.container.querySelector('script'), null);
    const dot = f.container.querySelector('.mx-sdk-form-group__error');
    assert.ok(dot);
    assert.equal(dot.getAttribute('aria-hidden'), 'true');
    const child = f.container.querySelector('#fld_email');
    assert.ok(child);
    await f.render(group({ isExpanded: true, hasError: false }, node));
    assert.equal(f.container.querySelector('.mx-sdk-form-group__error'), null);
    assert.equal(f.container.querySelector('#fld_email'), child);
    assert.equal(publicToggle(f).getAttribute('type'), 'button');
    f.unchangedEffects();
});

it('unmounts the closed panel and preserves the single host canonical value through edit and reopen', async (t) => {
    const f = await htmlPresentationFixture(t);
    const writes: string[] = [];
    let replaceCanonical: ((value: string) => void) | undefined;
    function Host() {
        const [canonical, setCanonical] = useState('ada@example.com');
        replaceCanonical = setCanonical;
        return h(
            'div',
            null,
            h('input', { id: 'adjacent-field', defaultValue: 'Neighbor' }),
            h('output', { id: 'canonical' }, canonical),
            group(
                {},
                h(CompleteMultilineTextField, {
                    id: 'fld_email',
                    form: 'html-presentation-owner',
                    value: canonical,
                    onChange: (value: string) => {
                        writes.push(value);
                        setCanonical(value);
                    },
                })
            )
        );
    }
    await f.render(h(Host));
    const sibling = f.container.querySelector('#adjacent-field');
    assert.ok(sibling instanceof f.window.HTMLInputElement);
    sibling.value = 'Adjacent draft';
    assert.equal(panel(f), null);
    assert.equal(f.container.querySelector('textarea'), null);
    assert.equal(f.container.textContent?.includes('Contact details'), false);
    assert.deepEqual(writes, []);
    await f.click(publicToggle(f));
    const first = f.container.querySelector('textarea');
    assert.ok(first);
    assert.equal(first.value, 'ada@example.com');
    assert.equal(first.form?.id, 'html-presentation-owner');
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
            f.window.HTMLTextAreaElement.prototype,
            'value'
        )?.set;
        assert.ok(setter);
        setter.call(first, 'grace@example.com');
        first.dispatchEvent(
            new f.window.InputEvent('input', {
                bubbles: true,
                data: 'grace@example.com',
                inputType: 'insertText',
            })
        );
    });
    assert.deepEqual(writes, ['grace@example.com']);
    assert.equal(
        f.container.querySelector('#canonical')?.textContent,
        'grace@example.com'
    );
    await f.click(publicToggle(f));
    assert.equal(first.isConnected, false);
    assert.equal(panel(f), null);
    assert.equal(f.container.querySelector('textarea'), null);
    await f.click(publicToggle(f));
    const reopened = f.container.querySelector('textarea');
    assert.ok(reopened);
    assert.notEqual(reopened, first);
    assert.equal(reopened.value, 'grace@example.com');
    await f.click(publicToggle(f));
    await act(async () => {
        assert.ok(replaceCanonical);
        replaceCanonical('host-update-while-closed@example.com');
    });
    assert.equal(f.container.querySelector('textarea'), null);
    await f.click(publicToggle(f));
    assert.equal(
        f.container.querySelector('textarea')?.value,
        'host-update-while-closed@example.com'
    );
    assert.deepEqual(writes, ['grace@example.com']);
    assert.equal(f.container.querySelector('#adjacent-field'), sibling);
    assert.equal(sibling.value, 'Adjacent draft');
    f.unchangedEffects();
});

for (const initial of [
    { name: 'configured', isExpanded: true, isReadOnlyPage: false },
    { name: 'readonly', isExpanded: false, isReadOnlyPage: true },
]) {
    it(`uses ${initial.name} expansion only initially and preserves independent user toggling`, async (t) => {
        const f = await htmlPresentationFixture(t);
        await f.render(group(initial));
        const button = publicToggle(f);
        assert.equal(button.getAttribute('aria-expanded'), 'true');
        assert.ok(panel(f));
        await f.click(button);
        assert.equal(button.getAttribute('aria-expanded'), 'false');
        assert.equal(panel(f), null);
        await f.render(
            group({
                isExpanded: true,
                isReadOnlyPage: true,
                title: 'Changed title',
                description: '<p>Changed description</p>',
                hasError: true,
            })
        );
        assert.equal(publicToggle(f), button);
        assert.equal(panel(f), null);
        await f.click(button);
        assert.equal(
            f.container.textContent?.includes('Changed description'),
            true
        );
        await f.click(button);
        assert.equal(panel(f), null);
        f.unchangedEffects();
    });
}

it('does not force an already mounted collapsed group open when readonly/default metadata changes', async (t) => {
    const f = await htmlPresentationFixture(t);
    await f.render(group());
    assert.equal(panel(f), null);
    await f.render(group({ isReadOnlyPage: true, isExpanded: true }));
    assert.equal(panel(f), null);
    assert.equal(publicToggle(f).getAttribute('aria-expanded'), 'false');
    await f.click(publicToggle(f));
    assert.ok(panel(f));
});

it('keeps preview title selection separate from its labeled disclosure and maps the current start field', async (t) => {
    const f = await htmlPresentationFixture(t);
    const selected: { kind: 'section'; startFieldId: string }[] = [];
    const preview = (startFieldId: string | null) => ({
        startFieldId,
        onSelectSection: (fieldId: string) =>
            selected.push({ kind: 'section', startFieldId: fieldId }),
    });
    await f.render(group({ preview: preview('fld_email'), hasError: true }));
    const title = f.container.querySelector('.mx-sdk-form-group__title-button');
    const toggle = f.container.querySelector('.mx-sdk-form-group__toggle');
    assert.ok(title instanceof f.window.HTMLButtonElement);
    assert.ok(toggle instanceof f.window.HTMLButtonElement);
    assert.equal(title.textContent, 'Contact');
    assert.equal(title.type, 'button');
    assert.equal(toggle.type, 'button');
    assert.equal(toggle.getAttribute('aria-label'), 'Expand Contact');
    assert.deepEqual(selected, []);
    await f.click(title);
    assert.deepEqual(selected, [
        { kind: 'section', startFieldId: 'fld_email' },
    ]);
    assert.equal(panel(f), null);
    await f.click(toggle);
    assert.ok(panel(f));
    assert.equal(toggle.getAttribute('aria-label'), 'Collapse Contact');
    assert.equal(selected.length, 1);
    await f.render(group({ preview: preview('fld_replacement') }));
    await f.click(title);
    assert.deepEqual(selected[1], {
        kind: 'section',
        startFieldId: 'fld_replacement',
    });
    assert.ok(panel(f));
    f.unchangedEffects();
});

it('falls back to the public title disclosure when preview has no section start field', async (t) => {
    const f = await htmlPresentationFixture(t);
    await f.render(
        group({
            preview: {
                startFieldId: null,
                onSelectSection: () =>
                    assert.fail('No section can be selected'),
            },
        })
    );
    assert.equal(f.container.querySelectorAll('button').length, 1);
    assert.equal(
        f.container.querySelector('.mx-sdk-form-group__title-button'),
        null
    );
    await f.click(publicToggle(f));
    assert.ok(panel(f));
});

it('suppresses all-hidden groups completely and resets disclosure state after suppression', async (t) => {
    const f = await htmlPresentationFixture(t);
    const preview = {
        startFieldId: 'fld_email',
        onSelectSection: () => assert.fail('Suppression must not select'),
    };
    await f.render(
        group({
            allFieldsHidden: true,
            isExpanded: true,
            hasError: true,
            preview,
        })
    );
    assert.equal(f.container.childElementCount, 0);
    await f.render(group({ isExpanded: true }));
    assert.ok(panel(f));
    await f.click(publicToggle(f));
    assert.equal(panel(f), null);
    await f.render(group({ allFieldsHidden: true, isExpanded: true }));
    assert.equal(f.container.childElementCount, 0);
    await f.render(group({ isExpanded: true }));
    assert.ok(panel(f));
    // The immutable host boolean is authoritative; do not inspect child DOM or
    // infer conditional visibility from a hidden/empty child presentation.
    await f.render(group({}, h('span', { hidden: true }, 'Host-hidden child')));
    assert.ok(publicToggle(f));
    f.unchangedEffects();
});

it('uses the same native theme palette and focus treatment for public and preview headers', async (t) => {
    const f = await htmlPresentationFixture(t);
    const style = f.window.document.createElement('style');
    const css = readFileSync(
        new URL('../../../src/react/form-group.css', import.meta.url),
        'utf8'
    );
    style.textContent = css;
    f.window.document.head.append(style);
    assert.ok(style.sheet);
    // Happy DOM drops rgb(var(...)) declarations from its CSSOM. Preserve the
    // native structural palette oracle against the actual scoped stylesheet;
    // the real boundary/DOM assertions below do not certify browser paint.
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const rule = (selector: string) => {
        const found = rules.filter((entry) =>
            entry[1].split(',').some((part) => part.trim() === selector)
        );
        assert.ok(found.length > 0, `Missing scoped CSS rule: ${selector}`);
        return found.map((entry) => entry[2]).join('\n');
    };
    assert.match(
        rule('.mx-sdk-form-group__header'),
        /background:\s*rgb\(var\(--theme-100,/
    );
    assert.match(
        rule('.mx-sdk-form-group__header:hover'),
        /background:\s*rgb\(var\(--theme-200,/
    );
    assert.match(rule('.mx-sdk-form-group__header'), /color:\s*#111827;/);
    assert.doesNotMatch(
        rule('.mx-sdk-form-group__header') +
            rule('.mx-sdk-form-group__header:hover'),
        /background:\s*#(?:f3f4f6|e5e7eb)/
    );
    for (const selector of ['__disclosure', '__title-button', '__toggle']) {
        assert.match(
            rule(`.mx-sdk-form-group${selector}:focus-visible`),
            /box-shadow:\s*0 0 0 3px rgb\(107 114 128 \/ 0\.75\)/
        );
    }
    await f.render(
        h(ThemeBoundary, { theme: 'indigo' }, group({ isExpanded: true }))
    );
    assert.ok(publicToggle(f).classList.contains('mx-sdk-form-group__header'));
    const theme = f.container.querySelector('[data-mx-theme="indigo"]');
    assert.ok(theme instanceof f.window.HTMLElement);
    assert.notEqual(theme.style.getPropertyValue('--theme-100'), '');
    await f.render(
        h(
            ThemeBoundary,
            { theme: 'indigo' },
            group({
                preview: { startFieldId: 'fld_email', onSelectSection() {} },
            })
        )
    );
    const title = f.container.querySelector('.mx-sdk-form-group__title-button');
    assert.ok(
        title?.parentElement?.classList.contains('mx-sdk-form-group__header')
    );
    f.unchangedEffects();
});

it('keeps nullable/empty descriptions, unique panel associations and existing field anchors', async (t) => {
    const f = await htmlPresentationFixture(t);
    await f.render(
        h(
            'div',
            null,
            h('a', { href: '#fld_email' }, 'Existing field error anchor'),
            group({ isExpanded: true, description: '' }),
            group(
                { isExpanded: true, title: 'Second', description: null },
                h('span', { id: 'fld_second' }, 'Second child')
            )
        )
    );
    const buttons = [
        ...f.container.querySelectorAll('.mx-sdk-form-group__disclosure'),
    ];
    const panels = [
        ...f.container.querySelectorAll('.mx-sdk-form-group__panel'),
    ];
    assert.equal(buttons.length, 2);
    assert.equal(panels.length, 2);
    assert.notEqual(panels[0].id, panels[1].id);
    buttons.forEach((button, index) =>
        assert.equal(button.getAttribute('aria-controls'), panels[index].id)
    );
    assert.equal(
        f.container.querySelectorAll(
            '.mx-sdk-form-group__description .mx-sdk-quill'
        ).length,
        1
    );
    const anchor = f.container.querySelector('a[href="#fld_email"]');
    assert.ok(anchor);
    assert.ok(f.container.querySelector('#fld_email'));
    assert.ok(buttons[0] instanceof f.window.HTMLButtonElement);
    await f.click(buttons[0]);
    assert.equal(f.container.querySelector('#fld_email'), null);
    assert.equal(anchor.getAttribute('href'), '#fld_email');
    assert.ok(f.container.querySelector('#fld_second'));
    f.unchangedEffects();
});

it('server renders readonly expansion through the existing HTML renderer without browser effects', () => {
    const html = execFileSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `
        import {createElement as h} from 'react';
        import {renderToString} from 'react-dom/server';
        import {FormGroup} from ${JSON.stringify(new URL('../src/react/FormGroup.js', import.meta.url).href)};
        const html=renderToString(h(FormGroup, {
            title:'<b>Literal title</b>',description:'<p><strong>Help</strong><script>unexpected()</script></p>',
            allFieldsHidden:false,hasError:true,isExpanded:false,isReadOnlyPage:true,
            children:h('span',{id:'fld_server'},'Canonical child')
        }));
        if(typeof window!=='undefined'||typeof document!=='undefined')throw Error('Browser side effect');
        console.log(html);
    `,
        ],
        { encoding: 'utf8' }
    );
    assert.ok(html.includes('&lt;b&gt;Literal title&lt;/b&gt;'));
    assert.ok(html.includes('<strong>Help</strong>'));
    assert.ok(html.includes('Canonical child'));
    assert.ok(html.includes('aria-expanded="true"'));
    assert.ok(!html.includes('<script'));
    assert.ok(!html.includes('<style'));
});
