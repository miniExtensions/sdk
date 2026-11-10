import { createElement, type MouseEvent, type ReactElement } from 'react';
import { Options as LinkifyOptions, tokenize } from 'linkifyjs';
import type { RuntimeLanguage } from '../runtime/types.js';
import { LiteralText } from './LiteralText.js';

export type CompleteReadOnlyTextLanguage = RuntimeLanguage;

export type CompleteReadOnlyTextSize =
    | 'small'
    | 'medium'
    | 'large'
    | 'very large';

export type CompleteReadOnlyTextLayout =
    | 'default'
    | 'linked-list'
    | 'cell-short'
    | 'cell-medium'
    | 'cell-tall'
    | 'cell-extra-tall'
    | 'cell-fit-content';

export type CompleteReadOnlyTextFieldProps = {
    /** Already converted and masked text; native access and value policy stay outside. */
    value: string | null | undefined;
    language: CompleteReadOnlyTextLanguage;
    /** Omitted size inherits the surrounding presentation. */
    textSize?: CompleteReadOnlyTextSize;
    /** Portable layout; omitted layout retains native ancestor compatibility hooks. */
    layout?: CompleteReadOnlyTextLayout;
    className?: string;
};

const emptyLabels: Record<CompleteReadOnlyTextLanguage, string> = {
    en: 'No Value',
    es: 'Sin Valor',
    fr: 'Pas de Valeur',
    vi: 'Không có Giá trị',
    nl: 'Geen Waarde',
    de: 'Keine Wert',
    ja: 'いいえ値',
    ko: '아니요 값',
    pt: 'Sem Valor',
    cs: 'Žádná hodnota',
    he: 'אין ערך',
    it: 'Nessun Valore',
    ka: 'არცერთი მნიშვნელობა',
    'zh-Hans': '没有值',
    ca: 'Sense Valor',
};

function EmptyValue({
    language,
    className,
}: {
    language: CompleteReadOnlyTextLanguage;
    className?: string;
}) {
    const label = emptyLabels[language];
    if (label === undefined) throw new Error(`Unexpected: ${String(language)}`);
    return createElement(
        'p',
        {
            className: ['mx-sdk-readonly-text-empty', className]
                .filter(Boolean)
                .join(' '),
            'data-testid': 'no-value-test-id',
        },
        createElement(
            'svg',
            {
                className: 'mx-sdk-readonly-text-empty-icon',
                xmlns: 'http://www.w3.org/2000/svg',
                viewBox: '0 0 24 24',
                fill: 'currentColor',
                'aria-hidden': true,
                'data-slot': 'icon',
            },
            createElement('path', {
                fillRule: 'evenodd',
                clipRule: 'evenodd',
                d: 'm6.72 5.66 11.62 11.62A8.25 8.25 0 0 0 6.72 5.66Zm10.56 12.68L5.66 6.72a8.25 8.25 0 0 0 11.62 11.62ZM5.105 5.106c3.807-3.808 9.98-3.808 13.788 0 3.808 3.807 3.808 9.98 0 13.788-3.807 3.808-9.98 3.808-13.788 0-3.808-3.807-3.808-9.98 0-13.788Z',
            })
        ),
        label
    );
}

const identity = (text: string) => text;
const sizeClasses: Record<CompleteReadOnlyTextSize, string> = {
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    'very large': 'text-xl',
};

/** Complete native-compatible literal/link presentation, with no state or I/O. */
export function CompleteReadOnlyTextField({
    value,
    language,
    textSize,
    layout,
    className,
}: CompleteReadOnlyTextFieldProps): ReactElement {
    const layoutAttributes =
        layout === undefined ? {} : { 'data-layout': layout };
    return createElement(LiteralText, {
        ...layoutAttributes,
        value,
        as: 'div',
        className: ['relative', 'mx-sdk-complete-readonly-text', className]
            .filter(Boolean)
            .join(' '),
        preserveWhitespace: false,
        empty: createElement(EmptyValue, { language, className }),
        renderText: (text) => {
            // Component-local baseline options, with no shared-default mutation
            // or required transitive React peer for headless SDK consumers.
            const options = new LinkifyOptions({
                attributes: null,
                className: null,
                defaultProtocol: 'http',
                format: identity,
                formatHref: identity,
                nl2br: false,
                rel: null,
                target: '_blank',
                tagName: 'a',
                truncate: 0,
                validate: true,
            });
            return createElement(
                'p',
                {
                    className: [
                        'linkify',
                        'read-only-text',
                        textSize && sizeClasses[textSize],
                    ]
                        .filter(Boolean)
                        .join(' '),
                },
                tokenize(text).map((token, index) => {
                    if (!token.isLink || !options.check(token))
                        return token.toString();
                    const link = options.resolve(token);
                    return createElement(
                        'a',
                        {
                            key: index,
                            href: link.formattedHref,
                            target: link.target || undefined,
                            rel: link.rel || undefined,
                            onClick: (event: MouseEvent<HTMLAnchorElement>) =>
                                event.stopPropagation(),
                        },
                        link.formatted
                    );
                })
            );
        },
    });
}
