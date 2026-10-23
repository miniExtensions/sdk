import type { FormLinkedChildRecovery } from '@miniextensions/sdk/forms';
import { requestConfirmation } from './confirmation.js';
import { captureReviewDateContext, prepareFormReviewRows } from './review.js';

/** Stable presentation adapter; the configured child owner retains Save authority. */
export const createLinkedChildReview =
    (options: {
        isCurrent(): boolean;
        status(message: string, error?: boolean): void;
    }): NonNullable<FormLinkedChildRecovery['review']> =>
    async (request) => {
        const presentation = new AbortController();
        const abort = () => presentation.abort();
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) abort();
        let confirmed = false;
        try {
            const dateContext = captureReviewDateContext();
            const rows = prepareFormReviewRows(
                request.loaded,
                request.draft.data,
                undefined,
                dateContext
            );
            const clientDateZoneRequired = rows.some(({ fieldId }) => {
                const config =
                    request.loaded.payload.fieldIdsToSchemas[fieldId]
                        ?.airtableField.config;
                return (
                    config?.type === 'dateTime' &&
                    config.options.timeZone === 'client'
                );
            });
            const current = () => {
                if (presentation.signal.aborted) return false;
                const accepted =
                    options.isCurrent() &&
                    request.isCurrent() &&
                    (!clientDateZoneRequired ||
                        captureReviewDateContext().clientTimeZone ===
                            dateContext.clientTimeZone) &&
                    options.isCurrent() &&
                    request.isCurrent();
                if (!accepted) abort();
                return accepted;
            };
            if (!current()) return { type: 'edit' };
            const accepted = await requestConfirmation({
                title: 'Review child answers',
                message:
                    'Choose Edit to return to the child Form, or Confirm to save these answers.',
                confirmLabel: 'Confirm',
                cancelLabel: 'Edit',
                rows,
                signal: presentation.signal,
            });
            if (!accepted || !current()) return { type: 'edit' };
            confirmed = true;
            // The page owner aborts request.signal after settlement. Keep forwarding
            // that retirement through validation and the sole allocated Save.
            return {
                type: 'confirm',
                signal: presentation.signal,
                isCurrent: current,
            };
        } catch {
            if (options.isCurrent())
                options.status(
                    'Review is unavailable for this child Form. No Save was sent.',
                    true
                );
            return { type: 'edit' };
        } finally {
            if (!confirmed) {
                request.signal.removeEventListener('abort', abort);
                abort();
            }
        }
    };
