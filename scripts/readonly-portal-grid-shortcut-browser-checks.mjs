import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function checkReadonlyPortalGridShortcutBrowser({
    page,
    evidence,
}) {
    const origin = new URL(page.url()).origin;
    const fixture = '/readonly-portal-grid.html';
    const assets = new Set([
        fixture,
        '/readonly-portal-grid.js',
        '/readonly-portal-grid.css',
        '/favicon.ico',
    ]);
    const probe = await page.context().newPage();
    const result = {
        checkerSha256: createHash('sha256')
            .update(readFileSync(new URL(import.meta.url)))
            .digest('hex'),
        chords: [],
        resize: [],
        pageErrors: [],
        unexpectedRequests: [],
    };
    evidence.resizeShortcuts = result;
    try {
        probe.setDefaultTimeout(5000);
        await probe.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                url.origin === origin &&
                request.method() === 'GET' &&
                assets.has(url.pathname) &&
                !['fetch', 'xhr'].includes(request.resourceType())
            )
                return route.continue();
            result.unexpectedRequests.push({
                method: request.method(),
                path: url.pathname,
            });
            return route.abort();
        });
        probe.on('pageerror', (error) => result.pageErrors.push(error.message));
        await probe.goto(origin + fixture);
        const handle = probe.getByRole('separator', { name: 'Resize Amount' });
        await handle.focus();
        await handle.evaluate((node) => {
            window.__gridResizeShortcutProbe = {
                separator: node,
                captured: [],
                host: [],
                traversals: [],
            };
            const proof = window.__gridResizeShortcutProbe;
            for (const type of ['keydown', 'keyup']) {
                const observe = (event, history) => {
                    if (
                        event.target !== node ||
                        !['ArrowLeft', 'ArrowRight'].includes(event.key)
                    )
                        return;
                    history.push({
                        type,
                        key: event.key,
                        alt: event.altKey,
                        meta: event.metaKey,
                        repeat: event.repeat,
                        trusted: event.isTrusted,
                        prevented: event.defaultPrevented,
                    });
                };
                document.addEventListener(
                    type,
                    (event) => observe(event, proof.captured),
                    true
                );
                document.addEventListener(type, (event) =>
                    observe(event, proof.host)
                );
            }
            addEventListener('popstate', (event) =>
                proof.traversals.push({
                    state: event.state,
                    trusted: event.isTrusted,
                    url: location.pathname + location.search,
                })
            );
        });
        const snapshot = () =>
            probe.evaluate(() => {
                const {
                    widths,
                    opens,
                    submits,
                    errors,
                    hides,
                    canonicalUnchanged,
                } = window.__nativeProbe.snapshot();
                const { captured, host, traversals, separator } =
                    window.__gridResizeShortcutProbe;
                return {
                    geometry: ['amount', 'notes'].map(
                        (id) =>
                            document.querySelector(
                                'th[data-field-id="' + id + '"]'
                            ).clientWidth
                    ),
                    writes: widths,
                    opens,
                    submits,
                    errors,
                    hides,
                    canonicalUnchanged,
                    focused: document.activeElement === separator,
                    captured,
                    host,
                    traversals,
                    historyState: history.state,
                    historyUrl: location.pathname + location.search,
                };
            });
        const initial = await snapshot();
        for (const modifier of ['Alt', 'Meta']) {
            for (const key of ['ArrowLeft', 'ArrowRight']) {
                for (const modifierFirst of [false, true]) {
                    const previous = await snapshot();
                    await probe.keyboard.down(modifier);
                    await probe.keyboard.down(key);
                    const during = await snapshot();
                    let repeatGeometry;
                    if (modifierFirst) {
                        await probe.keyboard.up(modifier);
                        await probe.keyboard.down(key);
                        repeatGeometry = (await snapshot()).geometry;
                    }
                    await probe.keyboard.up(key);
                    if (!modifierFirst) await probe.keyboard.up(modifier);
                    const after = await snapshot();
                    const expected = (type, modified, repeat = false) => ({
                        type,
                        key,
                        alt: modified && modifier === 'Alt',
                        meta: modified && modifier === 'Meta',
                        repeat,
                        trusted: true,
                        prevented: false,
                    });
                    const events = [expected('keydown', true)];
                    if (modifierFirst)
                        events.push(expected('keydown', false, true));
                    events.push(expected('keyup', !modifierFirst));
                    const capture = after.captured.slice(
                        previous.captured.length
                    );
                    const host = after.host.slice(previous.host.length);
                    result.chords.push({
                        modifier,
                        key,
                        modifierFirst,
                        capture,
                        host,
                        widths: [
                            previous.geometry,
                            during.geometry,
                            after.geometry,
                        ],
                        repeatGeometry,
                        commits: after.writes.length - previous.writes.length,
                    });
                    assert.deepEqual(capture, events);
                    assert.deepEqual(host, events);
                    assert.deepEqual(previous.geometry, initial.geometry);
                    assert.deepEqual(during.geometry, initial.geometry);
                    if (repeatGeometry)
                        assert.deepEqual(repeatGeometry, initial.geometry);
                    assert.deepEqual(after.geometry, initial.geometry);
                    assert.deepEqual(after.writes, []);
                    assert.deepEqual(after.hides, []);
                    assert.equal(after.canonicalUnchanged, true);
                    assert.deepEqual(after.opens, []);
                    assert.equal(after.submits, 0);
                    assert.equal(after.focused, true);
                }
            }
        }

        // Browser history is a separate observation from trusted page-event delivery.
        await probe.getByRole('button', { name: 'Before Grid' }).click();
        await handle.focus();
        await probe.evaluate(() => {
            history.replaceState(
                'native-before',
                '',
                '?resize-history=native-before'
            );
            history.pushState(
                'native-after',
                '',
                '?resize-history=native-after'
            );
        });
        const observeTraversal = async (key, from, state) => {
            const before = await snapshot();
            assert.equal(before.historyState, from);
            const baseline = before.traversals.length;
            const url = fixture + '?resize-history=' + state;
            await probe.keyboard.press(key);
            try {
                await probe.waitForFunction(
                    ({ baseline, state, url }) =>
                        window.__gridResizeShortcutProbe.traversals
                            .slice(baseline)
                            .some(
                                (entry) =>
                                    entry.trusted &&
                                    entry.state === state &&
                                    entry.url === url
                            ),
                    { baseline, state, url },
                    { timeout: 850 }
                );
            } catch (error) {
                if (error.name !== 'TimeoutError') throw error;
            }
            const after = await snapshot();
            const observed = after.traversals.slice(baseline);
            return {
                key,
                from,
                state,
                url,
                observed,
                status:
                    after.historyState === state &&
                    after.historyUrl === url &&
                    observed.some(
                        (entry) =>
                            entry.trusted &&
                            entry.state === state &&
                            entry.url === url
                    )
                        ? 'observed'
                        : 'not-observed',
            };
        };
        const back = await observeTraversal(
            'Alt+ArrowLeft',
            'native-after',
            'native-before'
        );
        if (back.status !== 'observed') {
            // Position the fixture for Forward. This traversal is excluded
            // from the observations taken after the Forward shortcut.
            await probe.evaluate(() => {
                if (history.state === 'native-after') history.back();
            });
            await probe.waitForFunction(
                () => history.state === 'native-before'
            );
        }
        result.history = {
            driver: 'Playwright Chromium',
            back,
            forwardSetup:
                back.status === 'observed' ? 'back-shortcut' : 'fixture',
            forward: await observeTraversal(
                'Alt+ArrowRight',
                'native-before',
                'native-after'
            ),
        };
        const afterNavigation = await snapshot();
        assert.deepEqual(afterNavigation.geometry, initial.geometry);
        assert.deepEqual(afterNavigation.writes, []);
        assert.deepEqual(afterNavigation.opens, []);
        assert.deepEqual(afterNavigation.hides, []);
        assert.equal(afterNavigation.submits, 0);
        assert.equal(afterNavigation.focused, true);

        let expectedWidth = initial.geometry[0];
        for (const [key, shift, delta] of [
            ['ArrowRight', false, 1],
            ['ArrowLeft', false, -1],
            ['ArrowRight', true, 10],
            ['ArrowLeft', true, -10],
        ]) {
            if (shift) await probe.keyboard.down('Shift');
            await probe.keyboard.down(key);
            expectedWidth += delta;
            await probe.waitForFunction(
                (width) =>
                    document.querySelector('th[data-field-id="amount"]')
                        .clientWidth === width,
                expectedWidth
            );
            const draft = await snapshot();
            assert.deepEqual(draft.geometry, [
                expectedWidth,
                initial.geometry[1],
            ]);
            assert.equal(draft.writes.length, result.resize.length);
            await probe.keyboard.up(key);
            if (shift) await probe.keyboard.up('Shift');
            await probe.waitForFunction(
                (commits) =>
                    window.__nativeProbe.snapshot().widths.length === commits,
                result.resize.length + 1
            );
            const after = await snapshot();
            assert.equal(after.writes.length, result.resize.length + 1);
            const commit = after.writes.at(-1);
            assert.deepEqual(commit, {
                scope: 'original',
                revision: 1,
                fieldId: 'amount',
                width: expectedWidth,
                measuredAtCommit: expectedWidth,
            });
            assert.deepEqual(after.geometry, [
                expectedWidth,
                initial.geometry[1],
            ]);
            result.resize.push({ key, shift, commit });
        }

        await probe.keyboard.down('ArrowLeft');
        await probe.keyboard.press('Escape');
        await probe.keyboard.up('ArrowLeft');
        const end = await snapshot();
        assert.deepEqual(end.geometry, [expectedWidth, initial.geometry[1]]);
        assert.equal(end.writes.length, result.resize.length);
        assert.deepEqual(end.opens, []);
        assert.deepEqual(end.hides, []);
        assert.equal(end.canonicalUnchanged, true);
        assert.equal(end.submits, 0);
        assert.deepEqual(end.errors, []);
        assert.deepEqual(result.pageErrors, []);
        assert.deepEqual(result.unexpectedRequests, []);
        result.status = 'passed';
    } finally {
        await probe.close();
    }
}
