import {
    createFormCaptchaProviderRegistry,
    type FormCaptchaCallbacks,
    type FormCaptchaProvider,
} from './formCaptcha.js';

/** Visible reCAPTCHA v2 render configuration; deployment owns the accepted key. */
export type RecaptchaV2Options = Readonly<{
    sitekey: string;
    theme?: 'light' | 'dark';
    type?: 'image' | 'audio';
    size?: 'normal' | 'compact';
    tabindex?: number;
    hl?: string;
}>;

/** External provider boundary. No execute/getResponse or verification authority. */
export type RecaptchaV2Api<Proof = string> = {
    render(
        container: HTMLElement,
        options: RecaptchaV2Options & {
            callback(value: Proof | null): void;
            'expired-callback'(): void;
            'error-callback'(cause?: unknown): void;
        }
    ): number;
    reset(widgetId: number): void;
};

/**
 * SDK-owned actual vendor adapter. The deployment supplies only its admitted
 * loader/API boundary; native consumers do not implement widget render/reset.
 * Share the registry/scope/configuration for one process-global script resource.
 */
export function createRecaptchaV2Provider<Proof = string>(request: {
    registry: ReturnType<typeof createFormCaptchaProviderRegistry>;
    scope: unknown;
    configuration: unknown;
    load(): RecaptchaV2Api<Proof> | Promise<RecaptchaV2Api<Proof>>;
}): FormCaptchaProvider<Proof, RecaptchaV2Options> {
    return request.registry.provider({
        scope: request.scope,
        configuration: request.configuration,
        async load() {
            const api = await request.load();
            return {
                render(
                    container,
                    options,
                    callbacks: FormCaptchaCallbacks<Proof>
                ) {
                    let active = true;
                    let widgetId: number;
                    try {
                        widgetId = api.render(container, {
                            ...options,
                            callback(value) {
                                if (active) callbacks.change(value);
                            },
                            'expired-callback'() {
                                if (active) callbacks.expired();
                            },
                            'error-callback'(cause) {
                                if (active) callbacks.error(cause);
                            },
                        });
                    } catch (cause) {
                        active = false;
                        container.replaceChildren();
                        throw cause;
                    }
                    return {
                        reset() {
                            if (active) api.reset(widgetId);
                        },
                        remove() {
                            if (!active) return;
                            active = false;
                            // v2 has no global remove API. Reset only this ID and
                            // detach only this isolated mount; keep shared globals.
                            try {
                                api.reset(widgetId);
                            } finally {
                                container.replaceChildren();
                            }
                        },
                    };
                },
            };
        },
    });
}
