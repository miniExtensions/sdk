import assert from 'node:assert/strict';
import { it } from 'node:test';
import { getAttachmentRowPolicy } from '../src/forms/index.js';
import {
    captureAttachmentRowActions,
    type AttachmentRowAuthority,
} from '../src/ui/index.js';

it('shares native add-only row admission while preserving duplicate indexes and missing baselines', () => {
    const input = {
        urls: ['native', 'new', 'native'],
        persistedUrls: ['native'],
        readOnly: false,
        addOnly: true,
        showExistingValues: false,
        hidePersistedValues: false,
    };
    assert.deepEqual(getAttachmentRowPolicy(input), {
        status: 'ready',
        rows: [
            {
                nativeIndex: 0,
                persisted: true,
                visible: false,
                removeAllowed: false,
            },
            {
                nativeIndex: 1,
                persisted: false,
                visible: true,
                removeAllowed: true,
            },
            {
                nativeIndex: 2,
                persisted: true,
                visible: false,
                removeAllowed: false,
            },
        ],
    });
    assert.equal(
        getAttachmentRowPolicy({ ...input, persistedUrls: undefined }).status,
        'unavailable'
    );
    const readonly = getAttachmentRowPolicy({
        ...input,
        readOnly: true,
        persistedUrls: undefined,
    });
    assert.equal(readonly.status, 'ready');
    if (readonly.status === 'ready')
        assert(readonly.rows.every((row) => row.visible && !row.removeAllowed));
});

it('suppresses all lazy rows when hidden, masked, malformed or retired', () => {
    for (const patch of [
        { visible: false },
        { configs: [{ obscurePassword: true }] },
        { configs: [{ maskPasswordOnLoginScreen: 'malformed' }] },
        { configs: [{ hideAttachmentName: 'malformed' }] },
        { configs: [] },
    ]) {
        let reads = 0,
            writes = 0;
        const authority = {
            owner: 'actual',
            revision: 1,
            visible: true,
            editable: true,
            configs: [{}],
            ...patch,
        };
        const facet = captureAttachmentRowActions({
            getAuthority: () => Reflect.apply(() => authority, undefined, []),
            readRows: () => {
                reads++;
                throw new Error('PRIVATE row');
            },
            isCurrent: () => true,
            remove: () => {
                writes++;
                return true;
            },
        });
        assert.notEqual(facet.presentation.status, 'ready');
        assert.equal(facet.remove(0), false);
        assert.equal(reads, 0);
        assert.equal(writes, 0);
    }
});

for (const behavior of ['counting', 'throwing'] as const) {
    it(`skips a ${behavior} hidden attachment getter while retaining its visible sibling`, () => {
        let hiddenReads = 0;
        const removed: number[] = [];
        const authority: AttachmentRowAuthority = {
            owner: 'actual',
            revision: 1,
            visible: true,
            editable: true,
            configs: [{ hideAttachmentName: false }],
        };
        const facet = captureAttachmentRowActions({
            getAuthority: () => authority,
            readRows: () => [
                {
                    nativeIndex: 0,
                    visible: false,
                    removeAllowed: false,
                    get attachment() {
                        hiddenReads++;
                        if (behavior === 'throwing')
                            throw new Error('PRIVATE_HIDDEN');
                        return { filename: 'PRIVATE_HIDDEN' };
                    },
                },
                {
                    nativeIndex: 1,
                    visible: true,
                    removeAllowed: true,
                    attachment: { filename: 'Visible sibling' },
                },
            ],
            isCurrent: () => true,
            remove: (index) => {
                removed.push(index);
                return true;
            },
        });
        assert.equal(hiddenReads, 0);
        assert.deepEqual(facet.presentation, {
            status: 'ready',
            rows: [{ label: 'Visible sibling' }],
        });
        assert.deepEqual(facet.rows, [{ nativeIndex: 1, removeAllowed: true }]);
        assert.equal(facet.remove(0), false);
        assert.equal(facet.remove(1), true);
        assert.equal(hiddenReads, 0);
        assert.deepEqual(removed, [1]);
    });
}

it('uses generic names without inspecting hidden filename metadata or exposing native URLs', () => {
    let nameReads = 0;
    const native = {
        url: 'PRIVATE_URL',
        get filename() {
            nameReads++;
            throw new Error('PRIVATE_NAME');
        },
    };
    const authority: AttachmentRowAuthority = {
        owner: 'actual',
        revision: 1,
        visible: true,
        editable: true,
        configs: [{}],
    };
    const facet = captureAttachmentRowActions({
        getAuthority: () => authority,
        readRows: () => [
            {
                nativeIndex: 0,
                visible: true,
                removeAllowed: true,
                attachment: native,
            },
        ],
        isCurrent: () => true,
        remove: () => true,
    });
    assert.deepEqual(facet.presentation, {
        status: 'ready',
        rows: [{ label: 'Attachment' }],
    });
    assert.equal(nameReads, 0);
    assert.equal(JSON.stringify(facet).includes('PRIVATE'), false);
});

it('captures immutable owner/revision primitives and rejects native ABA, policy replacement and unmount', () => {
    for (const replacement of [
        'owner',
        'revision',
        'aba',
        'readonly',
        'mask',
        'unmount',
    ] as const) {
        const config: {
            hideAttachmentName: boolean;
            obscurePassword?: boolean;
        } = { hideAttachmentName: false };
        const authority: AttachmentRowAuthority = {
            owner: 'actual',
            revision: 1,
            visible: true,
            editable: true,
            configs: [config],
        };
        let current = true,
            writes = 0;
        const facet = captureAttachmentRowActions({
            getAuthority: () => authority,
            readRows: () => [
                {
                    nativeIndex: 0,
                    visible: true,
                    removeAllowed: true,
                    attachment: { filename: 'Current' },
                },
            ],
            isCurrent: () => current,
            remove: () => {
                writes++;
                return true;
            },
        });
        if (replacement === 'owner') authority.owner = 'other';
        else if (replacement === 'revision') authority.revision = 2;
        else if (replacement === 'aba') authority.revision = 3;
        else if (replacement === 'readonly') authority.editable = false;
        else if (replacement === 'mask') config.obscurePassword = true;
        else current = false;
        assert.equal(facet.remove(0), false, replacement);
        assert.equal(writes, 0, replacement);
    }
});

it('rechecks current row admission and resists mutation of detached public row permissions', () => {
    const authority: AttachmentRowAuthority = {
        owner: 'actual',
        revision: 1,
        visible: true,
        editable: true,
        configs: [{}],
    };
    let allowed = false,
        writes = 0;
    const capture = () =>
        captureAttachmentRowActions({
            getAuthority: () => authority,
            readRows: () => [
                {
                    nativeIndex: 0,
                    visible: true,
                    removeAllowed: allowed,
                    attachment: { url: 'native' },
                },
            ],
            isCurrent: () => true,
            remove: () => {
                writes++;
                return true;
            },
        });
    const blocked = capture();
    Reflect.set(blocked.rows[0]!, 'removeAllowed', true);
    assert.equal(blocked.remove(0), false);
    assert.equal(writes, 0);
    allowed = true;
    const current = capture();
    assert.equal(current.remove(0), true);
    assert.equal(writes, 1);
    allowed = false;
    assert.equal(current.remove(0), false);
    assert.equal(writes, 1);
});

it('rejects a reentrant revision or privacy replacement while resolving rows', () => {
    for (const mutation of ['revision', 'mask'] as const) {
        const config: { obscurePassword?: boolean } = {};
        const authority: AttachmentRowAuthority = {
            owner: 'actual',
            revision: 1,
            visible: true,
            editable: true,
            configs: [config],
        };
        let writes = 0;
        const facet = captureAttachmentRowActions({
            getAuthority: () => authority,
            readRows: () => {
                if (mutation === 'revision') authority.revision = 2;
                else config.obscurePassword = true;
                return [
                    {
                        nativeIndex: 0,
                        visible: true,
                        removeAllowed: true,
                        attachment: { filename: 'PRIVATE' },
                    },
                ];
            },
            isCurrent: () => true,
            remove: () => {
                writes++;
                return true;
            },
        });
        assert.notEqual(facet.presentation.status, 'ready');
        assert.equal(facet.remove(0), false);
        assert.equal(writes, 0);
    }
});

it('narrows a caller editable flag with actual readonly configuration', () => {
    const authority: AttachmentRowAuthority = {
        owner: 'actual',
        revision: 1,
        visible: true,
        editable: true,
        configs: [{ readOnly: true }],
    };
    let writes = 0;
    const facet = captureAttachmentRowActions({
        getAuthority: () => authority,
        readRows: () => [
            {
                nativeIndex: 0,
                visible: true,
                removeAllowed: true,
                attachment: { filename: 'Current' },
            },
        ],
        isCurrent: () => true,
        remove: () => {
            writes++;
            return true;
        },
    });
    assert.equal(facet.presentation.status, 'ready');
    assert.equal(facet.remove(0), false);
    assert.equal(writes, 0);
});

it('refuses malformed native membership and policy flags without repairing their meaning', () => {
    const base = {
        urls: ['native'],
        persistedUrls: [],
        readOnly: false,
        addOnly: true,
        showExistingValues: false,
        hidePersistedValues: false,
    };
    for (const patch of [
        { urls: [''] },
        { urls: [17] },
        { urls: [, 'native'] },
        { persistedUrls: [null] },
        { readOnly: 'false' },
    ])
        assert.throws(
            () =>
                Reflect.apply(getAttachmentRowPolicy, undefined, [
                    { ...base, ...patch },
                ]),
            {
                name: 'TypeError',
                message: 'Attachment row policy is malformed.',
            }
        );
});

it('refuses malformed authority and sparse, duplicate or invalid row actions', () => {
    const base: AttachmentRowAuthority = {
        owner: 'actual',
        revision: 1,
        visible: true,
        editable: true,
        configs: [{}],
    };
    let writes = 0,
        reads = 0;
    for (const authority of [
        null,
        { ...base, owner: '' },
        { ...base, revision: NaN },
    ]) {
        const facet = captureAttachmentRowActions({
            getAuthority: () => authority,
            readRows: () => {
                reads++;
                return [];
            },
            isCurrent: () => true,
            remove: () => {
                writes++;
                return true;
            },
        });
        assert.equal(facet.presentation.status, 'unavailable');
        assert.equal(facet.remove(0), false);
    }
    assert.equal(reads, 0);
    const row = {
        nativeIndex: 0,
        visible: true,
        removeAllowed: true,
        attachment: { filename: 'Current' },
    };
    for (const rows of [
        [row, row],
        [{ ...row, nativeIndex: -1 }],
        [{ ...row, removeAllowed: 'true' }],
        [, row],
    ]) {
        const facet = Reflect.apply(captureAttachmentRowActions, undefined, [
            {
                getAuthority: () => base,
                readRows: () => Reflect.apply(() => rows, undefined, []),
                isCurrent: () => true,
                remove: () => {
                    writes++;
                    return true;
                },
            },
        ]);
        assert.equal(facet.presentation.status, 'unavailable');
        assert.equal(facet.remove(0), false);
    }
    assert.equal(writes, 0);
});

it('copies the public label facet without requiring structuredClone in the host realm', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'structuredClone'
    );
    Reflect.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        writable: true,
        value: undefined,
    });
    try {
        const authority: AttachmentRowAuthority = {
            owner: 'actual',
            revision: 1,
            visible: true,
            editable: true,
            configs: [{}],
        };
        const facet = captureAttachmentRowActions({
            getAuthority: () => authority,
            readRows: () => [
                {
                    nativeIndex: 0,
                    visible: true,
                    removeAllowed: true,
                    attachment: { filename: 'PRIVATE' },
                },
            ],
            isCurrent: () => true,
            remove: () => true,
        });
        assert.deepEqual(facet.presentation, {
            status: 'ready',
            rows: [{ label: 'Attachment' }],
        });
        assert.equal(facet.remove(0), true);
    } finally {
        if (descriptor)
            Reflect.defineProperty(globalThis, 'structuredClone', descriptor);
        else Reflect.deleteProperty(globalThis, 'structuredClone');
    }
});
