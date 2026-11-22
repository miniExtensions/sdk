import { createElement as h, version } from 'react';
import { createRoot } from 'react-dom/client';
import { CompleteFormReadonlyFooterActions } from '@miniextensions/sdk/react';
import { projectFormCompletionNavigation } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/form-completion.css';

// Shape and attributes from native FormLoaded's Heroicons 2.1.1 solid assets.
// The browser runner embeds a predecessor reference independent of the SDK.
const icons = globalThis.nativeFooterIcons;
const language = new URL(location.href).searchParams.get('lang') ?? 'en';
const translations = {
    en: ['Submit another form', 'Copy submission'],
    fr: ['Soumettre un autre formulaire', 'Copier la soumission'],
};
const labels = translations[language];
const commands = ['submit_another_form', 'copy_form'];
const path = '/survey/recSource?screen=2&campaign=footer#details';
const primaryStyle = 'native-primary';
const evidence = { react: version, navigations: [], submits: 0, clicks: [] };
const knownKeys = [
    ['reference-root', false, true],
    ['candidate-root', false, false],
    ['reference-child', true, true],
    ['candidate-child', true, false],
];

function act(surface, command) {
    const plan = projectFormCompletionNavigation({
        command,
        currentURL: new URL(path, location.href).href,
        recordId: 'recSource',
        inIframe: false,
    });
    if (plan.length !== 1 || plan[0].type !== 'navigate')
        throw new Error('Expected exactly one navigation');
    const destination = new URL(plan[0].url);
    if (destination.origin !== location.origin || plan[0].route !== 'self')
        throw new Error('Fixture requires a same-origin Form destination');
    evidence.navigations.push({
        surface,
        command,
        destination:
            destination.pathname + destination.search + destination.hash,
    });
    history.pushState(null, '', destination);
}

function nativeButton(index, surface) {
    return h(
        'button',
        {
            key: index,
            type: 'button',
            className: primaryStyle,
            onClick: () => act(surface, commands[index]),
        },
        h(
            'svg',
            {
                'aria-hidden': 'true',
                className: 'native-footer-icon',
                fill: 'currentColor',
                viewBox: '0 0 24 24',
            },
            ...icons[index].map((attributes) => h('path', attributes))
        ),
        labels[index]
    );
}

function footerRow(surface, child, reference, standalone = false) {
    return h(
        'section',
        {
            key: surface,
            'aria-label': surface,
            className: child ? 'child' : undefined,
        },
        h(
            'div',
            { 'data-surface': surface, className: 'footer-row' },
            reference
                ? (child ? [1] : [0, 1]).map((index) =>
                      nativeButton(index, surface)
                  )
                : h(CompleteFormReadonlyFooterActions, {
                      configuration: {
                          successMessageCanCreateNewRecord: true,
                          allowCopySubmittedToNewForm: true,
                      },
                      language,
                      mode: 'readonly',
                      context: child ? 'side-panel' : 'direct-url',
                      hasParentExtension: child,
                      hasExistingRecord: true,
                      ...(!standalone
                          ? { unstyled: true, buttonClassName: primaryStyle }
                          : {}),
                      onCommand: (command) => act(surface, command),
                  })
        )
    );
}

const root = createRoot(document.querySelector('main'));
root.render(
    h(
        'form',
        {
            onSubmit(event) {
                event.preventDefault();
                evidence.submits++;
            },
            onClickCapture(event) {
                if (event.target.closest('button'))
                    evidence.clicks.push({
                        trusted: event.isTrusted,
                        detail: event.detail,
                    });
            },
        },
        ...knownKeys.map(([surface, child, reference]) =>
            footerRow(surface, child, reference)
        ),
        footerRow('standalone', false, false, true)
    )
);

function textRect(button) {
    const label = [...button.childNodes].find(
        (node) => node.textContent === button.textContent
    );
    if (!label) throw new Error('Missing footer label');
    const range = document.createRange();
    range.selectNodeContents(label);
    return range.getBoundingClientRect();
}

function size(rect, origin) {
    return [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height];
}

window.footerProof = {
    snapshot() {
        return Object.fromEntries(
            [...document.querySelectorAll('[data-surface]')].map((row) => {
                const origin = row.getBoundingClientRect();
                return [
                    row.dataset.surface,
                    [...row.querySelectorAll('button')].map((button) => {
                        const icon = button.querySelector('svg');
                        const bounds = button.getBoundingClientRect();
                        const text = textRect(button);
                        const iconBounds = icon?.getBoundingClientRect();
                        const style = getComputedStyle(button);
                        return {
                            label: button.textContent,
                            button: size(bounds, origin),
                            text: size(text, bounds),
                            icon: iconBounds ? size(iconBounds, bounds) : null,
                            gap: iconBounds
                                ? text.left - iconBounds.right
                                : null,
                            paths: [
                                ...(icon?.querySelectorAll('path') ?? []),
                            ].map((node) => node.getAttribute('d')),
                            hidden: icon?.getAttribute('aria-hidden') ?? null,
                            background: style.backgroundColor,
                            color: style.color,
                            font: [
                                style.fontSize,
                                style.fontWeight,
                                style.lineHeight,
                            ],
                            border: style.borderTopWidth,
                            type: button.type,
                        };
                    }),
                ];
            })
        );
    },
    evidence: () => ({
        ...evidence,
        location: location.pathname + location.search + location.hash,
    }),
    unmount: () => root.unmount(),
};
