import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { it, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createElement as h } from 'react';
import {
    CompleteCheckboxField,
    type CompleteCheckboxFieldProps,
} from '../src/react/CompleteCheckboxField.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;
const props = (
    overrides: Partial<CompleteCheckboxFieldProps> = {}
): CompleteCheckboxFieldProps => ({
    value: null,
    onChange: () => assert.fail('Unexpected checkbox change'),
    ...overrides,
});
function input(fixture: Fixture) {
    const element = fixture.container.querySelector('input');
    assert.ok(element);
    return element;
}
function button(fixture: Fixture) {
    const element = fixture.container.querySelector('button');
    assert.ok(element);
    return element;
}
async function checkboxFixture(t: TestContext) {
    const fixture = await htmlPresentationFixture(t);
    assert.ok(fixture.window instanceof Window);
    // Match the browser's module realm: ReactDOM feature detection sees the
    // actual fixture document before the shell's popup dependency is imported.
    const { CompleteFormFieldPresentation } = await import(
        '../src/react/CompleteFormFieldPresentation.js'
    );
    function shell(
        leaf: Partial<CompleteCheckboxFieldProps>,
        associationKind: 'input' | 'group' | 'non-labelable' = 'input',
        withFeedback = true
    ) {
        return h(CompleteFormFieldPresentation, {
            title: 'Approve request',
            fieldName: 'Approval',
            associationKind,
            formId: 'external-checkbox-form',
            description: withFeedback ? '<p>Approval help</p>' : null,
            error: withFeedback ? 'Approval required' : null,
            children: (presentation) =>
                h(
                    CompleteCheckboxField,
                    props({
                        ...leaf,
                        title: 'Duplicate leaf title',
                        feedback: 'Duplicate leaf feedback',
                        presentation,
                    })
                ),
        });
    }
    return { ...fixture, shell };
}

it('server-renders native modes with literal trimmed button text and no browser', () => {
    assert.equal(typeof document, 'undefined');
    // SSR and browser imports execute in independent realms, as they do in a
    // consuming app. Avoid initializing ReactDOM before the client document.
    const html = execFileSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `
        import {createElement as h} from 'react';
        import {renderToStaticMarkup} from 'react-dom/server';
        import {CompleteCheckboxField} from ${JSON.stringify(new URL('../src/react/CompleteCheckboxField.js', import.meta.url).href)};
        const props={value:null,onChange(){throw Error('Unexpected SSR change');}};
        console.log(renderToStaticMarkup(h('main',null,
            h(CompleteCheckboxField, {...props,checkboxStyle:'button',uncheckedStateLabel:'  <b>Disabled</b>  ',title:'Approve <request>'}),
            h(CompleteCheckboxField, {...props,value:true,checkboxStyle:'button',checkedStateLabel:'  '})
        )));
        if(typeof document !== 'undefined' || typeof window !== 'undefined')throw Error('SSR browser dependency');
    `,
        ],
        { encoding: 'utf8' }
    );
    assert.match(html, /type="button"/);
    assert.match(html, /aria-pressed="false"/);
    assert.match(html, /&lt;b&gt;Disabled&lt;\/b&gt;/);
    assert.match(html, /Approve &lt;request&gt;/);
    assert.doesNotMatch(html, /<b>|<script/);
    assert.match(html, />true<\/button>/);
});

for (const checkboxStyle of ['checkbox', 'toggle'] as const) {
    it(`keeps ${checkboxStyle} controlled and connected to local shell nodes and external form`, async (t) => {
        const fixture = await checkboxFixture(t);
        const external = fixture.window.document.createElement('form');
        external.id = 'external-checkbox-form';
        fixture.window.document.body.append(external);
        const changes: boolean[] = [];
        const view = (value: boolean | null, withFeedback = true) =>
            fixture.shell(
                {
                    checkboxStyle,
                    value,
                    onChange: (next) => changes.push(next),
                    ariaInvalid: false, // A legacy prop cannot override shell feedback.
                },
                'input',
                withFeedback
            );
        await fixture.render(view(null));
        const node = input(fixture);
        const label = fixture.container.querySelector('label');
        assert.ok(label);
        assert.equal(label.htmlFor, node.id);
        assert.equal(
            node.getAttribute('form'),
            external.id,
            'Explicit external form association is forwarded (Chromium checks .form)'
        );
        assert.equal(node.checked, false);
        assert.equal(node.getAttribute('aria-checked'), 'false');
        assert.equal(node.getAttribute('aria-invalid'), 'true');
        assert.equal(fixture.container.querySelectorAll('label').length, 1);
        assert.doesNotMatch(
            fixture.container.textContent ?? '',
            /Duplicate leaf/
        );
        const targets = node.getAttribute('aria-describedby')?.split(' ') ?? [];
        assert.equal(targets.length, 2);
        assert.deepEqual(
            targets.map(
                (id) => fixture.window.document.getElementById(id)?.textContent
            ),
            ['Approval required', 'Approval help']
        );
        const background = fixture.container.querySelector(
            '.mx-sdk-complete-checkbox'
        );
        assert.ok(background instanceof fixture.window.HTMLElement);
        await fixture.click(background);
        assert.deepEqual(changes, []);
        await fixture.click(label);
        assert.deepEqual(changes, [true]);
        assert.equal(node.checked, false);
        await fixture.render(view(true));
        assert.ok(
            input(fixture) === node,
            'The mounted checkbox input remains stable'
        );
        assert.equal(node.checked, true);
        await fixture.click(node);
        assert.deepEqual(changes, [true, false]);
        await fixture.render(view(false, false));
        assert.ok(
            input(fixture) === node,
            'The mounted checkbox input remains stable'
        );
        assert.equal(node.getAttribute('aria-describedby'), null);
        assert.equal(node.getAttribute('aria-invalid'), 'false');
        assert.equal(node.id, label.htmlFor);
        fixture.unchangedEffects();
    });
}

it('keeps same-field instances isolated through local labels and current callbacks', async (t) => {
    const fixture = await checkboxFixture(t);
    const writes: string[] = [];
    const view = (revision: string) =>
        h(
            'div',
            null,
            fixture.shell({
                value: false,
                onChange: (next) => writes.push(`left:${revision}:${next}`),
            }),
            fixture.shell({
                value: true,
                onChange: (next) => writes.push(`right:${revision}:${next}`),
            })
        );
    await fixture.render(view('first'));
    const inputs = [...fixture.container.querySelectorAll('input')];
    const labels = [...fixture.container.querySelectorAll('label')];
    assert.equal(inputs.length, 2);
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.deepEqual(
        labels.map((label) => label.htmlFor),
        inputs.map((node) => node.id)
    );
    for (const node of inputs) {
        const targets = node.getAttribute('aria-describedby')?.split(' ') ?? [];
        assert.equal(targets.length, 2);
        for (const target of targets)
            assert.ok(
                node
                    .closest('.mx-sdk-form-field')
                    ?.querySelector(`[id="${target}"]`)
            );
    }
    await fixture.click(labels[1]);
    assert.deepEqual(writes, ['right:first:false']);
    await fixture.render(view('current'));
    const currentInputs = [...fixture.container.querySelectorAll('input')];
    assert.ok(
        currentInputs.length === inputs.length &&
            currentInputs.every((node, index) => node === inputs[index]),
        'Both mounted checkbox instances remain stable'
    );
    await fixture.click(labels[0]);
    assert.deepEqual(writes, ['right:first:false', 'left:current:true']);
    assert.equal(inputs[0].checked, false);
    assert.equal(inputs[1].checked, true);
});

it('keeps shell button titles non-activating and button activation non-submitting', async (t) => {
    const fixture = await checkboxFixture(t);
    const changes: boolean[] = [];
    const view = (value: boolean | null, withFeedback = true) =>
        fixture.shell(
            {
                checkboxStyle: 'button',
                value,
                checkedStateLabel: ' Enabled ',
                uncheckedStateLabel: ' Disabled ',
                onChange: (next) => changes.push(next),
            },
            'non-labelable',
            withFeedback
        );
    await fixture.render(view(null));
    const node = button(fixture);
    const title = fixture.container.querySelector('.mx-sdk-field-title');
    const group = fixture.container.querySelector('[role="group"]');
    assert.ok(title instanceof fixture.window.HTMLElement);
    assert.ok(group);
    assert.ok(
        fixture.container.querySelector('label') === null,
        'The shell uses a non-labelable title'
    );
    assert.equal(node.getAttribute('id'), null);
    assert.equal(node.getAttribute('aria-labelledby'), null); // Button keeps its state-label name.
    assert.equal(group.getAttribute('aria-labelledby'), title.id);
    assert.equal(
        fixture.container.querySelectorAll(`[id="${group.id}"]`).length,
        1
    );
    assert.equal(node.type, 'button');
    assert.equal(node.textContent, 'Disabled');
    assert.equal(node.getAttribute('aria-pressed'), 'false');
    await fixture.click(title);
    assert.deepEqual(changes, []);
    await fixture.click(node);
    assert.deepEqual(changes, [true]);
    assert.equal(node.getAttribute('aria-pressed'), 'false');
    await fixture.render(view(true, false));
    assert.ok(
        button(fixture) === node,
        'The mounted toggle button remains stable'
    );
    assert.equal(node.textContent, 'Enabled');
    assert.equal(node.getAttribute('aria-pressed'), 'true');
    assert.equal(node.getAttribute('aria-describedby'), null);
    await fixture.click(node);
    assert.deepEqual(changes, [true, false]);
    fixture.unchangedEffects();
});

it('forces readonly checkbox semantics and static grid presentation without any changes', async (t) => {
    const fixture = await checkboxFixture(t);
    await fixture.render(
        fixture.shell({
            checkboxStyle: 'button',
            readOnly: true,
            value: true,
            calendlyPresenter: h(
                'button',
                { type: 'button' },
                'Unavailable provider'
            ),
        })
    );
    const node = input(fixture);
    assert.equal(node.disabled, true);
    assert.equal(node.readOnly, true);
    assert.equal(node.checked, true);
    assert.ok(
        fixture.container.querySelector('button') === null,
        'Readonly presentation has no button'
    );
    await fixture.click(node);
    await fixture.click(fixture.container.querySelector('label')!);
    for (const value of [false, true] as const) {
        await fixture.render(
            fixture.shell({ readOnly: true, isInGrid: true, value }, 'group')
        );
        assert.ok(
            fixture.container.querySelector('input,button,label') === null,
            'Readonly grid renders no interactive control or label redirect'
        );
        const group = fixture.container.querySelector('[role="group"]');
        assert.ok(group);
        assert.equal(
            fixture.container.querySelectorAll('[role="group"]').length,
            1
        );
        assert.equal(
            fixture.container.querySelectorAll(`[id="${group.id}"]`).length,
            1
        );
        const indicator = fixture.container.querySelector(
            '[data-checkbox-grid-value]'
        );
        assert.ok(indicator instanceof fixture.window.HTMLElement);
        assert.equal(
            indicator.getAttribute('data-checkbox-grid-value'),
            String(value)
        );
        assert.equal(indicator.getAttribute('aria-hidden'), 'true');
        assert.match(group.textContent ?? '', new RegExp(String(value)));
        await fixture.click(indicator);
    }
});

it('composes only the explicit Calendly presenter under the shell group without label redirects', async (t) => {
    const fixture = await checkboxFixture(t);
    let presenterActions = 0;
    await fixture.render(
        fixture.shell(
            {
                calendlyPresenter: h(
                    'button',
                    {
                        type: 'button',
                        onClick: () => presenterActions++,
                    },
                    'Synthetic Calendly presenter'
                ),
            },
            'non-labelable'
        )
    );
    assert.ok(
        fixture.container.querySelector('label,input') === null,
        'Calendly has no native input or label redirect'
    );
    assert.equal(
        fixture.container.querySelectorAll('[role="group"]').length,
        1
    );
    const group = fixture.container.querySelector('[role="group"]');
    assert.ok(group);
    assert.equal(
        fixture.container.querySelectorAll(`[id="${group.id}"]`).length,
        1
    );
    const title = fixture.container.querySelector('.mx-sdk-field-title');
    assert.ok(title instanceof fixture.window.HTMLElement);
    await fixture.click(title);
    assert.equal(presenterActions, 0);
    await fixture.click(button(fixture));
    assert.equal(presenterActions, 1);
    fixture.unchangedEffects();
});

it('keeps optional standalone chrome local and removable without a shell', async (t) => {
    const fixture = await checkboxFixture(t);
    const changes: boolean[] = [];
    const view = (title: boolean) =>
        h(
            CompleteCheckboxField,
            props({
                title: 'Approve request',
                showTitle: title,
                feedback: title ? 'Required' : undefined,
                onChange: (next) => changes.push(next),
            })
        );
    await fixture.render(view(true));
    const node = input(fixture);
    const label = fixture.container.querySelector('label');
    assert.ok(label);
    assert.equal(label.htmlFor, node.id);
    const feedbackId = node.getAttribute('aria-describedby');
    assert.ok(feedbackId);
    assert.equal(
        fixture.window.document.getElementById(feedbackId)?.textContent,
        'Required'
    );
    await fixture.click(label);
    assert.deepEqual(changes, [true]);
    await fixture.render(view(false));
    assert.ok(
        input(fixture) === node,
        'The mounted checkbox input remains stable'
    );
    assert.ok(
        fixture.container.querySelector('label,[role="status"]') === null,
        'Standalone chrome can be removed'
    );
    assert.equal(node.getAttribute('aria-describedby'), null);
    assert.equal(node.getAttribute('aria-label'), 'Approve request');
});

it('keeps optional standalone button titles non-activating and state-text naming intact', async (t) => {
    const fixture = await checkboxFixture(t);
    const changes: boolean[] = [];
    await fixture.render(
        h(CompleteCheckboxField, {
            value: false,
            onChange: (value) => changes.push(value),
            checkboxStyle: 'button',
            title: 'Approval field',
            uncheckedStateLabel: 'Not approved',
        })
    );
    const title = fixture.container.querySelector(
        '.mx-sdk-complete-checkbox__title'
    );
    assert.ok(title instanceof fixture.window.HTMLElement);
    assert.equal(title.tagName, 'SPAN');
    assert.equal(title.getAttribute('for'), null);
    assert.equal(button(fixture).getAttribute('aria-labelledby'), null);
    assert.equal(button(fixture).textContent, 'Not approved');
    await fixture.click(title);
    assert.deepEqual(changes, []);
    await fixture.click(button(fixture));
    assert.deepEqual(changes, [true]);
});
