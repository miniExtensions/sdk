import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import {
    createCanonicalFormFrame,
    transitionCanonicalFormFrame,
    normalizeRichTextForComparison,
    type CanonicalFormEvent,
    type CanonicalFormFrame,
    type CanonicalFormTransitionPorts,
    type CanonicalFormValue,
    type CanonicalFormValues,
    type CanonicalFormErrors,
} from '../src/forms/index.js';

type NativeCheckpoint = Omit<CanonicalFormFrame, 'owner'> & {
    ownValueKeys: string[];
    nextFormEditGeneration: number | null;
    selectedRecordFilterExemptRecordIdsByField?: Record<string, string[]>;
};
type Retention =
    | { type: 'stale' }
    | { type: 'current'; newerFieldIds: string[]; uncertainFieldIds: string[] };
type NativeEvent =
    | {
          type: 'edit';
          fieldId: string;
          value: CanonicalFormValue;
          dirty: 'append' | 'preserve';
          expectedOwner?: 'initial' | 'current';
      }
    | { type: 'replaceErrors'; errors: CanonicalFormErrors }
    | { type: 'setLoadedBaseline'; values: CanonicalFormValues }
    | { type: 'setReadOnly'; readOnly: boolean }
    | { type: 'context'; shareId: string }
    | { type: 'reinstall'; values?: CanonicalFormValues; token?: string }
    | {
          type: 'linkedAdd';
          recordId: string;
          dirty?: 'append' | 'preserve';
          newlyCreated?: boolean;
      }
    | { type: 'linkedRemove'; recordId: string; dirty?: 'append' | 'preserve' }
    | { type: 'preserveOpen' | 'forgetAllocator' | 'captureSubmittedRecord' }
    | {
          type: 'settleSave';
          valuesFrom?: 'submitted';
          values?: CanonicalFormValues;
          dirtyFieldIdsToKeep?: string[];
      };
type NativeValidation = {
    boundary: 'real-validator-with-reducer-observed-inputs';
    input: {
        fieldId: string;
        value: CanonicalFormValue;
        previousValues: CanonicalFormValues;
        canonicalValues: CanonicalFormValues;
        evaluatedValues: CanonicalFormValues;
        loadedPolicyBaseline: CanonicalFormValues;
        previousErrors: CanonicalFormErrors;
        previousDirtyFieldIds: string[];
        provenance: CanonicalFormFrame['provenance'];
        manualReadonlyCompute?: CanonicalFormFrame['manualReadonlyCompute'];
        manualReadonlyOrigin?: CanonicalFormFrame['manualReadonlyOrigin'];
    };
    fieldError: string | null;
    resultingErrors: CanonicalFormErrors;
};
type NativeStep = {
    event: NativeEvent;
    checkpoint: NativeCheckpoint;
    validation: NativeValidation | null;
    stateChanged: boolean;
    initialOwnerCurrent: boolean;
    initialRetention: Retention;
    freshRetention: Retention;
    unrelatedPreserved: {
        session: boolean;
        linkedCache: boolean;
        portalRecords: boolean;
    };
};
type NativeScenario = {
    name: string;
    evidenceBoundary:
        | 'native-reducer-and-provenance'
        | 'trusted-settlement-not-request-admission';
    initial: NativeCheckpoint;
    steps: NativeStep[];
};
type NativeCorpus = {
    provenance: {
        revision: string;
        tree: string;
        generator: string;
        generatorSha256: string;
        casesSourceSha256: string;
    };
    fields: {
        id: string;
        name: string;
        type: string;
        readonlyPrefill?: boolean;
    }[];
    scenarios: NativeScenario[];
};

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
    assert.ok(isObject(value));
    return value;
}
function array(value: unknown): unknown[] {
    assert.ok(Array.isArray(value));
    return value;
}
function strings(value: unknown): void {
    for (const item of array(value)) assert.equal(typeof item, 'string');
}
function values(value: unknown): void {
    for (const item of Object.values(object(value))) {
        if (Array.isArray(item)) strings(item);
        else
            assert.ok(
                item === null ||
                    ['string', 'number', 'boolean'].includes(typeof item)
            );
    }
}
function errors(value: unknown): void {
    for (const item of Object.values(object(value)))
        assert.equal(typeof item, 'string');
}
function generation(value: unknown): void {
    assert.ok(
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    );
}
function provenance(value: unknown): void {
    if (value === null) return;
    const p = object(value);
    generation(p.instanceGeneration);
    assert.equal(typeof p.complete, 'boolean');
    if (p.policyGeneration !== undefined) generation(p.policyGeneration);
    if (p.fieldGenerations !== undefined)
        for (const item of Object.values(object(p.fieldGenerations)))
            generation(item);
}
function readonlyMetadata(frame: Record<string, unknown>): void {
    if (frame.manualReadonlyCompute !== undefined) {
        const receipt = object(frame.manualReadonlyCompute);
        assert.equal(typeof receipt.requestId, 'string');
        assert.ok(receipt.phase === 'pending' || receipt.phase === 'settled');
        strings(receipt.candidateFieldIds);
        strings(receipt.settledFieldIds);
    }
    if (frame.manualReadonlyOrigin !== undefined) {
        const origin = object(frame.manualReadonlyOrigin);
        generation(origin.ownerGeneration);
        strings(origin.fieldIds);
        values(origin.values);
    }
    if (frame.manualReadonlyRetiredUrlFieldIds !== undefined)
        strings(frame.manualReadonlyRetiredUrlFieldIds);
}
function checkpoint(value: unknown): void {
    const f = object(value);
    const record = object(f.record);
    assert.ok(record.type === 'create' || record.type === 'edit');
    if (record.type === 'edit') {
        assert.equal(typeof record.recordId, 'string');
        assert.equal(typeof record.tableId, 'string');
    }
    values(f.values);
    values(f.loadedPolicyBaseline);
    strings(f.ownValueKeys);
    strings(f.dirtyFieldIds);
    errors(f.errors);
    assert.equal(typeof f.isFormReadOnly, 'boolean');
    provenance(f.provenance);
    if (f.renderLease !== null) {
        const lease = object(f.renderLease);
        generation(lease.ownerGeneration);
        if (lease.policyGeneration !== undefined)
            generation(lease.policyGeneration);
    }
    if (f.nextFormEditGeneration !== null) generation(f.nextFormEditGeneration);
    readonlyMetadata(f);
}
function retention(value: unknown): void {
    const r = object(value);
    assert.ok(r.type === 'stale' || r.type === 'current');
    if (r.type === 'current') {
        strings(r.newerFieldIds);
        strings(r.uncertainFieldIds);
    }
}
function event(value: unknown): void {
    const e = object(value);
    switch (e.type) {
        case 'edit':
            assert.equal(typeof e.fieldId, 'string');
            values({ value: e.value });
            assert.ok(e.dirty === 'append' || e.dirty === 'preserve');
            assert.ok(
                e.expectedOwner === undefined ||
                    e.expectedOwner === 'initial' ||
                    e.expectedOwner === 'current'
            );
            break;
        case 'replaceErrors':
            errors(e.errors);
            break;
        case 'setLoadedBaseline':
            values(e.values);
            break;
        case 'setReadOnly':
            assert.equal(typeof e.readOnly, 'boolean');
            break;
        case 'context':
            assert.equal(typeof e.shareId, 'string');
            break;
        case 'reinstall':
            if (e.values !== undefined) values(e.values);
            if (e.token !== undefined) assert.equal(typeof e.token, 'string');
            break;
        case 'linkedAdd':
        case 'linkedRemove':
            assert.equal(typeof e.recordId, 'string');
            assert.ok(
                e.dirty === undefined ||
                    e.dirty === 'append' ||
                    e.dirty === 'preserve'
            );
            break;
        case 'settleSave':
            assert.ok(e.valuesFrom === 'submitted' || e.values !== undefined);
            if (e.values !== undefined) values(e.values);
            if (e.dirtyFieldIdsToKeep !== undefined)
                strings(e.dirtyFieldIdsToKeep);
            break;
        case 'preserveOpen':
        case 'forgetAllocator':
        case 'captureSubmittedRecord':
            break;
        default:
            assert.fail('Unknown native Form corpus event');
    }
}
function assertCorpus(value: unknown): asserts value is NativeCorpus {
    const corpus = object(value);
    const p = object(corpus.provenance);
    for (const key of [
        'revision',
        'tree',
        'generator',
        'generatorSha256',
        'casesSourceSha256',
    ])
        assert.equal(typeof p[key], 'string');
    for (const field of array(corpus.fields)) {
        const f = object(field);
        for (const key of ['id', 'name', 'type'])
            assert.equal(typeof f[key], 'string');
        if (f.readonlyPrefill !== undefined)
            assert.equal(typeof f.readonlyPrefill, 'boolean');
    }
    assert.ok(array(corpus.scenarios).length > 0);
    for (const scenario of array(corpus.scenarios)) {
        const s = object(scenario);
        assert.equal(typeof s.name, 'string');
        assert.ok(
            s.evidenceBoundary === 'native-reducer-and-provenance' ||
                s.evidenceBoundary ===
                    'trusted-settlement-not-request-admission'
        );
        checkpoint(s.initial);
        assert.ok(array(s.steps).length > 0);
        for (const step of array(s.steps)) {
            const t = object(step);
            event(t.event);
            checkpoint(t.checkpoint);
            assert.equal(typeof t.stateChanged, 'boolean');
            assert.equal(typeof t.initialOwnerCurrent, 'boolean');
            retention(t.initialRetention);
            retention(t.freshRetention);
            for (const flag of ['session', 'linkedCache', 'portalRecords'])
                assert.equal(
                    typeof object(t.unrelatedPreserved)[flag],
                    'boolean'
                );
            if (t.validation !== null) {
                const v = object(t.validation);
                assert.equal(
                    v.boundary,
                    'real-validator-with-reducer-observed-inputs'
                );
                const input = object(v.input);
                assert.equal(typeof input.fieldId, 'string');
                values({ value: input.value });
                for (const key of [
                    'previousValues',
                    'canonicalValues',
                    'evaluatedValues',
                    'loadedPolicyBaseline',
                ])
                    values(input[key]);
                errors(input.previousErrors);
                strings(input.previousDirtyFieldIds);
                provenance(input.provenance);
                readonlyMetadata(input);
                assert.ok(
                    v.fieldError === null || typeof v.fieldError === 'string'
                );
                errors(v.resultingErrors);
            }
        }
    }
}

const raw: unknown = JSON.parse(
    readFileSync('test/fixtures/canonicalForms.json', 'utf8')
);
assertCorpus(raw);
const corpus = raw;
const fieldDefinitions = new Map(
    corpus.fields.map((field) => [field.id, field])
);
const hash = (path: string) => {
    const bytes = readFileSync(path);
    const canonical = Buffer.from(
        bytes.toString('utf8').replaceAll('\r\n', '\n')
    );
    assert.equal(canonical.includes(13), false);
    assert.ok(
        bytes.equals(canonical) ||
            bytes.equals(
                Buffer.from(canonical.toString('utf8').replaceAll('\n', '\r\n'))
            )
    );
    return createHash('sha256').update(canonical).digest('hex');
};

// Compare only the SDK-owned frame. Native linked-filter exemptions and the
// global allocator remain host state, with their observed effects kept separate.
function canonicalView(frame: Omit<CanonicalFormFrame, 'owner'>) {
    return {
        record: frame.record,
        values: frame.values,
        dirtyFieldIds: frame.dirtyFieldIds,
        errors: frame.errors,
        loadedPolicyBaseline: frame.loadedPolicyBaseline,
        isFormReadOnly: frame.isFormReadOnly,
        provenance: frame.provenance,
        renderLease: frame.renderLease,
        ...(frame.manualReadonlyCompute === undefined
            ? {}
            : { manualReadonlyCompute: frame.manualReadonlyCompute }),
        ...(frame.manualReadonlyOrigin === undefined
            ? {}
            : { manualReadonlyOrigin: frame.manualReadonlyOrigin }),
        ...(frame.manualReadonlyRetiredUrlFieldIds === undefined
            ? {}
            : {
                  manualReadonlyRetiredUrlFieldIds:
                      frame.manualReadonlyRetiredUrlFieldIds,
              }),
    };
}

function assertNativeRetention(
    actual: CanonicalFormFrame,
    initial: NativeCheckpoint,
    step: NativeStep
): void {
    // These are comparisons with native-observed consequences of history, not
    // a substitute implementation of native request/response admission.
    const current = actual.provenance;
    if (step.initialRetention.type === 'stale') {
        assert.notEqual(
            current?.instanceGeneration,
            initial.provenance?.instanceGeneration
        );
    } else {
        assert.equal(
            current?.instanceGeneration,
            initial.provenance?.instanceGeneration
        );
        assert.equal(current?.complete, true);
        assert.deepEqual(step.initialRetention.uncertainFieldIds, []);
        const newer = corpus.fields
            .filter(
                ({ id }) =>
                    (current?.fieldGenerations?.[id] ?? 0) >
                    (initial.provenance?.fieldGenerations?.[id] ?? 0)
            )
            .map(({ id }) => id);
        assert.deepEqual(newer, step.initialRetention.newerFieldIds);
    }
    assert.deepEqual(step.freshRetention, {
        type: 'current',
        newerFieldIds: [],
        uncertainFieldIds: [],
    });
    const originalLease = initial.renderLease;
    assert.equal(
        actual.renderLease !== null &&
            originalLease !== null &&
            actual.renderLease.ownerGeneration ===
                originalLease.ownerGeneration &&
            actual.renderLease.policyGeneration ===
                originalLease.policyGeneration &&
            actual.isFormReadOnly === initial.isFormReadOnly,
        step.initialOwnerCurrent
    );
}

describe('canonical Form parity with executed native transitions', () => {
    it('binds observations to the pinned native source and maintained generator inputs', () => {
        assert.equal(
            corpus.provenance.revision,
            'e492cd6db39cc2ad21754d4614ade9f4fa235d3d'
        );
        assert.equal(
            corpus.provenance.tree,
            'c05d6fafeaecdd1e65a28c6c5fc8a72e0be9baed'
        );
        assert.equal(
            corpus.provenance.generator,
            'scripts/generate-canonical-form-fixtures.mjs'
        );
        assert.equal(
            corpus.provenance.generatorSha256,
            hash(corpus.provenance.generator)
        );
        assert.equal(
            corpus.provenance.casesSourceSha256,
            hash('test/fixtures/canonicalFormCases.mjs')
        );
        assert.equal(
            new Set(corpus.scenarios.map((scenario) => scenario.name)).size,
            corpus.scenarios.length
        );
    });

    for (const scenario of corpus.scenarios) {
        it(scenario.name, () => {
            let installation = 0;
            let frame = createCanonicalFormFrame({
                ...canonicalView(scenario.initial),
                owner: {
                    cohort: 'public-direct-root-non-compute',
                    installation: `${scenario.name}:0`,
                },
            });
            let initialOwnerCurrent = true;
            let submitted: CanonicalFormValues | undefined;

            for (const [index, step] of scenario.steps.entries()) {
                const input = step.event;
                const before = frame;
                const immutableBefore = structuredClone(canonicalView(before));
                const calls: string[] = [];
                const authority = Symbol('observed-native-action');
                const admitted = new Set<symbol>();
                // This port replays the actual native guarded-editor result.
                // A constructor, matching-looking frame or receipt grants none.
                if (
                    input.type !== 'edit' ||
                    input.expectedOwner !== 'initial' ||
                    initialOwnerCurrent
                )
                    admitted.add(authority);
                const allocation = Symbol(
                    'trusted-settlement-only-not-a-request-receipt'
                );
                const generations: {
                    operation: 'instance' | 'policy' | 'field';
                    value: number | null;
                }[] = [];
                if (step.validation !== null)
                    generations.push({
                        operation: 'field',
                        value:
                            step.checkpoint.provenance?.fieldGenerations?.[
                                step.validation.input.fieldId
                            ] ?? null,
                    });
                else if (
                    input.type === 'setReadOnly' &&
                    input.readOnly !== before.isFormReadOnly
                )
                    generations.push({
                        operation: 'policy',
                        value:
                            step.checkpoint.provenance?.policyGeneration ??
                            null,
                    });
                else if (
                    input.type === 'context' ||
                    input.type === 'reinstall' ||
                    input.type === 'settleSave'
                )
                    generations.push({
                        operation: 'instance',
                        value:
                            step.checkpoint.provenance?.instanceGeneration ??
                            null,
                    });

                const ports: CanonicalFormTransitionPorts<symbol, symbol> = {
                    admit: (original, e) => {
                        calls.push('admit');
                        assert.equal(original, before);
                        return admitted.has(e.authority);
                    },
                    isReadonlyUrlPrefill: (original, fieldId) => {
                        calls.push('readonly');
                        assert.equal(original, before);
                        return (
                            fieldDefinitions.get(fieldId)?.readonlyPrefill ===
                            true
                        );
                    },
                    areValuesEquivalent: (
                        fieldId,
                        previous,
                        value,
                        retired
                    ) => {
                        calls.push('equal');
                        assert.deepEqual(previous, before.values[fieldId]);
                        assert.deepEqual(retired.values, before.values);
                        assert.equal(retired.errors, before.errors);
                        assert.equal(retired.provenance, before.provenance);
                        assert.equal(
                            retired.dirtyFieldIds,
                            before.dirtyFieldIds
                        );
                        assert.equal(
                            retired.loadedPolicyBaseline,
                            before.loadedPolicyBaseline
                        );
                        assert.equal(retired.manualReadonlyCompute, undefined);
                        if (
                            before.manualReadonlyOrigin?.fieldIds.includes(
                                fieldId
                            )
                        )
                            assert.equal(
                                retired.manualReadonlyOrigin,
                                undefined
                            );
                        if (fieldDefinitions.get(fieldId)?.readonlyPrefill)
                            assert.equal(
                                retired.manualReadonlyRetiredUrlFieldIds?.filter(
                                    (id) => id === fieldId
                                ).length,
                                1
                            );
                        if (
                            fieldDefinitions.get(fieldId)?.type === 'richText'
                        ) {
                            assert.ok(
                                previous === undefined ||
                                    previous === null ||
                                    typeof previous === 'string'
                            );
                            assert.ok(
                                value === null || typeof value === 'string'
                            );
                            return (
                                normalizeRichTextForComparison(previous) ===
                                normalizeRichTextForComparison(value)
                            );
                        }
                        return isDeepStrictEqual(previous, value);
                    },
                    allocateGeneration: (operation) => {
                        calls.push(`allocate:${operation}`);
                        const observed = generations.shift();
                        assert.ok(
                            observed,
                            'No native generation was allocated for this transition'
                        );
                        assert.equal(operation, observed.operation);
                        assert.equal(
                            observed.value,
                            step.checkpoint.nextFormEditGeneration
                        );
                        return observed.value;
                    },
                    validateEdit: (previous, next, fieldId, value) => {
                        calls.push('validate');
                        const observation = step.validation;
                        assert.ok(
                            observation,
                            'Native did not validate an equal or refused write'
                        );
                        assert.equal(previous, before);
                        assert.equal(fieldId, observation.input.fieldId);
                        assert.deepEqual(value, observation.input.value);
                        assert.deepEqual(
                            previous.values,
                            observation.input.previousValues
                        );
                        assert.deepEqual(
                            next.values,
                            observation.input.canonicalValues
                        );
                        assert.deepEqual(
                            next.loadedPolicyBaseline,
                            observation.input.loadedPolicyBaseline
                        );
                        assert.deepEqual(
                            next.errors,
                            observation.input.previousErrors
                        );
                        assert.deepEqual(
                            next.dirtyFieldIds,
                            observation.input.previousDirtyFieldIds
                        );
                        assert.deepEqual(
                            next.provenance,
                            observation.input.provenance
                        );
                        assert.deepEqual(
                            next.manualReadonlyCompute,
                            observation.input.manualReadonlyCompute
                        );
                        assert.deepEqual(
                            next.manualReadonlyOrigin,
                            observation.input.manualReadonlyOrigin
                        );
                        assert.ok(
                            calls.indexOf('equal') <
                                calls.findIndex(
                                    (call) => call === 'allocate:field'
                                )
                        );
                        assert.ok(
                            calls.indexOf('allocate:field') <
                                calls.indexOf('validate')
                        );
                        // Native projection is separately recorded. These
                        // fixtures contain no lookup/conditional transformation.
                        assert.deepEqual(
                            observation.input.evaluatedValues,
                            next.values
                        );
                        assert.equal(
                            observation.resultingErrors[fieldId] ?? null,
                            observation.fieldError
                        );
                        return isDeepStrictEqual(
                            next.errors,
                            observation.resultingErrors
                        )
                            ? next.errors
                            : observation.resultingErrors;
                    },
                    retainRenderLease: (_current, e) => {
                        calls.push('retain');
                        assert.equal(
                            scenario.evidenceBoundary,
                            'trusted-settlement-not-request-admission'
                        );
                        assert.equal(e.allocation, allocation);
                        // These real native actions deliberately omit an
                        // allocated render owner. No request admission is tested.
                        return false;
                    },
                };

                let sdkEvent: CanonicalFormEvent<symbol, symbol> | null = null;
                switch (input.type) {
                    case 'edit':
                        sdkEvent = { ...input, authority };
                        break;
                    case 'replaceErrors':
                        sdkEvent = { ...input, authority };
                        break;
                    case 'setLoadedBaseline':
                        sdkEvent = { ...input, authority };
                        break;
                    case 'setReadOnly':
                        sdkEvent = { ...input, authority };
                        break;
                    case 'preserveOpen':
                        sdkEvent = { type: 'preserve', authority };
                        break;
                    case 'captureSubmittedRecord':
                        submitted = structuredClone(frame.values);
                        break;
                    case 'forgetAllocator':
                        // Host allocator metadata is not part of the SDK frame.
                        break;
                    case 'linkedAdd':
                    case 'linkedRemove':
                        // Replay the real native producer's canonical write,
                        // not a duplicate implementation of linked membership.
                        if (step.validation !== null)
                            sdkEvent = {
                                type: 'edit',
                                authority,
                                fieldId: 'fld_links',
                                value: step.validation.input.value,
                                dirty: input.dirty ?? 'append',
                            };
                        break;
                    case 'context':
                        sdkEvent = { type: 'replaceEditInstance', authority };
                        break;
                    case 'reinstall': {
                        const loadedValues = input.values ?? before.values;
                        sdkEvent = {
                            type: 'install',
                            authority,
                            frame: {
                                ...before,
                                owner: {
                                    cohort: 'public-direct-root-non-compute',
                                    installation: `${scenario.name}:${++installation}`,
                                },
                                record: { type: 'create' },
                                values: loadedValues,
                                dirtyFieldIds: [],
                                errors: {},
                                loadedPolicyBaseline: loadedValues,
                                isFormReadOnly: false,
                                provenance: null,
                                renderLease: null,
                            },
                        };
                        break;
                    }
                    case 'settleSave': {
                        assert.equal(
                            scenario.evidenceBoundary,
                            'trusted-settlement-not-request-admission'
                        );
                        const returned = step.checkpoint.record;
                        assert.ok(returned.type === 'edit');
                        const savedValues =
                            input.valuesFrom === 'submitted'
                                ? submitted
                                : input.values;
                        assert.ok(savedValues);
                        sdkEvent = {
                            type: 'settleSave',
                            authority,
                            allocation,
                            record: returned,
                            values: savedValues,
                            dirtyFieldIdsToKeep:
                                input.dirtyFieldIdsToKeep ?? [],
                        };
                        break;
                    }
                }
                if (sdkEvent !== null) {
                    const result = transitionCanonicalFormFrame(
                        frame,
                        sdkEvent,
                        ports
                    );
                    assert.ok(result.frame);
                    frame = result.frame;
                    if (!admitted.has(authority)) {
                        assert.equal(result.disposition, 'stale');
                        assert.equal(frame, before);
                        assert.deepEqual(calls, ['admit']);
                    } else {
                        const expectedDisposition = (() => {
                            switch (sdkEvent.type) {
                                case 'edit':
                                    return step.validation === null
                                        ? 'unchanged'
                                        : 'edited';
                                case 'replaceErrors':
                                    return 'errorsReplaced';
                                case 'setLoadedBaseline':
                                    return 'baselineReplaced';
                                case 'setReadOnly':
                                    return sdkEvent.readOnly ===
                                        before.isFormReadOnly
                                        ? 'unchanged'
                                        : 'policyChanged';
                                case 'preserve':
                                    return 'preserved';
                                case 'replaceEditInstance':
                                    return 'editInstanceReplaced';
                                case 'install':
                                    return 'installed';
                                case 'settleSave':
                                    return 'saveSettled';
                                default:
                                    throw new Error(
                                        'Native replay must qualify the exact event disposition'
                                    );
                            }
                        })();
                        assert.equal(result.disposition, expectedDisposition);
                        assert.equal(calls.at(-1), 'admit');
                        assert.ok(
                            calls.filter((call) => call === 'admit').length >= 2
                        );
                    }
                    assert.equal(
                        frame !== before,
                        step.stateChanged,
                        `${scenario.name} step ${index} canonical publication`
                    );
                } else {
                    assert.deepEqual(calls, []);
                    assert.equal(frame, before);
                }
                assert.equal(
                    generations.length,
                    0,
                    'Consume every real native generation allocation'
                );
                assert.equal(
                    calls.filter((call) => call === 'validate').length,
                    step.validation === null ? 0 : 1
                );
                assert.deepEqual(
                    canonicalView(before),
                    immutableBefore,
                    'No prior canonical snapshot may mutate'
                );
                assert.deepEqual(
                    canonicalView(frame),
                    canonicalView(step.checkpoint),
                    `${scenario.name} step ${index}`
                );
                assert.deepEqual(
                    Object.keys(frame.values),
                    step.checkpoint.ownValueKeys
                );
                assertNativeRetention(frame, scenario.initial, step);
                assert.deepEqual(step.unrelatedPreserved, {
                    session: true,
                    linkedCache: true,
                    portalRecords: true,
                });
                initialOwnerCurrent = step.initialOwnerCurrent;
            }
        });
    }
});
