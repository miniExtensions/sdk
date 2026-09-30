export const element = <Tag extends keyof HTMLElementTagNameMap>(
    tag: Tag,
    text?: string,
    className?: string
): HTMLElementTagNameMap[Tag] => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className != null) node.className = className;
    return node;
};

export const inputById = (id: string): HTMLInputElement => {
    const node = document.getElementById(id);
    if (!(node instanceof HTMLInputElement)) {
        throw new Error(`Missing input ${id}.`);
    }
    return node;
};

export const nodeById = (id: string): HTMLElement => {
    const node = document.getElementById(id);
    if (node == null) throw new Error(`Missing element ${id}.`);
    return node;
};

export const button = (
    text: string,
    action: () => void,
    className = 'secondary'
): HTMLButtonElement => {
    const node = element('button', text, className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
};

export const labeled = <Control extends HTMLElement>(
    title: string,
    control: Control
): HTMLLabelElement => {
    const label = element('label', title);
    label.append(control);
    return label;
};

export const settings = (
    publicFields: import('@miniextensions/sdk').JsonObject
): import('@miniextensions/sdk').JsonObject => {
    const state = publicFields.state;
    const isSettings = (
        value: unknown
    ): value is import('@miniextensions/sdk').JsonObject =>
        typeof value === 'object' && value != null && !Array.isArray(value);
    return isSettings(state) ? state : {};
};
