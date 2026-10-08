import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSelectionModel } from '../src/ui/model.js';
import type {
    SelectionOption,
    SelectionLoader,
    SelectionPage,
    SelectionRequest,
    SelectionState,
} from '../src/ui/types.js';

const options = [
    { value: 'one', label: 'First choice' },
    { value: 'two', label: 'Second choice' },
    { value: 'locked', label: 'Disabled choice', disabled: true },
];

function deferred<T>() {
    let resolve!: (result: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });
    return { promise, resolve, reject };
}

function loaderFixture() {
    const requests: SelectionRequest[] = [];
    const responses: ReturnType<typeof deferred<SelectionPage>>[] = [];
    return {
        requests,
        responses,
        loadOptions(request: SelectionRequest) {
            const response = deferred<SelectionPage>();
            requests.push(request);
            responses.push(response);
            return response.promise;
        },
    };
}

describe('selection model values and snapshots', () => {
    it('deduplicates option IDs and values, and limits single selection', () => {
        const model = createSelectionModel({
            options: [...options, { value: 'one', label: 'Updated first' }],
            value: ['one', 'one', 'two'],
        });
        assert.equal(model.getState().multiple, false);
        assert.deepEqual(model.getState().value, ['one']);
        assert.equal(model.getState().options.length, 3);
        assert.equal(
            model.getState().selectedOptions[0].label,
            'Updated first'
        );
        model.choose(['two', 'one']);
        assert.deepEqual(model.getState().value, ['two']);
        model.toggle('unknown');
        model.toggle('locked');
        assert.deepEqual(model.getState().value, ['two']);
    });

    it('copies initial inputs, snapshots, subscriber values, and change values', () => {
        const input = [{ value: 'one', label: 'First' }];
        const value = ['one'];
        const model = createSelectionModel({
            multiple: true,
            options: input,
            value,
            onChange(next) {
                (next as string[]).push('callback mutation');
            },
        });
        input[0].label = 'Input mutation';
        value.push('Input mutation');
        const mutate = (state: SelectionState) => {
            (state.value as string[]).push('Snapshot mutation');
            (state.options as SelectionOption[])[0].label = 'Snapshot mutation';
            (state.selectedOptions as SelectionOption[])[0].label = 'Mutation';
        };
        mutate(model.getState());
        const unsubscribe = model.subscribe(mutate);
        let observed: SelectionState | undefined;
        model.subscribe((state) => {
            observed = state;
        });
        assert.deepEqual(observed?.value, ['one']);
        assert.equal(observed?.options[0].label, 'First');
        assert.equal(observed?.selectedOptions[0].label, 'First');
        unsubscribe();
        model.clear();
        assert.deepEqual(model.getState().value, []);
    });

    it('applies atomic user changes once and ignores disabled or unknown additions', () => {
        const changes: string[][] = [];
        const model = createSelectionModel({
            multiple: true,
            options,
            value: ['one', 'missing', 'locked'],
            selectedOptions: [
                { value: 'missing', label: 'Previously selected' },
            ],
            onChange(next) {
                changes.push([...next]);
            },
        });
        model.choose(['missing', 'two', 'two', 'unknown', 'locked']);
        assert.deepEqual(model.getState().value, ['missing', 'two', 'locked']);
        assert.equal(changes.length, 1);
        model.choose(['missing', 'two', 'locked']);
        assert.equal(changes.length, 1);
        model.toggle('locked');
        assert.deepEqual(model.getState().value, ['missing', 'two']);
        model.toggle('locked');
        model.toggle('unknown');
        model.choose(['unknown']);
        assert.deepEqual(model.getState().value, ['missing', 'two']);
        assert.equal(changes.length, 2);
        model.toggle('missing');
        assert.deepEqual(model.getState().value, ['two']);
    });

    it('blocks user changes while disabled/readOnly, with programmatic updates still allowed', () => {
        let changes = 0;
        const model = createSelectionModel({
            options,
            value: ['one'],
            disabled: true,
            onChange: () => changes++,
        });
        model.toggle('one');
        model.choose(['two']);
        model.clear();
        assert.deepEqual(model.getState().value, ['one']);
        model.setValue(
            ['external', 'two'],
            [{ value: 'external', label: 'External selection' }]
        );
        assert.deepEqual(model.getState().value, ['external']);
        assert.equal(
            model.getState().selectedOptions[0].label,
            'External selection'
        );
        model.setDisabled(false);
        model.setReadOnly(true);
        model.clear();
        assert.deepEqual(model.getState().value, ['external']);
        assert.equal(changes, 0);
        model.setReadOnly(false);
        model.clear();
        assert.deepEqual(model.getState().value, []);
        assert.equal(changes, 1);
    });

    it('filters static options by label or value while preserving selected labels', async () => {
        const model = createSelectionModel({ options, value: ['one'] });
        await model.setSearchTerm('SECOND');
        assert.deepEqual(
            model.getState().options.map(({ value }) => value),
            ['two']
        );
        assert.equal(model.getState().selectedOptions[0].label, 'First choice');
        await model.setSearchTerm('one');
        assert.deepEqual(
            model.getState().options.map(({ value }) => value),
            ['one']
        );
        model.setOptions([{ value: 'one', label: 'New first label' }]);
        assert.equal(
            model.getState().selectedOptions[0].label,
            'New first label'
        );
        await model.setSearchTerm('nothing matches');
        assert.deepEqual(model.getState().options, []);
        assert.equal(model.getState().loading, false);
        assert.equal(model.getState().error, null);
        model.setValue(['unknown']);
        assert.deepEqual(model.getState().selectedOptions, [
            { value: 'unknown', label: 'unknown' },
        ]);
    });

    it('does not carry callback or observer failures into a replacement scope', () => {
        const model = createSelectionModel({
            options,
            onChange() {
                model.reset({ options: [options[1]] });
                throw new Error('Old callback failure');
            },
        });
        model.choose(['one']);
        assert.equal(model.getState().error, null);
        let replaceOnNext = false;
        model.subscribe(() => {
            if (!replaceOnNext) return;
            replaceOnNext = false;
            model.reset({ options: [options[0]] });
            throw new Error('Old observer failure');
        });
        replaceOnNext = true;
        model.setValue(['two']);
        assert.equal(model.getState().error, null);
        assert.deepEqual(model.getState().value, []);
        assert.deepEqual(model.getState().options, [options[0]]);
    });
});

describe('selection model asynchronous pages', () => {
    it('clears stale labels before abort observers and never subscribes after reentrant destruction', async () => {
        for (const destroyOnAbort of [false, true]) {
            let fresh = true;
            let observed: SelectionState | undefined;
            let snapshots = 0;
            const response = deferred<SelectionPage>();
            const loader: SelectionLoader = (request) => {
                request.signal.addEventListener('abort', () => {
                    observed = model.getState();
                    if (destroyOnAbort) model.destroy();
                });
                return response.promise;
            };
            loader.isCurrent = () => fresh;
            const model = createSelectionModel({
                options,
                value: ['one'],
                loadOptions: loader,
            });
            const pending = model.reload();
            await Promise.resolve();
            fresh = false;
            model.subscribe(() => snapshots++);
            assert.deepEqual(observed?.selectedOptions, []);
            assert.deepEqual(observed?.value, []);
            assert.equal(
                observed?.error,
                'Selection context changed. Reset the control before continuing.'
            );
            assert.equal(snapshots, destroyOnAbort ? 0 : 1);
            response.resolve({ options, offset: null });
            await pending;
            assert.deepEqual(model.getState().value, []);
            model.destroy();
        }
    });

    it('does not expose old labels through snapshots or observers when freshness is false or throws', () => {
        for (const fail of [
            () => false,
            () => {
                throw new Error('Freshness failure');
            },
        ]) {
            let fresh = true;
            const loader: SelectionLoader = () =>
                Promise.resolve({ options: [], offset: null });
            loader.isCurrent = () => (fresh ? true : fail());
            const model = createSelectionModel({
                options,
                value: ['one'],
                loadOptions: loader,
            });
            const snapshots: SelectionState[] = [];
            model.subscribe((state) => snapshots.push(state));
            fresh = false;
            const snapshot = model.getState();
            assert.deepEqual(snapshot.options, []);
            assert.deepEqual(snapshot.selectedOptions, []);
            assert.deepEqual(snapshot.value, []);
            assert.equal(snapshots.length, 2);
            assert.deepEqual(snapshots[1].selectedOptions, []);
            let initial: SelectionState | undefined;
            model.subscribe((state) => {
                initial = state;
            });
            assert.deepEqual(initial?.options, []);
            model.setDisabled(true);
            model.setReadOnly(true);
            model.cancel();
            assert.equal(
                model.getState().error,
                'Selection context changed. Reset the control before continuing.'
            );
            model.destroy();
        }
    });

    it('invalidates old session choices before callbacks or fetches and recovers only through reset', async () => {
        const fixture = loaderFixture();
        let fresh = true;
        let changes = 0;
        const loader: SelectionLoader = fixture.loadOptions;
        loader.isCurrent = () => fresh;
        const model = createSelectionModel({
            options,
            value: ['one'],
            loadOptions: loader,
            onChange: () => changes++,
        });
        fresh = false;
        model.choose(['two']);
        assert.deepEqual(model.getState().value, []);
        assert.deepEqual(model.getState().options, []);
        assert.deepEqual(model.getState().selectedOptions, []);
        assert.equal(
            model.getState().error,
            'Selection context changed. Reset the control before continuing.'
        );
        assert.equal(changes, 0);
        await model.reload();
        await model.setSearchTerm('new');
        await model.loadMore();
        assert.equal(fixture.requests.length, 0);
        fresh = true;
        model.setOptions(options);
        model.setValue(['one']);
        model.cancel();
        assert.deepEqual(model.getState().value, []);
        assert.notEqual(model.getState().error, null);
        model.reset({
            options,
            loadOptions: loader,
            onChange: () => changes++,
        });
        model.choose(['two']);
        assert.deepEqual(model.getState().value, ['two']);
        assert.equal(changes, 1);
        assert.equal(model.getState().error, null);
    });

    it('discards a page when session freshness changes while its request is pending', async () => {
        const fixture = loaderFixture();
        let fresh = true;
        const loader: SelectionLoader = fixture.loadOptions;
        loader.isCurrent = () => fresh;
        const model = createSelectionModel({
            loadOptions: loader,
            value: ['one'],
            selectedOptions: [options[0]],
        });
        const pending = model.reload();
        await Promise.resolve();
        fresh = false;
        fixture.responses[0].resolve({ options, offset: 'old-session' });
        await pending;
        assert.equal(fixture.requests[0].signal.aborted, true);
        assert.deepEqual(model.getState().options, []);
        assert.deepEqual(model.getState().value, []);
        assert.deepEqual(model.getState().selectedOptions, []);
        assert.equal(model.getState().loading, false);
        assert.equal(model.getState().offset, null);
        assert.notEqual(model.getState().error, null);
    });

    it('aborts immediately and rejects stale completions even when loaders ignore abort', async () => {
        const fixture = loaderFixture();
        const model = createSelectionModel({
            loadOptions: fixture.loadOptions,
        });
        const first = model.setSearchTerm('old');
        assert.equal(model.getState().loading, true);
        await Promise.resolve();
        const next = model.setSearchTerm('new');
        assert.equal(fixture.requests[0].signal.aborted, true);
        await Promise.resolve();
        assert.equal(fixture.requests[1].searchTerm, 'new');
        fixture.responses[0].resolve({
            options: [options[0]],
            offset: 'stale',
        });
        await first;
        assert.equal(model.getState().loading, true);
        assert.deepEqual(model.getState().options, []);
        assert.equal(model.getState().offset, null);
        fixture.responses[1].resolve({
            options: [options[1]],
            offset: 'fresh',
        });
        await next;
        assert.deepEqual(model.getState().options, [options[1]]);
        assert.equal(model.getState().offset, 'fresh');
        assert.equal(model.getState().loading, false);
    });

    it('keeps a replacement scope when an old abort listener synchronously resets the model', async () => {
        let calls = 0;
        const response = deferred<SelectionPage>();
        const model = createSelectionModel({
            loadOptions(request) {
                calls++;
                request.signal.addEventListener('abort', () => {
                    model.reset({ options: [options[1]], value: ['two'] });
                });
                return response.promise;
            },
        });
        const old = model.reload();
        await Promise.resolve();
        await model.setSearchTerm('stale search');
        assert.equal(calls, 1);
        assert.deepEqual(model.getState().options, [options[1]]);
        assert.deepEqual(model.getState().value, ['two']);
        assert.equal(model.getState().searchTerm, '');
        response.resolve({ options: [options[0]], offset: 'old offset' });
        await old;
        assert.deepEqual(model.getState().options, [options[1]]);
        assert.equal(model.getState().offset, null);
    });

    it('ignores stale failures without clearing a newer request or error state', async () => {
        const fixture = loaderFixture();
        const model = createSelectionModel({
            loadOptions: fixture.loadOptions,
        });
        const first = model.reload();
        await Promise.resolve();
        const next = model.setSearchTerm('new');
        await Promise.resolve();
        fixture.responses[1].reject(new Error('Current failure'));
        await next;
        fixture.responses[0].reject(new Error('Stale failure'));
        await first;
        assert.equal(model.getState().error, 'Current failure');
        assert.equal(model.getState().loading, false);
    });

    it('deduplicates pages, joins in-flight paging, and retries the failed cursor', async () => {
        const fixture = loaderFixture();
        const model = createSelectionModel({
            loadOptions: fixture.loadOptions,
        });
        const first = model.reload();
        await Promise.resolve();
        fixture.responses[0].resolve({
            options: [options[0]],
            offset: 'page-two',
        });
        await first;
        model.choose(['one']);
        const more = model.loadMore();
        const duplicate = model.loadMore();
        await Promise.resolve();
        assert.equal(fixture.requests.length, 2);
        assert.equal(fixture.requests[1].offset, 'page-two');
        fixture.responses[1].reject(new Error('Retry this page'));
        await Promise.all([more, duplicate]);
        assert.equal(model.getState().offset, 'page-two');
        assert.deepEqual(model.getState().options, [options[0]]);
        assert.equal(model.getState().error, 'Retry this page');
        const retry = model.loadMore();
        await Promise.resolve();
        assert.equal(fixture.requests[2].offset, 'page-two');
        fixture.responses[2].resolve({
            options: [{ value: 'one', label: 'Refreshed first' }, options[1]],
            offset: null,
        });
        await retry;
        assert.deepEqual(
            model.getState().options.map(({ value }) => value),
            ['one', 'two']
        );
        assert.equal(
            model.getState().selectedOptions[0].label,
            'Refreshed first'
        );
        assert.equal(model.getState().error, null);
        await model.loadMore();
        assert.equal(fixture.requests.length, 3);
    });

    it('preserves selected labels across search and handles empty results explicitly', async () => {
        const fixture = loaderFixture();
        const model = createSelectionModel({
            loadOptions: fixture.loadOptions,
            value: ['one'],
            selectedOptions: [options[0]],
        });
        const pending = model.setSearchTerm('empty');
        assert.equal(model.getState().selectedOptions[0].label, 'First choice');
        await Promise.resolve();
        fixture.responses[0].resolve({ options: [], offset: null });
        await pending;
        assert.deepEqual(model.getState().options, []);
        assert.equal(model.getState().loading, false);
        assert.equal(model.getState().error, null);
        assert.equal(model.getState().selectedOptions[0].label, 'First choice');
    });

    it('captures synchronous loader throws and rejected promises as state errors', async () => {
        const model = createSelectionModel({
            loadOptions() {
                throw new Error('Synchronous failure');
            },
        });
        await model.reload();
        assert.equal(model.getState().error, 'Synchronous failure');
        model.reset({
            loadOptions: () => Promise.reject('Rejected failure'),
        });
        await model.reload();
        assert.equal(model.getState().error, 'Rejected failure');
        model.reset({
            loadOptions: () =>
                Promise.reject(new DOMException('Canceled', 'AbortError')),
        });
        await model.reload();
        assert.equal(model.getState().error, null);
        assert.equal(model.getState().loading, false);
    });

    it('cancel aborts pending requests without late snapshots or callbacks', async () => {
        const fixture = loaderFixture();
        let changes = 0;
        let snapshots = 0;
        const model = createSelectionModel({
            loadOptions: fixture.loadOptions,
            onChange: () => changes++,
        });
        model.subscribe(() => snapshots++);
        const pending = model.reload();
        await Promise.resolve();
        model.cancel();
        assert.equal(fixture.requests[0].signal.aborted, true);
        assert.equal(model.getState().loading, false);
        const afterCancel = snapshots;
        fixture.responses[0].resolve({ options, offset: 'stale' });
        await pending;
        assert.equal(snapshots, afterCancel);
        assert.equal(changes, 0);
        assert.deepEqual(model.getState().options, []);
        assert.equal(model.getState().error, null);
    });

    it('reset replaces visitor values, labels, loader and callbacks while retaining subscriptions', async () => {
        const fixture = loaderFixture();
        let oldChanges = 0;
        let newChanges = 0;
        let snapshots = 0;
        const model = createSelectionModel({
            multiple: true,
            options,
            value: ['one'],
            loadOptions: fixture.loadOptions,
            onChange: () => oldChanges++,
        });
        model.subscribe(() => snapshots++);
        const pending = model.reload();
        await Promise.resolve();
        model.reset({
            options: [options[1]],
            value: ['one'],
            onChange: () => newChanges++,
        });
        assert.equal(fixture.requests[0].signal.aborted, true);
        assert.equal(model.getState().multiple, false);
        assert.deepEqual(model.getState().selectedOptions, [
            { value: 'one', label: 'one' },
        ]);
        fixture.responses[0].resolve({ options, offset: 'old-visitor' });
        await pending;
        assert.deepEqual(model.getState().options, [options[1]]);
        await model.reload();
        assert.equal(fixture.requests.length, 1);
        model.choose(['two']);
        assert.equal(newChanges, 1);
        assert.equal(oldChanges, 0);
        assert.ok(snapshots >= 4);
        model.reset({ options });
        model.choose(['one']);
        assert.equal(newChanges, 1);
        assert.deepEqual(model.getState().value, ['one']);
    });

    it('destroy aborts pending work and makes subsequent mutation and subscription inert', async () => {
        const fixture = loaderFixture();
        let snapshots = 0;
        let changes = 0;
        const model = createSelectionModel({
            options,
            value: ['one'],
            loadOptions: fixture.loadOptions,
            onChange: () => changes++,
        });
        model.subscribe(() => snapshots++);
        const pending = model.reload();
        await Promise.resolve();
        model.destroy();
        assert.equal(fixture.requests[0].signal.aborted, true);
        const destroyedState = model.getState();
        const afterDestroy = snapshots;
        fixture.responses[0].reject(new Error('Late failure'));
        await pending;
        model.clear();
        model.setValue(['two']);
        model.setOptions(options);
        model.setDisabled(true);
        model.setReadOnly(true);
        model.reset({ options, value: ['two'] });
        model.subscribe(() => snapshots++);
        await model.setSearchTerm('new');
        await model.reload();
        await model.loadMore();
        assert.deepEqual(model.getState(), destroyedState);
        assert.equal(snapshots, afterDestroy);
        assert.equal(changes, 0);
        assert.equal(fixture.requests.length, 1);
    });
});
it('owned search input retires paging and late results without dispatch until explicit reload', async () => {
    const first = deferred<SelectionPage>();
    const requests: SelectionRequest[] = [];
    const model = createSelectionModel({
        multiple: true,
        value: ['one'],
        selectedOptions: options,
        loadOptions: async (request) => {
            requests.push(request);
            if (requests.length === 1) return await first.promise;
            return { options, offset: 'next' };
        },
    });
    model.setSearchInput('Visitor A query');
    assert.equal(model.getState().searchTerm, 'Visitor A query');
    assert.equal(requests.length, 0);
    const reading = model.reload();
    await Promise.resolve();
    assert.equal(requests.length, 1);
    model.setSearchInput('Replacement query');
    assert.equal(requests[0]!.signal.aborted, true);
    first.resolve({
        options: [{ value: 'private', label: 'Late private result' }],
        offset: 'old-offset',
    });
    await reading;
    assert.equal(model.getState().searchTerm, 'Replacement query');
    assert.deepEqual(model.getState().options, []);
    assert.equal(model.getState().offset, null);
    assert.deepEqual(model.getState().value, ['one']);
    assert.equal(requests.length, 1);
    await model.reload();
    assert.equal(requests[1]!.searchTerm, 'Replacement query');
    assert.equal(requests[1]!.offset, null);
    assert.equal(model.getState().offset, 'next');
    model.setSearchInput('Third query');
    assert.equal(model.getState().offset, null);
    assert.equal(requests.length, 2);
    model.destroy();
    model.setSearchInput('Retained old query');
    assert.notEqual(model.getState().searchTerm, 'Retained old query');
});
