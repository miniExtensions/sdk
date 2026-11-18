import type { RuntimeSortField } from '../runtime/index.js';

export type PortalVisitorSortStamp = Readonly<{
    sessionId: string;
    fieldId: string;
    viewId: string | null;
    configurationRevision: string | number;
    metadataRevision: string | number;
    /** Increases on owner transitions, including a return to the same view. */
    generation: number;
}>;

export type PortalVisitorSortField = Readonly<{
    id: string;
    /** Source field name used for an unambiguous legacy name reference. */
    name: string;
    label?: string;
}>;

export type PortalVisitorSortFrame = Readonly<{
    stamp: PortalVisitorSortStamp;
    fields: readonly PortalVisitorSortField[];
    criteria: readonly RuntimeSortField[];
}>;

export type PortalVisitorSortCommand = Readonly<{
    stamp: PortalVisitorSortStamp;
    criteria: readonly RuntimeSortField[];
}>;

export type PortalVisitorSortOutcome =
    | Readonly<{ type: 'allocated'; requestId: string; generation: number }>
    | Readonly<{ type: 'unchanged' | 'stale' }>
    | Readonly<{
          type: 'refused' | 'uncertain';
          /** Set only when this command's own criteria publication was verified. */
          committedGeneration?: number;
      }>;

export type PortalVisitorSortPort = {
    /** The host may provide this before a row collection has been accepted. */
    read(): PortalVisitorSortFrame | null;
    subscribe(listener: () => void): () => void;
    /**
     * Verify the command stamp before any preference write and revalidate the
     * installed request against its active owner before invoking transport.
     * Report allocation only after transport is invoked. Later network
     * completion and any retained rows belong to the host. If the command
     * publishes criteria before a refused or uncertain read, include the
     * verified generation of that publication.
     */
    apply(
        command: PortalVisitorSortCommand
    ): PortalVisitorSortOutcome | Promise<PortalVisitorSortOutcome>;
};

type Rule = { key: number; value: RuntimeSortField };
export type PortalVisitorSortRule = Readonly<{
    key: number;
    fieldId: string | null;
    direction: RuntimeSortField['type'];
    availableFields: readonly PortalVisitorSortField[];
}>;

function referenceKey(rule: RuntimeSortField) {
    const ref = rule.idOrName;
    return ref.type === 'id' ? ref.id : ref.name;
}

function equalRules(
    first: readonly RuntimeSortField[],
    second: readonly RuntimeSortField[]
) {
    return (
        first.length === second.length &&
        first.every((rule, index) => {
            const other = second[index];
            return (
                rule.type === other.type &&
                rule.idOrName.type === other.idOrName.type &&
                referenceKey(rule) === referenceKey(other)
            );
        })
    );
}

function equalScope(
    captured: PortalVisitorSortFrame,
    live: PortalVisitorSortFrame
) {
    const a = captured.stamp;
    const b = live.stamp;
    return (
        a.sessionId === b.sessionId &&
        a.fieldId === b.fieldId &&
        a.viewId === b.viewId &&
        a.configurationRevision === b.configurationRevision &&
        a.metadataRevision === b.metadataRevision &&
        captured.fields.length === live.fields.length &&
        captured.fields.every((field, index) => {
            const other = live.fields[index];
            return (
                field.id === other.id &&
                field.name === other.name &&
                field.label === other.label
            );
        })
    );
}

function readFrame(port: PortalVisitorSortPort): PortalVisitorSortFrame | null {
    try {
        const frame = port.read();
        if (!frame) return null;
        const { stamp, fields, criteria } = frame;
        const revision = (value: string | number) =>
            typeof value === 'string'
                ? value.length > 0
                : Number.isSafeInteger(value);
        if (
            typeof stamp.sessionId !== 'string' ||
            !stamp.sessionId ||
            typeof stamp.fieldId !== 'string' ||
            !stamp.fieldId ||
            !(stamp.viewId === null || typeof stamp.viewId === 'string') ||
            !revision(stamp.configurationRevision) ||
            !revision(stamp.metadataRevision) ||
            !Number.isSafeInteger(stamp.generation) ||
            stamp.generation < 0 ||
            !Array.isArray(fields) ||
            !Array.isArray(criteria) ||
            new Set(fields.map((field) => field.id)).size !== fields.length ||
            fields.some(
                (field) =>
                    typeof field.id !== 'string' ||
                    !field.id ||
                    typeof field.name !== 'string' ||
                    !field.name ||
                    (field.label !== undefined &&
                        typeof field.label !== 'string')
            ) ||
            criteria.some(
                (rule) =>
                    (rule.type !== 'asc' && rule.type !== 'desc') ||
                    (rule.idOrName.type !== 'id' &&
                        rule.idOrName.type !== 'name') ||
                    typeof referenceKey(rule) !== 'string' ||
                    !referenceKey(rule)
            )
        )
            return null;
        return structuredClone({ stamp, fields, criteria });
    } catch {
        return null;
    }
}

function outcomeOf(value: PortalVisitorSortOutcome): PortalVisitorSortOutcome {
    switch (value?.type) {
        case 'allocated':
            if (
                typeof value.requestId === 'string' &&
                value.requestId.length > 0 &&
                Number.isSafeInteger(value.generation) &&
                value.generation >= 0
            )
                return {
                    type: 'allocated',
                    requestId: value.requestId,
                    generation: value.generation,
                };
            break;
        case 'stale':
        case 'unchanged':
            return { type: value.type };
        case 'refused':
        case 'uncertain': {
            const generation = value.committedGeneration;
            if (generation === undefined) return { type: value.type };
            if (Number.isSafeInteger(generation) && generation >= 0)
                return {
                    type: value.type,
                    committedGeneration: generation,
                };
            break;
        }
    }
    return { type: 'uncertain' };
}

/** Owns one dialog draft and one commit attempt. It never reads records. */
export function createPortalVisitorSortDraft(port: PortalVisitorSortPort) {
    const captured = readFrame(port);
    if (!captured) return null;
    let nextKey = 0;
    let retired = false;
    let submitted: RuntimeSortField[] | undefined;
    const rules: Rule[] = captured.criteria.map((value) => ({
        key: nextKey++,
        value,
    }));
    const current = () => {
        if (retired) return false;
        const live = readFrame(port);
        if (
            live &&
            equalScope(captured, live) &&
            live.stamp.generation === captured.stamp.generation &&
            equalRules(captured.criteria, live.criteria)
        )
            return true;
        retired = true;
        return false;
    };
    const resolvedField = (rule: Rule) => {
        const ref = rule.value.idOrName;
        if (ref.type === 'id')
            return captured.fields.find((field) => field.id === ref.id);
        const fits = captured.fields.filter((field) => field.name === ref.name);
        return fits.length === 1 ? fits[0] : undefined;
    };
    const available = (key?: number) => {
        const used = new Set(
            rules
                .filter((rule) => rule.key !== key)
                .map((rule) => resolvedField(rule)?.id)
        );
        return captured.fields.filter((field) => !used.has(field.id));
    };
    const find = (key: number) => rules.find((rule) => rule.key === key);
    return {
        current,
        snapshot() {
            return {
                canAdd: available().length > 0,
                rules: rules.map((rule): PortalVisitorSortRule => {
                    const selected = resolvedField(rule);
                    const fields = available(rule.key);
                    if (
                        selected &&
                        !fields.some((field) => field.id === selected.id)
                    )
                        fields.unshift(selected);
                    return {
                        key: rule.key,
                        fieldId: selected?.id ?? null,
                        direction: rule.value.type,
                        availableFields: structuredClone(fields),
                    };
                }),
            };
        },
        add(): number | null {
            if (!current()) return null;
            const field = available()[0];
            if (!field) return null;
            const key = nextKey++;
            rules.push({
                key,
                value: { type: 'asc', idOrName: { type: 'id', id: field.id } },
            });
            return key;
        },
        setField(key: number, id: string): boolean {
            if (!current()) return false;
            const rule = find(key);
            const original = rule && resolvedField(rule);
            if (
                !rule ||
                !original ||
                original.id === id ||
                !available(key).some((field) => field.id === id)
            )
                return false;
            rule.value = {
                type: rule.value.type,
                idOrName: { type: 'id', id },
            };
            return true;
        },
        setDirection(
            key: number,
            direction: RuntimeSortField['type']
        ): boolean {
            if (!current() || (direction !== 'asc' && direction !== 'desc'))
                return false;
            const rule = find(key);
            if (!rule || !resolvedField(rule)) return false;
            rule.value = { ...rule.value, type: direction };
            return true;
        },
        remove(key: number): boolean {
            if (!current()) return false;
            const index = rules.findIndex((rule) => rule.key === key);
            if (index < 0) return false;
            rules.splice(index, 1);
            return true;
        },
        retire() {
            retired = true;
        },
        /** Keep late host feedback out of successor dialogs using the same port. */
        canReport(outcome: PortalVisitorSortOutcome): boolean {
            if (!submitted) return true;
            const live = readFrame(port);
            if (!live || !equalScope(captured, live)) return false;
            const generation = live.stamp.generation;
            if (generation === captured.stamp.generation)
                return (
                    equalRules(live.criteria, captured.criteria) ||
                    equalRules(live.criteria, submitted)
                );
            const attributedGeneration =
                outcome.type === 'allocated'
                    ? outcome.generation
                    : outcome.type === 'refused' || outcome.type === 'uncertain'
                      ? outcome.committedGeneration
                      : undefined;
            return (
                generation > captured.stamp.generation &&
                generation === attributedGeneration &&
                equalRules(live.criteria, submitted)
            );
        },
        async commit(): Promise<PortalVisitorSortOutcome> {
            if (!current()) return { type: 'stale' };
            retired = true;
            const next = rules.map((rule) => rule.value);
            if (equalRules(next, captured.criteria))
                return { type: 'unchanged' };
            submitted = next;
            try {
                return outcomeOf(
                    await port.apply(
                        structuredClone({
                            stamp: captured.stamp,
                            criteria: next,
                        })
                    )
                );
            } catch {
                return { type: 'uncertain' };
            }
        },
    };
}
