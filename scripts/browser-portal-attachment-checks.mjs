import assert from 'node:assert/strict';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

const { page, record } = portalRecipeFixtures;
const button = (root, text) => {
    const found = [...root.querySelectorAll('button')].find(
        (node) => node.textContent === text
    );
    assert(found, `Missing attachment fixture control: ${text}`);
    return found;
};
const attachment = {
    id: 'PRIVATE_ATTACHMENT_ID',
    url: 'https://private.example.test/PRIVATE_URL',
    filename: 'PRIVATE_FILENAME.png',
    size: 27,
    type: 'image/png',
    thumbnails: {
        large: { url: 'https://private.example.test/PRIVATE_THUMB' },
    },
};
const leaks = [
    'PRIVATE_URL',
    'PRIVATE_THUMB',
    'PRIVATE_ATTACHMENT_ID',
    'image/png',
];
const assertNoLeaks = (root, forbidden = leaks) => {
    const presentation = [root.textContent];
    for (const node of root.querySelectorAll('*')) {
        if ('value' in node) presentation.push(String(node.value));
        for (const attribute of node.attributes)
            presentation.push(attribute.value);
    }
    for (const secret of forbidden)
        assert.equal(
            presentation.some((text) => text.includes(secret)),
            false,
            secret
        );
    assert.equal(root.querySelector('img, a, textarea'), null);
};
const detail = (displayConfig, childConfig, extra = {}) => ({
    fieldId: 'fld_files',
    fieldName: 'PRIVATE_RAW_FIELD_TITLE',
    titleOverride: 'Published files',
    isHidden: false,
    miniExtConfig: displayConfig,
    childFormField: {
        idOrName: { type: 'id', id: 'fld_files' },
        config: { type: 'multipleAttachments', config: childConfig },
    },
    fieldIsInEditingChildForm: true,
    ...extra,
});

/** Actual copied Portal adapter and installed collection; no live network. */
export async function checkPortalAttachmentCases({
    check,
    mount,
    editablePortal,
}) {
    const setup = async (options = {}) => {
        const {
            displayConfig,
            childConfig,
            value,
            extra,
            customMap,
            physical,
            computed,
        } = {
            displayConfig: { hideAttachmentName: true },
            childConfig: { hideAttachmentName: false },
            value: [attachment],
            extra: {},
            customMap: 'accepted',
            physical: true,
            computed: false,
            ...options,
        };
        const portal = editablePortal();
        const config =
            portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
        config.layout = 'grid';
        const columns = [detail(displayConfig, childConfig, extra)];
        portal.payload.linkedRecordFieldIdToDetailFields.fld_children = columns;
        const result = page(
            [record('rec_one', 'Original scalar')],
            'next_page'
        );
        result.tableIdsToLinkedTableStates.tbl_children.recordIdsToAirtableRecords.rec_one.fields.fld_files =
            value;
        if (physical)
            result.tableIdsToLinkedTableStates.tbl_children.airtableFields.push(
                {
                    id: 'fld_files',
                    name: 'PRIVATE_RAW_FIELD_TITLE',
                    config: { type: 'multipleAttachments' },
                    isComputed: computed,
                }
            );
        result.customViewDetailFields =
            customMap === 'accepted' ? { fld_children: columns } : customMap;
        const original = structuredClone(result);
        const h = await mount({ portal, handlers: { list: () => result } });
        await h.click('Load records');
        return { ...h, result, original };
    };
    const preview = async (h) => {
        const calls = h.calls.length;
        await h.click('Edit cell');
        const form = [...h.view.node.querySelectorAll('form')].find((node) =>
            node.textContent.includes(
                'Use the child Form to change attachments.'
            )
        );
        assert(form);
        assert.equal(
            form.querySelector(
                'button[type="submit"], input, textarea, select'
            ),
            null
        );
        assert.equal(
            [...form.querySelectorAll('button')].some(
                (node) => node.textContent === 'Save cell'
            ),
            false
        );
        form.dispatchEvent(
            new h.window.Event('submit', { bubbles: true, cancelable: true })
        );
        await h.settle();
        assert.equal(
            h.calls.length,
            calls,
            'Opening and submitting readonly preview performs zero I/O.'
        );
        assertNoLeaks(form, [...leaks, 'PRIVATE_RAW_FIELD_TITLE']);
        assertNoLeaks(
            {
                textContent: h.statuses.flat().join(' '),
                querySelectorAll: () => [],
                querySelector: () => null,
            },
            ['PRIVATE_RAW_FIELD_TITLE', ...leaks]
        );
        assert.deepEqual(
            h.result,
            h.original,
            'Rendering never prunes or rewrites complete native values.'
        );
        return form;
    };

    for (const [name, displayConfig, childConfig, showsName] of [
        [
            'Portal hides despite child opt-in',
            { hideAttachmentName: true },
            { hideAttachmentName: false },
            false,
        ],
        [
            'Portal opt-in despite child hiding',
            { hideAttachmentName: false },
            { hideAttachmentName: true },
            true,
        ],
        ['missing policy', undefined, { hideAttachmentName: false }, false],
        ['null policy', null, { hideAttachmentName: false }, false],
        ['array policy', [], { hideAttachmentName: false }, false],
        ['number policy', 1, { hideAttachmentName: false }, false],
        ['string policy', 'bad', { hideAttachmentName: false }, false],
        ['missing flag', {}, { hideAttachmentName: false }, false],
        [
            'null flag',
            { hideAttachmentName: null },
            { hideAttachmentName: false },
            false,
        ],
        [
            'string flag',
            { hideAttachmentName: 'false' },
            { hideAttachmentName: false },
            false,
        ],
        [
            'missing child policy',
            { hideAttachmentName: false },
            undefined,
            true,
        ],
    ]) {
        await check(`attachment display: ${name}`, async () => {
            const h = await setup({ displayConfig, childConfig });
            const cell = h.view.node.querySelector('tbody td');
            assert.equal(
                cell.textContent.includes(attachment.filename),
                showsName
            );
            assertNoLeaks(
                h.view.node,
                showsName ? leaks : [...leaks, attachment.filename]
            );
            const form = await preview(h);
            assert.equal(
                form.textContent.includes(attachment.filename),
                showsName
            );
            if (!showsName)
                assertNoLeaks(form, [...leaks, attachment.filename]);
            await h.dispose();
        });
    }
    for (const [name, value, expected] of [
        ['null', null, ''],
        ['missing', undefined, ''],
        ['blank', '  ', ''],
        ['empty array', [], ''],
        [
            'duplicate rows',
            [attachment, attachment],
            'PRIVATE_FILENAME.png\nPRIVATE_FILENAME.png',
        ],
        [
            'HTML-looking filename',
            [{ ...attachment, filename: '<img src=x onerror=alert(1)>' }],
            '<img src=x onerror=alert(1)>',
        ],
        ['missing filename', [{ url: attachment.url }], 'Attachment'],
        ['blank filename', [{ ...attachment, filename: '  ' }], 'Attachment'],
        ['object answer', attachment, 'Attachment presentation unavailable'],
        [
            'mixed array',
            [attachment, null],
            'Attachment presentation unavailable',
        ],
        [
            'missing URL',
            [{ filename: attachment.filename }],
            'Attachment presentation unavailable',
        ],
        [
            'invalid filename',
            [{ ...attachment, filename: 12 }],
            'Attachment presentation unavailable',
        ],
        ['sparse array', Array(1), 'Attachment presentation unavailable'],
    ]) {
        await check(`attachment value: ${name}`, async () => {
            const h = await setup({
                displayConfig: { hideAttachmentName: false },
                value,
            });
            // The button contributes only its own text, never a value.
            const cell = h.view.node.querySelector('tbody td');
            const copy = cell.cloneNode(true);
            for (const button of copy.querySelectorAll('button'))
                button.remove();
            assert.equal(copy.textContent, expected);
            const form = await preview(h);
            assert.equal(form.querySelector('p').textContent, expected);
            assertNoLeaks(h.view.node);
            await h.dispose();
        });
    }
    for (const [name, options, columnCount, canPreview] of [
        ['legacy null map', { customMap: null }, 1, true],
        ['non-null missing key', { customMap: {} }, 0, false],
        [
            'explicit empty details',
            { customMap: { fld_children: [] } },
            0,
            false,
        ],
        ['missing physical schema', { physical: false }, 0, false],
        ['hidden field', { extra: { isHidden: true } }, 0, false],
        ['empty custom title', { extra: { titleOverride: '' } }, 1, true],
        ['no custom title', { extra: { titleOverride: null } }, 1, true],
        ['computed', { computed: true }, 1, false],
        [
            'readonly child',
            { childConfig: { readOnly: true, hideAttachmentName: false } },
            1,
            false,
        ],
    ]) {
        await check(`attachment metadata: ${name}`, async () => {
            const h = await setup(options);
            assert.equal(
                h.view.node.querySelectorAll('thead th').length,
                columnCount + 1
            );
            assert.equal(
                [...h.view.node.querySelectorAll('button')].some(
                    (node) => node.textContent === 'Edit cell'
                ),
                canPreview
            );
            if (canPreview) {
                const form = await preview(h);
                assert.equal(
                    form.querySelector('h3').textContent,
                    name === 'empty custom title'
                        ? ''
                        : name === 'no custom title'
                          ? 'Attachments'
                          : 'Published files'
                );
            }
            assertNoLeaks(h.view.node, [...leaks, attachment.filename]);
            assert.deepEqual(h.result, h.original);
            assert.equal(
                h.calls.filter((call) => call.operation === 'grid').length,
                0
            );
            await h.dispose();
        });
    }
    for (const transition of [
        'same view refresh',
        'new view',
        'new owner',
        'owner ABA',
    ]) {
        await check(`attachment retained Edit: ${transition}`, async () => {
            const h = await setup({
                displayConfig: { hideAttachmentName: false },
            });
            const oldEdit = button(h.view.node, 'Edit cell');
            assert(h.view.node.textContent.includes(attachment.filename));
            h.result.customViewDetailFields.fld_children[0].miniExtConfig = {
                hideAttachmentName: true,
            };
            h.original = structuredClone(h.result);
            if (transition === 'new view') {
                const select =
                    h.view.node.querySelectorAll('.toolbar select')[1];
                select.value = 'view_other';
                select.dispatchEvent(
                    new h.window.Event('change', { bubbles: true })
                );
            } else if (transition === 'new owner') h.switchOwner('visitor_B');
            else if (transition === 'owner ABA') {
                h.switchOwner('visitor_B');
                h.switchOwner('visitor_A');
            }
            await h.click('Load records');
            assert.equal(
                h.view.node.querySelector('tbody tr').dataset.recordId,
                'rec_one'
            );
            const calls = h.calls.length;
            const statuses = structuredClone(h.statuses);
            oldEdit.dispatchEvent(
                new h.window.Event('click', { bubbles: true })
            );
            await h.settle();
            assert.equal(
                h.view.node.querySelector('form'),
                null,
                'Retained Edit must not open an obsolete preview.'
            );
            assert.deepEqual(
                h.statuses,
                statuses,
                'A retired entry does not mutate successor status.'
            );
            assert.equal(h.calls.length, calls);
            assertNoLeaks(h.view.node, [...leaks, attachment.filename]);
            const fresh = await preview(h);
            oldEdit.dispatchEvent(
                new h.window.Event('click', { bubbles: true })
            );
            await h.settle();
            assert(
                fresh.isConnected,
                'Retained Edit must not replace the current preview.'
            );
            assertNoLeaks(fresh, [
                ...leaks,
                attachment.filename,
                'PRIVATE_RAW_FIELD_TITLE',
            ]);
            assert.equal(h.calls.length, calls);
            assert.deepEqual(h.result, h.original);
            await h.dispose();
        });
    }
    for (const transition of [
        'paging',
        'view',
        'table',
        'owner ABA',
        'dispose',
    ]) {
        await check(`attachment retained preview: ${transition}`, async () => {
            const h = await setup();
            const old = await preview(h);
            const close = button(old, 'Close');
            const calls = h.calls.length;
            if (transition === 'paging') await h.click('Next page');
            else if (transition === 'owner ABA') {
                h.switchOwner('visitor_B');
                h.switchOwner('visitor_A');
            } else if (transition === 'dispose') h.view.destroy();
            else {
                const selects = h.view.node.querySelectorAll('.toolbar select');
                selects[transition === 'table' ? 0 : 1].value =
                    transition === 'table' ? '' : 'view_other';
                selects[transition === 'table' ? 0 : 1].dispatchEvent(
                    new h.window.Event('change', { bubbles: true })
                );
            }
            old.dispatchEvent(
                new h.window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            close.dispatchEvent(new h.window.Event('click', { bubbles: true }));
            await h.settle();
            assert.equal(
                h.calls.length,
                calls + (transition === 'paging' ? 1 : 0)
            );
            assert.equal(
                h.calls.some((call) => call.operation === 'grid'),
                false
            );
            assert.deepEqual(h.result, h.original);
            if (transition !== 'dispose') {
                if (transition === 'table') {
                    const select = h.view.node.querySelector('.toolbar select');
                    select.value = 'fld_children';
                    select.dispatchEvent(
                        new h.window.Event('change', { bubbles: true })
                    );
                }
                await h.click('Load records');
                const fresh = await preview(h);
                const before = h.calls.length;
                close.dispatchEvent(
                    new h.window.Event('click', { bubbles: true })
                );
                old.dispatchEvent(
                    new h.window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
                await h.settle();
                assert(
                    fresh.isConnected,
                    'Retained Close cannot close a successor preview.'
                );
                assert.equal(h.calls.length, before);
            }
            await h.dispose();
        });
    }
}
