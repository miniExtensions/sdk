import assert from 'node:assert/strict';
import { join } from 'node:path';

const records = [
    {
        id: 'recAlpha',
        fields: {
            fldTitle: 'Alpha record',
            fldNotes:
                '**Alpha**\n\n[x] Checked A\n[ ] Pending A\n\n[Read A](/help/a)',
        },
    },
    {
        id: 'recBeta',
        fields: {
            fldTitle: 'Beta record',
            fldNotes: '**Beta**\n\n[ ] Pending B\n\n[Read B](/help/b)',
        },
    },
    { id: 'recBlank', fields: { fldTitle: 'Blank record', fldNotes: null } },
];
const theme = {
    accentColor: 'rgb(59, 130, 246)',
    linkColor: 'rgb(29, 78, 216)',
    linkHoverColor: 'rgb(59, 130, 246)',
};
const initialEffects = { writes: 0, opens: [], submits: 0, links: [] };

export const readonlyPortalGridRichTextEntry = String.raw`
import { StrictMode, createElement as h, version } from 'react';
import { CompleteReadOnlyTextField, ReadonlyPortalRecords, RichTextField } from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';

export function mountRichTextGrid(root) {
    const records = ${JSON.stringify(records)};
    const fields = [['fldTitle', 'Name', 'singleLineText'], ['fldNotes', 'Notes', 'richText']]
        .map(([id, name, type], index) => ({
            id, name, config: { type, options: null }, isComputed: false,
            isPrimaryField: index === 0, description: null
        }));
    const actions = ${JSON.stringify(initialEffects)};
    const admitted = new Set();
    const listeners = new Set();
    const write = () => { actions.writes++; };
    let stamp = {};
    let projection = {
        portalFieldId: 'fldRichGrid',
        linkedTableId: 'tblRichGrid',
        records,
        table: { airtableFields: fields },
        detailProjection: 'present',
        detailFields: fields.map(({ id, name }) => ({
            fieldId: id,
            fieldName: name,
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: {
                title: name,
                readOnly: true,
                conditionalFields: { logicalOperator: 'and', conditions: [] },
            },
        })),
    };
    const scope = createBorrowedPortalRenderScope({
        capture: () => ({ stamp, projection }),
        isCurrent: (expected) => expected === stamp,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        invokeIfCurrent() { write(); return false; },
    });
    const grid = {
        ready: true,
        preferenceScopeKey: 'rich-text-grid',
        primaryFieldId: 'fldTitle',
        hiddenColumns: {},
        columnWidths: { fldTitle: 180, fldNotes: 380 },
        rowHeight: 'fit-content',
        recordLabel: id => records.find(record => record.id === id)?.fields.fldTitle,
        onFieldHiddenChange: write,
        onColumnWidthCommit: write,
    };
    const renderers = {
        renderSingleLineTextField: ({ value }) =>
            h(CompleteReadOnlyTextField, { value, language: 'en' }),
        renderRichTextField(field) {
            if (field.capability.type !== 'readonly' || field.computed ||
                field.physicalKind !== 'richText' || field.fieldId !== 'fldNotes')
                throw new Error('Expected the admitted physical read-only Rich Text detail');
            const source = records.find(record => record.fields.fldNotes === field.value);
            if (!source) throw new Error('Unexpected Rich Text fixture value');
            admitted.add(source.id);
            return h(RichTextField, {
                value: field.value,
                identity: source.id + ':' + field.fieldId,
                readOnly: true,
                onValueChange: write,
                ...${JSON.stringify(theme)},
                emptyContent: h(CompleteReadOnlyTextField, { value: null, language: 'en' }),
            });
        },
    };
    const render = () => {
        const revision = scope.getSnapshot().revision;
        const byRecordId = new Map(projection.records.map(({ id }) => [id, {
            revision,
            activate() { actions.opens.push(id); },
        }]));
        root.render(h(StrictMode, null, h('form', {
            id: 'formatted-rich-text-grid',
            onSubmit(event) { event.preventDefault(); actions.submits++; },
            onClickCapture(event) {
                const link = event.target instanceof Element && event.target.closest('.me-rich-text a');
                if (!link) return;
                event.preventDefault();
                actions.links.push({ path: link.pathname, trusted: event.nativeEvent.isTrusted });
            },
        }, h(ReadonlyPortalRecords, {
            scope, layout: 'grid', grid, renderers, openActions: { scope, byRecordId },
        }))));
    };
    window.richTextGridProof = {
        observe: () => ({ react: version, admitted: [...admitted].sort(), actions }),
        reorder() {
            admitted.clear();
            stamp = {};
            projection = { ...projection, records: [records[1], records[0], records[2]] };
            for (const listener of listeners) listener();
            render();
        },
        unmount() {
            root.unmount();
            scope.destroy();
            return listeners.size;
        },
    };
    render();
}
`;

export async function checkReadonlyPortalGridRichTextBrowser({
    browser,
    origin,
    evidence,
    output,
}) {
    const fixture = '/readonly-portal-grid.html?fixture=formatted-rich-text';
    const assets = new Set([
        fixture,
        '/readonly-portal-grid.js',
        '/readonly-portal-grid.css',
        '/favicon.ico',
    ]);
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'block',
    });
    const item = { refusedRequests: [], pageErrors: [], cleanup: false };
    evidence.formattedRichText = item;
    try {
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                request.method() === 'GET' &&
                url.origin === origin &&
                assets.has(url.pathname + url.search)
            )
                return route.continue();
            item.refusedRequests.push(url.pathname);
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) => item.pageErrors.push(error.name));
        await page.goto(origin + fixture);
        const form = page.locator('#formatted-rich-text-grid');
        const row = (id) => form.locator(`tr[data-record-id="${id}"]`);
        const notes = (id) => row(id).locator('td[data-field-id="fldNotes"]');
        const actions = () =>
            page.evaluate(() => window.richTextGridProof.observe());
        const cells = () =>
            form.locator('tr[data-record-id]').evaluateAll((rows) =>
                rows.map((node) => {
                    const cell = node.querySelector(
                        'td[data-field-id="fldNotes"]'
                    );
                    const editor = cell.querySelector('.ProseMirror');
                    const link = cell.querySelector('a');
                    return {
                        id: node.dataset.recordId,
                        title: node
                            .querySelector('td[data-field-id="fldTitle"]')
                            .textContent.trim(),
                        bold:
                            editor?.querySelector('strong')?.textContent ??
                            null,
                        readOnly:
                            editor?.getAttribute('contenteditable') === 'false',
                        list: editor?.querySelector('ul')?.className ?? null,
                        checks: [
                            ...cell.querySelectorAll('input[type="checkbox"]'),
                        ].map((input) => ({
                            checked: input.checked,
                            inert:
                                input.disabled ||
                                getComputedStyle(input).pointerEvents ===
                                    'none',
                        })),
                        link: link
                            ? {
                                  path: link.pathname,
                                  sameOrigin: link.origin === location.origin,
                                  color: getComputedStyle(link).color,
                              }
                            : null,
                        blank:
                            cell
                                .querySelector(
                                    '[data-testid="no-value-test-id"]'
                                )
                                ?.textContent.trim() ?? null,
                    };
                })
            );
        await notes('recAlpha').locator('strong').waitFor();
        await notes('recBeta').locator('strong').waitFor();
        await notes('recBlank')
            .getByText('No Value', { exact: true })
            .waitFor();
        const expected = [
            {
                id: 'recAlpha',
                title: 'Alpha record',
                bold: 'Alpha',
                readOnly: true,
                list: 'checkbox_list',
                checks: [
                    { checked: true, inert: true },
                    { checked: false, inert: true },
                ],
                link: {
                    path: '/help/a',
                    sameOrigin: true,
                    color: theme.linkColor,
                },
                blank: null,
            },
            {
                id: 'recBeta',
                title: 'Beta record',
                bold: 'Beta',
                readOnly: true,
                list: 'checkbox_list',
                checks: [{ checked: false, inert: true }],
                link: {
                    path: '/help/b',
                    sameOrigin: true,
                    color: theme.linkColor,
                },
                blank: null,
            },
            {
                id: 'recBlank',
                title: 'Blank record',
                bold: null,
                readOnly: false,
                list: null,
                checks: [],
                link: null,
                blank: 'No Value',
            },
        ];
        item.initial = await cells();
        assert.deepEqual(item.initial, expected);
        const before = await actions();
        assert.deepEqual(before.admitted, ['recAlpha', 'recBeta', 'recBlank']);

        const check = notes('recAlpha')
            .locator('input[type="checkbox"]')
            .first();
        const box = await check.boundingBox();
        assert(box);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.keyboard.type('Denied edit');
        assert.equal(await check.isChecked(), true);
        const link = notes('recAlpha').getByRole('link', { name: 'Read A' });
        await link.hover();
        assert.equal(
            await link.evaluate((node) => getComputedStyle(node).color),
            theme.linkHoverColor
        );
        await link.click();
        await page.mouse.move(0, 0);
        assert.deepEqual((await actions()).actions, {
            ...initialEffects,
            links: [{ path: '/help/a', trusted: true }],
        });
        assert.deepEqual(await cells(), expected);
        if (output)
            await form.screenshot({
                path: join(output, 'grid-formatted-rich-text.png'),
            });

        await page.evaluate(() => window.richTextGridProof.reorder());
        await page.waitForFunction(
            () =>
                document.querySelector(
                    '#formatted-rich-text-grid tr[data-record-id]'
                )?.dataset.recordId === 'recBeta'
        );
        item.reordered = await cells();
        assert.deepEqual(item.reordered, [
            expected[1],
            expected[0],
            expected[2],
        ]);
        await row('recBeta')
            .getByRole('button', {
                name: 'Open record Beta record',
                exact: true,
            })
            .click();
        const after = await actions();
        assert.equal(after.react, evidence.react);
        assert.deepEqual(after.admitted, before.admitted);
        assert.deepEqual(after.actions, {
            ...initialEffects,
            opens: ['recBeta'],
            links: [{ path: '/help/a', trusted: true }],
        });
        assert.deepEqual(item.pageErrors, []);
        assert.deepEqual(item.refusedRequests, []);
        item.actions = after.actions;
        item.remainingSubscriptions = await page.evaluate(() =>
            window.richTextGridProof.unmount()
        );
        assert.equal(item.remainingSubscriptions, 0);
        assert.equal(await form.count(), 0);
        item.passed = true;
    } finally {
        await context.close();
        item.cleanup = true;
    }
}
