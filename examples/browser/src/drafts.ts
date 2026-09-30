/** Each visitor owns one store; session and connection changes clear it. */
export type ParentFormDraftScope = {
    portalId: string;
    recordId: string;
    portalFieldId: string;
};
export type FormDraftScope = {
    extensionId: string;
    recordId: string | null;
    parent: ParentFormDraftScope | null;
};
export type FormDraftHandle = { readonly scope: string };
export type FormDraftSnapshot<Value> = {
    data: Record<string, Value>;
    dirtyFieldIds: string[];
};
export type DraftSelectChoice = {
    id: string;
    name: string;
    color?: string;
    newOption?: boolean;
};
type Draft<Value> = {
    handle: FormDraftHandle;
    data: Record<string, Value>;
    dirty: Set<string>;
    choices: Map<string, DraftSelectChoice[]>;
};

/** Native values stay in memory across rerenders, never in shared storage. */
export class FormDraftStore<Value> {
    private readonly drafts = new Map<string, Draft<Value>>();

    open(
        scope: FormDraftScope,
        initialValues: Readonly<Record<string, Value>>,
        initialDirtyFieldIds: readonly string[]
    ): FormDraftHandle {
        const key = JSON.stringify([
            scope.extensionId,
            scope.recordId,
            scope.parent?.portalId ?? null,
            scope.parent?.recordId ?? null,
            scope.parent?.portalFieldId ?? null,
        ]);
        const existing = this.drafts.get(key);
        if (existing != null) return existing.handle;
        const handle = { scope: key };
        this.drafts.set(key, {
            handle,
            data: structuredClone(initialValues),
            dirty: new Set(initialDirtyFieldIds),
            choices: new Map(),
        });
        return handle;
    }

    read(handle: FormDraftHandle, fieldId: string): Value | undefined {
        return structuredClone(this.owned(handle)?.data[fieldId]);
    }

    write(handle: FormDraftHandle, fieldId: string, value: Value): boolean {
        const draft = this.owned(handle);
        if (draft == null) return false;
        draft.data[fieldId] = structuredClone(value);
        draft.dirty.add(fieldId);
        return true;
    }

    snapshot(handle: FormDraftHandle): FormDraftSnapshot<Value> | null {
        const draft = this.owned(handle);
        return draft == null
            ? null
            : {
                  data: structuredClone(draft.data),
                  dirtyFieldIds: [...draft.dirty],
              };
    }

    addChoice(
        handle: FormDraftHandle,
        fieldId: string,
        choice: DraftSelectChoice
    ): boolean {
        const draft = this.owned(handle);
        if (draft == null) return false;
        draft.choices.set(fieldId, [
            ...(draft.choices.get(fieldId) ?? []).filter(
                (previous) => previous.id !== choice.id
            ),
            structuredClone(choice),
        ]);
        return true;
    }

    choices(handle: FormDraftHandle, fieldId: string): DraftSelectChoice[] {
        return structuredClone(this.owned(handle)?.choices.get(fieldId) ?? []);
    }

    discard(handle: FormDraftHandle): void {
        if (this.owned(handle) != null) this.drafts.delete(handle.scope);
    }

    clear(): void {
        this.drafts.clear();
    }

    private owned(handle: FormDraftHandle): Draft<Value> | undefined {
        const draft = this.drafts.get(handle.scope);
        return draft?.handle === handle ? draft : undefined;
    }
}
