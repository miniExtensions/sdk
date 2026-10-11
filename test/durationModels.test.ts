import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
    createDurationFieldModel,
    createNumberFieldModel,
    createCheckboxFieldModel,
} from '../src/ui/index.js';
import type { DurationFieldModelOptions } from '../src/ui/index.js';

type Format = ReturnType<DurationFieldModelOptions['getDurationFormat']>;
type InputCase = {
    id: string;
    durationFormat: Format;
    input: string;
    admission: 'admitted' | 'refused';
    canonicalRawFilter: boolean;
    seconds?: number | null;
    formattedInput?: string;
    formattedNative?: string;
};
type NativeCase = {
    id: string;
    durationFormat: Format;
    secondsText: string;
    formatted: string;
};
const fixture: {
    provenance: {
        revision: string;
        tree: string;
        generator: string;
        generatorSha256: string;
        sources: { path: string; sha256: string }[];
        dependencies: Record<string, string>;
    };
    inputCases: InputCase[];
    nativeCases: NativeCase[];
} = JSON.parse(
    readFileSync('test/fixtures/duration-input-canonical.json', 'utf8')
);
const harness = (durationFormat: Format = 'h:mm:ss', initial: unknown = 7) => {
    let value = initial;
    let current = true;
    let writable = true;
    let format = durationFormat;
    const writes: (number | boolean | null)[] = [];
    const options: DurationFieldModelOptions = {
        getValue: () => value,
        getDurationFormat: () => format,
        isCurrent: () => current,
        canEdit: () => writable,
        write: (next) => {
            writes.push(next);
            value = next;
            return true;
        },
    };
    return {
        options,
        writes,
        get value() {
            return value;
        },
        setValue(next: unknown) {
            value = next;
        },
        setCurrent(next: boolean) {
            current = next;
        },
        setWritable(next: boolean) {
            writable = next;
        },
        setFormat(next: Format) {
            format = next;
        },
    };
};

describe('duration model canonical fixtures', () => {
    it('guards pinned provenance, generator digest and explicit input partitions', () => {
        assert.equal(
            fixture.provenance.revision,
            '58f73d575ab10baa0a10693660d8002f204368e1'
        );
        assert.match(fixture.provenance.tree, /^[a-f0-9]{40}$/);
        assert.equal(
            fixture.provenance.generator,
            'scripts/generate-duration-fixtures.mjs'
        );
        assert.equal(
            createHash('sha256')
                .update(readFileSync(fixture.provenance.generator))
                .digest('hex'),
            fixture.provenance.generatorSha256
        );
        assert.deepEqual(fixture.provenance.dependencies, {
            moment: '2.31.0',
            'moment-duration-format': '2.3.2',
        });
        assert.deepEqual(
            fixture.provenance.sources.map((source) => source.path),
            [
                'types/airtable/DurationField/helpers.ts',
                'types/utils/assertUnreachable.ts',
            ]
        );
        for (const source of fixture.provenance.sources)
            assert.match(source.sha256, /^[a-f0-9]{64}$/);
        assert.deepEqual(
            fixture.provenance.sources.map((source) => source.sha256),
            [
                'a8208bcb379258404969dfa4a10d3b7e51b28a6cade9bebb09b068f846d6469a',
                '4d028fb5576114f3840b4382de3d2a9062e95e6a9b9ffea4114401476f4d70c9',
            ]
        );
        assert.equal(
            createHash('sha256')
                .update(
                    JSON.stringify(
                        [...fixture.inputCases, ...fixture.nativeCases].map(
                            (row) => row.id
                        )
                    )
                )
                .digest('hex'),
            '34beb9074d5779f9b563465f3a0777ecb4d7e9320c886a79682cf6364cb69ac8'
        );
        assert.equal(fixture.inputCases.length, 200);
        assert.equal(fixture.nativeCases.length, 35);
        assert.equal(
            new Set(
                [...fixture.inputCases, ...fixture.nativeCases].map(
                    (row) => row.id
                )
            ).size,
            235
        );
        for (const row of fixture.inputCases) {
            assert(
                row.id.startsWith(`${row.durationFormat}/${row.admission}/`)
            );
            assert.equal(typeof row.canonicalRawFilter, 'boolean');
            for (const key of ['seconds', 'formattedInput', 'formattedNative'])
                assert.equal(
                    Object.hasOwn(row, key),
                    row.admission === 'admitted'
                );
        }
        assert.equal(
            fixture.inputCases.filter((row) => row.admission === 'admitted')
                .length,
            102
        );
        assert.equal(
            fixture.inputCases.filter((row) => row.admission === 'refused')
                .length,
            98
        );
    });
    for (const row of fixture.inputCases) {
        it(row.id, () => {
            const h = harness(row.durationFormat);
            const model = createDurationFieldModel(h.options);
            assert.equal(model.setFocused(true), true);
            assert.equal(
                model.setInput(row.input),
                row.admission === 'admitted'
            );
            assert.equal(model.getState().input, row.input);
            if (row.admission === 'admitted') {
                assert.deepEqual(h.writes, [row.seconds]);
                assert.equal(h.value, row.seconds);
                assert.equal(model.getState().valid, true);
                assert.equal(model.setFocused(false), true);
                assert.equal(model.getState().input, row.formattedNative);
                assert.equal(h.writes.length, 1);
            } else {
                assert.equal(model.getState().valid, false);
                assert.deepEqual(h.writes, []);
                assert.equal(h.value, 7);
                assert.equal(model.setFocused(false), true);
                assert.equal(model.getState().input, row.input);
            }
            model.destroy();
        });
    }
    for (const row of fixture.nativeCases) {
        it(row.id, () => {
            const native = Number(row.secondsText);
            const h = harness(row.durationFormat, native);
            const model = createDurationFieldModel(h.options);
            assert.equal(model.getState().input, row.formatted);
            assert.equal(model.setFocused(true), true);
            assert.equal(model.setFocused(false), true);
            assert.equal(model.getState().input, row.formatted);
            assert(Object.is(h.value, native));
            assert.deepEqual(h.writes, []);
            model.destroy();
        });
    }
});

describe('duration model owner and editing boundaries', () => {
    it('retains partial focused input through external value observation and blur', () => {
        const h = harness();
        const model = createDurationFieldModel(h.options);
        model.setFocused(true);
        model.setInput('1:');
        assert.equal(model.getState().valid, false);
        h.setValue(42);
        assert.equal(model.getState().input, '1:');
        assert.equal(model.getState().valid, false);
        assert.deepEqual(h.writes, []);
        // Blur must not turn unfinished input into a silently accepted answer.
        model.setFocused(false);
        assert.equal(model.getState().input, '1:');
        assert.equal(model.getState().valid, false);
        assert.equal(h.value, 42);
        assert.deepEqual(h.writes, []);
    });
    it('stale refresh tickets cannot erase newer invalid input', () => {
        const h = harness();
        const model = createDurationFieldModel(h.options);
        const ticket = model.getState().revision;
        model.setInput('-');
        model.refresh(ticket);
        assert.equal(model.getState().input, '-');
        assert.equal(model.getState().valid, false);
        model.refresh(model.getState().revision);
        assert.equal(model.getState().input, '0:07');
        assert.deepEqual(h.writes, []);
    });
    it('configuration replacement retires retained actions including observed ABA', () => {
        const h = harness('h:mm');
        const model = createDurationFieldModel(h.options);
        model.getState();
        h.setFormat('h:mm:ss');
        assert.equal(model.getState().retired, true);
        h.setFormat('h:mm');
        assert.equal(model.setInput('8'), false);
        assert.equal(model.setFocused(true), false);
        assert.deepEqual(h.writes, []);
        assert.equal(h.value, 7);
    });
    it('reentrant permission callbacks cannot commit after configuration replacement', () => {
        const h = harness('h:mm');
        const model = createDurationFieldModel(h.options);
        model.getState();
        h.options.canEdit = () => {
            h.setFormat('h:mm:ss');
            return true;
        };
        assert.equal(model.setInput('8'), false);
        assert.equal(model.getState().retired, true);
        assert.deepEqual(h.writes, []);
    });
    for (const action of ['focus', 'blur', 'invalid-input', 'state'] as const) {
        it(`reentrant configuration replacement refuses retained ${action}`, () => {
            const h = harness('h:mm');
            const model = createDurationFieldModel(h.options);
            const before = model.getState();
            assert.equal(before.retired, false);
            assert.equal(before.focused, false);
            if (action === 'blur') assert.equal(model.setFocused(true), true);
            h.options.canEdit = () => {
                h.setFormat('h:mm:ss');
                return true;
            };
            if (action === 'focus') {
                assert.equal(model.setFocused(true), false);
            } else if (action === 'blur') {
                assert.equal(model.setFocused(false), false);
            } else if (action === 'invalid-input') {
                assert.equal(model.setInput('1:'), false);
            } else {
                const state = model.getState();
                assert.equal(state.retired, true);
                assert.equal(state.canEdit, false);
                assert.equal(state.valid, false);
            }
            const after = model.getState();
            assert.equal(after.retired, true);
            assert.equal(after.canEdit, false);
            assert.equal(after.focused, action === 'blur');
            assert.equal(after.input, '');
            assert.equal(h.value, 7);
            assert.deepEqual(h.writes, []);
            h.setFormat('h:mm');
            assert.equal(model.setFocused(true), false);
            assert.equal(model.setInput('8'), false);
            assert.deepEqual(h.writes, []);
        });
    }
    it('reentrant permission callbacks preserve newer invalid edits', () => {
        const h = harness();
        const model = createDurationFieldModel(h.options);
        let nested = false;
        h.options.canEdit = () => {
            if (!nested) {
                nested = true;
                model.setInput('-');
            }
            return true;
        };
        assert.equal(model.setInput('8'), false);
        assert.equal(model.getState().input, '-');
        assert.equal(model.getState().valid, false);
        assert.deepEqual(h.writes, []);
    });
    it('blocked and retired actions preserve native seconds', () => {
        const h = harness();
        const model = createDurationFieldModel(h.options);
        h.setWritable(false);
        assert.equal(model.setInput('8'), false);
        assert.equal(model.setFocused(true), false);
        h.setWritable(true);
        h.setCurrent(false);
        assert.equal(model.setInput('8'), false);
        h.setCurrent(true);
        assert.equal(model.setInput('9'), false);
        assert.deepEqual(h.writes, []);
        assert.equal(h.value, 7);
    });
    it('unsupported external native values remain unwritten', () => {
        for (const native of [
            NaN,
            Infinity,
            -Infinity,
            1e308,
            -1e308,
            '12',
            true,
            {},
            [],
        ]) {
            const h = harness('h:mm:ss', native);
            const model = createDurationFieldModel(h.options);
            assert.equal(model.getState().valid, false);
            model.setFocused(true);
            model.setFocused(false);
            assert(Object.is(h.value, native));
            assert.deepEqual(h.writes, []);
        }
    });
    it('an observer of its own synchronous write preserves raw input and acceptance', () => {
        const h = harness('h:mm:ss.SSS');
        const model = createDurationFieldModel(h.options);
        model.setFocused(true);
        const write = h.options.write;
        let observed: string | undefined;
        h.options.write = (value) => {
            const accepted = write(value);
            observed = model.getState().input;
            return accepted;
        };
        assert.equal(model.setInput('0002.123'), true);
        assert.equal(observed, '0002.123');
        assert.equal(model.getState().input, '0002.123');
        assert.equal(h.value, 2.123);
        assert.deepEqual(h.writes, [2.123]);
        model.setFocused(false);
        assert.equal(model.getState().input, '0:02.123');
        assert.equal(h.value, 2.123);
        assert.deepEqual(h.writes, [2.123]);
    });
    for (const nested of ['1:', '0003.125']) {
        it(`an observer's newer ${nested} input wins the outer synchronous write`, () => {
            const h = harness('h:mm:ss.SSS');
            const model = createDurationFieldModel(h.options);
            model.setFocused(true);
            const write = h.options.write;
            let entered = false;
            h.options.write = (value) => {
                const accepted = write(value);
                model.getState();
                if (!entered) {
                    entered = true;
                    model.setInput(nested);
                }
                return accepted;
            };
            assert.equal(model.setInput('0002.123'), false);
            assert.equal(model.getState().input, nested);
            assert.equal(model.getState().valid, nested !== '1:');
            assert.equal(h.value, nested === '1:' ? 2.123 : 3.125);
            assert.deepEqual(
                h.writes,
                nested === '1:' ? [2.123] : [2.123, 3.125]
            );
            model.setFocused(false);
            assert.equal(
                model.getState().input,
                nested === '1:' ? nested : '0:03.125'
            );
            assert.equal(h.writes.length, nested === '1:' ? 1 : 2);
        });
    }
    it('number notation and checkbox actions retain their existing semantics', () => {
        const number = harness();
        const numeric = createNumberFieldModel(number.options);
        assert.equal(numeric.setInput('+1e2'), true);
        assert.equal(number.value, 100);
        assert.equal(numeric.setInput('.25'), true);
        assert.equal(number.value, 0.25);
        const checkbox = harness('h:mm:ss', null);
        const check = createCheckboxFieldModel(checkbox.options);
        assert.equal(check.setChecked(true), true);
        assert.equal(checkbox.value, true);
        assert.equal(check.setChecked(false), true);
        assert.equal(checkbox.value, false);
        assert.equal(check.setInput('7'), false);
    });
});
