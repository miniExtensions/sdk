import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createNativeFormPages,
    type NativeFormPageDescriptor,
    type NativeFormPagesPublication,
} from '../src/ui/nativeFormPages.js';

const page = (title: string, hidden = false): NativeFormPageDescriptor => ({
    title,
    description: `${title} description`,
    fieldIds: [title],
    hidden,
});

function fixture() {
    const owner = {};
    const configuration = {};
    const advances: (() => void)[] = [];
    const nextPages: number[] = [];
    const backPages: number[] = [];
    let live = true;
    let currentReads = 0;
    const isCurrent = () => {
        currentReads++;
        return live;
    };
    const onNext: NativeFormPagesPublication<string>['onNext'] = (request) => {
        nextPages.push(request.pageIndex);
        advances.push(request.advance);
    };
    const onBack = (index: number) => {
        backPages.push(index);
    };
    const publication = (
        overrides: Partial<NativeFormPagesPublication<string>> = {}
    ): NativeFormPagesPublication<string> => ({
        owner,
        configuration,
        pages: [page('first'), page('hidden', true), page('last')],
        multiple: true,
        reviewItems: ['original'],
        isCurrent,
        onNext,
        onBack,
        ...overrides,
    });
    return {
        owner,
        configuration,
        publication,
        advances,
        nextPages,
        backPages,
        currentReads: () => currentReads,
        setCurrent: (value: boolean) => {
            live = value;
        },
    };
}

it('copies immutable page/list presentation and returns inert stable snapshots', () => {
    const f = fixture();
    const ids = ['field'];
    const descriptors: NativeFormPageDescriptor[] = [
        { title: 'Only', description: null, fieldIds: ids, hidden: false },
    ];
    const items = ['original'];
    const pages = createNativeFormPages(
        f.publication({ pages: descriptors, reviewItems: items })
    );
    const initial = pages.getSnapshot();
    const reads = f.currentReads();
    ids.push('later');
    descriptors.push(page('Other'));
    items.push('later');
    assert.equal(pages.getSnapshot(), initial);
    assert.equal(f.currentReads(), reads);
    assert.deepEqual(initial.pages[0]!.fieldIds, ['field']);
    assert.equal(initial.pages.length, 1);
    assert.deepEqual(initial.reviewItems, ['original']);
    assert(Object.isFrozen(initial));
    assert(Object.isFrozen(initial.actions));
    assert(Object.isFrozen(initial.pages));
    assert(Object.isFrozen(initial.pages[0]));
    assert(Object.isFrozen(initial.pages[0]!.fieldIds));
    assert(Object.isFrozen(initial.reviewItems));
    assert.equal(f.nextPages.length, 0);
});

it('normalizes hidden, empty and single-page presentations', () => {
    const f = fixture();
    const pages = createNativeFormPages(
        f.publication({
            pages: [page('hidden', true), page('first'), page('last')],
        })
    );
    assert.equal(pages.getSnapshot().activePageIndex, 1);
    assert.equal(pages.getSnapshot().isFirstPage, true);
    pages.next();
    f.advances[0]!();
    assert.equal(pages.getSnapshot().activePageIndex, 2);
    assert.equal(pages.getSnapshot().isLastPage, true);
    pages.update(
        f.publication({
            pages: [page('hidden', true), page('first'), page('last')],
            multiple: false,
        })
    );
    assert.equal(pages.getSnapshot().activePageIndex, 1);
    assert.equal(pages.getSnapshot().isFirstPage, true);
    assert.equal(pages.getSnapshot().isLastPage, true);
    pages.update(f.publication({ pages: [page('hidden', true)] }));
    assert.equal(pages.getSnapshot().activePageIndex, 0);
    assert.equal(pages.getSnapshot().isFirstPage, true);
    assert.equal(pages.getSnapshot().isLastPage, true);
    pages.update(f.publication({ pages: [] }));
    assert.equal(pages.getSnapshot().activePageIndex, 0);
    assert.equal(pages.getSnapshot().isFirstPage, true);
    assert.equal(pages.getSnapshot().isLastPage, true);
});

it('advances only after native validation and skips hidden pages', () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    pages.next();
    assert.deepEqual(f.nextPages, [0]);
    assert.equal(pages.getSnapshot().activePageIndex, 0);
    f.advances[0]!();
    assert.equal(pages.getSnapshot().activePageIndex, 2);
    f.advances[0]!();
    assert.equal(pages.getSnapshot().activePageIndex, 2);
    pages.back();
    assert.equal(pages.getSnapshot().activePageIndex, 0);
    assert.deepEqual(f.backPages, [0]);
});

it('a newer navigation request retires an older delayed advance', () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    pages.next();
    pages.next();
    f.advances[0]!();
    assert.equal(pages.getSnapshot().activePageIndex, 0);
    f.advances[1]!();
    assert.equal(pages.getSnapshot().activePageIndex, 2);
    const oldActions = pages.getSnapshot().actions;
    pages.back();
    oldActions.next();
    oldActions.back();
    assert.equal(pages.getSnapshot().activePageIndex, 0);
    assert.deepEqual(f.nextPages, [0, 0]);
});

it('structural publication changes retire held advances without retiring the owner', () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    pages.next();
    pages.update(f.publication({ pages: [page('replacement'), page('last')] }));
    f.advances[0]!();
    assert.equal(pages.getSnapshot().activePageIndex, 0);
    assert.equal(pages.getSnapshot().retired, false);
    pages.next();
    f.advances[1]!();
    assert.equal(pages.getSnapshot().activePageIndex, 1);
});

it('controlled preview navigation waits for the authoritative host publication', () => {
    const f = fixture();
    const pages = createNativeFormPages(
        f.publication({ controlledPageIndex: 0 })
    );
    pages.next();
    f.advances[0]!();
    assert.equal(pages.getSnapshot().activePageIndex, 0);
    pages.update(f.publication({ controlledPageIndex: 2 }));
    pages.back();
    assert.deepEqual(f.backPages, [0]);
    assert.equal(pages.getSnapshot().activePageIndex, 2);
    pages.update(f.publication({ controlledPageIndex: 0 }));
    assert.equal(pages.getSnapshot().activePageIndex, 0);
});

it('controlled preview selection permits hidden pages, clamps bounds and wins in single-page mode', () => {
    const f = fixture();
    const pages = createNativeFormPages(
        f.publication({ controlledPageIndex: 1 })
    );
    assert.equal(pages.getSnapshot().activePageIndex, 1);
    assert.equal(pages.getSnapshot().isFirstPage, false);
    assert.equal(pages.getSnapshot().isLastPage, false);
    pages.update(f.publication({ controlledPageIndex: 1, multiple: false }));
    assert.equal(pages.getSnapshot().activePageIndex, 1);
    assert.equal(pages.getSnapshot().isFirstPage, true);
    assert.equal(pages.getSnapshot().isLastPage, true);
    pages.update(f.publication({ controlledPageIndex: -10 }));
    assert.equal(pages.getSnapshot().activePageIndex, 0);
    pages.update(f.publication({ controlledPageIndex: 99 }));
    assert.equal(pages.getSnapshot().activePageIndex, 2);
    pages.update(
        f.publication({
            controlledPageIndex: 1,
            pages: [page('a', true), page('b', true)],
        })
    );
    assert.equal(pages.getSnapshot().activePageIndex, 1);
    pages.update(f.publication({ controlledPageIndex: 99, pages: [] }));
    assert.equal(pages.getSnapshot().activePageIndex, 0);
});

it('callback-only publications and equal item contents do not emit forever', () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    const initial = pages.getSnapshot();
    let notifications = 0;
    pages.subscribe(() => {
        notifications++;
    });
    pages.update(
        f.publication({
            onNext: () => {},
            onBack: () => {},
            isCurrent: () => true,
            reviewItems: ['original'],
        })
    );
    assert.equal(pages.getSnapshot(), initial);
    assert.equal(notifications, 0);
    pages.update(f.publication({ reviewItems: ['changed'] }));
    assert.equal(notifications, 1);
});

it('live Review updates preserve the captured one-shot callback and close before invoking it', () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    const result = Promise.resolve('native settlement');
    const calls: string[] = [];
    assert.equal(
        pages.openReview(() => {
            assert.equal(pages.getSnapshot().reviewing, false);
            calls.push('original');
            return result;
        }),
        true
    );
    const confirm = pages.getSnapshot().actions.confirmReview;
    pages.update(f.publication({ reviewItems: ['new live value'] }));
    assert.equal(pages.getSnapshot().reviewing, true);
    assert.deepEqual(pages.getSnapshot().reviewItems, ['new live value']);
    assert.equal(
        pages.openReview(() => {
            calls.push('replacement');
        }),
        false
    );
    assert.equal(confirm(), result);
    confirm();
    pages.confirmReview();
    assert.deepEqual(calls, ['original']);
});

it('a newly visible later page retires a final-page Review without retiring navigation', () => {
    const f = fixture();
    const initial = [page('contact'), page('delivery', true)];
    const visible = [page('contact'), page('delivery')];
    const pages = createNativeFormPages(f.publication({ pages: initial }));
    const submissions: string[] = [];
    pages.openReview(() => submissions.push('original'));
    const oldConfirm = pages.confirmReview;

    pages.update(f.publication({ pages: initial, reviewItems: ['updated'] }));
    assert.equal(pages.getSnapshot().reviewing, true);
    pages.update(f.publication({ pages: visible }));
    assert.equal(pages.getSnapshot().reviewing, false);
    assert.equal(pages.getSnapshot().isLastPage, false);
    oldConfirm();
    assert.equal(submissions.length, 0);

    pages.next();
    f.advances[0]!();
    assert.equal(pages.getSnapshot().activePageIndex, 1);
    pages.openReview(() => submissions.push('with delivery'));
    oldConfirm();
    pages.confirmReview();
    pages.confirmReview();
    assert.deepEqual(submissions, ['with delivery']);
});

it('losing final-page eligibility while Confirm closes Review invalidates native invocation', () => {
    const f = fixture();
    const initial = f.publication({
        pages: [page('contact'), page('delivery', true)],
    });
    const pages = createNativeFormPages(initial);
    let submissions = 0;
    pages.openReview(() => submissions++);
    const unsubscribe = pages.subscribe(() => {
        if (pages.getSnapshot().reviewing) return;
        unsubscribe();
        pages.update(
            f.publication({ pages: [page('contact'), page('delivery')] })
        );
        pages.update(initial);
    });

    pages.confirmReview();
    assert.equal(pages.getSnapshot().isLastPage, true);
    assert.equal(submissions, 0);
});

it('old Review dismiss and Confirm callbacks cannot affect a reopened Review', () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    let original = 0;
    let reopened = 0;
    pages.openReview(() => {
        original++;
    });
    const old = pages.getSnapshot().actions;
    const oldControllerDismiss = pages.dismissReview;
    const oldControllerConfirm = pages.confirmReview;
    old.dismissReview();
    pages.openReview(() => {
        reopened++;
    });
    old.dismissReview();
    old.confirmReview();
    oldControllerDismiss();
    oldControllerConfirm();
    assert.equal(pages.getSnapshot().reviewing, true);
    pages.confirmReview();
    assert.equal(original, 0);
    assert.equal(reopened, 1);
});

it('native queued submission reads its latest payload and allocated settlement survives retirement', async () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
        release = resolve;
    });
    let finish: () => void = () => {};
    const settlement = new Promise<void>((resolve) => {
        finish = resolve;
    });
    let canonical = 'before';
    let allocations = 0;
    pages.openReview(async () => {
        await ready;
        allocations++;
        const allocatedPayload = canonical;
        await settlement;
        return allocatedPayload;
    });
    const pending = pages.confirmReview();
    canonical = 'after Confirm';
    pages.update(f.publication({ reviewItems: [canonical] }));
    release();
    await Promise.resolve();
    assert.equal(allocations, 1);
    f.setCurrent(false);
    pages.update(f.publication());
    assert.equal(pages.getSnapshot().retired, true);
    finish();
    assert.equal(await pending, 'after Confirm');
    assert.equal(allocations, 1);
});

it('a throwing native callback stays consumed and explicit reopening uses a new callback', () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    let calls = 0;
    pages.openReview(() => {
        calls++;
        throw new Error('native refusal');
    });
    assert.throws(() => pages.confirmReview(), /native refusal/);
    assert.equal(pages.getSnapshot().reviewing, false);
    pages.confirmReview();
    pages.openReview(() => {
        calls++;
    });
    pages.confirmReview();
    assert.equal(calls, 2);
});

for (const changed of ['owner', 'configuration', 'currentness'] as const) {
    it(`observed ${changed} retirement is sticky across A-B-A restoration`, () => {
        const f = fixture();
        const pages = createNativeFormPages(f.publication());
        let submits = 0;
        pages.openReview(() => {
            submits++;
        });
        const old = pages.getSnapshot().actions;
        if (changed === 'currentness') {
            f.setCurrent(false);
            pages.update(f.publication());
            f.setCurrent(true);
        } else {
            pages.update(f.publication({ [changed]: {} }));
        }
        pages.update(f.publication());
        old.confirmReview();
        old.dismissReview();
        pages.next();
        assert.equal(pages.getSnapshot().retired, true);
        assert.equal(pages.getSnapshot().reviewing, false);
        assert.equal(submits, 0);
        assert.equal(f.nextPages.length, 0);
    });
}

it('render reads do not observe currentness; the next action observes and retires it', () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    const initial = pages.getSnapshot();
    const reads = f.currentReads();
    f.setCurrent(false);
    assert.equal(pages.getSnapshot(), initial);
    assert.equal(f.currentReads(), reads);
    pages.next();
    assert.equal(pages.getSnapshot().retired, true);
    assert.equal(f.nextPages.length, 0);
});

for (const action of ['confirm', 'back', 'next'] as const) {
    it(`a retained ${action} cannot run inside an outer currentness refusal`, () => {
        const f = fixture();
        const events: string[] = [];
        let reenter = false;
        let retained: () => unknown = () => {};
        let nestedPresentation: unknown;
        const publication = f.publication({
            isCurrent() {
                if (!reenter) return true;
                events.push('admission:start');
                retained();
                nestedPresentation = pages.getSnapshot();
                events.push('admission:end');
                return false;
            },
            onNext({ advance }) {
                events.push('native:next');
                advance();
            },
            onBack() {
                events.push('native:back');
            },
        });
        const pages = createNativeFormPages(publication);
        if (action === 'confirm') {
            pages.openReview(() => {
                events.push('native:submit');
            });
            retained = pages.confirmReview;
        } else if (action === 'back') {
            pages.next();
            retained = pages.back;
        } else retained = pages.next;
        events.length = 0;
        const before = pages.getSnapshot();
        reenter = true;
        pages.update(publication);
        assert.deepEqual(events, ['admission:start', 'admission:end']);
        assert.equal(nestedPresentation, before);
        assert.equal(pages.getSnapshot().retired, true);
        assert.equal(pages.getSnapshot().reviewing, false);
    });
}

it('dispose retires held callbacks without touching the host or a successor owner', () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    let submits = 0;
    pages.next();
    pages.openReview(() => {
        submits++;
    });
    const old = pages.getSnapshot().actions;
    const successor = createNativeFormPages(f.publication());
    pages.dispose();
    pages.dispose();
    f.advances[0]!();
    old.confirmReview();
    pages.update(f.publication());
    assert.equal(pages.getSnapshot().retired, true);
    assert.equal(successor.getSnapshot().retired, false);
    assert.equal(successor.getSnapshot().activePageIndex, 0);
    assert.equal(submits, 0);
});

it('subscriber reentry publishes current live rows and a failing subscriber is isolated', () => {
    const f = fixture();
    const pages = createNativeFormPages(f.publication());
    let changed = false;
    pages.subscribe(() => {
        throw new Error('renderer failed');
    });
    pages.subscribe(() => {
        if (!changed) {
            changed = true;
            pages.update(f.publication({ reviewItems: ['listener update'] }));
        }
    });
    pages.openReview(() => {});
    assert.equal(pages.getSnapshot().reviewing, true);
    assert.deepEqual(pages.getSnapshot().reviewItems, ['listener update']);
});
