import type { PrintableFormPreparedDocument } from './printableForm.js';

export type PrintableDOMOptions = {
    readonly isCurrent: () => boolean;
    readonly afterPrint: () => void;
    readonly signal?: AbortSignal;
    /** A preparation deadline only. It never interprets a print invocation. */
    readonly preparationTimeoutMs?: number;
    readonly title?: string;
    /** Preserve a whole native fallback, without claiming SDK media parity. */
    readonly embeddedContent?: 'refuse' | 'retain-native';
};

function preparationScope(options: PrintableDOMOptions) {
    const abort = new AbortController();
    const timeout = setTimeout(
        () => abort.abort(),
        options.preparationTimeoutMs ?? 30_000
    );
    const cancelled = () => abort.abort();
    options.signal?.addEventListener('abort', cancelled, { once: true });
    if (options.signal?.aborted) abort.abort();
    return {
        signal: abort.signal,
        check() {
            if (
                abort.signal.aborted ||
                options.isCurrent() !== true ||
                abort.signal.aborted
            )
                throw new Error('Print preparation retired');
        },
        stop() {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', cancelled);
        },
    };
}

function isFailedOptionalCollaboratorPhoto(image: HTMLImageElement): boolean {
    if (
        !image.complete ||
        image.naturalWidth !== 0 ||
        !image.matches(
            '.mx-sdk-collaborator-badge > .mx-sdk-collaborator-badge-avatar > img.mx-sdk-collaborator-avatar[alt=""]'
        )
    )
        return false;
    const label = image.parentElement?.parentElement?.querySelector(
        ':scope > .mx-sdk-collaborator-badge-body > .mx-sdk-collaborator-name'
    );
    return Boolean(label?.textContent?.trim() && !label.closest('[hidden]'));
}

/** Await retained content and identify settled badge photos to omit from print. */
async function waitForContent(
    root: HTMLElement,
    scope: ReturnType<typeof preparationScope>
) {
    const view = root.ownerDocument.defaultView;
    if (!view) throw new Error('Print document unavailable');
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error = false) => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            root.removeEventListener('load', inspect, true);
            root.removeEventListener('error', deferInspect, true);
            scope.signal.removeEventListener('abort', fail);
            if (error) reject(new Error('Print content preparation failed'));
            else resolve();
        };
        const fail = () => finish(true);
        const inspect = () => {
            try {
                scope.check();
                for (const image of root.querySelectorAll('img'))
                    if (image.loading !== 'eager') image.loading = 'eager';
                if (
                    root.matches('[aria-busy="true"]') ||
                    root.querySelector('[aria-busy="true"]')
                )
                    return;
                if (
                    [...root.querySelectorAll('img')].some(
                        (image) =>
                            !image.complete ||
                            (image.naturalWidth === 0 &&
                                !isFailedOptionalCollaboratorPhoto(image))
                    )
                )
                    return;
                finish();
            } catch {
                fail();
            }
        };
        // React image recovery gets its committed replacement before inspection.
        const deferInspect = () => queueMicrotask(inspect);
        const observer = new view.MutationObserver(inspect);
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
        });
        root.addEventListener('load', inspect, true);
        root.addEventListener('error', deferInspect, true);
        scope.signal.addEventListener('abort', fail, { once: true });
        inspect();
    });
    const failedPhotos = new Set<HTMLImageElement>();
    for (const image of root.querySelectorAll('img')) {
        scope.check();
        if (isFailedOptionalCollaboratorPhoto(image)) failedPhotos.add(image);
        else if (typeof image.decode === 'function')
            await abortable(image.decode(), scope.signal);
    }
    scope.check();
    return failedPhotos;
}

function abortable<T>(
    promise: PromiseLike<T>,
    signal: AbortSignal
): Promise<T> {
    return new Promise((resolve, reject) => {
        const cancelled = () => reject(new Error('Print preparation retired'));
        signal.addEventListener('abort', cancelled, { once: true });
        if (signal.aborted) cancelled();
        Promise.resolve(promise)
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', cancelled));
    });
}

function copyLiveValues(source: HTMLElement, target: HTMLElement) {
    const inputs = source.querySelectorAll('input,textarea,select');
    const copies = target.querySelectorAll('input,textarea,select');
    if (inputs.length !== copies.length)
        throw new Error('Print input preparation failed');
    inputs.forEach((input, index) => {
        const copy = copies[index];
        if (input.tagName === 'INPUT') {
            const original = input as HTMLInputElement;
            const cloned = copy as HTMLInputElement;
            cloned.value = original.value;
            cloned.checked = original.checked;
        } else if (input.tagName === 'TEXTAREA') {
            (copy as HTMLTextAreaElement).value = (
                input as HTMLTextAreaElement
            ).value;
            copy.textContent = (input as HTMLTextAreaElement).value;
        } else {
            const original = input as HTMLSelectElement;
            [...(copy as HTMLSelectElement).options].forEach(
                (option, position) => {
                    option.selected = original.options[position].selected;
                }
            );
        }
    });
    const canvases = source.querySelectorAll('canvas');
    const clones = target.querySelectorAll('canvas');
    canvases.forEach((canvas, index) => {
        const context = clones[index]?.getContext('2d');
        if (!context) throw new Error('Print canvas preparation failed');
        context.drawImage(canvas, 0, 0);
    });
}

/**
 * Copies a retained readonly document into one uniquely owned frame. The caller
 * supplies document-wide admission before capture; this function has no queue,
 * global iframe ID, canonical values, provider, or print retry.
 */
export async function preparePrintableDOM(
    source: HTMLElement,
    options: PrintableDOMOptions
): Promise<PrintableFormPreparedDocument> {
    const scope = preparationScope(options);
    const host = source.ownerDocument;
    let frame: HTMLIFrameElement | null = null;
    let printWindow: Window | null = null;
    let afterPrint: (() => void) | null = null;
    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        if (printWindow && afterPrint)
            printWindow.removeEventListener('afterprint', afterPrint);
        frame?.remove();
        disposed = true;
    };
    try {
        scope.check();
        // Embedded browsing contexts and playing media need a separately
        // admitted print representation; never silently print a blank player.
        if (
            options.embeddedContent !== 'retain-native' &&
            source.querySelector('iframe,audio,video')
        )
            throw new Error('Unsupported print content');
        const failedSourcePhotos = await waitForContent(source, scope);
        scope.check();
        if (
            options.embeddedContent !== 'retain-native' &&
            source.querySelector('iframe,audio,video')
        )
            throw new Error('Unsupported print content');
        frame = host.createElement('iframe');
        frame.title = options.title ?? 'Printable document';
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        frame.dataset.mxSdkPrintFrame = '';
        frame.style.cssText =
            'position:fixed;left:-100000px;top:0;width:816px;height:1056px;border:0;pointer-events:none;';
        host.body.appendChild(frame);
        const document = frame.contentDocument;
        printWindow = frame.contentWindow;
        if (!document || !printWindow)
            throw new Error('Print frame unavailable');
        const html = document.documentElement;
        const head = document.head;
        const body = document.body;
        html.lang = source.lang || host.documentElement.lang;
        html.className = host.documentElement.className;
        html.style.cssText = host.documentElement.style.cssText;
        const htmlDirection = host.documentElement.getAttribute('dir');
        if (htmlDirection !== null) html.setAttribute('dir', htmlDirection);
        body.className = host.body.className;
        body.style.cssText = host.body.style.cssText;
        const bodyDirection = host.body.getAttribute('dir');
        if (bodyDirection !== null) body.setAttribute('dir', bodyDirection);
        document.title = options.title ?? host.title;
        const base = document.createElement('base');
        base.href = host.baseURI;
        head.appendChild(base);
        const styles: Promise<void>[] = [];
        for (const item of host.querySelectorAll(
            'style,link[rel="stylesheet"]'
        )) {
            const cloned = item.cloneNode(true) as
                | HTMLStyleElement
                | HTMLLinkElement;
            if (item.tagName === 'STYLE') {
                const sheet = (item as HTMLStyleElement).sheet;
                if (sheet)
                    cloned.textContent = [...sheet.cssRules]
                        .map((rule) => rule.cssText)
                        .join('\n');
            }
            if (cloned.tagName === 'LINK') {
                const link = cloned as HTMLLinkElement;
                if (link.disabled || !link.getAttribute('href')) continue;
                styles.push(
                    new Promise<void>((resolve, reject) => {
                        link.addEventListener('load', () => resolve(), {
                            once: true,
                        });
                        link.addEventListener(
                            'error',
                            () => reject(new Error('Print stylesheet failed')),
                            { once: true }
                        );
                    })
                );
            }
            head.appendChild(cloned);
        }
        const cloned = source.cloneNode(true) as HTMLElement;
        if (failedSourcePhotos.size) {
            const clonedImages = cloned.querySelectorAll('img');
            source.querySelectorAll('img').forEach((image, index) => {
                if (failedSourcePhotos.has(image))
                    clonedImages[index]?.remove();
            });
        }
        // The source's staging position must not become print layout.
        cloned.style.position = '';
        cloned.style.left = '';
        cloned.style.top = '';
        cloned.style.opacity = '';
        cloned.style.pointerEvents = '';
        if (cloned.hasAttribute('data-mx-sdk-print-source')) {
            cloned.removeAttribute('aria-hidden');
            cloned.removeAttribute('inert');
        }
        body.appendChild(cloned);
        copyLiveValues(source, cloned);
        await abortable(Promise.all(styles), scope.signal);
        for (const photo of await waitForContent(cloned, scope)) photo.remove();
        // Force style/layout discovery before waiting for all used fonts.
        cloned.getBoundingClientRect();
        if (document.fonts) await abortable(document.fonts.ready, scope.signal);
        scope.check();
        afterPrint = () => options.afterPrint();
        printWindow.addEventListener('afterprint', afterPrint);
        const ownedFrame = frame;
        const ownedWindow = printWindow;
        const ownedDocument = document;
        const frameIsCurrent = () =>
            !disposed &&
            ownedFrame.isConnected &&
            ownedFrame.contentWindow === ownedWindow &&
            ownedFrame.contentDocument === ownedDocument;
        return {
            invoke(boundary) {
                if (
                    !frameIsCurrent() ||
                    typeof ownedWindow.print !== 'function'
                )
                    throw new Error('Print frame retired');
                const print = ownedWindow.print;
                ownedWindow.focus();
                return void boundary(() => {
                    if (!frameIsCurrent())
                        throw new Error('Print frame retired');
                    print.call(ownedWindow);
                });
            },
            dispose,
        };
    } catch {
        dispose();
        throw new Error('Print preparation failed');
    } finally {
        scope.stop();
    }
}
