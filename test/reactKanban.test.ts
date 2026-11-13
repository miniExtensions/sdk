import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h } from 'react';
import {
    Kanban,
    type KanbanProps,
    type KanbanCard,
} from '../src/react/Kanban.js';
import { Item } from '../src/react/kanban/Item.js';
import { claimKanbanCursor } from '../src/react/kanban/cursor.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

type PublicProps = KanbanProps<{ category: string }, object>;
type Props = { -readonly [Key in keyof PublicProps]: PublicProps[Key] };
const BoundKanban = Kanban<{ category: string }, object>;
export function kanbanFixtureProps(): Props {
    const fields: Props['projection']['fields'] = [
        {
            id: 'status',
            config: {
                type: 'singleSelect',
                options: {
                    choices: [
                        { id: 'open', name: 'Open' },
                        { id: 'closed', name: 'Closed' },
                        { id: 'empty', name: 'Empty' },
                    ],
                },
            },
        },
    ];
    return {
        label: 'Project board',
        readOnly: false,
        modalOpen: false,
        projection: {
            categoryFieldId: 'status',
            fields,
            recordIds: ['a', 'b'],
            readRecord: (id) => ({
                fields: { status: id === 'a' ? 'Open' : 'Legacy' },
            }),
            uncategorizedLabel: 'Sin categoría',
            hideEmptyColumns: false,
        },
        cards: ['a', 'b'].map((recordId) => ({
            recordId,
            accessibleLabel: `Project ${recordId}`,
            projection: {
                status: 'present',
                primary: `Primary ${recordId}`,
                fields: [
                    {
                        key: 'detail',
                        title: 'Detail',
                        leaf: { kind: 'literal', text: `Rich ${recordId}` },
                    },
                ],
                language: 'en',
                layout: 'kanban',
                images: [],
                imageFit: 'cover',
                imageHeight: 160,
                shouldRenderThumbnail: false,
                thumbnailLocation: 'left',
                fieldsPerCardRow: 1,
                labels: {
                    previousImage: 'Previous image',
                    nextImage: 'Next image',
                    noImage: 'No image',
                },
            },
        })),
        captureCategoryInvocation: () => {
            throw new Error('Unexpected category invocation');
        },
    };
}
async function fixture(t: TestContext) {
    const f = await htmlPresentationFixture(t);
    const errors: string[] = [];
    const oldError = console.error;
    console.error = (...args: unknown[]) => {
        errors.push(args.map(String).join(' '));
    };
    t.after(() => {
        console.error = oldError;
        assert.deepEqual(errors, []);
    });
    const values = {
        requestAnimationFrame: f.window.requestAnimationFrame.bind(f.window),
        cancelAnimationFrame: f.window.cancelAnimationFrame.bind(f.window),
        KeyboardEvent: f.window.KeyboardEvent,
        MouseEvent: f.window.MouseEvent,
    };
    const original = Object.keys(values).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(values))
        Object.defineProperty(globalThis, key, {
            value,
            writable: true,
            configurable: true,
        });
    t.after(() => {
        for (const [key, value] of original) {
            if (value) Object.defineProperty(globalThis, key, value);
            else Reflect.deleteProperty(globalThis, key);
        }
    });
    // The real private sensor frame loads only after this fixture installs its DOM.
    await import('../src/react/kanban/Board.js');
    return f;
}
it('composes ordered columns, actual rich card content and explicitly admitted action chrome', async (t) => {
    const f = await fixture(t),
        props = kanbanFixtureProps();
    let opens = 0,
        unlinks = 0;
    const first = props.cards[0];
    assert.ok(first);
    props.cards = [
        {
            ...first,
            open: {
                label: 'Open project',
                activate: () => {
                    opens++;
                },
            },
            unlink: {
                label: 'Remove project',
                description: 'Unlink project',
                pending: false,
                disabled: false,
                activate: () => {
                    unlinks++;
                },
            },
            needsReviewLabel: 'Needs review',
        },
        props.cards[1],
    ];
    await f.render(h(BoundKanban, props));
    assert.deepEqual(
        [...f.container.querySelectorAll('.mx-sdk-kanban-column-label')].map(
            (node) => node.textContent
        ),
        ['Sin categoría', 'Open', 'Closed', 'Empty', 'Legacy']
    );
    assert.ok(f.container.textContent?.includes('Primary a'));
    assert.ok(f.container.textContent?.includes('Rich a'));
    assert.ok(f.container.querySelector('[aria-label="Needs review"]'));
    const open = f.container.querySelector('[aria-label="Open project"]'),
        unlink = f.container.querySelector('[aria-label="Remove project"]');
    assert.ok(open instanceof f.window.HTMLButtonElement);
    assert.ok(unlink instanceof f.window.HTMLButtonElement);
    assert.equal(open.type, 'button');
    assert.equal(unlink.type, 'button');
    await f.click(open);
    await f.click(unlink);
    assert.equal(opens, 1);
    assert.equal(unlinks, 1);
    f.unchangedEffects();
});
it('card replacements use current actions without changing the adjacent draft or projection order', async (t) => {
    const f = await fixture(t),
        props = kanbanFixtureProps();
    let firstCalls = 0,
        nextCalls = 0;
    const original = props.cards[0];
    assert.ok(original);
    props.cards = [
        {
            ...original,
            open: {
                label: 'Open current',
                activate: () => {
                    firstCalls++;
                },
            },
        },
        props.cards[1],
    ];
    const view = () =>
        h(
            'div',
            null,
            h('textarea', { id: 'adjacent', defaultValue: 'Original' }),
            h(BoundKanban, props)
        );
    await f.render(view());
    const draft = f.container.querySelector('#adjacent');
    assert.ok(draft instanceof f.window.HTMLTextAreaElement);
    draft.value = 'Retained draft';
    props.cards = [
        {
            ...original,
            open: {
                label: 'Open current',
                activate: () => {
                    nextCalls++;
                },
            },
        },
        props.cards[1],
    ];
    await f.render(view());
    const open = f.container.querySelector('[aria-label="Open current"]');
    assert.ok(open instanceof f.window.HTMLButtonElement);
    await f.click(open);
    assert.equal(firstCalls, 0);
    assert.equal(nextCalls, 1);
    assert.equal(f.container.querySelector('#adjacent'), draft);
    assert.equal(draft.value, 'Retained draft');
});
it('current projection replacement resets columns and order without any mutation', async (t) => {
    const f = await fixture(t),
        props = kanbanFixtureProps();
    await f.render(h(BoundKanban, props));
    props.projection = {
        ...props.projection,
        recordIds: ['b', 'a'],
        readRecord: () => ({ fields: { status: 'Closed' } }),
        hideEmptyColumns: true,
        uncategorizedLabel: 'Changed',
    };
    await f.render(h(BoundKanban, props));
    assert.deepEqual(
        [...f.container.querySelectorAll('.mx-sdk-kanban-column-label')].map(
            (node) => node.textContent
        ),
        ['Closed']
    );
    assert.deepEqual(
        [...f.container.querySelectorAll('.mx-sdk-kanban-card')].map((node) =>
            node.getAttribute('aria-label')
        ),
        ['Project b', 'Project a']
    );
    f.unchangedEffects();
});
it('loading/unavailable cards and pending unlink remain presentation only', async (t) => {
    const f = await fixture(t),
        props = kanbanFixtureProps();
    let unlinks = 0;
    props.cards = [
        {
            recordId: 'a',
            accessibleLabel: 'Loading project',
            projection: { status: 'loading', label: 'Cargando' },
            unlink: {
                label: 'Remove pending',
                description: 'Pending',
                pending: true,
                disabled: true,
                activate: () => {
                    unlinks++;
                },
            },
        },
        {
            recordId: 'b',
            accessibleLabel: 'Unavailable project',
            projection: { status: 'unavailable', label: 'Unavailable' },
        },
    ];
    await f.render(h(BoundKanban, props));
    assert.ok(f.container.textContent?.includes('Cargando'));
    assert.ok(f.container.textContent?.includes('Unavailable'));
    const remove = f.container.querySelector('[aria-label="Remove pending"]');
    assert.ok(remove instanceof f.window.HTMLButtonElement);
    assert.equal(remove.disabled, true);
    assert.equal(remove.getAttribute('aria-busy'), 'true');
    await f.click(remove);
    assert.equal(unlinks, 0);
    assert.equal(f.container.querySelector('.mx-sdk-kanban-open'), null);
    f.unchangedEffects();
});
it('nested Enter and literal space stop drag bubbling without preventing native default activation', async (t) => {
    const f = await fixture(t),
        props = kanbanFixtureProps();
    await f.render(h(BoundKanban, props));
    let outerKeys = 0;
    f.window.document.addEventListener('keydown', () => {
        outerKeys++;
    });
    const positive = f.window.document.createElement('button');
    f.container.append(positive);
    positive.dispatchEvent(
        new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    assert.equal(outerKeys, 1);
    outerKeys = 0;
    const card = f.container.querySelector('.mx-sdk-kanban-card');
    assert.ok(card);
    for (const key of ['Enter', ' ']) {
        const event = new f.window.KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        });
        card.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false);
    }
    assert.equal(outerKeys, 0);
});
it('cursor claims compose, release idempotently and preserve external changes', () => {
    const window = new Window();
    try {
        const body = window.document.body;
        body.style.cursor = 'crosshair';
        const first = claimKanbanCursor(body as unknown as HTMLElement),
            second = claimKanbanCursor(body as unknown as HTMLElement);
        assert.equal(body.style.cursor, 'grabbing');
        second();
        second();
        assert.equal(body.style.cursor, 'grabbing');
        first();
        assert.equal(body.style.cursor, 'crosshair');
        const third = claimKanbanCursor(body as unknown as HTMLElement);
        body.style.cursor = 'wait';
        third();
        assert.equal(body.style.cursor, 'wait');
    } finally {
        void window.happyDOM.close();
    }
});
it('real overlay Item effects restore the prior cursor through StrictMode and unmount', async (t) => {
    const f = await fixture(t);
    f.window.document.body.style.cursor = 'crosshair';
    const item = (key: string) =>
        h(Item, {
            key,
            value: key,
            dragOverlay: true,
            renderItem: () => h('span', null, 'Overlay content'),
        });
    await f.render(h('ul', null, item('a'), item('b')));
    assert.equal(f.window.document.body.style.cursor, 'grabbing');
    await f.render(h('ul', null, item('b')));
    assert.equal(f.window.document.body.style.cursor, 'grabbing');
    await f.render(null);
    assert.equal(f.window.document.body.style.cursor, 'crosshair');
});
it('cold SSR is document-free and missing admitted card data fails instead of fabricating content', () => {
    const url = new URL('../src/react/Kanban.js', import.meta.url).href;
    const script = `import assert from 'node:assert/strict';import React from 'react';import{renderToString}from'react-dom/server';const{Kanban}=await import(${JSON.stringify(url)});assert.equal(typeof document,'undefined');const projection={categoryFieldId:'status',fields:[{id:'status',config:{type:'singleSelect',options:{choices:[{id:'open',name:'Open'}]}}}],recordIds:[],readRecord:()=>undefined,uncategorizedLabel:'Uncategorized',hideEmptyColumns:false};const props={label:'Board',projection,cards:[],readOnly:false,modalOpen:false,captureCategoryInvocation:()=>{throw Error('Unexpected invocation')}};assert.match(renderToString(React.createElement(Kanban,props)),/Open/);assert.equal(typeof document,'undefined');props.projection={...projection,recordIds:['missing'],readRecord:()=>({fields:{status:'Open'}})};assert.throws(()=>renderToString(React.createElement(Kanban,props)),/Missing admitted Kanban card projection/);`;
    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        stdio: 'pipe',
        env: process.env,
    });
});
