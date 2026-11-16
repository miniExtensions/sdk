import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, useLayoutEffect, useState } from 'react';
import { renderToString } from 'react-dom/server';
import {
    CSVExportButton,
    type CSVExportButtonProps,
    type CSVExportLabels,
} from '../src/react/CSVExportButton.js';
import {
    type CSVExportInput,
    type CSVExportPlatform,
} from '../src/portals/csvExport.js';
import { AirtableFieldType } from '../src/formulas/types.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const labels: CSVExportLabels = {
    download: 'Télécharger',
    warning: 'Current displayed records only.',
    continue: 'Continuer',
    cancel: 'Annuler',
    help: 'Aide',
    pending: 'Préparation',
    errors: {
        denied: 'Refused',
        failed: 'Failed rows',
        loading: 'Still loading',
        schema: 'Schema changed',
        unexpected: 'Could not prepare file',
    },
};
function input(count = 1, value = 'Original'): CSVExportInput {
    return {
        admission: {
            allowed: true,
            borrowedRecords: false,
            cohort: 'portal-grid',
        },
        columns: [{ key: 'Name', title: 'Visible name' }],
        rows: Array.from({ length: count }, () => ({
            status: 'loaded',
            viewType: 'list',
            fields: [
                {
                    field: {
                        id: 'name',
                        name: 'Name',
                        config: { type: AirtableFieldType.SINGLE_LINE_TEXT },
                    },
                    value,
                },
            ],
        })),
    };
}
function boundary() {
    const texts: string[] = [],
        filenames: string[] = [],
        revoked: string[] = [];
    let resolve!: () => void;
    const clicked = new Promise<void>((yes) => {
        resolve = yes;
    });
    const platform: CSVExportPlatform = {
        createBlob(text) {
            texts.push(text);
            return {};
        },
        createObjectURL() {
            return 'blob:owned-synthetic';
        },
        revokeObjectURL(url) {
            revoked.push(url);
        },
        createAnchor() {
            let name = '';
            return {
                setAttribute(key, value) {
                    if (key === 'download') name = value;
                },
                click() {
                    filenames.push(name);
                    resolve();
                },
            };
        },
    };
    return { platform, texts, filenames, revoked, clicked };
}

it('renders/imports on the server with no platform operation or dialog', () => {
    const f = boundary();
    assert.equal(typeof globalThis.window, 'undefined');
    const html = renderToString(
        h(CSVExportButton, {
            request: {
                input: input(100),
                filename: 'Untouched',
                platform: f.platform,
            },
            labels,
        })
    );
    assert(html.includes('Télécharger'));
    assert(!html.includes('<dialog'));
    assert.deepEqual(f.texts, []);
});

it(
    'uses the actual localized non-submit control and real async serializer with synthetic delivery',
    { timeout: 5000 },
    async (t) => {
        const f = await htmlPresentationFixture(t),
            delivery = boundary();
        await f.render(
            h(CSVExportButton, {
                request: {
                    input: input(),
                    filename: 'Exact filename',
                    platform: delivery.platform,
                },
                labels,
            })
        );
        const button = f.container.querySelector('button');
        assert.ok(button);
        assert.equal(button.type, 'button');
        await act(async () => {
            button.click();
            await delivery.clicked;
        });
        assert.deepEqual(delivery.texts, ['Visible name\nOriginal\n']);
        assert.deepEqual(delivery.filenames, ['Exact filename']);
        assert.deepEqual(delivery.revoked, ['blob:owned-synthetic']);
        assert.equal(f.container.querySelector('[role=status]'), null);
        f.unchangedEffects();
    }
);

it(
    'confirms current committed data rather than warning-opening data and cancels without work',
    { timeout: 5000 },
    async (t) => {
        const f = await htmlPresentationFixture(t),
            delivery = boundary();
        let props: CSVExportButtonProps = {
            request: {
                input: input(100),
                filename: 'Old filename',
                platform: delivery.platform,
            },
            labels,
        };
        await f.render(h(CSVExportButton, props));
        const trigger = f.container.querySelector('button');
        assert.ok(trigger);
        trigger.focus();
        await f.click(trigger);
        let dialog = f.container.querySelector('dialog');
        assert.ok(dialog);
        assert.equal(dialog.open, true);
        assert.equal(dialog.getAttribute('aria-label'), labels.download);
        const cancel = [...dialog.querySelectorAll('button')].find(
            (b) => b.textContent === labels.cancel
        );
        assert.ok(cancel);
        await f.click(cancel);
        assert.equal(f.window.document.activeElement, trigger);
        assert.equal(f.container.querySelector('dialog'), null);
        assert.deepEqual(delivery.texts, []);
        await f.click(trigger);
        props = {
            ...props,
            request: {
                ...props.request,
                input: input(1, 'Current'),
                filename: 'Current filename',
            },
        };
        await f.render(h(CSVExportButton, props));
        dialog = f.container.querySelector('dialog');
        assert.ok(dialog);
        const confirm = [...dialog.querySelectorAll('button')].find(
            (b) => b.textContent === labels.continue
        );
        assert.ok(confirm);
        await act(async () => {
            confirm.click();
            await delivery.clicked;
        });
        assert.deepEqual(delivery.texts, ['Visible name\nCurrent\n']);
        assert.deepEqual(delivery.filenames, ['Current filename']);
        assert.equal(f.container.querySelector('dialog'), null);
        f.unchangedEffects();
    }
);

it(
    'reads same-turn committed props when a parent layout effect confirms',
    { timeout: 5000 },
    async (t) => {
        const f = await htmlPresentationFixture(t),
            delivery = boundary();
        let replace!: (next: boolean) => void;
        function Host() {
            const [confirmNow, set] = useState(false);
            replace = set;
            useLayoutEffect(() => {
                if (confirmNow) {
                    const button = [
                        ...f.container.querySelectorAll('dialog button'),
                    ].find((b) => b.textContent === labels.continue);
                    assert.ok(button instanceof f.window.HTMLButtonElement);
                    button.click();
                }
            }, [confirmNow]);
            return h(CSVExportButton, {
                request: {
                    input: input(
                        confirmNow ? 1 : 100,
                        confirmNow ? 'Committed now' : 'Old'
                    ),
                    filename: confirmNow ? 'New name' : 'Old name',
                    platform: delivery.platform,
                },
                labels,
            });
        }
        await f.render(h(Host));
        const trigger = f.container.querySelector('button');
        assert.ok(trigger);
        await f.click(trigger);
        await act(async () => {
            replace(true);
        });
        await act(async () => {
            await delivery.clicked;
        });
        assert.deepEqual(delivery.texts, ['Visible name\nCommitted now\n']);
        assert.deepEqual(delivery.filenames, ['New name']);
        f.unchangedEffects();
    }
);

it(
    'preserves an allocated attempt through unmount and suppresses borrowed presentation',
    { timeout: 5000 },
    async (t) => {
        const f = await htmlPresentationFixture(t),
            delivery = boundary();
        const props = {
            request: {
                input: input(),
                filename: 'Captured',
                platform: delivery.platform,
            },
            labels,
        };
        await f.render(h(CSVExportButton, props));
        const trigger = f.container.querySelector('button');
        assert.ok(trigger);
        await act(async () => {
            trigger.click();
            await f.render(null);
            await delivery.clicked;
        });
        assert.deepEqual(delivery.filenames, ['Captured']);
        assert.deepEqual(delivery.revoked, ['blob:owned-synthetic']);
        await f.render(
            h(CSVExportButton, {
                ...props,
                request: {
                    ...props.request,
                    input: {
                        ...input(),
                        admission: {
                            ...input().admission,
                            borrowedRecords: true,
                        },
                    },
                },
            })
        );
        assert.equal(f.container.querySelector('button'), null);
        assert.equal(delivery.filenames.length, 1);
        f.unchangedEffects();
    }
);

it('provides localized classified feedback without displaying source errors', async (t) => {
    const f = await htmlPresentationFixture(t),
        delivery = boundary();
    await f.render(
        h(CSVExportButton, {
            request: {
                input: {
                    ...input(),
                    formatField() {
                        throw new TypeError('Secret row and token');
                    },
                },
                filename: 'Private filename',
                platform: delivery.platform,
            },
            labels,
        })
    );
    const trigger = f.container.querySelector('button');
    assert.ok(trigger);
    await f.click(trigger);
    assert.equal(
        f.container.querySelector('[role=alert]')?.textContent,
        labels.errors.unexpected
    );
    assert(!f.container.textContent?.includes('Secret'));
    assert.deepEqual(delivery.texts, []);
    f.unchangedEffects();
});

void Window; // Keep component-suite classification explicit for the normal coverage runner.
