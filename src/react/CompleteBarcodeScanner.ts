import type * as React from 'react';
import {
    createElement as h,
    Fragment,
    type MutableRefObject,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
} from 'react';
import { ScannerReader } from './scannerReader.js';

export type BarcodeScannerLabels = {
    scan_barcode_or_qr_code: string;
    barcode_scanner_no_camera: string;
    barcode_scanner_permission_denied: string;
    barcode_scanner_decode_error: string;
    try_again: string;
    continue_manually: string;
    close: string;
};

export const defaultBarcodeScannerLabels: BarcodeScannerLabels = {
    scan_barcode_or_qr_code: 'Scan barcode or QR code',
    barcode_scanner_no_camera:
        'No camera was found. You can enter the value manually.',
    barcode_scanner_permission_denied:
        'Camera access was denied. You can enter the value manually.',
    barcode_scanner_decode_error:
        'The code could not be scanned. Try again or enter the value manually.',
    try_again: 'Try again',
    continue_manually: 'Enter manually',
    close: 'Close',
};

export type BarcodeScannerLayout = {
    /** Theme variables/colors are copied into the portal; no app context needed. */
    style?: CSSProperties;
    /** Applied at desktop widths, e.g. the host's open support panel. */
    desktopViewportOffset?: number;
    className?: string;
};
export type CompleteBarcodeScannerProps = BarcodeScannerLayout & {
    labels?: BarcodeScannerLabels;
    onUpdate: (text: string) => void | Promise<void>;
    onDismiss: () => void;
    runInLoop?: boolean;
    /** Changes retire camera work, including A → B → A transitions. */
    ownerKey?: unknown;
};
type Failure = 'no-device' | 'permission-denied' | 'decode-error';
const focusEpochs = new WeakMap<Document, number>();

function useScannerReturnFocus(dismissed: boolean) {
    const target = useRef<HTMLElement | null>();
    const registration = useRef<{ document: Document; retiredAt?: number }>();
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommittedEffect(() => {
        if (dismissed) return;
        const owner = document;
        if (target.current === undefined)
            target.current =
                owner.activeElement instanceof HTMLElement
                    ? owner.activeElement
                    : null;
        const current: { document: Document; retiredAt?: number } = {
            document: owner,
        };
        registration.current = current;
        focusEpochs.set(owner, (focusEpochs.get(owner) ?? 0) + 1);
        return () => {
            // Snapshot before a replacement's layout registration, including
            // replacements still waiting for their private dialog module.
            current.retiredAt = focusEpochs.get(owner);
        };
    }, [dismissed]);
    useEffect(() => {
        if (dismissed) return;
        const current = registration.current;
        if (!current) return;
        return () => {
            // Headless restores from its own unmount microtask. Its history
            // misses the trigger on a cold lazy import; restore our earlier
            // capture after that teardown, without stealing a newer focus.
            queueMicrotask(() =>
                queueMicrotask(() => {
                    const owner = current.document;
                    const saved = target.current;
                    if (
                        registration.current !== current ||
                        current.retiredAt !== focusEpochs.get(owner) ||
                        !saved?.isConnected ||
                        saved === owner.body ||
                        Boolean((saved as HTMLButtonElement).disabled) ||
                        saved.closest('[inert], [hidden]')
                    )
                        return;
                    const dialogs = owner.querySelectorAll(
                        '.mx-sdk-scanner[role=dialog]'
                    );
                    const top = dialogs[dialogs.length - 1];
                    if (top && !top.contains(saved)) return;
                    const active = owner.activeElement;
                    if (
                        active &&
                        active !== owner.body &&
                        active !== owner.documentElement &&
                        active !== saved &&
                        active.isConnected
                    )
                        return;
                    saved.focus({ preventScroll: true });
                })
            );
        };
    }, [dismissed]);
}

const classifyFailure = (error: unknown): Failure =>
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError')
        ? 'permission-denied'
        : 'decode-error';

export function ScannerIcon({ stop = false }: { stop?: boolean }) {
    return h(
        'svg',
        {
            viewBox: '0 0 24 24',
            'aria-hidden': true,
            width: 20,
            height: 20,
            fill: 'currentColor',
        },
        // Native Form uses the solid Heroicons 2.1.1 glyphs (MIT).
        !stop &&
            h('path', {
                d: 'M12 9a3.75 3.75 0 1 0 0 7.5A3.75 3.75 0 0 0 12 9Z',
            }),
        h('path', {
            fillRule: 'evenodd',
            clipRule: 'evenodd',
            d: stop
                ? 'M4.5 7.5a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9Z'
                : 'M9.344 3.071a49.52 49.52 0 0 1 5.312 0c.967.052 1.83.585 2.332 1.39l.821 1.317c.24.383.645.643 1.11.71.386.054.77.113 1.152.177 1.432.239 2.429 1.493 2.429 2.909V18a3 3 0 0 1-3 3h-15a3 3 0 0 1-3-3V9.574c0-1.416.997-2.67 2.429-2.909.382-.064.766-.123 1.151-.178a1.56 1.56 0 0 0 1.11-.71l.822-1.315a2.942 2.942 0 0 1 2.332-1.39ZM6.75 12.75a5.25 5.25 0 1 1 10.5 0 5.25 5.25 0 0 1-10.5 0Zm12-1.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z',
        })
    );
}

/** Complete camera/dialog UI, separate from the display-only BarcodeField. */
export function CompleteBarcodeScanner(props: CompleteBarcodeScannerProps) {
    const labels = props.labels ?? defaultBarcodeScannerLabels;
    const [runtime, setRuntime] =
        useState<typeof import('./scannerDialogRuntime.js')>();
    const [loadError, setLoadError] = useState<{ error: unknown }>();
    const [dismissed, setDismissed] = useState(false);
    useScannerReturnFocus(dismissed);
    const isDismissed = useRef(false);
    const dispose = useRef<() => void>(() => {});
    useEffect(() => {
        let active = true;
        // Like the other complete controls, public import and SSR must not
        // initialize ReactDOM before a browser exists. No video/camera mounts
        // until its owned dialog is ready, and retired mounts cannot revive.
        void import('./scannerDialogRuntime.js').then(
            (loaded) => {
                if (active && !isDismissed.current) setRuntime(loaded);
            },
            (error: unknown) => {
                if (active && !isDismissed.current) setLoadError({ error });
            }
        );
        return () => {
            active = false;
        };
    }, []);
    const dismiss = () => {
        if (isDismissed.current) return;
        isDismissed.current = true;
        dispose.current();
        setDismissed(true);
        props.onDismiss();
    };
    if (loadError) throw loadError.error;
    if (dismissed || !runtime) return null;
    const style: CSSProperties & { '--mx-sdk-scanner-offset'?: string } = {
        ...props.style,
        '--mx-sdk-scanner-offset': `${props.desktopViewportOffset ?? 0}px`,
    };
    return h(
        runtime.ScannerDialog,
        {
            title: labels.scan_barcode_or_qr_code,
            closeLabel: labels.close,
            dismiss,
            style,
            className: props.className,
        },
        h(ScannerVideo, { ...props, labels, onDismiss: dismiss, dispose })
    );
}

// Mount inside the dialog portal: camera work starts only after its video node
// exists, including a cold dialog/SSR handoff.
function ScannerVideo(
    props: CompleteBarcodeScannerProps & {
        labels: BarcodeScannerLabels;
        dispose: MutableRefObject<() => void>;
    }
) {
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const { labels, dispose } = props;
    const [attempt, setAttempt] = useState(0);
    const [failure, setFailure] = useState<Failure | null>(null);
    const video = useRef<HTMLVideoElement>(null);
    const callbacks = useRef(props);
    useCommittedEffect(() => {
        callbacks.current = props;
    });
    useCommittedEffect(() => {
        let active = true;
        const reader = new ScannerReader(() =>
            fail(new Error('Camera stream ended'))
        );
        let stream: MediaStream | undefined;
        const releaseCamera = () => {
            if (stream) {
                reader.stopMediaStream(stream);
                stream = undefined;
            }
            reader.dispose();
        };
        const stop = () => {
            if (!active) return;
            active = false;
            releaseCamera();
        };
        const deliver = async (text: string) => {
            try {
                await callbacks.current.onUpdate(text);
            } catch {
                // The host owns any allocated write/lookup and its error UI.
                // Close without classifying its failure as a camera error or
                // automatically replaying an operation with an unknown outcome.
                if (active) callbacks.current.onDismiss();
            }
        };
        dispose.current = stop;
        const fail = (error: unknown) => {
            if (!active) return;
            setFailure(classifyFailure(error));
            stop();
        };
        const run = async () => {
            const sources = await reader.listVideoInputDevices();
            if (!active) return;
            if (!sources.some((source) => source.kind === 'videoinput')) {
                setFailure('no-device');
                stop();
                return;
            }
            const acquired = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
            });
            if (!active) {
                reader.stopMediaStream(acquired);
                return;
            }
            stream = acquired;
            const target = video.current;
            if (!target) {
                stop();
                return;
            }
            if (props.runInLoop) {
                await reader.decodeFromStream(
                    acquired,
                    target,
                    (result, error) => {
                        if (!active) return;
                        if (result) void deliver(result.getText());
                        else if (error && error.name !== 'NotFoundException')
                            fail(error);
                    }
                );
            } else {
                const result = await reader.decodeOnceFromStream(
                    acquired,
                    target
                );
                if (!active) return;
                releaseCamera();
                await deliver(result.getText());
            }
        };
        void run().catch(fail);
        return stop;
    }, [attempt, props.runInLoop, props.ownerKey]);

    useCommittedEffect(() => {
        setFailure(null);
    }, [props.ownerKey, props.runInLoop]);
    const message =
        failure === 'no-device'
            ? labels.barcode_scanner_no_camera
            : failure === 'permission-denied'
              ? labels.barcode_scanner_permission_denied
              : labels.barcode_scanner_decode_error;
    return h(
        Fragment,
        null,
        h('video', {
            ref: video,
            className: 'mx-sdk-scanner-video',
            'aria-label': labels.scan_barcode_or_qr_code,
        }),
        failure
            ? h(
                  'div',
                  { className: 'mx-sdk-scanner-failure' },
                  h('p', { role: 'alert' }, message),
                  h(
                      'div',
                      { className: 'mx-sdk-scanner-actions' },
                      h(
                          'button',
                          {
                              type: 'button',
                              onClick: () => {
                                  dispose.current();
                                  setFailure(null);
                                  setAttempt((n) => n + 1);
                              },
                          },
                          labels.try_again
                      ),
                      h(
                          'button',
                          { type: 'button', onClick: props.onDismiss },
                          labels.continue_manually
                      )
                  )
              )
            : null
    );
}
