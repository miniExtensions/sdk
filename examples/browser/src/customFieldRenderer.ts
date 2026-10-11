import type { FormFieldBinding } from '@miniextensions/sdk/forms';

/** App-supplied rendering: the binding owns all policy, native state and requests. */
export function mountCustomField(
    binding: FormFieldBinding,
    document: Document
) {
    const node = document.createElement('section');
    const title = document.createElement('span');
    const body = document.createElement('div');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    node.append(title, body, status);
    const input = document.createElement('input');
    let retired = false;
    let durationListeners = false;
    const onFocus = () => {
        if (!retired && body.contains(input))
            binding.scalar?.setFocused?.(true);
    };
    const onBlur = () => {
        if (!retired && body.contains(input))
            binding.scalar?.setFocused?.(false);
    };
    const listenForDuration = (enabled: boolean) => {
        if (durationListeners === enabled) return;
        durationListeners = enabled;
        if (enabled) {
            input.addEventListener('focus', onFocus);
            input.addEventListener('blur', onBlur);
        } else {
            input.removeEventListener('focus', onFocus);
            input.removeEventListener('blur', onBlur);
        }
    };
    input.addEventListener('input', () => {
        if (retired || !binding.getSnapshot().canEdit) return;
        if (binding.date) binding.date.setInput(input.value);
        else if (binding.scalar) {
            if (binding.scalar.getState().kind === 'checkbox')
                binding.scalar.setChecked(input.checked);
            else binding.scalar.setInput(input.value);
        } else binding.setValue(input.value || null);
    });
    const stop = binding.subscribe((snapshot) => {
        listenForDuration(
            !snapshot.retired && snapshot.scalar?.kind === 'duration'
        );
        node.hidden = snapshot.visibility.type !== 'visible';
        node.inert = snapshot.retired;
        title.textContent = snapshot.field?.title ?? '';
        status.textContent =
            snapshot.date?.error ??
            snapshot.scalar?.error ??
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n');
        status.setAttribute('aria-busy', String(snapshot.pending));
        if (snapshot.retired) {
            body.replaceChildren();
            return;
        }
        if (
            !status.textContent &&
            snapshot.selectAvailability?.status === 'blocked'
        ) {
            // Application-owned localized wording; the SDK returns finite codes only.
            const code = snapshot.selectAvailability.code;
            status.textContent =
                code === 'unsupported-condition' || code === 'invalid-condition'
                    ? 'Choices are unavailable for this configuration.'
                    : 'Choices are temporarily unavailable.';
        } else if (
            !status.textContent &&
            snapshot.selectAvailability?.status === 'ready' &&
            snapshot.selection?.options.length === 0
        ) {
            status.textContent = snapshot.selection.searchTerm.trim()
                ? 'No matching choices.'
                : 'No choices available.';
        }
        if (snapshot.selection && binding.selection) {
            body.replaceChildren();
            const available = new Map(
                [
                    ...snapshot.selection.options,
                    ...snapshot.selection.selectedOptions,
                ].map((option) => [option.value, option])
            );
            for (const option of available.values()) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = option.label;
                button.setAttribute(
                    'aria-pressed',
                    String(snapshot.selection.value.includes(option.value))
                );
                button.disabled = !snapshot.canEdit || option.disabled === true;
                button.addEventListener('click', () => {
                    if (retired || !binding.getSnapshot().canEdit) return;
                    binding.selection!.toggle(option.value);
                });
                body.append(button);
            }
        } else if (snapshot.date) {
            input.setAttribute('aria-label', snapshot.field?.title ?? '');
            const config = snapshot.field?.schema.miniExtConfig;
            input.type =
                config &&
                'obscurePassword' in config &&
                config.obscurePassword === true
                    ? 'password'
                    : 'text';
            input.inputMode = '';
            input.disabled = !snapshot.date.canEdit;
            input.value = snapshot.date.input;
            input.setAttribute('aria-invalid', String(!snapshot.date.valid));
            if (!body.contains(input)) body.replaceChildren(input);
        } else if (snapshot.scalar) {
            input.setAttribute('aria-label', snapshot.field?.title ?? '');
            input.type =
                snapshot.scalar.kind === 'checkbox' ? 'checkbox' : 'text';
            input.inputMode =
                snapshot.scalar.kind === 'number' ? 'decimal' : '';
            input.disabled = !snapshot.canEdit;
            input.checked = snapshot.scalar.checked;
            input.value = snapshot.scalar.input;
            input.setAttribute('aria-invalid', String(!snapshot.scalar.valid));
            if (!body.contains(input)) body.replaceChildren(input);
        } else if (snapshot.field?.fieldType === 'singleLineText') {
            input.setAttribute('aria-label', snapshot.field.title);
            const config = snapshot.field.schema.miniExtConfig;
            input.type =
                config &&
                'obscurePassword' in config &&
                config.obscurePassword === true
                    ? 'password'
                    : 'text';
            input.disabled = !snapshot.canEdit;
            input.value =
                typeof snapshot.value === 'string' ? snapshot.value : '';
            if (!body.contains(input)) body.replaceChildren(input);
        } else
            body.textContent =
                'This example custom renderer does not handle this field type.';
    });
    return {
        node,
        destroy() {
            if (retired) return;
            retired = true;
            listenForDuration(false);
            stop();
            node.remove();
        },
    };
}
