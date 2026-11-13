import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
    installCompleteRichTextFocusObserver,
    richTextDocumentNavigationKeys,
} from './browser-complete-rich-text-checks.mjs';

// CI can run on Linux while the qualified browser runs on a team Mac. Route
// using that browser's platform, rather than the Node runner's operating system.
// These routing controls do not certify trusted native caret movement.
test('Rich Text document navigation uses the browser platform for both boundaries', () => {
    for (const platform of ['MacIntel', 'MacPPC'])
        assert.deepEqual(richTextDocumentNavigationKeys(platform), {
            start: 'Meta+ArrowUp',
            end: 'Meta+ArrowDown',
        });
    for (const platform of ['Win32', 'Linux x86_64', ''])
        assert.deepEqual(richTextDocumentNavigationKeys(platform), {
            start: 'Control+Home',
            end: 'Control+End',
        });
});

// Exact consumer observer, actual HTMLElement focus/focusin ordering and a
// controlled clock. These tests qualify fixture ordering/retirement, not native
// browser navigation. The real PM 20ms counterfactual is a separate engine test.
async function fixture(t) {
    const window = new Window({ url: 'https://focus.synthetic.invalid/' });
    const { document } = window;
    const listeners = [];
    const callbacks = [];
    let observer;
    let current;
    let timersEnabled = false;
    t.after(async () => {
        try {
            observer?.dispose();
            for (const [element, listener] of listeners)
                element.removeEventListener('focus', listener);
        } finally {
            try {
                if (timersEnabled) t.mock.timers.reset();
            } finally {
                await window.happyDOM.close();
            }
        }
    });
    const createView = (name) => {
        const dom = document.createElement('div');
        dom.id = name;
        dom.tabIndex = 0;
        dom.contentEditable = 'true';
        document.body.append(dom);
        // A target focus listener runs before document focusin. The observer
        // must not announce readiness before this earlier callback completes.
        const onFocus = () => {
            setTimeout(() => {
                callbacks.push({
                    name,
                    readyBeforeReconcile: observer.snapshot().ready,
                });
            }, 20);
        };
        dom.addEventListener('focus', onFocus);
        listeners.push([dom, onFocus]);
        return { dom, isDestroyed: false };
    };
    const first = createView('first');
    current = { view: first };
    const outside = document.createElement('button');
    outside.textContent = 'Outside editor';
    document.body.append(outside);
    observer = installCompleteRichTextFocusObserver({
        document,
        getCurrentEditor: () => current,
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    timersEnabled = true;
    return {
        observer,
        first,
        outside,
        document,
        callbacks,
        createView,
        replaceOwner(next) {
            current = next;
            observer.reconcile();
        },
        current: () => current,
        tick: (ms) => t.mock.timers.tick(ms),
    };
}

test('exact focus observer becomes ready only after the earlier target-focus callback', async (t) => {
    const f = await fixture(t);
    assert.equal(f.observer.snapshot().ready, false);
    f.first.dom.focus();
    assert.equal(f.document.activeElement, f.first.dom);
    assert.equal(f.observer.snapshot().phase, 'pending');
    f.tick(19);
    assert.equal(f.observer.snapshot().ready, false);
    assert.deepEqual(f.callbacks, []);
    f.tick(1);
    assert.deepEqual(f.callbacks, [
        { name: 'first', readyBeforeReconcile: false },
    ]);
    assert.equal(f.observer.snapshot().ready, true);
    const admitted = f.observer.snapshot();
    f.first.dom.focus();
    assert.deepEqual(
        f.observer.snapshot(),
        admitted,
        'Already focused does not invent another focus timer'
    );
});

test('focus-out retires pending and ready generations without later admission', async (t) => {
    const f = await fixture(t);
    f.first.dom.focus();
    f.tick(19);
    const pending = f.observer.snapshot().generation;
    f.outside.focus();
    assert.equal(f.observer.snapshot().ready, false);
    assert(f.observer.snapshot().generation > pending);
    f.tick(1);
    assert.equal(f.observer.snapshot().ready, false);
    f.first.dom.focus();
    f.tick(20);
    assert.equal(f.observer.snapshot().ready, true);
    f.outside.focus();
    f.tick(20);
    assert.equal(f.observer.snapshot().ready, false);
    assert.equal(f.document.activeElement, f.outside);
});

test('owner and view replacements cannot inherit another focus admission', async (t) => {
    const f = await fixture(t);
    f.first.dom.focus();
    f.tick(19);
    f.replaceOwner({ view: f.first });
    f.tick(1);
    assert.equal(
        f.observer.snapshot().ready,
        false,
        'New owner on the same DOM needs its own focus event'
    );
    f.outside.focus();
    f.first.dom.focus();
    f.tick(20);
    assert.equal(f.observer.snapshot().ready, true);
    const nextView = f.createView('second');
    f.current().view = nextView;
    f.observer.reconcile();
    assert.equal(
        f.observer.snapshot().ready,
        false,
        'A new PM view under the same owner retires readiness'
    );
    nextView.dom.focus();
    f.tick(20);
    assert.equal(f.observer.snapshot().ready, true);
    nextView.isDestroyed = true;
    assert.equal(f.observer.snapshot().ready, false);
});

test('detachment and disposal cancel pending observation and remove listeners', async (t) => {
    const f = await fixture(t);
    f.first.dom.focus();
    f.first.dom.remove();
    f.observer.reconcile();
    f.tick(20);
    assert.equal(f.observer.snapshot().ready, false);
    f.document.body.append(f.first.dom);
    f.outside.focus();
    f.first.dom.focus();
    const pending = f.observer.snapshot();
    assert.equal(pending.phase, 'pending');
    f.observer.dispose();
    const disposed = f.observer.snapshot();
    assert.equal(disposed.phase, 'disposed');
    assert.equal(disposed.ready, false);
    f.tick(20);
    f.outside.focus();
    f.first.dom.focus();
    f.tick(20);
    assert.deepEqual(
        f.observer.snapshot(),
        disposed,
        'Disposed listeners cannot start another generation'
    );
    f.observer.dispose();
    assert.deepEqual(f.observer.snapshot(), disposed);
});
