type CursorScope = { previous: string; owners: number };
const scopes = new WeakMap<HTMLElement, CursorScope>();
/** Each overlay releases only its own claim and preserves an external change. */
export function claimKanbanCursor(body: HTMLElement): () => void {
    let scope = scopes.get(body);
    if (!scope) {
        scope = { previous: body.style.cursor, owners: 0 };
        scopes.set(body, scope);
        body.style.cursor = 'grabbing';
    }
    const owned = scope;
    owned.owners++;
    let active = true;
    return () => {
        if (!active) return;
        active = false;
        owned.owners--;
        if (owned.owners === 0) {
            scopes.delete(body);
            if (body.style.cursor === 'grabbing')
                body.style.cursor = owned.previous;
        }
    };
}
