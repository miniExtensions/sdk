import type * as React from 'react';
import {
    createContext,
    createElement,
    forwardRef,
    useContext,
    type CSSProperties,
    type HTMLAttributes,
} from 'react';
import {
    getThemeStyles,
    type ThemeColor,
    type ThemeTokens,
} from '../ui/theme.js';

export type ThemeStyle = CSSProperties &
    Partial<ThemeTokens> & {
        '--mx-sdk-accent'?: string;
        '--mx-sdk-button-background'?: string;
        '--mx-sdk-button-hover'?: string;
        '--mx-sdk-button-focus'?: string;
        '--mx-sdk-button-foreground'?: string;
        '--mx-sdk-button-hover-foreground'?: string;
    };

/** Styling inputs only. Native/consumer state remains the selection owner. */
export type ThemeSnapshot = {
    readonly theme?: ThemeColor;
    readonly tokens?: ThemeTokens;
};

export type ThemeBoundaryProps = Omit<HTMLAttributes<HTMLDivElement>, 'style'> &
    ThemeSnapshot & { style?: ThemeStyle };

export type ThemePortalProps = {
    className: string;
    style: ThemeStyle | undefined;
    'data-mx-theme': ThemeColor | undefined;
};

const ThemeContext = createContext<ThemeSnapshot>({});

/**
 * Pass an effective snapshot explicitly to a detached portal's DOM wrapper.
 * This never reads computed styles or discovers DOM-only customizations.
 */
export function getThemePortalProps(snapshot: ThemeSnapshot): ThemePortalProps {
    return {
        className: snapshot.tokens ? 'mx-sdk-theme' : '',
        style: snapshot.tokens ? { ...snapshot.tokens } : undefined,
        'data-mx-theme': snapshot.tokens ? snapshot.theme : undefined,
    };
}

/** Includes only explicit boundary inputs, never arbitrary stylesheet values. */
export function useThemeSnapshot(): ThemeSnapshot {
    return useContext(ThemeContext);
}

/**
 * Omitted theme/tokens inherit. Explicit tokens replace the entire palette;
 * style wins locally. Supply custom raw tokens in `tokens` to propagate them
 * through a detached portal. CSS is optional and must be imported by the host.
 */
export const ThemeBoundary: React.ForwardRefExoticComponent<
    ThemeBoundaryProps & React.RefAttributes<HTMLDivElement>
> = forwardRef<HTMLDivElement, ThemeBoundaryProps>(function ThemeBoundary(
    { theme, tokens, style, className, children, ...div },
    ref
) {
    const parent = useThemeSnapshot();
    const ownTokens = tokens ?? (theme ? getThemeStyles(theme) : undefined);
    const snapshot: ThemeSnapshot = {
        theme: theme ?? parent.theme,
        tokens: ownTokens ?? parent.tokens,
    };
    return createElement(
        ThemeContext.Provider,
        { value: snapshot },
        createElement(
            'div',
            {
                ...div,
                ref,
                className: [ownTokens && 'mx-sdk-theme', className]
                    .filter(Boolean)
                    .join(' '),
                'data-mx-theme': ownTokens ? snapshot.theme : undefined,
                style: { ...ownTokens, ...style },
            },
            children
        )
    );
});
