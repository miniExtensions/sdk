import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { preparePrintableDOM } from '../src/ui/printableDOM.js';

function fixture(t: TestContext) {
    const window = new Window({ url: 'http://localhost:4200/print' });
    t.after(() => window.happyDOM.close());
    const document = window.document;
    const source = document.createElement('div');
    source.style.cssText =
        'position:fixed;left:-100000px;opacity:0;width:816px;';
    source.innerHTML =
        '<label>Snapshot<input value="before"></label><textarea>text</textarea><select><option>first</option><option>second</option></select>';
    document.body.append(source);
    let current = true;
    let after = 0;
    const options = {
        isCurrent: () => current,
        afterPrint: () => {
            after++;
        },
    };
    return {
        window,
        document,
        source,
        options,
        get after() {
            return after;
        },
        retire() {
            current = false;
        },
    };
}
const dom = (value: unknown) => value as HTMLElement;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('owned DOM engine copies live inputs/styles and preserves its frame until explicit cleanup', async (t) => {
    const f = fixture(t);
    f.document.head.innerHTML = '<style></style>';
    f.document
        .querySelector('style')!
        .sheet!.insertRule('.print-color { color: purple; }', 0);
    assert.equal(f.document.querySelector('style')!.textContent, '');
    f.document.body.className = 'theme-purple';
    f.source.querySelector('input')!.value = 'committed live value';
    f.source.querySelector('textarea')!.value = 'committed text';
    f.source.querySelector('select')!.selectedIndex = 1;
    const foreign = f.document.createElement('iframe');
    foreign.id = 'printWindow';
    f.document.body.append(foreign);
    const prepared = await preparePrintableDOM(dom(f.source), f.options);
    const frame = f.document.querySelector(
        'iframe[data-mx-sdk-print-frame]'
    ) as unknown as HTMLIFrameElement;
    assert.ok(frame);
    assert.equal(frame.id, '');
    const printed = frame.contentDocument!;
    assert.equal(printed.querySelector('input')!.value, 'committed live value');
    assert.equal(printed.querySelector('textarea')!.value, 'committed text');
    assert.equal(printed.querySelector('select')!.selectedIndex, 1);
    assert.equal(printed.body.className, 'theme-purple');
    assert.match(printed.head.textContent ?? '', /color:\s*purple/);
    assert.equal(
        printed.body
            .firstElementChild!.getAttribute('style')!
            .includes('opacity'),
        false
    );
    f.source.querySelector('input')!.value = 'later value';
    assert.equal(printed.querySelector('input')!.value, 'committed live value');
    let calls = 0;
    Object.defineProperty(frame.contentWindow, 'print', {
        configurable: true,
        value: () => {
            calls++;
        },
    });
    prepared.invoke((print) => {
        print();
        return { status: 'invoked' };
    });
    assert.equal(calls, 1);
    frame.contentWindow!.dispatchEvent(
        new f.window.Event('afterprint') as unknown as Event
    );
    assert.equal(f.after, 1);
    assert.equal(frame.isConnected, true);
    await prepared.dispose();
    await prepared.dispose();
    assert.equal(frame.isConnected, false);
    assert.equal(foreign.isConnected, true);
    assert.equal(f.source.isConnected, true);
});

test('asynchronous source content is retained until its committed busy marker clears', async (t) => {
    const f = fixture(t);
    f.source.setAttribute('aria-busy', 'true');
    // The public root itself can carry readiness, as can a nested rich presenter.
    const pending = preparePrintableDOM(dom(f.source), f.options);
    await turn();
    assert.equal(f.document.querySelector('[data-mx-sdk-print-frame]'), null);
    f.source.removeAttribute('aria-busy');
    const prepared = await pending;
    assert.ok(f.document.querySelector('[data-mx-sdk-print-frame]'));
    await prepared.dispose();
});

test('cancellation during font preparation cleans only the exact owned frame before rejecting', async (t) => {
    const f = fixture(t);
    let release!: () => void;
    const fonts = new Promise<void>((resolve) => {
        release = resolve;
    });
    let fontsEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
        fontsEntered = resolve;
    });
    const prototype = f.window.HTMLIFrameElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(
        prototype,
        'contentDocument'
    )!;
    Object.defineProperty(prototype, 'contentDocument', {
        ...descriptor,
        get() {
            const document = descriptor.get!.call(this) as Document | null;
            if (document)
                Object.defineProperty(document, 'fonts', {
                    configurable: true,
                    get() {
                        fontsEntered();
                        return { ready: fonts };
                    },
                });
            return document;
        },
    });
    t.after(() =>
        Object.defineProperty(prototype, 'contentDocument', descriptor)
    );
    const abort = new AbortController();
    t.after(() => {
        abort.abort();
        release();
    });
    const pending = preparePrintableDOM(dom(f.source), {
        ...f.options,
        signal: abort.signal,
    });
    const outcome = pending.then(
        () => 'prepared',
        () => 'rejected'
    );
    await entered;
    assert.ok(f.document.querySelector('[data-mx-sdk-print-frame]'));
    abort.abort();
    assert.equal(await outcome, 'rejected');
    assert.equal(f.document.querySelector('[data-mx-sdk-print-frame]'), null);
    release();
    await turn();
    assert.equal(f.document.querySelector('[data-mx-sdk-print-frame]'), null);
});

test('late embedded content cannot bypass whole-stage refusal while awaiting a rich presenter', async (t) => {
    const f = fixture(t);
    f.source.setAttribute('aria-busy', 'true');
    const pending = preparePrintableDOM(dom(f.source), f.options);
    const rejected = assert.rejects(pending, /Print preparation failed/);
    f.source.append(f.document.createElement('iframe'));
    f.source.removeAttribute('aria-busy');
    await rejected;
    assert.equal(f.document.querySelector('[data-mx-sdk-print-frame]'), null);
});

test('resource retirement inside the external invocation boundary cannot call a removed window', async (t) => {
    const f = fixture(t);
    const prepared = await preparePrintableDOM(dom(f.source), f.options);
    const frame = f.document.querySelector(
        'iframe[data-mx-sdk-print-frame]'
    ) as unknown as HTMLIFrameElement;
    let calls = 0;
    Object.defineProperty(frame.contentWindow, 'print', {
        configurable: true,
        value: () => {
            calls++;
        },
    });
    assert.throws(
        () =>
            prepared.invoke((print) => {
                void prepared.dispose();
                print();
                return { status: 'invoked' };
            }),
        /Print frame retired/
    );
    assert.equal(calls, 0);
});

test('an authority predicate cannot synchronously abort preparation and still admit a frame', async (t) => {
    const f = fixture(t);
    const abort = new AbortController();
    await assert.rejects(
        preparePrintableDOM(dom(f.source), {
            ...f.options,
            signal: abort.signal,
            isCurrent() {
                abort.abort();
                return true;
            },
        }),
        /Print preparation failed/
    );
    assert.equal(f.document.querySelector('[data-mx-sdk-print-frame]'), null);
});

test('retired authority after async preparation refuses without invoking or leaking a frame', async (t) => {
    const f = fixture(t);
    f.source.firstElementChild!.setAttribute('aria-busy', 'true');
    const pending = preparePrintableDOM(dom(f.source), f.options);
    const rejected = assert.rejects(pending, /Print preparation failed/);
    f.retire();
    f.source.firstElementChild!.removeAttribute('aria-busy');
    await rejected;
    assert.equal(f.document.querySelector('[data-mx-sdk-print-frame]'), null);
});

test('unadmitted embedded media refuses the whole stage without replacing a foreign frame', async (t) => {
    const f = fixture(t);
    const foreign = f.document.createElement('iframe');
    f.document.body.append(foreign);
    f.source.append(f.document.createElement('video'));
    await assert.rejects(
        preparePrintableDOM(dom(f.source), f.options),
        /Print preparation failed/
    );
    assert.equal(f.document.querySelector('[data-mx-sdk-print-frame]'), null);
    assert.equal(foreign.isConnected, true);
});
