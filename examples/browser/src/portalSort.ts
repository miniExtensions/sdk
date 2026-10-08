import {
    createPortalSortEditor,
    type PortalEditorOptions,
} from '@miniextensions/sdk/portals';
import { button, element, labeled } from './dom.js';
export type PortalSortEditor =
    | { type: 'ready'; node: HTMLElement; destroy(): void }
    | { type: 'unavailable'; diagnostic: string };
/** Stock markup only; the shared model owns eligibility and prepared criteria. */
export function mountPortalSortEditor(
    options: PortalEditorOptions
): PortalSortEditor {
    const node = element('section');
    node.setAttribute('aria-label', 'Portal sorting');
    let mounted = false;
    const result = createPortalSortEditor({
        ...options,
        isCurrent: () => (!mounted || node.isConnected) && options.isCurrent(),
    });
    if (result.type === 'unavailable') return result;
    const model = result.model,
        initial = model.getSnapshot();
    const field = element('select');
    field.append(new Option('Use configured order', ''));
    for (const f of initial.fields)
        field.append(new Option(`${f.name} (${f.id})`, f.id));
    const direction = element('select');
    direction.append(
        new Option('Ascending', 'asc'),
        new Option('Descending', 'desc')
    );
    const apply = button(
        initial.unresolved ? 'Replace existing sorts' : 'Apply sort',
        () => {
            if (!node.isConnected) {
                model.destroy();
                return;
            }
            mounted = true;
            const id = field.value,
                order = direction.value as 'asc' | 'desc';
            model.setField(id);
            model.setDirection(order);
            model.apply();
        }
    );
    const render = () => {
        if (node.isConnected) mounted = true;
        const s = model.getSnapshot();
        field.value = s.fieldId;
        direction.value = s.direction;
        node.inert = s.retired;
        field.disabled = direction.disabled = apply.disabled = s.retired;
    };
    field.addEventListener('change', () => {
        if (!node.isConnected) {
            model.destroy();
            return;
        }
        mounted = true;
        model.setField(field.value);
    });
    direction.addEventListener('change', () => {
        if (!node.isConnected) {
            model.destroy();
            return;
        }
        mounted = true;
        model.setDirection(direction.value as 'asc' | 'desc');
    });
    if (initial.unresolved)
        node.append(
            element(
                'p',
                'Existing multiple or unresolved sorts are preserved. Choose Replace existing sorts to explicitly replace them.'
            )
        );
    node.append(
        labeled('Sort field', field),
        labeled('Sort direction', direction),
        apply
    );
    // Before mounting, initialize from the captured state without observing DOM ownership.
    field.value = initial.fieldId;
    direction.value = initial.direction;
    const stop = model.subscribe(render);
    return {
        type: 'ready',
        node,
        destroy() {
            stop();
            model.destroy();
            node.inert = true;
            field.disabled = direction.disabled = apply.disabled = true;
        },
    };
}
