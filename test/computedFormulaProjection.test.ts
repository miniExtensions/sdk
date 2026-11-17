import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    projectComputedFormulaDisplay,
    type ComputedFormulaProjectionInput,
} from '../src/react/computedFormulaProjection.js';

const input = (
    overrides: Partial<ComputedFormulaProjectionInput> = {}
): ComputedFormulaProjectionInput => ({
    isValid: true,
    language: 'en',
    resultType: 'number',
    value: 0,
    formattedValue: '0.00',
    ...overrides,
});
const forbidden = () => {
    throw Error('Concealed or invalid fact read');
};

it('conceals before metadata, config, formatter facts and resource authority', () => {
    const facts = Object.defineProperties(
        { masked: true },
        Object.fromEntries(
            [
                'isValid',
                'language',
                'config',
                'value',
                'formattedValue',
                'select',
                'gallery',
                'resource',
            ].map((key) => [key, { get: forbidden }])
        )
    );
    assert.deepEqual(
        projectComputedFormulaDisplay(facts as ComputedFormulaProjectionInput),
        { status: 'masked' }
    );
});

it('invalid metadata never reads result, configuration or formatting facts', () => {
    const facts = Object.defineProperties(
        { isValid: false, language: 'en' },
        Object.fromEntries(
            [
                'config',
                'resultType',
                'value',
                'formattedValue',
                'select',
                'gallery',
                'resource',
            ].map((key) => [key, { get: forbidden }])
        )
    );
    assert.deepEqual(
        projectComputedFormulaDisplay(facts as ComputedFormulaProjectionInput),
        {
            status: 'ready',
            display: { mode: 'controlled', isValid: false, language: 'en' },
        }
    );
});

it('password policy projects configured text without evaluating rich or conversion facts', () => {
    const facts = Object.defineProperties(
        {
            isValid: true,
            language: 'en',
            config: {
                obscurePassword: true,
                textSizeForFormulaAsTextField: 'large',
            },
        },
        Object.fromEntries(
            [
                'resultType',
                'value',
                'formattedValue',
                'select',
                'gallery',
                'resource',
                'buttonLabels',
            ].map((key) => [key, { get: forbidden }])
        )
    );
    const result = projectComputedFormulaDisplay(
        facts as ComputedFormulaProjectionInput
    );
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready' || !result.display.isValid)
        throw Error('Expected masked display');
    assert.equal(result.display.obscurePassword, true);
    assert.equal(result.display.textSize, 'large');
    assert.equal(result.display.value, null);
});

it('preserves formatted text, literal false/zero and host admitted rich references without mutation', () => {
    const select = Object.freeze({
        choices: Object.freeze([{ id: 'ready', name: 'Ready' }]),
    });
    const owner = Object.freeze({ token: {}, isCurrent: () => true });
    const resource = Object.freeze({ owner, identity: {} });
    const entries = Object.freeze([
        { url: 'https://computed.example.invalid/image.png' },
    ]);
    const config = Object.freeze({
        renderFormulaAsHTML: true,
        renderFormulaAsAttachment: true,
        displayAsButton: true,
    });
    const result = projectComputedFormulaDisplay(
        input({
            value: false,
            formattedValue: 'false, 0',
            config,
            select,
            gallery: { entries, owner, identity: resource.identity },
            resource,
        })
    );
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready' || !result.display.isValid)
        throw Error('Expected valid display');
    assert.equal(result.display.value, false);
    assert.equal(result.display.formattedValue, 'false, 0');
    assert.equal(result.display.select, select);
    assert.equal(result.display.resource, resource);
    assert.equal(result.display.gallery?.entries, entries);
    assert.equal(result.display.gallery?.owner, owner);
    assert.equal(result.display.renderFormulaAsHTML, true);
    assert.equal(result.display.renderFormulaAsAttachment, true);
    assert.equal(result.display.displayAsButton, true);
    assert.equal(result.display.textSize, 'small');
    assert.equal(Object.hasOwn(config, 'readOnly'), false);
});

it('maps legacy gallery options with defaults while preserving explicit no-effect controls', () => {
    const result = projectComputedFormulaDisplay(
        input({
            config: {
                displayMode: 'icon',
                thumbnailSize: 'large',
                thumbFitType: 'contain',
                hideAttachmentName: false,
                disableOpenFiles: true,
                disableDownloadFiles: true,
                heightForFormulaFieldHTML: '12rem',
                textSizeForFormulaAsTextField: 'very large',
            },
        })
    );
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') throw Error('Expected configured display');
    assert.deepEqual(result.display.gallery, {
        entries: [],
        labels: undefined,
        owner: undefined,
        identity: undefined,
        isInGrid: false,
        displayMode: 'icon',
        thumbnailSize: 'large',
        thumbFitType: 'contain',
        hideAttachmentName: false,
        disableOpenFiles: true,
        disableDownloadFiles: true,
    });
    assert.equal(result.display.heightForFormulaFieldHTML, '12rem');
    assert.equal(result.display.textSize, 'very large');
});

it('rejects malformed config flags, text sizes, height and labels before rendering', () => {
    for (const config of [
        { renderFormulaAsHTML: 'true' },
        { disableOpenFiles: 1 },
        { textSizeForFormulaAsTextField: { toString: forbidden } },
        { heightForFormulaFieldHTML: NaN },
        { validUrlButtonLabel: [] },
    ])
        assert.deepEqual(projectComputedFormulaDisplay(input({ config })), {
            status: 'unavailable',
        });
});

it('keeps failed formatting as a fact instead of preempting existing rich-mode precedence', () => {
    const result = projectComputedFormulaDisplay(
        input({
            resultType: 'singleLineText',
            value: '<strong>Native</strong>',
            formattedValue: null,
            formattingFailed: true,
            config: { renderFormulaAsHTML: true },
        })
    );
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready' || !result.display.isValid)
        throw Error('Expected valid metadata');
    assert.equal(result.display.formattingFailed, true);
    assert.equal(result.display.renderFormulaAsHTML, true);
});

it('does not infer resource or Button action authority from values or configuration', () => {
    const result = projectComputedFormulaDisplay(
        input({
            resultType: 'singleLineText',
            value: 'https://example.invalid',
            config: { displayAsButton: true, renderFormulaAsAttachment: true },
        })
    );
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') throw Error('Expected display facts');
    assert.equal(result.display.resource, undefined);
    assert.equal(result.display.gallery?.owner, undefined);
    assert.deepEqual(result.display.gallery?.entries, []);
});
