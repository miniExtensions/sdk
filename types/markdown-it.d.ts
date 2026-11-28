declare module 'markdown-it' {
    export default function markdownIt(): {
        parse(
            text: string,
            environment: Record<string, unknown>
        ): readonly {
            type: string;
            map: readonly [number, number] | null;
        }[];
    };
}
