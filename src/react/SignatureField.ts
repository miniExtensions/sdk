import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ReactElement,
} from 'react';
import type { AirtableAttachment } from '../runtime/types.js';
import { ActionButton } from './ActionButton.js';
import {
    SignatureCanvas,
    type SignatureCanvasHandle,
} from './SignatureCanvas.js';
import {
    SignatureReceipt,
    type SignatureAppend,
    type SignatureAuthority,
    type SignatureMethod,
    type SignatureRecovery,
    type SignatureStorage,
} from './signatureReceipt.js';

export type SignatureMessages = {
    methodLabel: string;
    type: string;
    draw: string;
    upload: string;
    signHere: string;
    typePlaceholder: string;
    selectImage: string;
    imageHelp: string;
    clear: string;
    sign: string;
    saving: string;
    attachPrevious: string;
    noMethods: string;
    saveError: string;
    invalidType: string;
    tooLarge: string;
    recoveryRequired: string;
};
const defaultMessages: SignatureMessages = {
    methodLabel: 'Signature method',
    type: 'Type',
    draw: 'Draw',
    upload: 'Upload',
    signHere: 'Sign here',
    typePlaceholder: 'Type your name here',
    selectImage: 'Select a signature image',
    imageHelp: 'PNG, JPG, JPEG, or SVG (max 5MB)',
    clear: 'Clear',
    sign: 'Sign',
    saving: 'Saving...',
    attachPrevious: 'Attach last signature',
    noMethods: 'No signature methods are enabled.',
    saveError: "We couldn't save your signature. Please try again.",
    invalidType: 'Please upload a valid image file (PNG, JPG, JPEG, or SVG)',
    tooLarge: 'File size must be less than 5MB',
    recoveryRequired:
        'The signature outcome is uncertain. Recovery is required before trying again.',
};
export type SignatureFieldProps = {
    id: string;
    ownerIdentity: string | null;
    /** Host-owned canonical value; same-owner echoes must not remount drafts. */
    value: readonly AirtableAttachment[];
    /** Synchronously returns appended only after the canonical commit. */
    appendCurrent: SignatureAppend;
    storage: SignatureStorage;
    /** Receives unresolved outcomes even after retirement; never a UI setter. */
    onRecovery: (recovery: SignatureRecovery) => void;
    previousSignature?: AirtableAttachment;
    config?: {
        allowTypedSignature?: boolean;
        allowDrawnSignature?: boolean;
        allowUploadedSignature?: boolean;
    };
    messages?: Partial<SignatureMessages>;
    className?: string;
};
const methods: SignatureMethod[] = ['type', 'draw', 'upload'];
const acceptedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
const font = '"Brush Script MT", "Lucida Handwriting", cursive';

/** Complete portable control; storage authority and the attachment list stay with the host. */
export function SignatureField(props: SignatureFieldProps): ReactElement {
    return h(SignatureSession, {
        ...props,
        key: JSON.stringify([props.ownerIdentity, props.id]),
    });
}

function SignatureSession(props: SignatureFieldProps) {
    const messages = { ...defaultMessages, ...props.messages };
    const enabled = methods.filter((method) =>
        method === 'draw'
            ? (props.config?.allowDrawnSignature ?? true)
            : method === 'type'
              ? (props.config?.allowTypedSignature ?? false)
              : (props.config?.allowUploadedSignature ?? false)
    );
    const [selected, setSelected] = useState<SignatureMethod>(
        enabled[0] ?? 'draw'
    );
    const active = enabled.includes(selected) ? selected : enabled[0];
    const [typed, setTyped] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [emptyCanvas, setEmptyCanvas] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [uncertain, setUncertain] = useState(false);
    const canvas = useRef<SignatureCanvasHandle>(null);
    const input = useRef<HTMLInputElement>(null);
    const root = useRef<HTMLDivElement>(null);
    const generations = useRef({ type: 0, draw: 0, upload: 0 });
    const mounted = useRef(false);
    const committed = useRef({ props, active, enabled });
    const operation = useRef<{
        authority: SignatureAuthority;
        generation: number;
    } | null>(null);
    const sequence = useRef(0);
    const instance = useId();
    const commitEffect =
        typeof window === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        committed.current = { props, active, enabled };
        mounted.current = true;
        if (
            operation.current != null &&
            operation.current.authority.method !== active
        ) {
            operation.current = null;
            setBusy(false);
            setError(null);
        }
    });
    commitEffect(
        () => () => {
            mounted.current = false;
            operation.current = null;
        },
        []
    );

    const clear = (method: SignatureMethod) => {
        generations.current[method]++;
        if (method === 'type') setTyped('');
        else if (method === 'upload') {
            setFile(null);
            if (input.current != null) input.current.value = '';
        } else canvas.current?.clear();
    };
    useEffect(() => {
        if (active === selected) return;
        clear(selected);
        if (active != null) setSelected(active);
    }, [active, selected]);

    const empty =
        active === 'type'
            ? typed.trim() === ''
            : active === 'upload'
              ? file == null
              : emptyCanvas;
    const report = (recovery: SignatureRecovery) => {
        // A consumer reporter must not change lease settlement or trigger a retry.
        try {
            props.onRecovery(recovery);
        } catch {
            /* host reporter owns delivery */
        }
    };
    const save = async () => {
        if (active == null || empty || operation.current != null || uncertain)
            return;
        if (active === 'upload' && file != null) {
            if (!acceptedTypes.includes(file.type)) {
                setError(messages.invalidType);
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                setError(messages.tooLarge);
                return;
            }
        }
        const authority: SignatureAuthority = {
            ownerIdentity: props.ownerIdentity,
            fieldId: props.id,
            method: active,
            operationId: `${instance}:${++sequence.current}`,
        };
        const admitted = { authority, generation: generations.current[active] };
        operation.current = admitted;
        setBusy(true);
        setError(null);
        const current = () =>
            mounted.current &&
            operation.current === admitted &&
            committed.current.active === active;
        try {
            let upload: File;
            if (active === 'upload' && file != null) upload = file;
            else {
                let data: string | undefined;
                if (active === 'draw') data = canvas.current?.toDataURL();
                else {
                    const surface =
                        root.current?.ownerDocument.createElement('canvas');
                    if (surface == null)
                        throw new Error('Unable to create signature canvas');
                    surface.width = 600;
                    surface.height = 200;
                    const context = surface.getContext('2d');
                    if (context == null)
                        throw new Error('Unable to create signature canvas');
                    context.fillStyle = '#ffffff';
                    context.fillRect(0, 0, 600, 200);
                    context.fillStyle = '#000000';
                    context.font = `48px ${font}`;
                    context.textAlign = 'center';
                    context.textBaseline = 'middle';
                    context.fillText(typed, 300, 100);
                    data = surface.toDataURL('image/png');
                }
                if (data == null)
                    throw new Error('Unable to export signature canvas');
                const bytes = Uint8Array.from(
                    atob(data.slice(data.indexOf(',') + 1)),
                    (char) => char.charCodeAt(0)
                );
                upload = new File(
                    [bytes],
                    `${sequence.current}-signature.png`,
                    { type: 'image/png' }
                );
            }
            const temporary = await props.storage.store(upload, authority);
            const receipt = new SignatureReceipt(temporary, authority);
            const state = await receipt.settle(
                () =>
                    current()
                        ? {
                              value: committed.current.props.value,
                              append: committed.current.props.appendCurrent,
                          }
                        : null,
                report
            );
            if (!current()) return;
            if (state === 'uncertain') {
                setUncertain(true);
                setError(messages.recoveryRequired);
            } else if (
                state === 'transferred' &&
                generations.current[active] === admitted.generation
            )
                clear(active);
        } catch (failure) {
            report({
                authority,
                phase: 'store',
                error: failure,
                state: 'uncertain',
            });
            if (current()) setError(messages.saveError);
        } finally {
            if (current()) {
                operation.current = null;
                setBusy(false);
            }
        }
    };
    const reuse = () => {
        if (active == null || !empty || busy || uncertain) return;
        const current = committed.current.props;
        if (current.previousSignature == null) return;
        try {
            const result = current.appendCurrent({
                ownerIdentity: current.ownerIdentity,
                fieldId: current.id,
                method: active,
                operationId: `${instance}:${++sequence.current}`,
                attachment: current.previousSignature,
                value: current.value,
            });
            if (result === 'appended') clear(active);
            else if (result !== 'retired')
                throw new Error('Unknown signature append outcome');
        } catch (failure) {
            const authority = {
                ownerIdentity: current.ownerIdentity,
                fieldId: current.id,
                method: active,
                operationId: `${instance}:${sequence.current}`,
            };
            report({
                authority,
                phase: 'append',
                error: failure,
                state: 'uncertain',
            });
            setUncertain(true);
            setError(messages.recoveryRequired);
        }
    };
    const button = (
        label: string,
        onClick: () => void,
        disabled: boolean,
        primary = false
    ) =>
        h(
            ActionButton,
            {
                className: `mx-sdk-signature-button${primary ? ' mx-sdk-signature-primary' : ''}`,
                onClick,
                disabled,
            },
            label
        );
    return h(
        'div',
        {
            ref: root,
            className: ['mx-sdk-signature', props.className]
                .filter(Boolean)
                .join(' '),
            'data-testid': 'signature-field-test-id',
        },
        active == null
            ? h('div', { role: 'alert' }, messages.noMethods)
            : h(
                  'div',
                  null,
                  enabled.length > 1 &&
                      h(
                          'div',
                          {
                              role: 'tablist',
                              className: 'mx-sdk-signature-tabs',
                              'aria-label': messages.methodLabel,
                          },
                          ...enabled.map((method) =>
                              h(
                                  'button',
                                  {
                                      key: method,
                                      type: 'button',
                                      role: 'tab',
                                      'aria-selected': method === active,
                                      onClick: () => {
                                          setSelected(method);
                                          setError(null);
                                      },
                                  },
                                  messages[method]
                              )
                          )
                      ),
                  active === 'type' &&
                      h(
                          'div',
                          null,
                          h('input', {
                              id: props.id,
                              type: 'text',
                              value: typed,
                              placeholder: messages.typePlaceholder,
                              'aria-label': messages.typePlaceholder,
                              onChange: (event) => {
                                  generations.current.type++;
                                  setTyped(event.currentTarget.value);
                              },
                          }),
                          typed !== '' &&
                              h(
                                  'div',
                                  {
                                      className:
                                          'mx-sdk-signature-type-preview',
                                      style: { fontFamily: font },
                                  },
                                  typed
                              )
                      ),
                  active === 'draw' &&
                      h(
                          'div',
                          { className: 'mx-sdk-signature-draw' },
                          emptyCanvas && h('p', null, messages.signHere),
                          h(SignatureCanvas, {
                              ref: canvas,
                              id: props.id,
                              label: messages.signHere,
                              onDraft: (empty) => {
                                  generations.current.draw++;
                                  setEmptyCanvas(empty);
                              },
                          })
                      ),
                  active === 'upload' &&
                      h(
                          'div',
                          { className: 'mx-sdk-signature-upload' },
                          h('input', {
                              ref: input,
                              id: props.id,
                              type: 'file',
                              accept: acceptedTypes.join(','),
                              'aria-label': messages.selectImage,
                              onChange: (event) => {
                                  const next = event.currentTarget.files?.[0];
                                  if (next != null) {
                                      generations.current.upload++;
                                      setFile(next);
                                  }
                              },
                          }),
                          h('p', null, file?.name ?? messages.selectImage),
                          h(
                              'small',
                              null,
                              file != null
                                  ? `${(file.size / 1024).toFixed(2)} KB`
                                  : messages.imageHelp
                          )
                      ),
                  (uncertain || error != null) &&
                      h(
                          'p',
                          {
                              role: 'alert',
                              className: 'mx-sdk-signature-error',
                          },
                          uncertain ? messages.recoveryRequired : error
                      ),
                  h(
                      'div',
                      { className: 'mx-sdk-signature-actions' },
                      props.previousSignature != null && empty
                          ? button(
                                messages.attachPrevious,
                                reuse,
                                busy || uncertain
                            )
                          : button(
                                messages.clear,
                                () => clear(active),
                                empty || busy
                            ),
                      button(
                          busy ? messages.saving : messages.sign,
                          () => void save(),
                          empty || busy || uncertain,
                          true
                      )
                  )
              )
    );
}
