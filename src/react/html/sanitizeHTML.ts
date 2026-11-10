import { getHTMLPurifier } from './htmlPurifier.js';

const formControlTags = [
    'button',
    'datalist',
    'fieldset',
    'form',
    'input',
    'label',
    'legend',
    'optgroup',
    'option',
    'output',
    'select',
    'textarea',
];

/** Native-compatible HTML policy; does not interpret Markdown. */
export const sanitizeHTML = (html: string): string =>
    getHTMLPurifier().sanitize(html, {
        ADD_TAGS: ['iframe'],
        ADD_ATTR: [
            'allow',
            'allowfullscreen',
            'frameborder',
            'loading',
            'referrerpolicy',
            'sandbox',
            'scrolling',
        ],
        FORBID_TAGS: formControlTags,
    });

const meaningfulNonTextTags = /<(?:audio|hr|iframe|img|table|video)\b/i;
const htmlWhitespaceEntities = /&(?:#160|#x0*a0|nbsp);/gi;

export const hasRenderableHTMLContent = (html: string): boolean => {
    const sanitized = sanitizeHTML(html);
    if (meaningfulNonTextTags.test(sanitized)) return true;
    return (
        sanitized
            .replace(/<[^>]*>/g, '')
            .replace(htmlWhitespaceEntities, '')
            .replace(/[\s\u00a0\u200b-\u200d\ufeff]/gu, '').length > 0
    );
};
