/** Render-owned selections, separate from native attachment answers. */
export function createPendingFiles(owns: () => boolean, changed: () => void) {
    let retired = false;
    let revision = 0;
    const entries = new Map<
        HTMLInputElement,
        { generation: number; file: File | null; listener: () => void }
    >();
    const current = () => !retired && owns();
    const observe = (input: HTMLInputElement) => {
        const entry = entries.get(input);
        if (entry == null || !current()) return null;
        const file = input.files?.[0] ?? null;
        if (entry.file !== file) {
            entry.file = file;
            entry.generation++;
            revision++;
        }
        return entry;
    };
    return {
        register(input: HTMLInputElement): void {
            const listener = () => {
                if (!current()) return;
                const entry = entries.get(input)!;
                entry.file = input.files?.[0] ?? null;
                entry.generation++;
                revision++;
                changed();
            };
            entries.set(input, { generation: 0, file: null, listener });
            input.addEventListener('change', listener);
        },
        capture(input: HTMLInputElement) {
            const entry = observe(input);
            return entry?.file == null
                ? null
                : { input, generation: entry.generation, file: entry.file };
        },
        clear(
            input: HTMLInputElement,
            accepted?: { generation: number; file: File }
        ): boolean {
            const entry = observe(input);
            if (
                entry == null ||
                (accepted != null &&
                    (entry.generation !== accepted.generation ||
                        entry.file !== accepted.file))
            )
                return false;
            input.value = '';
            entry.file = null;
            entry.generation++;
            revision++;
            changed();
            return true;
        },
        pending(): boolean {
            for (const input of entries.keys())
                if (observe(input)?.file != null) return true;
            return false;
        },
        revision(): number {
            for (const input of entries.keys()) observe(input);
            return revision;
        },
        retire(): void {
            retired = true;
            revision++;
            for (const [input, entry] of entries)
                input.removeEventListener('change', entry.listener);
            entries.clear();
        },
    };
}
