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

it('card readonly Date and DateTime leaves match the existing date facade without importing its picker', async (t) => {
    await fixture(t);
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { DateField, DateTimeField } = await import(
        '../src/react/date/DateField.js'
    );
    const { LinkedFinderRichLeaf } = await import(
        '../src/react/LinkedFinderCard.js'
    );
    const moment = (await import('moment-timezone')).default;
    const originalLocale = moment.locale();
    moment.locale('fr');
    t.after(() => {
        moment.locale(originalLocale);
    });
    const configs = [
        {
            type: 'date',
            options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
        },
        {
            type: 'dateTime',
            options: {
                dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                timeFormat: { name: '24hour', format: 'HH:mm' },
                timeZone: 'utc',
            },
        },
        {
            type: 'dateTime',
            options: {
                dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                timeFormat: { name: '12hour', format: 'h:mma' },
                timeZone: 'client',
            },
        },
    ] as const;
    for (const config of configs)
        for (const value of [
            null,
            '',
            'not-a-date',
            '2026-11-13',
            '2026-11-13T12:45:00.000Z',
            '2026-11-01T08:30:00.000Z',
        ])
            for (const language of ['en', 'es', 'de'] as const) {
                const actual = renderToStaticMarkup(
                    h(LinkedFinderRichLeaf, {
                        leaf:
                            config.type === 'date'
                                ? {
                                      kind: 'date',
                                      display: {
                                          airtableDateConfig: config,
                                          value,
                                          language,
                                      },
                                  }
                                : {
                                      kind: 'dateTime',
                                      display: {
                                          airtableDateConfig: config,
                                          value,
                                          language,
                                      },
                                  },
                    })
                );
                const id = actual.match(/^<div id="([^"]+)">/)?.[1];
                assert.ok(
                    id,
                    'Card supplies a nonblank generated date identity'
                );
                const common = { id, value, language };
                const expected =
                    config.type === 'date'
                        ? h(DateField, {
                              ...common,
                              mode: 'readOnly',
                              airtableDateConfig: config,
                          })
                        : h(DateTimeField, {
                              ...common,
                              mode: 'readOnly',
                              airtableDateConfig: config,
                          });
                assert.equal(actual, renderToStaticMarkup(expected));
            }
});

it('composes actual rich Card leaves and image lifetimes inside the public board without category effects', async (t) => {
    const f = await fixture(t),
        props = kanbanFixtureProps(),
        card = props.cards[0];
    assert(card?.projection.status === 'present');
    const { LinkedFinderCard } = await import('../src/react/index.js');
    const { createRendererProps } = await import(
        '../src/ui/rendererRegistry.js'
    );
    const numeric = createRendererProps({
        physicalKind: 'number',
        fieldId: 'n',
        title: 'Number',
        field: {
            id: 'n',
            name: 'Number',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'number', options: { precision: 2 } },
        },
        displayConfig: null,
        value: 12.5,
        context: 'linked-detail',
        computed: false,
        dirty: false,
        pending: false,
        validation: [],
        error: null,
        capability: { type: 'readonly' },
    });
    assert(numeric?.physicalKind === 'number');
    const images = Array.from({ length: 8 }, (_, index) => ({
        id: String(index),
        url:
            'data:image/svg+xml,' +
            encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg"><text>${index}</text></svg>`
            ),
        filename: 'Image ' + index,
    }));
    let actions = 0,
        categories = 0;
    const projection: Extract<KanbanCard['projection'], { status: 'present' }> =
        {
            ...card.projection,
            shouldRenderThumbnail: true,
            imageHeight: 100,
            images,
            fields: [
                {
                    key: 'literal',
                    title: null,
                    leaf: { kind: 'literal', text: 'Literal' },
                },
                {
                    key: 'text',
                    title: 'Text',
                    leaf: {
                        kind: 'text',
                        display: { value: 'Text leaf', language: 'en' },
                    },
                },
                {
                    key: 'html',
                    title: 'HTML',
                    leaf: {
                        kind: 'html',
                        html: '<p><strong>HTML leaf</strong><script>forbidden()</script></p>',
                    },
                },
                {
                    key: 'quill',
                    title: 'Quill',
                    leaf: { kind: 'quill', html: '<p>Quill leaf</p>' },
                },
                {
                    key: 'markdown',
                    title: 'Markdown',
                    leaf: {
                        kind: 'markdown',
                        value: null,
                        identity: 'readonly-note',
                        emptyLabel: 'Empty note',
                    },
                },
                {
                    key: 'number',
                    title: 'Number',
                    leaf: {
                        kind: 'numeric',
                        display: {
                            ...numeric,
                            capability: { type: 'readonly' },
                        },
                        emptyLabel: 'Empty number',
                    },
                },
                {
                    key: 'date',
                    title: 'Date',
                    leaf: {
                        kind: 'date',
                        display: {
                            airtableDateConfig: {
                                type: 'date',
                                options: {
                                    dateFormat: {
                                        format: 'YYYY-MM-DD',
                                    },
                                },
                            },
                            value: '2026-11-13',
                            language: 'en',
                        },
                    },
                },
                {
                    key: 'time',
                    title: 'Time',
                    leaf: {
                        kind: 'dateTime',
                        display: {
                            airtableDateConfig: {
                                type: 'dateTime',
                                options: {
                                    dateFormat: {
                                        format: 'YYYY-MM-DD',
                                    },
                                    timeFormat: {
                                        format: 'HH:mm',
                                    },
                                    timeZone: 'utc',
                                },
                            },
                            value: '2026-11-13T12:00:00Z',
                            language: 'en',
                        },
                    },
                },
                {
                    key: 'phone',
                    title: 'Phone',
                    leaf: {
                        kind: 'phone',
                        display: {
                            value: '+15550000001',
                            emptyLabel: 'No phone',
                        },
                    },
                },
                {
                    key: 'duration',
                    title: 'Duration',
                    leaf: {
                        kind: 'duration',
                        display: {
                            value: 3661,
                            format: 'h:mm:ss',
                            language: 'en',
                        },
                    },
                },
                {
                    key: 'checkbox',
                    title: 'Checkbox',
                    leaf: {
                        kind: 'checkbox',
                        value: true,
                        checkedLabel: 'Checked',
                        uncheckedLabel: 'Unchecked',
                    },
                },
                {
                    key: 'barcode',
                    title: 'Barcode',
                    leaf: {
                        kind: 'barcode',
                        display: {
                            value: {
                                text: 'Synthetic barcode',
                                type: 'code128',
                            },
                            language: 'en',
                        },
                    },
                },
                {
                    key: 'button',
                    title: 'Action',
                    leaf: {
                        kind: 'button',
                        accepted: {
                            mode: 'controlled',
                            value: { label: 'Rich action', url: '/synthetic' },
                            config: { openLinkType: 'triggerWebhookPOST' },
                            onTriggerWebhook: () => {
                                actions++;
                            },
                        },
                    },
                },
                {
                    key: 'people',
                    title: 'People',
                    leaf: {
                        kind: 'people',
                        items: [
                            { label: 'Synthetic person', avatar: images[0]! },
                        ],
                    },
                },
                {
                    key: 'attachment',
                    title: 'Attachment',
                    leaf: {
                        kind: 'attachmentImages',
                        images: [images[1]!],
                        empty: 'none',
                        emptyLabel: 'No images',
                    },
                },
                {
                    key: 'empty-attachment',
                    title: 'Empty attachment',
                    leaf: {
                        kind: 'attachmentImages',
                        images: [],
                        empty: 'no-values',
                        emptyLabel: 'No attachment values',
                    },
                },
                {
                    key: 'hidden-attachment',
                    title: null,
                    leaf: {
                        kind: 'attachmentImages',
                        images: [],
                        empty: 'none',
                        emptyLabel: 'Not displayed',
                    },
                },
                {
                    key: 'sequence',
                    title: 'Details',
                    leaf: {
                        kind: 'sequence',
                        leaves: [
                            {
                                kind: 'pills',
                                items: [
                                    {
                                        label: 'Pill',
                                        color: '#111',
                                        backgroundColor: '#eee',
                                    },
                                ],
                            },
                            { kind: 'linkedPills', labels: ['Linked label'] },
                            {
                                kind: 'rating',
                                value: 2,
                                max: 3,
                                icon: 'star',
                                color: '#6366f1',
                                label: 'Two stars',
                            },
                        ],
                    },
                },
            ],
        };
    props.cards = [{ ...card, projection }, ...props.cards.slice(1)];
    props.captureCategoryInvocation = () => {
        categories++;
        throw Error('Unexpected category operation');
    };
    await f.render(h(BoundKanban, props));
    for (const text of [
        'Text leaf',
        'HTML leaf',
        'Quill leaf',
        'Empty note',
        '12.5',
        '2026-11-13',
        '+15550000001',
        '1:01:01',
        'Synthetic barcode',
        'Synthetic person',
        'No attachment values',
        'Pill',
        'Linked label',
    ])
        assert(f.container.textContent.includes(text), text);
    assert.equal(f.container.querySelectorAll('script').length, 0);
    assert.equal(
        f.container.querySelectorAll('.mx-sdk-finder-carousel img').length,
        6
    );
    const action = [...f.container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Rich action'
    );
    assert(action);
    await f.click(action);
    assert.equal(actions, 1);
    assert.equal(categories, 0);
    const next = f.container.querySelector('button[aria-label="Next image"]');
    assert(next instanceof f.window.HTMLButtonElement);
    await f.click(next);
    assert.equal(
        f.container
            .querySelector('.mx-sdk-finder-carousel-track')
            ?.getAttribute('style')
            ?.includes('-100%'),
        true
    );
    const dot = f.container.querySelector(
        '.mx-sdk-finder-carousel button[aria-label="3"]'
    );
    assert(dot instanceof f.window.HTMLButtonElement);
    await f.click(dot);
    assert.equal(
        f.container
            .querySelector('.mx-sdk-finder-carousel-track')
            ?.getAttribute('style')
            ?.includes('-200%'),
        true
    );
    for (let index = 0; index < 6; index++) {
        const image = f.container.querySelector('.mx-sdk-finder-carousel img');
        assert(image instanceof f.window.HTMLImageElement);
        await f.imageEvent(image, 'error');
    }
    assert.equal(
        f.container.querySelectorAll('.mx-sdk-finder-carousel img').length,
        0
    );
    assert(f.container.querySelector('[role="img"][aria-label="No image"]'));
    assert.equal(categories, 0);
    await f.render(
        h(LinkedFinderCard, {
            projection: { ...projection, layout: 'gallery', fields: [] },
        })
    );
    assert.equal(
        f.container.querySelectorAll('.mx-sdk-finder-carousel img').length,
        6
    );
    await f.render(
        h(LinkedFinderCard, {
            projection: {
                ...projection,
                layout: 'list',
                fields: [],
                thumbnailLocation: 'right',
            },
        })
    );
    assert(
        f.container.firstElementChild?.lastElementChild?.classList.contains(
            'mx-sdk-finder-list-image'
        )
    );
    for (let index = 0; index < 8; index++) {
        const image = f.container.querySelector('.mx-sdk-finder-list-image');
        assert(image instanceof f.window.HTMLImageElement);
        assert.equal(image.getAttribute('alt'), 'Image ' + index);
        await f.imageEvent(image, 'error');
    }
    assert.equal(
        f.container.querySelectorAll('.mx-sdk-finder-list-image').length,
        0
    );
    await f.render(
        h(LinkedFinderCard, {
            projection: {
                ...projection,
                layout: 'list',
                fields: [],
                images: [{ ...images[0]!, url: images[0]!.url + '#new' }],
            },
        })
    );
    assert.equal(
        f.container
            .querySelector('.mx-sdk-finder-list-image')
            ?.getAttribute('alt'),
        'Image 0'
    );
    assert.equal(categories, 0);
    f.unchangedEffects();
});

it('preserves native keyboard rectangle selection and empty-container offsets with immutable measured snapshots', async (t) => {
    const f = await fixture(t),
        { coordinateGetter } = await import(
            '../src/react/kanban/keyboardCoordinates.js'
        );
    type Options = Parameters<typeof coordinateGetter>[1];
    type Containers = Options['context']['droppableContainers'];
    type Entry = NonNullable<ReturnType<Containers['get']>>;
    type Id = Entry['id'];
    class SnapshotContainers extends Map<Id, Entry> {
        get(id: Id | null | undefined) {
            return id == null ? undefined : super.get(id);
        }
        toArray() {
            return [...this.values()];
        }
        getEnabled() {
            return this.toArray().filter((entry) => !entry.disabled);
        }
        getNodeFor(id: Id | null | undefined) {
            return this.get(id)?.node.current ?? undefined;
        }
    }
    const rect = (left: number, top: number, width = 300, height = 98) =>
        Object.freeze({
            left,
            top,
            width,
            height,
            right: left + width,
            bottom: top + height,
        });
    const original = rect(500, 500),
        node = f.container as unknown as HTMLElement;
    const entry = (
        id: string,
        box: ReturnType<typeof rect>,
        data: Record<string, unknown> = {},
        disabled = false
    ): Entry => ({
        id,
        key: id,
        data: { current: data },
        disabled,
        node: { current: node },
        rect: { current: box },
    });
    const options = (entries: Entry[], activeType = 'item'): Options => ({
        active: 'active',
        currentCoordinates: { x: 500, y: 500 },
        context: {
            activatorEvent: null,
            active: {
                id: 'active',
                data: { current: { type: activeType } },
                rect: { current: { initial: original, translated: original } },
            },
            activeNode: node,
            collisionRect: original,
            collisions: null,
            draggableNodes: new Map(),
            draggingNode: node,
            draggingNodeRect: original,
            droppableRects: new Map(
                entries.map((entry) => [entry.id, entry.rect.current!])
            ),
            droppableContainers: new SnapshotContainers(
                entries.map((entry) => [entry.id, entry])
            ),
            over: null,
            scrollableAncestors: [],
            scrollAdjustedTranslate: null,
        },
    });
    const key = (code: string) =>
        new f.window.KeyboardEvent('keydown', { code, cancelable: true });
    for (const [code, target] of [
        ['ArrowDown', rect(500, 700)],
        ['ArrowUp', rect(500, 100)],
        ['ArrowRight', rect(900, 500)],
        ['ArrowLeft', rect(100, 500)],
    ] as const) {
        const event = key(code),
            snapshot = options([
                entry('target', target),
                entry('disabled', rect(500, 510), {}, true),
            ]);
        assert.deepEqual(
            coordinateGetter(event as unknown as KeyboardEvent, snapshot),
            { x: target.left, y: target.top }
        );
        assert.equal(event.defaultPrevented, true);
        assert.equal(snapshot.context.collisionRect, original);
    }
    const empty = rect(900, 400),
        container = entry('empty', empty, { type: 'container', children: [] });
    assert.deepEqual(
        coordinateGetter(
            key('ArrowRight') as unknown as KeyboardEvent,
            options([container])
        ),
        { x: 920, y: 474 }
    );
    const full = entry('full', empty, {
        type: 'container',
        children: ['child'],
    });
    assert.equal(
        coordinateGetter(
            key('ArrowRight') as unknown as KeyboardEvent,
            options([full])
        ),
        undefined
    );
    assert.deepEqual(
        coordinateGetter(
            key('ArrowRight') as unknown as KeyboardEvent,
            options([full], 'container')
        ),
        { x: 920, y: 474 }
    );
    const placeholder = entry('placeholder', rect(900, 400, 500, 300));
    assert.deepEqual(
        coordinateGetter(
            key('ArrowRight') as unknown as KeyboardEvent,
            options([placeholder])
        ),
        { x: 1000, y: 501 }
    );
    const missing = options([entry('missing', empty)]);
    missing.context.droppableRects.clear();
    assert.equal(
        coordinateGetter(
            key('ArrowRight') as unknown as KeyboardEvent,
            missing
        ),
        undefined
    );
    const detached = entry('detached', empty);
    detached.node.current = null;
    assert.equal(
        coordinateGetter(
            key('ArrowRight') as unknown as KeyboardEvent,
            options([detached])
        ),
        undefined
    );
    const unmeasured = entry('unmeasured', empty),
        unmeasuredOptions = options([unmeasured]);
    unmeasured.rect.current = null;
    assert.equal(
        coordinateGetter(
            key('ArrowRight') as unknown as KeyboardEvent,
            unmeasuredOptions
        ),
        undefined
    );
    const inactive = options([]);
    inactive.context.active = null;
    assert.equal(
        coordinateGetter(
            key('ArrowRight') as unknown as KeyboardEvent,
            inactive
        ),
        undefined
    );
    inactive.context.active = options([]).context.active;
    inactive.context.collisionRect = null;
    assert.equal(
        coordinateGetter(
            key('ArrowRight') as unknown as KeyboardEvent,
            inactive
        ),
        undefined
    );
    const ignored = key('Escape');
    assert.equal(
        coordinateGetter(ignored as unknown as KeyboardEvent, options([])),
        undefined
    );
    assert.equal(ignored.defaultPrevented, false);
});
