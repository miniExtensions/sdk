import { button, element } from './dom.js';

export type ConfirmationOptions = {
    title: string;
    message: string;
    confirmLabel: string;
};
let pending: (() => void) | null = null;

/** Context changes settle the prompt as cancelled, never as permission. */
export const cancelConfirmation = (): void => {
    pending?.();
};

/** A visible DOM dialog keeps focus and keyboard actions in the application. */
export const requestConfirmation = (
    options: ConfirmationOptions
): Promise<boolean> => {
    cancelConfirmation();
    return new Promise((resolve) => {
        const trigger = document.activeElement;
        const dialog = element('dialog', undefined, 'confirmation');
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'confirmation-title');
        dialog.setAttribute('aria-describedby', 'confirmation-message');
        const title = element('h2', options.title);
        title.id = 'confirmation-title';
        const message = element('p', options.message);
        message.id = 'confirmation-message';
        let settled = false;
        const finish = (accepted: boolean): void => {
            if (settled) return;
            settled = true;
            pending = null;
            if (dialog.open) dialog.close();
            dialog.remove();
            if (trigger instanceof HTMLElement && trigger.isConnected)
                trigger.focus();
            resolve(accepted);
        };
        const cancel = button('Cancel', () => finish(false));
        const confirm = button(
            options.confirmLabel,
            () => finish(true),
            'danger'
        );
        const actions = element('div', undefined, 'actions');
        actions.append(cancel, confirm);
        dialog.append(title, message, actions);
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            finish(false);
        });
        dialog.addEventListener('close', () => finish(false));
        pending = () => finish(false);
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
