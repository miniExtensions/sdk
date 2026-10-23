import { button, element } from './dom.js';

export type ConfirmationOptions = {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    rows?: readonly ConfirmationRow[];
    signal?: AbortSignal;
};
export type ConfirmationRow = {
    fieldId: string;
    title: string;
    value: string;
    hideTitle: boolean;
};
let pending: (() => void) | null = null;
let requestVersion = 0;

/** Context changes settle the prompt as cancelled, never as permission. */
export const cancelConfirmation = (): void => {
    pending?.();
};

/** A visible DOM dialog keeps focus and keyboard actions in the application. */
export const requestConfirmation = (
    options: ConfirmationOptions
): Promise<boolean> => {
    if (options.signal?.aborted) return Promise.resolve(false);
    const version = ++requestVersion;
    cancelConfirmation();
    // Focus restoration during prior cleanup may itself open a newer prompt.
    if (version !== requestVersion || options.signal?.aborted)
        return Promise.resolve(false);
    return new Promise<boolean>((resolve, reject) => {
        let trigger: Element | null = null;
        let dialog: HTMLDialogElement | null = null;
        let settled = false;
        const cancelOwn = (): void => finish(false);
        const current = () =>
            !settled &&
            pending === cancelOwn &&
            requestVersion === version &&
            !options.signal?.aborted;
        const finish = (accepted: boolean, failed = false): void => {
            if (settled) return;
            settled = true;
            const ownsPrompt = pending === cancelOwn;
            const cleanupVersion = requestVersion;
            if (ownsPrompt) pending = null;
            // Every cleanup step is confined to this captured prompt. A failure
            // must settle as refusal even when another cleanup step also fails.
            try {
                options.signal?.removeEventListener('abort', cancelOwn);
            } catch {
                failed = true;
            }
            if (dialog != null) {
                try {
                    if (dialog.open) dialog.close();
                } catch {
                    failed = true;
                }
                try {
                    dialog.remove();
                } catch {
                    failed = true;
                    try {
                        dialog.parentNode?.removeChild(dialog);
                    } catch {
                        // The settled handlers cannot authorize an action even
                        // if the browser also refuses removal of this node.
                    }
                }
            }
            try {
                if (
                    ownsPrompt &&
                    pending == null &&
                    requestVersion === cleanupVersion &&
                    trigger instanceof HTMLElement &&
                    trigger.isConnected
                )
                    trigger.focus();
            } catch {
                failed = true;
            }
            if (failed)
                reject(
                    new Error(
                        'The confirmation could not be displayed. No action was taken.'
                    )
                );
            else
                resolve(
                    accepted &&
                        ownsPrompt &&
                        pending == null &&
                        requestVersion === version &&
                        !options.signal?.aborted
                );
        };
        try {
            trigger = document.activeElement;
            dialog = element('dialog', undefined, 'confirmation');
            dialog.setAttribute(
                'role',
                options.rows == null ? 'alertdialog' : 'dialog'
            );
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-labelledby', 'confirmation-title');
            dialog.setAttribute('aria-describedby', 'confirmation-message');
            const title = element('h2', options.title);
            title.id = 'confirmation-title';
            const message = element('p', options.message);
            message.id = 'confirmation-message';
            const cancel = button(options.cancelLabel ?? 'Cancel', () =>
                finish(false)
            );
            const confirm = button(
                options.confirmLabel,
                () => finish(true),
                options.rows == null ? 'danger' : ''
            );
            const actions = element('div', undefined, 'actions');
            actions.append(cancel, confirm);
            dialog.append(title, message);
            if (options.rows != null) {
                dialog.dataset.formReview = '';
                const rows = element('dl');
                for (const [index, row] of options.rows.entries()) {
                    const label = element('dt', row.title);
                    label.id = `confirmation-review-label-${index}`;
                    label.dataset.reviewFieldId = row.fieldId;
                    label.dataset.reviewTitleHidden = String(row.hideTitle);
                    if (row.hideTitle) {
                        // Keep the canonical semantic title accessible while
                        // honoring its separate visual presentation setting.
                        label.style.position = 'absolute';
                        label.style.width = '1px';
                        label.style.height = '1px';
                        label.style.overflow = 'hidden';
                        label.style.clipPath = 'inset(100%)';
                    }
                    const value = element('dd', row.value);
                    value.setAttribute('aria-labelledby', label.id);
                    value.style.whiteSpace = 'pre-wrap';
                    rows.append(label, value);
                }
                if (options.rows.length === 0)
                    dialog.append(
                        element('p', 'No nonempty answers to review.')
                    );
                else dialog.append(rows);
            }
            dialog.append(actions);
            dialog.addEventListener('cancel', (event) => {
                event.preventDefault();
                finish(false);
            });
            dialog.addEventListener('close', () => finish(false));
            if (version !== requestVersion || options.signal?.aborted) {
                finish(false);
                return;
            }
            pending = cancelOwn;
            options.signal?.addEventListener('abort', cancelOwn, {
                once: true,
            });
            if (!current()) {
                finish(false);
                return;
            }
            document.body.append(dialog);
            if (!current()) {
                finish(false);
                return;
            }
            dialog.showModal();
            if (!current()) {
                finish(false);
                return;
            }
            // Escape and Enter on the initial focus both cancel the action.
            cancel.focus();
        } catch {
            finish(false, true);
        }
    });
};
