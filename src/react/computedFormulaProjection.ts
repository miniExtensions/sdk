import type { RuntimeLanguage } from '../runtime/types.js';
import type { ComputedFormulaDisplay } from './ComputedField.js';
import type { CompleteReadOnlyTextSize } from './CompleteReadOnlyTextField.js';
import type { ControlledFormulaFieldProps } from './FormulaField.js';
import type { ReadOnlyURLGalleryProps } from './ReadOnlyURLGallery.js';
import { isLookupResultPresentation } from './lookupPresentationValidation.js';

export type ComputedFormulaProjection =
    | { readonly status: 'masked' | 'unavailable' }
    | { readonly status: 'ready'; readonly display: ComputedFormulaDisplay };

/** Host conversion, choice localization and URL/resource admission remain facts.
 * This projection owns only deterministic display configuration and assembly. */
export type ComputedFormulaProjectionInput = {
    readonly masked?: boolean;
    readonly isValid: boolean;
    readonly language: RuntimeLanguage;
    readonly config?: object | null;
    readonly defaultTextSize?: CompleteReadOnlyTextSize;
    readonly resultType: string;
    readonly value: unknown;
    readonly formattedValue: string | null | undefined;
    readonly formattingFailed?: boolean;
    readonly select?: ControlledFormulaFieldProps['select'];
    readonly gallery?: Pick<
        ReadOnlyURLGalleryProps,
        'entries' | 'labels' | 'owner' | 'identity'
    >;
    readonly resource?: ControlledFormulaFieldProps['resource'];
    readonly isInGrid?: boolean;
    readonly buttonLabels?: ControlledFormulaFieldProps['buttonLabels'];
};

/** No formatter, renderer, resource producer, binding, setter or transport port. */
export function projectComputedFormulaDisplay(
    input: ComputedFormulaProjectionInput
): ComputedFormulaProjection {
    try {
        const masked = input.masked;
        if (masked === true) return { status: 'masked' };
        if (masked !== undefined && typeof masked !== 'boolean')
            return { status: 'unavailable' };
        const valid = input.isValid;
        if (typeof valid !== 'boolean') return { status: 'unavailable' };
        if (!valid)
            return {
                status: 'ready',
                display: {
                    mode: 'controlled',
                    isValid: false,
                    language: input.language,
                },
            };
        const config = input.config ?? {};
        if (typeof config !== 'object' || Array.isArray(config))
            return { status: 'unavailable' };
        const flag = (name: string): boolean | undefined => {
            const value: unknown = Reflect.get(config, name);
            if (value === undefined || typeof value === 'boolean') return value;
            throw Error('Malformed computed presentation flag');
        };
        const label = (name: string): string | null | undefined => {
            const value: unknown = Reflect.get(config, name);
            if (value == null || typeof value === 'string') return value;
            throw Error('Malformed computed presentation label');
        };
        const size: unknown =
            Reflect.get(config, 'textSizeForFormulaAsTextField') ??
            input.defaultTextSize ??
            'small';
        if (
            typeof size !== 'string' ||
            !['small', 'medium', 'large', 'very large'].includes(size)
        )
            return { status: 'unavailable' };
        const obscurePassword = flag('obscurePassword');
        if (obscurePassword === true)
            return {
                status: 'ready',
                display: {
                    mode: 'controlled',
                    language: input.language,
                    isValid: true,
                    resultType: 'singleLineText',
                    value: null,
                    formattedValue: null,
                    obscurePassword: true,
                    textSize: size as CompleteReadOnlyTextSize,
                },
            };
        const renderFormulaAsHTML = flag('renderFormulaAsHTML');
        const renderFormulaAsAttachment = flag('renderFormulaAsAttachment');
        const displayAsButton = flag('displayAsButton');
        const height: unknown = Reflect.get(
            config,
            'heightForFormulaFieldHTML'
        );
        if (
            height != null &&
            typeof height !== 'string' &&
            (typeof height !== 'number' || !Number.isFinite(height))
        )
            return { status: 'unavailable' };
        const displayMode: unknown = Reflect.get(config, 'displayMode');
        const thumbnailSize: unknown = Reflect.get(config, 'thumbnailSize');
        const thumbFitType: unknown = Reflect.get(config, 'thumbFitType');
        const gallery = input.gallery;
        const display: ComputedFormulaDisplay = {
            mode: 'controlled',
            isValid: true,
            language: input.language,
            resultType: input.resultType,
            value: input.value,
            formattedValue: input.formattedValue,
            formattingFailed: input.formattingFailed,
            textSize: size as CompleteReadOnlyTextSize,
            renderFormulaAsHTML,
            heightForFormulaFieldHTML: height as
                | number
                | string
                | null
                | undefined,
            renderFormulaAsAttachment,
            displayAsButton,
            validUrlButtonLabel: label('validUrlButtonLabel'),
            invalidUrlButtonLabel: label('invalidUrlButtonLabel'),
            buttonLabels: input.buttonLabels,
            select: input.select,
            resource: input.resource,
            gallery: {
                entries: gallery?.entries ?? [],
                labels: gallery?.labels,
                owner: gallery?.owner,
                identity: gallery?.identity,
                isInGrid: input.isInGrid ?? false,
                displayMode:
                    displayMode === 'icon' || displayMode === 'thumbnail'
                        ? displayMode
                        : undefined,
                thumbnailSize:
                    thumbnailSize === 'small' ||
                    thumbnailSize === 'medium' ||
                    thumbnailSize === 'large'
                        ? thumbnailSize
                        : undefined,
                thumbFitType:
                    thumbFitType === 'contain' || thumbFitType === 'cover'
                        ? thumbFitType
                        : undefined,
                hideAttachmentName: flag('hideAttachmentName'),
                disableOpenFiles: flag('disableOpenFiles') === true,
                disableDownloadFiles: flag('disableDownloadFiles') === true,
            },
        };
        return isLookupResultPresentation({ kind: 'formula', display })
            ? { status: 'ready', display }
            : { status: 'unavailable' };
    } catch {
        return { status: 'unavailable' };
    }
}
