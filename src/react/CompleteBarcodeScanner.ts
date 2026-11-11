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
        h('path', {
            d: stop
                ? 'M5 4h14v16H5z'
                : 'M8 4 6 7H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2-3H8zm4 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
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
