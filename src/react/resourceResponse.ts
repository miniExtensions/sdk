/** A response belongs to one accepted resource lifetime, never to a field writer. */
export async function readResourceResponse(
    response: Response,
    signal: AbortSignal,
    isCurrent: () => boolean,
    progress?: (received: number, length: number | null) => void
): Promise<ArrayBuffer[]> {
    const body = response.body;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let completed = false;
    const current = () => !signal.aborted && isCurrent();
    const cancel = () => {
        const resource = reader ?? body;
        if (resource !== null) {
            try {
                void resource.cancel().catch(() => {});
            } catch {
                // A concurrent retirement can already have released it.
            }
        }
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        if (!current()) throw Error('Resource retired');
        if (!response.ok || body === null) throw Error('Resource unavailable');
        reader = body.getReader();
        const rawLength = Number(response.headers.get('Content-Length'));
        const length =
            Number.isFinite(rawLength) && rawLength > 0 ? rawLength : null;
        const chunks: ArrayBuffer[] = [];
        let received = 0;
        while (current()) {
            const result = await reader.read();
            if (!current()) throw Error('Resource retired');
            if (result.done) {
                completed = true;
                return chunks;
            }
            const chunk = new Uint8Array(result.value).buffer;
            chunks.push(chunk);
            received += chunk.byteLength;
            progress?.(received, length);
        }
        throw Error('Resource retired');
    } finally {
        signal.removeEventListener('abort', cancel);
        if (!completed) cancel();
        reader?.releaseLock();
        // The caller classifies an owned failure before aborting its controller.
    }
}
