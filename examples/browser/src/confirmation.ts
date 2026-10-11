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
    return new Promise((resolve) => {
        const trigger = document.activeElement;
        const dialog = element('dialog', undefined, 'confirmation');
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
        let settled = false;
        const cancelOwn = (): void => finish(false);
        const finish = (accepted: boolean): void => {
            if (settled) return;
            settled = true;
            const ownsPrompt = pending === cancelOwn;
            if (ownsPrompt) pending = null;
            options.signal?.removeEventListener('abort', cancelOwn);
            if (dialog.open) dialog.close();
            dialog.remove();
            if (
                ownsPrompt &&
                pending == null &&
                trigger instanceof HTMLElement &&
                trigger.isConnected
            )
                trigger.focus();
            resolve(accepted);
        };
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
                dialog.append(element('p', 'No nonempty answers to review.'));
            else dialog.append(rows);
        }
        dialog.append(actions);
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            finish(false);
        });
        dialog.addEventListener('close', () => finish(false));
        pending = cancelOwn;
        options.signal?.addEventListener('abort', cancelOwn, { once: true });
        document.body.append(dialog);
        try {
            dialog.showModal();
            // Escape and Enter on the initial focus both cancel the action.
            cancel.focus();
        } catch {
            finish(false);
        }
    });
};
