import {
    createElement as h,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import {
    CompleteBarcodeScanner,
    ScannerIcon,
    defaultBarcodeScannerLabels,
    type BarcodeScannerLabels,
    type BarcodeScannerLayout,
} from './CompleteBarcodeScanner.js';

export const qrScannerButtonTestId = 'qr-scanner-button';
export type BarcodeScannerButtonOptions = BarcodeScannerLayout & {
    autoStartCamera: boolean;
    hideButton: boolean;
    scannerButtonClassName?: string;
    buttonAppearance?: 'filled' | 'unstyled';
    setValue: (text: string) => void | Promise<void>;
    runInLoop: boolean;
    labels?: BarcodeScannerLabels;
    ownerKey?: unknown;
};
type Session = { busy: boolean; owner: unknown; loop: boolean };

/** The caller owns the admitted write/lookup. Retirement never cancels it. */
export function useBarcodeScannerButton(options: BarcodeScannerButtonOptions) {
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const [session, setSession] = useState<Session | null>(null);
    const live = useRef<Session | null>(null);
    const mounted = useRef(false);
    const latest = useRef(options);
    const lastScan = useRef(0);
    const restart = useRef<ReturnType<typeof setTimeout> | null>(null);
    useCommittedEffect(() => {
        latest.current = options;
    });
    const retire = useCallback(() => {
        live.current = null;
        if (restart.current !== null) clearTimeout(restart.current);
        restart.current = null;
    }, []);
    const start = useCallback(() => {
        retire();
        const next = {
            busy: false,
            owner: latest.current.ownerKey,
            loop: latest.current.runInLoop,
        };
        live.current = next;
        setSession(next);
    }, [retire]);
    useCommittedEffect(() => {
        mounted.current = true;
        if (options.autoStartCamera && !options.hideButton) start();
        return () => {
            mounted.current = false;
            retire();
        };
        // Auto-start is an initial configuration, not a replay on re-enable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const policy = useRef({
        hide: options.hideButton,
        owner: options.ownerKey,
        loop: options.runInLoop,
    });
    useCommittedEffect(() => {
        const previous = policy.current;
        policy.current = {
            hide: options.hideButton,
            owner: options.ownerKey,
            loop: options.runInLoop,
        };
        if (
            previous.hide !== options.hideButton ||
            !Object.is(previous.owner, options.ownerKey) ||
            previous.loop !== options.runInLoop
        ) {
            retire();
            setSession(null);
        }
    }, [options.hideButton, options.ownerKey, options.runInLoop, retire]);
    const dismiss = () => {
        retire();
        setSession(null);
    };
    const onUpdate = async (text: string) => {
        if (
            !session ||
            live.current !== session ||
            !mounted.current ||
            latest.current.hideButton ||
            !Object.is(session.owner, latest.current.ownerKey) ||
            session.loop !== latest.current.runInLoop ||
            session.busy
        )
            return;
        session.busy = true;
        const admitted = latest.current;
        try {
            if (text && lastScan.current < Date.now() - 1000) {
                lastScan.current = Date.now();
                await admitted.setValue(text);
            }
        } catch (error) {
            session.busy = false;
            throw error;
        }
        if (live.current === session && mounted.current) {
            setSession(null);
            if (admitted.runInLoop)
                restart.current = setTimeout(() => {
                    restart.current = null;
                    if (live.current === session && mounted.current) start();
                }, 500);
        }
    };
    const labels = options.labels ?? defaultBarcodeScannerLabels;
    return {
        barcodeScannerButton: options.hideButton
            ? null
            : h(
                  'button',
                  {
                      type: 'button',
                      className: [
                          'mx-sdk-scanner-button',
                          options.buttonAppearance !== 'unstyled' &&
                              'mx-sdk-scanner-button-filled',
                          options.scannerButtonClassName,
                      ]
                          .filter(Boolean)
                          .join(' '),
                      'data-testid': qrScannerButtonTestId,
                      onClick: (event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          if (session) dismiss();
                          else start();
                      },
                  },
                  h(
                      'span',
                      { className: 'mx-sdk-scanner-sr-only' },
                      labels.scan_barcode_or_qr_code
                  ),
                  h(ScannerIcon, { stop: session !== null })
              ),
        scannerComponent:
            !options.hideButton &&
            session &&
            Object.is(session.owner, options.ownerKey) &&
            session.loop === options.runInLoop
                ? h(CompleteBarcodeScanner, {
                      labels,
                      onUpdate,
                      onDismiss: dismiss,
                      runInLoop: options.runInLoop,
                      ownerKey: session,
                      style: options.style,
                      desktopViewportOffset: options.desktopViewportOffset,
                  })
                : null,
    };
}

export type BarcodeScannerFieldOptions = Omit<
    BarcodeScannerButtonOptions,
    'hideButton' | 'autoStartCamera' | 'runInLoop'
> & {
    fieldType: 'barcode' | 'email' | 'url' | 'singleLineText';
    readOnly?: boolean;
    enableQRCodeScannerForFormField?: boolean;
    autoStartCamera?: boolean;
};
export function useBarcodeScannerButtonInField(
    options: BarcodeScannerFieldOptions
) {
    const hideButton = Boolean(
        options.readOnly ||
            (options.fieldType !== 'barcode' &&
                !options.enableQRCodeScannerForFormField)
    );
    return useBarcodeScannerButton({
        ...options,
        hideButton,
        autoStartCamera: !hideButton && options.autoStartCamera === true,
        runInLoop: false,
    });
}
