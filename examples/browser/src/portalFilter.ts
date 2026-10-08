import {
    createPortalFilterEditor,
    type PortalEditorOptions,
} from '@miniextensions/sdk/portals';
import { button, element, labeled } from './dom.js';
export type PortalFilterEditor =
    | { type: 'ready'; node: HTMLElement; destroy(): void }
    | { type: 'unavailable'; diagnostic: string };
/** Stock markup consumes the same prepared editor state as custom renderers. */
export function mountPortalScalarFilterEditor(
    options: PortalEditorOptions
): PortalFilterEditor {
    const node = element('section');
    node.setAttribute('aria-label', 'Portal condition filtering');
    let mounted = false;
    const result = createPortalFilterEditor({
        ...options,
        isCurrent: () => (!mounted || node.isConnected) && options.isCurrent(),
    });
    if (result.type === 'unavailable') return result;
    const model = result.model,
        initial = model.getSnapshot();
    const field = element('select');
    for (const f of initial.fields)
        field.append(new Option(`${f.name} (${f.id})`, f.id));
    const operator = element('select'),
        value = element('input');
    value.type = 'text';
    const bool = element('select');
    bool.append(new Option('False', 'false'), new Option('True', 'true'));
    const choices = element('select'),
        valueRow = labeled('Filter value', value),
        boolRow = labeled('Checkbox value', bool),
        choicesRow = labeled('Filter choices', choices);
    const message = element('p', '', 'hint');
    message.setAttribute('role', 'status');
    const replacement = button('Replace existing filters', () => {
        if (!node.isConnected) {
            model.destroy();
            return;
        }
        mounted = true;
        model.prepareReplacement();
    });
    const apply = button('Apply filter', () => {
            if (!node.isConnected) {
                model.destroy();
                return;
            }
            mounted = true;
            const id = field.value,
                op = operator.value,
                text = value.value,
                flag = bool.value === 'true',
                ids = Array.from(choices.selectedOptions)
                    .map((o) => o.value)
                    .filter((v) => v !== '');
            if (id !== model.getSnapshot().fieldId && !model.setField(id))
                return;
            if (!model.setOperator(op)) return;
            const kind = model.getSnapshot().operandKind;
            if (kind !== 'none')
                model.setOperand(
                    kind === 'choices' ? ids : kind === 'boolean' ? flag : text
                );
            model.apply();
        }),
        clear = button('Clear filter', () => {
            if (!node.isConnected) {
                model.destroy();
                return;
            }
            mounted = true;
            model.clear();
        });
    const readOperand = () => {
        if (!node.isConnected) {
            model.destroy();
            return;
        }
        mounted = true;
        const s = model.getSnapshot();
        if (s.operandKind === 'choices')
            model.setOperand(
                Array.from(choices.selectedOptions)
                    .map((o) => o.value)
                    .filter((v) => v !== '')
            );
        else if (s.operandKind === 'boolean')
            model.setOperand(bool.value === 'true');
        else if (s.operandKind === 'text') model.setOperand(value.value);
    };
    const render = () => {
        if (node.isConnected) mounted = true;
        const s = model.getSnapshot();
        field.value = s.fieldId;
        operator.replaceChildren(
            ...s.operators.map((op) => new Option(op, op))
        );
        operator.value = s.operator;
        choices.replaceChildren(
            new Option('Choose a choice', ''),
            ...s.choices.map((c) => new Option(c.name, c.id))
        );
        choices.multiple = s.multiple;
        for (const o of Array.from(choices.options))
            o.selected =
                Array.isArray(s.operand) && s.operand.includes(o.value);
        value.value = typeof s.operand === 'string' ? s.operand : '';
        bool.value = s.operand === true ? 'true' : 'false';
        for (const [row, control, kind] of [
            [valueRow, value, 'text'],
            [boolRow, bool, 'boolean'],
            [choicesRow, choices, 'choices'],
        ] as const) {
            control.hidden = s.operandKind !== kind;
            row.hidden = control.hidden;
            row.style.display = control.hidden ? 'none' : '';
        }
        message.textContent = s.diagnostic ?? '';
        node.inert = s.retired;
        for (const c of [field, operator, value, bool, choices])
            c.disabled = s.retired;
        apply.disabled = clear.disabled = s.retired || !s.replacementPrepared;
        replacement.disabled = s.retired || s.replacementPrepared;
    };
    field.addEventListener('change', () => {
        const id = field.value;
        readOperand();
        model.setField(id);
    });
    operator.addEventListener('change', () => {
        const op = operator.value;
        readOperand();
        model.setOperator(op);
    });
    value.addEventListener('input', readOperand);
    bool.addEventListener('change', readOperand);
    choices.addEventListener('change', readOperand);
    if (initial.unresolved) node.append(replacement);
    node.append(
        labeled('Filter field', field),
        labeled('Filter operator', operator),
        valueRow,
        boolRow,
        choicesRow,
        message,
        apply,
        clear
    );
    const stop = model.subscribe(render);
    render();
    return {
        type: 'ready',
        node,
        destroy() {
            stop();
            model.destroy();
            node.inert = true;
            for (const c of node.querySelectorAll<
                HTMLInputElement | HTMLSelectElement | HTMLButtonElement
            >('input,select,button'))
                c.disabled = true;
        },
    };
}
