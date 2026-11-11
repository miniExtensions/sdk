import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { Window, type Event as ResourceBoundaryEvent } from 'happy-dom';
import { act, createElement as h, StrictMode, useState } from 'react';
import { renderToString } from 'react-dom/server';
import type { CompleteFormFieldPresentationProps } from '../src/react/CompleteFormFieldPresentation.js';
import { CompleteMultilineTextField } from '../src/react/CompleteMultilineTextField.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

/*
 * Real shell + complete leaf + public HTML assemblies. The shared fixture owns
 * only the synthetic DOM/resource/layout boundary. Event delivery here does not
 * establish browser paint, trusted input, provider loading or persisted writes.
 * Image events are delivered to actual mounted/replaced nodes, never captured
 * callbacks; the assertions characterize the native single failed-URL latch.
 */
type Props = CompleteFormFieldPresentationProps;
type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;
let CompleteFormFieldPresentation: typeof import('../src/react/CompleteFormFieldPresentation.js').CompleteFormFieldPresentation;
async function fixture(t: TestContext) {
    const f = await htmlPresentationFixture(t);
    // Match the existing Date popup tests: browser feature detection belongs to
    // the already installed DOM realm, while the no-browser server case below
    // runs in its own subprocess. Components and popup primitives remain real.
    ({ CompleteFormFieldPresentation } = await import(
        '../src/react/CompleteFormFieldPresentation.js'
    ));
    return f;
}
const imageA =
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"%3E%3Crect width="8" height="8" fill="red"/%3E%3C/svg%3E';
const imageB =
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"%3E%3Crect width="8" height="8" fill="blue"/%3E%3C/svg%3E';
const rejectChange = () => assert.fail('Presentation must not write');
function shell(overrides: Partial<Props> = {}, value = 'Literal answer') {
    return h(CompleteFormFieldPresentation, {
        fieldName: 'Airtable fallback',
        title: 'Field title',
        associationKind: 'input',
        formId: 'html-presentation-owner',
        children: (presentation) =>
            h(CompleteMultilineTextField, {
                // Deliberately repeated raw field identity must be overridden only
                // for DOM association; it remains no writer capability.
                id: 'fld_shared',
                value,
                onChange: rejectChange,
                presentation,
            }),
        ...overrides,
    });
}
function textarea(f: Fixture) {
    const found = f.container.querySelector('textarea');
    assert.ok(found);
    return found;
}
function image(f: Fixture) {
    const found = f.window.document.body.querySelector('img');
    assert.ok(found);
    return found;
}
function trigger(f: Fixture) {
    const found = [...f.container.querySelectorAll('button')].find((node) =>
        node.getAttribute('aria-label')?.startsWith('Field description for')
    );
    assert.ok(found);
    return found;
}
function retry(f: Fixture) {
    const found = [...f.window.document.body.querySelectorAll('button')].find(
        (node) => node.textContent === 'Try again'
    );
    assert.ok(found);
    return found;
}
function assertUniqueIds(f: Fixture) {
    const ids = [...f.window.document.body.querySelectorAll('[id]')].map(
        (node) => node.id
    );
    assert.equal(
        new Set(ids).size,
        ids.length,
        'Every mounted association has one local target'
    );
}
function describedNodes(f: Fixture, control: ReturnType<typeof textarea>) {
    return (control.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => {
            const target = f.window.document.getElementById(id);
            assert.ok(target, `Missing described-by target ${id}`);
            assert.ok(
                control.closest('.mx-sdk-form-field')?.contains(target),
                'Feedback must belong to this field instance'
            );
            return target;
        });
}

it('server renders literal title/required and sanitized HTML without browser or writer effects', () => {
    const html = execFileSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `
        import {createElement as h} from 'react';
        import {renderToString} from 'react-dom/server';
        import {CompleteFormFieldPresentation} from ${JSON.stringify(new URL('../src/react/CompleteFormFieldPresentation.js', import.meta.url).href)};
        import {CompleteMultilineTextField} from ${JSON.stringify(new URL('../src/react/CompleteMultilineTextField.js', import.meta.url).href)};
        const html=renderToString(h(CompleteFormFieldPresentation, {
            title:'<b>Literal title</b>',fieldName:'Airtable fallback',required:true,
            associationKind:'input',formId:'external-form',
            description:'<p><strong>Real description</strong><script>privateEffect()</script></p>',
            error:'<em>Literal error</em>',
            children:presentation=>h(CompleteMultilineTextField, {id:'fld_shared',value:'Literal answer',presentation,onChange(){throw Error('Unexpected writer')}})
        }));
        if(typeof window!=='undefined'||typeof document!=='undefined')throw Error('Server browser side effect');
        console.log(html);
    `,
        ],
        { encoding: 'utf8' }
    );
    assert.ok(html.includes('&lt;b&gt;Literal title&lt;/b&gt;'));
    assert.ok(html.includes('<strong>Real description</strong>'));
    assert.ok(html.includes('&lt;em&gt;Literal error&lt;/em&gt;'));
    assert.ok(html.includes('>*</span>'));
    assert.ok(!html.includes('<script'));
    assert.ok(!html.includes('privateEffect()'));
    assert.ok(!html.includes('id="fld_shared"'));
});

it('shares instance-local labels, help and errors with two actual complete multiline controls', async (t) => {
    const f = await fixture(t);
    assert.ok(f.window instanceof Window);
    const pair = (description: string, error: string, value: string) =>
        h(
            'main',
            null,
            shell({ title: 'First instance', description, error }, value),
            shell(
                { title: 'Second instance', description, error },
                'Second value'
            )
        );
    await f.render(pair('<p>Shared help</p>', 'Invalid value', 'First value'));
    const controls = [...f.container.querySelectorAll('textarea')];
    const labels = [...f.container.querySelectorAll('label')];
    assert.equal(controls.length, 2);
    assert.equal(labels.length, 2);
    const firstId = controls[0].id;
    const secondId = controls[1].id;
    assert.notEqual(firstId, secondId);
    controls.forEach((control, index) => {
        assert.equal(labels[index].htmlFor, control.id);
        assert.equal(labels[index].control, control);
        assert.equal(control.getAttribute('aria-labelledby'), labels[index].id);
        assert.equal(control.form?.id, 'html-presentation-owner');
        assert.equal(control.getAttribute('aria-invalid'), 'true');
        assert.deepEqual(
            describedNodes(f, control).map((node) => node.textContent),
            ['Invalid value', 'Shared help']
        );
    });
    assertUniqueIds(f);
    await f.render(
        pair('<p>Replacement help</p>', 'New error', 'Changed canonical value')
    );
    assert.equal(textarea(f).id, firstId);
    assert.equal(f.container.querySelectorAll('textarea')[1].id, secondId);
    assert.equal(textarea(f).value, 'Changed canonical value');
    assert.deepEqual(
        describedNodes(f, textarea(f)).map((node) => node.textContent),
        ['New error', 'Replacement help']
    );
    assertUniqueIds(f);
    f.unchangedEffects();
});

it('keeps hidden semantic titles and required markers literal without an invented visible label', async (t) => {
    const f = await fixture(t);
    await f.render(
        shell({
            title: '',
            semanticTitle: '<i>Semantic fallback</i>',
            showTitle: false,
            required: true,
        })
    );
    const label = f.container.querySelector('label');
    assert.ok(label);
    assert.equal(label.textContent, '<i>Semantic fallback</i>*');
    assert.equal(label.querySelector('i'), null);
    assert.ok(label.classList.contains('mx-sdk-field-sr-only'));
    assert.equal(label.htmlFor, textarea(f).id);
    assert.equal(textarea(f).getAttribute('aria-labelledby'), label.id);
    await f.render(
        shell({ title: '   ', semanticTitle: ' ', showTitle: false })
    );
    assert.equal(
        f.container.querySelector('label')?.textContent,
        'Airtable fallback'
    );
});

it('omits absent help/error targets and places real HTML before or after the complete control', async (t) => {
    const f = await fixture(t);
    for (const description of [
        undefined,
        '',
        '<p><br></p>',
        '<p>&nbsp;&#160;&#x00a0;\u200b</p>',
    ]) {
        await f.render(shell({ description }));
        assert.equal(textarea(f).getAttribute('aria-describedby'), null);
        assert.equal(f.container.querySelector('[id$="-description"]'), null);
        assert.equal(f.container.querySelector('[id$="-error"]'), null);
    }
    for (const placement of ['top', 'bottom'] as const) {
        await f.render(
            shell({
                description: '<p><em>Positioned help</em></p>',
                descriptionPlacement: placement,
            })
        );
        const text = f.container.querySelector('[id$="-description"]');
        assert.ok(text);
        assert.equal(text.querySelector('em')?.textContent, 'Positioned help');
        assert.equal(describedNodes(f, textarea(f))[0], text);
        const controlWrapper = textarea(f).closest('.mx-sdk-field-control');
        assert.ok(controlWrapper);
        const position = text.compareDocumentPosition(controlWrapper);
        assert.ok(position & (placement === 'top' ? 4 : 2));
    }
});

it('cancels a focused tooltip when focus leaves before its optional popup commits', async (t) => {
    const f = await fixture(t);
    await f.render(
        h(
            'main',
            null,
            shell({
                description: '<p>Deferred tooltip help</p>',
                descriptionPlacement: 'tooltip',
            }),
            shell({ title: 'Adjacent field' })
        )
    );
    const button = trigger(f);
    const adjacent = f.container.querySelectorAll('textarea')[1];
    assert.ok(adjacent);
    // Both real focus transitions occur before the optional popup can commit;
    // no popup/module double is needed to exercise the missing blur boundary.
    await act(async () => {
        button.focus();
        adjacent.focus();
        // Settle the actual optional resource after blur, so a late resolution
        // cannot escape this fixture's DOM realm or reopen the popup.
        await import('../src/react/fieldTooltipPopup.js');
    });
    assert.equal(f.window.document.activeElement, adjacent);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-describedby'), null);
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null
    );
    f.unchangedEffects();
});

it('retains exactly one hidden tooltip help target beside a separately focusable popup', async (t) => {
    const f = await fixture(t);
    await f.render(
        shell({
            description: '<p>Tooltip <strong>help</strong></p>',
            descriptionPlacement: 'tooltip',
        })
    );
    const control = textarea(f);
    const help = describedNodes(f, control)[0];
    assert.ok(help.classList.contains('mx-sdk-field-sr-only'));
    assert.equal(help.textContent, 'Tooltip help');
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null
    );
    const button = trigger(f);
    assert.equal(button.type, 'button');
    await act(async () => button.focus());
    assert.equal(f.window.document.activeElement, button);
    const popup = f.window.document.body.querySelector('[role="tooltip"]');
    assert.ok(popup);
    assert.equal(popup.textContent, 'Tooltip help');
    assert.equal(button.getAttribute('aria-describedby'), popup.id);
    assert.equal(f.container.querySelectorAll(`[id="${help.id}"]`).length, 1);
    assertUniqueIds(f);
    await act(async () =>
        button.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
            })
        )
    );
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null
    );
    assert.equal(button.getAttribute('aria-describedby'), null);
    await f.click(button);
    assert.ok(f.window.document.body.querySelector('[role="tooltip"]'));
    f.unchangedEffects();
});

it('dismisses a hovered portal tooltip with Escape while the real textarea keeps focus', async (t) => {
    const f = await fixture(t);
    await f.render(
        shell({
            description: '<p>Hover guidance</p>',
            descriptionPlacement: 'tooltip',
        })
    );
    const control = textarea(f);
    const button = trigger(f);
    await act(async () => {
        control.focus();
        control.dispatchEvent(
            new f.window.MouseEvent('mouseout', {
                bubbles: true,
                relatedTarget: button,
            })
        );
        button.dispatchEvent(
            new f.window.MouseEvent('mouseover', {
                bubbles: true,
                relatedTarget: control,
            })
        );
    });
    const popup = f.window.document.body.querySelector('[role="tooltip"]');
    assert.ok(popup);
    assert.equal(popup.textContent, 'Hover guidance');
    assert.equal(
        f.container.contains(popup),
        false,
        'Popup escapes native scrolling/clipping containers'
    );
    assert.equal(
        f.window.document.activeElement,
        control,
        'Hover never steals control focus'
    );
    await act(async () =>
        control.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null
    );
    assert.equal(f.window.document.activeElement, control);
    f.unchangedEffects();
});

it('uses no absent text description for image-only tooltip or markup-empty HTML', async (t) => {
    const f = await fixture(t);
    await f.render(
        shell({
            title: 'Image guidance',
            description: '<p>&nbsp;<br></p>',
            descriptionImageUrl: imageA,
            descriptionPlacement: 'tooltip',
        })
    );
    assert.equal(textarea(f).getAttribute('aria-describedby'), null);
    assert.equal(f.container.querySelector('[id$="-description"]'), null);
    const button = trigger(f);
    assert.equal(
        button.getAttribute('aria-label'),
        'Field description for Image guidance'
    );
    await f.click(button);
    assert.equal(image(f).alt, '');
    assert.equal(image(f).src, imageA);
    assert.equal(textarea(f).getAttribute('aria-describedby'), null);
    assertUniqueIds(f);
});

it('retires an image-only popup when failure removes its trigger without clearing the failed URL', async (t) => {
    const f = await fixture(t);
    const config: Partial<Props> = {
        descriptionPlacement: 'tooltip',
        descriptionImageUrl: imageA,
    };
    await f.render(shell(config));
    const controlId = textarea(f).id;
    await f.click(trigger(f));
    const popup = f.window.document.body.querySelector('[role="tooltip"]');
    assert.ok(popup);
    assert.equal(trigger(f).getAttribute('aria-describedby'), popup.id);
    await f.imageEvent(image(f), 'error');
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-field-tooltip-trigger'),
        null
    );
    await f.render(shell(config));
    assert.equal(
        f.container.querySelector('.mx-sdk-field-tooltip-trigger'),
        null,
        'Same failed URL does not retry when the tooltip disappears'
    );
    await f.render(shell({ ...config, descriptionImageUrl: imageB }));
    assert.equal(textarea(f).id, controlId);
    assert.equal(trigger(f).getAttribute('aria-expanded'), 'false');
    assert.equal(trigger(f).getAttribute('aria-describedby'), null);
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null,
        'A replacement image must not reopen the retired popup'
    );
    await f.click(trigger(f));
    assert.equal(image(f).src, imageB);
    await f.render(shell(config));
    assert.equal(
        f.container.querySelector('.mx-sdk-field-tooltip-trigger'),
        null,
        'Healthy B does not replace the failed-A latch'
    );
    await f.render(
        shell({ ...config, description: '<p>Replacement text help</p>' })
    );
    assert.equal(trigger(f).getAttribute('aria-expanded'), 'false');
    assert.equal(trigger(f).getAttribute('aria-describedby'), null);
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null,
        'Replacement text also starts with a closed tooltip'
    );
    await f.click(trigger(f));
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]')?.textContent,
        'Replacement text help'
    );
    assert.equal(
        f.window.document.body.querySelector('img'),
        null,
        'Text restoration must not silently retry failed A'
    );
    assert.equal(
        textarea(f).getAttribute('aria-describedby')?.endsWith('-description'),
        true
    );
    assertUniqueIds(f);
    f.unchangedEffects();
});

it('retires an open text tooltip when its description is cleared and restored in the same placement', async (t) => {
    const f = await fixture(t);
    const config: Partial<Props> = {
        descriptionPlacement: 'tooltip',
        description: '<p>Initial tooltip text</p>',
    };
    await f.render(shell(config));
    await f.click(trigger(f));
    assert.ok(f.window.document.body.querySelector('[role="tooltip"]'));
    await f.render(shell({ ...config, description: '<p>&nbsp;<br></p>' }));
    assert.equal(
        f.container.querySelector('.mx-sdk-field-tooltip-trigger'),
        null
    );
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null
    );
    assert.equal(textarea(f).getAttribute('aria-describedby'), null);
    await f.render(
        shell({ ...config, description: '<p>Restored tooltip text</p>' })
    );
    assert.equal(trigger(f).getAttribute('aria-expanded'), 'false');
    assert.equal(trigger(f).getAttribute('aria-describedby'), null);
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null
    );
    await f.click(trigger(f));
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]')?.textContent,
        'Restored tooltip text'
    );
    assertUniqueIds(f);
    f.unchangedEffects();
});

it('keeps preview image recovery focusable inside a portaled tooltip without submitting', async (t) => {
    const f = await fixture(t);
    await f.render(
        shell({
            description: '<p>Preview image help</p>',
            descriptionImageUrl: imageA,
            descriptionPlacement: 'tooltip',
            preview: true,
            previewControlProps: {
                'data-config-preview-canvas-control': 'true',
            },
        })
    );
    const button = trigger(f);
    assert.equal(
        button.getAttribute('data-config-preview-canvas-control'),
        'true'
    );
    await act(async () => button.focus());
    await f.imageEvent(image(f), 'error');
    const retryButton = retry(f);
    assert.equal(retryButton.type, 'button');
    assert.equal(
        retryButton.getAttribute('data-config-preview-canvas-control'),
        'true'
    );
    await act(async () => retryButton.focus());
    assert.ok(
        f.window.document.body.querySelector('[role="tooltip"]'),
        'Moving focus into recovery must retain the popup'
    );
    assert.equal(f.window.document.activeElement, retryButton);
    await f.click(retryButton);
    assert.equal(image(f).src, imageA);
    assert.equal(f.window.document.body.querySelector('[role="status"]'), null);
    f.unchangedEffects();
});

it('distinguishes bubbling synthetic image errors from native resource failures without filtering genuine Window errors', async (t) => {
    const f = await fixture(t);
    const windowErrors: string[] = [];
    const collectWindowError = (event: ResourceBoundaryEvent) => {
        // Match the browser proof's existing collector for both generic
        // resource events (no error/message) and genuine ErrorEvent objects.
        const error = 'error' in event ? event.error : undefined;
        const message = 'message' in event ? event.message : undefined;
        windowErrors.push(String(error || message));
    };
    f.window.addEventListener('error', collectWindowError);
    t.after(() => f.window.removeEventListener('error', collectWindowError));
    await f.render(
        shell({
            descriptionImageUrl: imageA,
            description: '<p>Local image recovery</p>',
            preview: true,
        })
    );
    const firstImage = image(f);
    await act(async () => {
        firstImage.dispatchEvent(
            new f.window.Event('error', {
                bubbles: true,
                cancelable: true,
                composed: true,
            })
        );
    });
    assert.deepEqual(
        windowErrors,
        ['undefined'],
        'A fabricated bubbling resource error reaches the unfiltered Window collector'
    );
    assert.equal(f.container.querySelector('img'), null);
    assert.ok(f.container.querySelector('[role="status"]'));
    await f.click(retry(f));
    const replacementImage = image(f);
    assert.ok(
        replacementImage !== firstImage,
        'Preview retry mounts a real replacement image node'
    );
    assert.equal(replacementImage.src, imageA);
    // Actual image resource error events do not bubble, cancel or cross a
    // shadow boundary. Keep their delivery distinct from automation defaults.
    const resourceError = new f.window.Event('error', {
        bubbles: false,
        cancelable: false,
        composed: false,
    });
    await act(async () => {
        replacementImage.dispatchEvent(resourceError);
    });
    assert.deepEqual(
        windowErrors,
        ['undefined'],
        'Native resource failure updates the image lifecycle without a global application error'
    );
    assert.equal(f.container.querySelector('img'), null);
    assert.ok(f.container.querySelector('[role="status"]'));
    await f.click(retry(f));
    assert.equal(image(f).src, imageA);
    assert.equal(f.container.querySelector('[role="status"]'), null);
    const applicationError = new Error('Genuine synthetic application error');
    await act(async () => {
        f.window.dispatchEvent(
            new f.window.ErrorEvent('error', {
                error: applicationError,
                message: applicationError.message,
            })
        );
    });
    assert.deepEqual(
        windowErrors,
        ['undefined', String(applicationError)],
        'The same collector still detects genuine Window ErrorEvent failures'
    );
    f.unchangedEffects();
});

it('preserves same-URL failure through text rerenders, replacement URLs, preview retry and true remount', async (t) => {
    const f = await fixture(t);
    await f.render(
        shell({
            descriptionImageUrl: ` ${imageA} `,
            description: '<p>First text</p>',
        })
    );
    const first = image(f);
    assert.equal(first.src, imageA);
    await f.imageEvent(first, 'error');
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(f.container.querySelector('[role="status"]'), null);
    await f.render(
        shell({
            descriptionImageUrl: imageA,
            description: '<p>Changed text</p>',
        })
    );
    assert.equal(f.container.querySelector('img'), null);
    await f.render(
        shell({
            descriptionImageUrl: imageB,
            description: '<p>Changed text</p>',
        })
    );
    const replacement = image(f);
    assert.notEqual(replacement, first);
    assert.equal(replacement.src, imageB);
    await f.render(shell({ descriptionImageUrl: imageA, preview: true }));
    assert.equal(
        f.container.querySelector('img'),
        null,
        'Returning to failed A retains the one native latch'
    );
    assert.ok(
        f.container
            .querySelector('[role="status"]')
            ?.textContent.includes('This image could not be loaded.')
    );
    await f.click(retry(f));
    const retried = image(f);
    assert.notEqual(retried, first);
    await f.imageEvent(retried, 'error');
    await f.render(null);
    await f.render(shell({ descriptionImageUrl: imageA }));
    assert.equal(image(f).src, imageA, 'True remount retries the source');
});

it('resets native description mount state across placement and visibility changes only', async (t) => {
    const f = await fixture(t);
    const config: Partial<Props> = {
        description: '<p>Placement guidance</p>',
        descriptionImageUrl: imageA,
    };
    await f.render(shell(config));
    const id = textarea(f).id;
    await f.imageEvent(image(f), 'error');
    assert.equal(f.window.document.body.querySelector('img'), null);
    await f.render(
        shell({ ...config, description: '<p>Updated same-placement text</p>' })
    );
    assert.equal(f.window.document.body.querySelector('img'), null);
    await f.render(shell({ ...config, descriptionPlacement: 'tooltip' }));
    assert.equal(trigger(f).getAttribute('aria-expanded'), 'false');
    await f.click(trigger(f));
    assert.equal(
        image(f).src,
        imageA,
        'A newly mounted description placement retries its image'
    );
    await f.render(shell({ ...config, descriptionPlacement: 'top' }));
    assert.equal(image(f).src, imageA);
    await f.render(shell({ ...config, descriptionPlacement: 'tooltip' }));
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null,
        'A returning tooltip starts closed'
    );
    await f.click(trigger(f));
    await f.imageEvent(image(f), 'error');
    await f.render(
        shell({ ...config, descriptionPlacement: 'tooltip', visible: false })
    );
    assert.equal(f.container.childElementCount, 0);
    await f.render(shell({ ...config, descriptionPlacement: 'tooltip' }));
    assert.equal(
        textarea(f).id,
        id,
        'Mounted field identity survives projected visibility rerenders'
    );
    assert.equal(trigger(f).getAttribute('aria-expanded'), 'false');
    await f.click(trigger(f));
    assert.equal(
        image(f).src,
        imageA,
        'Restoring visible description content retries after its unmount'
    );
    f.unchangedEffects();
});

it('characterizes replacement-node late errors in both orders without turning the latch into a failure cache', async (t) => {
    const f = await fixture(t);
    await f.render(shell({ descriptionImageUrl: imageA }));
    const oldA = image(f);
    await f.render(shell({ descriptionImageUrl: imageB }));
    const currentB = image(f);
    await f.imageEvent(oldA, 'error');
    assert.equal(
        image(f),
        currentB,
        'Detached A cannot suppress healthy replacement B'
    );
    await f.imageEvent(currentB, 'error');
    assert.equal(f.container.querySelector('img'), null);
    await f.imageEvent(oldA, 'error');
    assert.equal(
        f.container.querySelector('img'),
        null,
        'A detached late event does not resurrect failed current B'
    );
    await f.render(shell({ descriptionImageUrl: imageA }));
    assert.equal(
        image(f).src,
        imageA,
        'B failure replaces A in the single latch; this is not a permanent URL failure cache'
    );
});

it('gives group and non-labelable presenters actual local named nodes without label redirects', async (t) => {
    const f = await fixture(t);
    for (const kind of ['group', 'non-labelable'] as const) {
        await f.render(
            shell({
                associationKind: kind,
                description: '<p>Group help</p>',
                error: 'Group error',
                children: () =>
                    h('span', null, 'Readonly or admitted presenter'),
            })
        );
        assert.equal(f.container.querySelector('label'), null);
        const group = f.container.querySelector('[role="group"]');
        assert.ok(group);
        assert.ok(group.id);
        const label = f.window.document.getElementById(
            group.getAttribute('aria-labelledby') ?? ''
        );
        assert.equal(label?.textContent, 'Field title');
        for (const id of (group.getAttribute('aria-describedby') ?? '').split(
            ' '
        )) {
            assert.ok(f.window.document.getElementById(id));
        }
        assert.equal(group.textContent, 'Readonly or admitted presenter');
        assertUniqueIds(f);
    }
});

it('composes a real readonly multiline inside one locally named group without duplicate IDs', async (t) => {
    const f = await fixture(t);
    await f.render(
        shell({
            associationKind: 'group',
            description: '<p>Readonly guidance</p>',
            error: 'Readonly feedback',
            children: (presentation) =>
                h(CompleteMultilineTextField, {
                    id: 'fld_shared',
                    value: 'Readonly canonical value',
                    onChange: rejectChange,
                    presentation,
                    readOnly: true,
                    characterLimit: 3,
                }),
        })
    );
    const group = f.container.querySelector('[role="group"]');
    assert.ok(group);
    const control = textarea(f);
    assert.equal(control.id, '', 'The shell owns the actual group ID');
    assert.equal(control.disabled, true);
    assert.equal(control.value, 'Readonly canonical value');
    assert.equal(control.getAttribute('maxlength'), null);
    assert.equal(control.form?.id, 'html-presentation-owner');
    assert.equal(f.container.querySelector('label'), null);
    const labelId = group.getAttribute('aria-labelledby');
    assert.ok(labelId);
    assert.equal(
        f.window.document.getElementById(labelId)?.textContent,
        'Field title'
    );
    assert.equal(control.getAttribute('aria-labelledby'), labelId);
    assert.deepEqual(
        describedNodes(f, control).map((node) => node.textContent),
        ['Readonly feedback', 'Readonly guidance']
    );
    assertUniqueIds(f);
    await f.click(control);
    f.unchangedEffects();
});

it('presents native projected visibility and loading without rendering a leaf or dangling input label', async (t) => {
    const f = await fixture(t);
    let leaves = 0;
    const children: Props['children'] = () => {
        leaves++;
        return h('textarea', { id: 'unexpected-control' });
    };
    await f.render(shell({ visible: false, children }));
    assert.equal(f.container.childElementCount, 0);
    assert.equal(leaves, 0);
    await f.render(
        shell({
            loading: h('span', { role: 'status' }, 'Loading dependent choices'),
            children,
        })
    );
    assert.equal(leaves, 0);
    assert.equal(f.container.querySelector('label'), null);
    const group = f.container.querySelector('[role="group"]');
    assert.ok(group);
    assert.equal(group.textContent, 'Loading dependent choices');
    assert.equal(
        f.window.document.getElementById(
            group.getAttribute('aria-labelledby') ?? ''
        )?.textContent,
        'Field title'
    );
});

it('hydrates two actual shell/leaf assemblies with stable local IDs and no recoverable mismatch', async (t) => {
    const pair = (value = 'Server answer') =>
        h(
            StrictMode,
            null,
            shell(
                { description: '<p>Server help</p>', error: 'Server error' },
                value
            ),
            shell({ title: 'Second field' })
        );
    const f = await fixture(t);
    const markup = renderToString(pair());
    const hydrationContainer = f.window.document.createElement('main');
    hydrationContainer.innerHTML = markup;
    f.window.document.body.append(hydrationContainer);
    const originalControls = [
        ...hydrationContainer.querySelectorAll('textarea'),
    ];
    const ids = originalControls.map((node) => node.id);
    assert.equal(new Set(ids).size, 2);
    const errors: unknown[] = [];
    const { hydrateRoot } = await import('react-dom/client');
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
        await act(async () => {
            root = hydrateRoot(
                hydrationContainer as unknown as HTMLElement,
                pair(),
                { onRecoverableError: (error) => errors.push(error) }
            );
        });
        assert.deepEqual(errors, []);
        assert.deepEqual(
            [...hydrationContainer.querySelectorAll('textarea')],
            originalControls
        );
        await act(async () => root?.render(pair('Client answer')));
        assert.deepEqual(
            [...hydrationContainer.querySelectorAll('textarea')].map(
                (node) => node.id
            ),
            ids
        );
        assert.equal(
            hydrationContainer.querySelector('textarea')?.value,
            'Client answer'
        );
        const first = hydrationContainer.querySelector('textarea');
        assert.ok(first);
        const label = hydrationContainer.querySelector('label');
        assert.equal(label?.htmlFor, first.id);
        for (const id of (first.getAttribute('aria-describedby') ?? '').split(
            ' '
        )) {
            assert.ok(hydrationContainer.querySelector(`[id="${id}"]`));
        }
        assert.deepEqual(errors, []);
    } finally {
        if (root) await act(async () => root?.unmount());
        hydrationContainer.remove();
    }
    f.unchangedEffects();
});

it('isolates a real edited leaf from its same-field sibling and never implicitly submits', async (t) => {
    const f = await fixture(t);
    const writes: Array<[string, string]> = [];
    function Field({ instance }: { instance: string }) {
        const [value, setValue] = useState('initial');
        return shell({
            children: (presentation) =>
                h(CompleteMultilineTextField, {
                    id: 'fld_shared',
                    value,
                    presentation,
                    onChange: (next) => {
                        writes.push([instance, next]);
                        setValue(next);
                    },
                }),
        });
    }
    await f.render(
        h(
            'main',
            null,
            h(Field, { instance: 'left' }),
            h(Field, { instance: 'right' })
        )
    );
    const controls = [...f.container.querySelectorAll('textarea')];
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
            f.window.HTMLTextAreaElement.prototype,
            'value'
        )?.set;
        assert.ok(setter);
        setter.call(controls[0], 'left draft');
        controls[0].dispatchEvent(
            new f.window.InputEvent('input', {
                bubbles: true,
                data: 'left draft',
                inputType: 'insertText',
            })
        );
    });
    assert.deepEqual(writes, [['left', 'left draft']]);
    assert.equal(controls[0].value, 'left draft');
    assert.equal(controls[1].value, 'initial');
    f.unchangedEffects();
});
