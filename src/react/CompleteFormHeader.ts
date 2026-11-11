import { createElement as h, useEffect, useRef, type ReactNode } from 'react';
import {
    shouldRenderFormCover,
    projectFormHeader,
    resolveFormFooterDescription,
    type FormDisplaySource,
    type FormPresentationIdentity,
} from '../forms/header.js';
import type { RuntimeLanguage } from '../runtime/types.js';
import {
    CompleteQuillHTMLRenderer,
    CompleteTruncatedDescription,
} from './html/index.js';

export type FormHeaderSettingsTarget =
    | 'logo'
    | 'title'
    | 'description'
    | 'footer'
    | 'cover';
/** Explicit authoring capability; public consumers omit it. */
export type FormHeaderPreview = {
    showPlaceholders: boolean;
    showFieldSources: boolean;
    onOpenSettings?: (target: FormHeaderSettingsTarget) => void;
    isCurrent?: () => boolean;
};
export type FormHeaderLabels = {
    addLogo: string;
    title: string;
    addDescription: string;
    addFooter: string;
    addCover: string;
    logoSource: string;
    titleSource: string;
    descriptionSource: string;
    footerSource: string;
    readMore: string;
    showLess: string;
};
const disclosureLabels: Record<RuntimeLanguage, [string, string]> = {
    en: ['Read more', 'Show less'],
    es: ['Leer más', 'Mostrar menos'],
    fr: ['Lire la suite', 'Afficher moins'],
    vi: ['Đọc thêm', 'Hiển thị ít hơn'],
    nl: ['Lees meer', 'Minder weergeven'],
    de: ['Mehr lesen', 'Weniger anzeigen'],
    ja: ['続きを読む', 'もっと少なく表示'],
    ko: ['더 읽기', '덜 보이기'],
    pt: ['Leia mais', '덜 보이기'],
    cs: ['Číst více', 'Zobrazit méně'],
    he: ['קרא עוד', 'הצג פחות'],
    it: ['Leggi di più', 'Mostra meno'],
    ka: ['მეტის წაკითხვა', 'ნაკლები ჩვენება'],
    'zh-Hans': ['阅读更多', '显示较少'],
    ca: ['Llegeix més', 'Mostra menys'],
};
export function formHeaderLabels(
    language: RuntimeLanguage = 'en'
): FormHeaderLabels {
    const [readMore, showLess] = disclosureLabels[language];
    return {
        addLogo: 'Add logo',
        title: 'Form title',
        addDescription: 'Add form description',
        addFooter: 'Add footer',
        addCover: 'Add cover image',
        logoSource: 'Logo from Airtable',
        titleSource: 'Title from Airtable',
        descriptionSource: 'Description from Airtable',
        footerSource: 'Footer from Airtable',
        readMore,
        showLess,
    };
}

type PresentationProps = {
    identity: FormPresentationIdentity;
    preview?: FormHeaderPreview;
    labels?: Partial<FormHeaderLabels>;
    className?: string;
};
function useSettingsCommand(props: PresentationProps) {
    const current = useRef(props);
    current.current = props;
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    // Each rendered capability belongs to this accepted owner/config/record.
    const identity = props.identity;
    const preview = props.preview;
    return (target: FormHeaderSettingsTarget) => {
        const latest = current.current;
        if (
            !mounted.current ||
            preview == null ||
            latest.preview !== preview ||
            latest.identity.owner !== identity.owner ||
            latest.identity.configuration !== identity.configuration ||
            latest.identity.record !== identity.record ||
            !preview.showPlaceholders ||
            preview.isCurrent?.() === false
        )
            return;
        preview.onOpenSettings?.(target);
    };
}
function fieldName(source: FormDisplaySource): string | null {
    return source.type === 'field' && source.field.status === 'resolved'
        ? source.field.field.name
        : null;
}
function SourceIcon() {
    return h(
        'svg',
        {
            viewBox: '0 0 200 170',
            xmlns: 'http://www.w3.org/2000/svg',
            'aria-hidden': true,
            className: 'mx-sdk-form-source-icon',
        },
        h('path', {
            fill: 'currentColor',
            d: 'M90.039 12.368L24.079 39.66c-3.667 1.519-3.63 6.729.062 8.192l66.235 26.266a24.58 24.58 0 0 0 18.12 0l66.236-26.266c3.69-1.463 3.729-6.673.06-8.191l-65.958-27.293a24.58 24.58 0 0 0-18.795 0zM180.89 88.527l-71.708 28.496c-5.818 2.312-12.281 2.312-18.1 0L19.376 88.527c-2.424-.963-5.114.93-4.776 3.36l7.874 56.575c.354 2.547 2.135 4.67 4.593 5.477l71.394 23.443a24.58 24.58 0 0 0 15.262 0l71.394-23.443c2.458-.807 4.239-2.93 4.593-5.477l7.874-56.575c.338-2.43-2.352-4.323-4.776-3.36z',
        })
    );
}
function placeholder(args: {
    source: FormDisplaySource;
    enabled: boolean;
    target: FormHeaderSettingsTarget;
    sourceLabel: string;
    addLabel: string;
    preview?: FormHeaderPreview;
    command: (target: FormHeaderSettingsTarget) => void;
}): ReactNode {
    if (!args.preview?.showPlaceholders) return null;
    const name =
        args.enabled && args.preview.showFieldSources
            ? fieldName(args.source)
            : null;
    return h(
        'button',
        {
            type: 'button',
            className: `mx-sdk-form-placeholder mx-sdk-form-placeholder--${args.target}${name != null ? ' mx-sdk-form-placeholder--source' : ''}`,
            onClick: () => args.command(args.target),
        },
        name != null ? h(SourceIcon) : null,
        name != null
            ? h('span', null, `${args.sourceLabel}: ${name}`)
            : args.addLabel
    );
}
export type CompleteFormHeaderProps = PresentationProps & {
    title: FormDisplaySource;
    extensionName: string | null;
    description?: {
        enabled: boolean;
        source: FormDisplaySource;
        truncate?: boolean;
    };
    logo?: FormDisplaySource;
    isChildForm?: boolean;
    language?: RuntimeLanguage;
    testId?: string;
};
/** Complete stock presenter. Values and preview capabilities are host-admitted facts. */
export function CompleteFormHeader(props: CompleteFormHeaderProps): ReactNode {
    const command = useSettingsCommand(props);
    const labels = { ...formHeaderLabels(props.language), ...props.labels };
    const none: FormDisplaySource = { type: 'none' };
    const logoSource = props.logo ?? none;
    const { logo, title, description: html } = projectFormHeader(props);
    if (
        logo == null &&
        title == null &&
        html == null &&
        !props.preview?.showPlaceholders
    )
        return null;
    return h(
        'div',
        {
            className: ['mx-sdk-form-header', props.className]
                .filter(Boolean)
                .join(' '),
            'data-testid': props.testId,
        },
        logo
            ? h('img', { className: 'mx-sdk-form-logo', src: logo, alt: '' })
            : !props.isChildForm
              ? placeholder({
                    source: logoSource,
                    enabled: true,
                    target: 'logo',
                    sourceLabel: labels.logoSource,
                    addLabel: labels.addLogo,
                    preview: props.preview,
                    command,
                })
              : null,
        title
            ? h('h1', { className: 'mx-sdk-form-title' }, title)
            : placeholder({
                  source: props.title,
                  enabled: true,
                  target: 'title',
                  sourceLabel: labels.titleSource,
                  addLabel: labels.title,
                  preview: props.preview,
                  command,
              }),
        html
            ? h(
                  'section',
                  { className: 'mx-sdk-form-description' },
                  props.description?.truncate
                      ? h(CompleteTruncatedDescription, {
                            html,
                            resetKey: props.identity.record,
                            readMoreLabel: labels.readMore,
                            showLessLabel: labels.showLess,
                        })
                      : h(CompleteQuillHTMLRenderer, { html })
              )
            : placeholder({
                  source: props.description?.source ?? none,
                  enabled: props.description?.enabled === true,
                  target: 'description',
                  sourceLabel: labels.descriptionSource,
                  addLabel: labels.addDescription,
                  preview: props.preview,
                  command,
              })
    );
}
export type CompleteFormFooterDescriptionProps = PresentationProps & {
    enabled: boolean;
    source: FormDisplaySource;
};
export function CompleteFormFooterDescription(
    props: CompleteFormFooterDescriptionProps
): ReactNode {
    const command = useSettingsCommand(props);
    const labels = { ...formHeaderLabels(), ...props.labels };
    const html = resolveFormFooterDescription(props);
    if (html == null && !props.preview?.showPlaceholders) return null;
    return h(
        'div',
        {
            className: ['mx-sdk-form-footer-description', props.className]
                .filter(Boolean)
                .join(' '),
        },
        html != null
            ? h(CompleteQuillHTMLRenderer, { html })
            : placeholder({
                  source: props.source,
                  enabled: props.enabled,
                  target: 'footer',
                  sourceLabel: labels.footerSource,
                  addLabel: labels.addFooter,
                  preview: props.preview,
                  command,
              })
    );
}
export type CompleteFormCoverProps = PresentationProps & {
    src?: string | null;
    isChildForm?: boolean;
    isModal?: boolean;
    testId?: string;
};
export function CompleteFormCover(props: CompleteFormCoverProps): ReactNode {
    const command = useSettingsCommand(props);
    if (
        !shouldRenderFormCover({
            ...props,
            showPlaceholders: props.preview?.showPlaceholders,
        })
    )
        return null;
    const labels = { ...formHeaderLabels(), ...props.labels };
    return h(
        'div',
        {
            className: [
                'mx-sdk-form-cover',
                !props.src ? 'mx-sdk-form-cover--placeholder' : '',
                props.className,
            ]
                .filter(Boolean)
                .join(' '),
            style: { height: props.src ? 136 : 96, width: '100%' },
        },
        props.src
            ? h('img', {
                  'data-testid': props.testId,
                  src: props.src,
                  alt: '',
                  style: {
                      height: 216,
                      width: '100%',
                      top: 0,
                      right: 0,
                      left: 0,
                      objectFit: 'cover',
                  },
              })
            : placeholder({
                  source: { type: 'none' },
                  enabled: true,
                  target: 'cover',
                  sourceLabel: '',
                  addLabel: labels.addCover,
                  preview: props.preview,
                  command,
              })
    );
}
