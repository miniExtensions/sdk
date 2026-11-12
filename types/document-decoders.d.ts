declare module 'papaparse' {
    const parser: {
        parse(
            text: string,
            options: {
                delimiter: string;
                dynamicTyping: false;
                worker: false;
                download: false;
            }
        ): { data: string[][]; errors: { code: string; message: string }[] };
    };
    export default parser;
}

declare module 'utif2' {
    export type Directory = {
        width?: number;
        height?: number;
        t256?: number[];
        t257?: number[];
    };
    const decoder: {
        decode(bytes: ArrayBuffer): Directory[];
        decodeImage(bytes: ArrayBuffer, directory: Directory): void;
        toRGBA8(directory: Directory): Uint8Array;
    };
    export default decoder;
}
