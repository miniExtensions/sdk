import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    resourceOwnerCurrent,
    resourceOwnerGeneration,
    type ReadonlyResourceOwner,
} from './readonlyResourceOwner.js';

export type AttachmentDownloadOptions = {
    /** A URL explicitly granted for this selected occurrence. Null disables it. */
    url: string | null;
    filename?: string | null;
    /** Host identity for the occurrence, independent of its URL. */
    identity: unknown;
    owner?: ReadonlyResourceOwner;
    read(url: string): Promise<Response>;
    onError?(error: unknown): void;
};

export type AttachmentDownload = {
    progress: number | null;
    start(): Promise<void>;
};

const useCommitEffect =
    typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** An allocated read can finish, but only the current occurrence publishes it. */
export function useAttachmentDownload({
    url,
    filename,
    identity,
    owner,
    read,
    onError,
}: AttachmentDownloadOptions): AttachmentDownload {
    const generation = resourceOwnerGeneration(owner);
    const [ownerRevision, setOwnerRevision] = useState(0);
    const scope = useMemo(
        () => ({}),
        [url, filename, identity, owner, generation, ownerRevision]
    );
    const active = useRef<{
        scope: object;
        busy: boolean;
        retired: boolean;
    } | null>(null);
    const [status, setStatus] = useState<{
        scope: object;
        percent: number;
    } | null>(null);

    useCommitEffect(() => {
        const mounted = { scope, busy: false, retired: false };
        active.current = mounted;
        setStatus(null);
        let rotationPending = false;
        const retire = () => {
            mounted.retired = true;
            if (active.current === mounted) setStatus(null);
        };
        const observeOwner = () => {
            if (active.current !== mounted) return;
            const authorized = resourceOwnerCurrent(owner);
            const rotated = !Object.is(
                resourceOwnerGeneration(owner),
                generation
            );
            if (active.current !== mounted || (authorized && !rotated)) return;
            retire();
            // Keep observing a retired owner so a notified successor can start
            // without a host render or waiting for the old read to finish.
            if (rotated && !rotationPending) {
                rotationPending = true;
                setOwnerRevision((revision) => revision + 1);
            }
        };
        let unsubscribe: (() => void) | undefined;
        try {
            unsubscribe = owner?.subscribe?.(observeOwner);
            observeOwner();
        } catch {
            retire();
        }
        return () => {
            if (active.current === mounted) active.current = null;
            unsubscribe?.();
        };
    }, [scope, owner, generation]);

    const start = async () => {
        const mounted = active.current;
        if (
            url == null ||
            mounted?.scope !== scope ||
            mounted.busy ||
            mounted.retired
        )
            return;
        const current = () => {
            if (active.current !== mounted || mounted.retired) return false;
            if (
                !resourceOwnerCurrent(owner) ||
                !Object.is(resourceOwnerGeneration(owner), generation)
            )
                mounted.retired = true;
            return active.current === mounted && !mounted.retired;
        };
        mounted.busy = true;
        if (!current()) {
            mounted.busy = false;
            return;
        }
        const progress = (percent: number) => setStatus({ scope, percent });
        progress(0);
        let anchor: HTMLAnchorElement | undefined;
        let objectUrl: string | undefined;
        try {
            const response = await read(url);
            if (!response.ok)
                throw new Error(
                    `Download failed with status ${response.status}`
                );
            if (response.body == null) throw new Error('Response body is null');

            const reader = response.body.getReader();
            const length = Number(response.headers.get('Content-Length'));
            const knownLength = Number.isFinite(length) && length > 0;
            let received = 0;
            const chunks: BlobPart[] = [];
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (!current()) {
                        chunks.length = 0;
                        continue;
                    }
                    chunks.push(value);
                    received += value.byteLength;
                    if (knownLength)
                        progress(Math.min(100, (received / length) * 100));
                }
            } finally {
                reader.releaseLock();
            }

            if (!current()) return;
            objectUrl = URL.createObjectURL(new Blob(chunks));
            anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.style.display = 'none';
            anchor.download = filename ?? 'Unnamed';
            document.body.appendChild(anchor);
            if (current()) anchor.click();
        } catch (error) {
            if (current()) onError?.(error);
        } finally {
            anchor?.remove();
            if (objectUrl != null) URL.revokeObjectURL(objectUrl);
            mounted.busy = false;
            if (active.current === mounted) setStatus(null);
        }
    };

    return {
        progress: status?.scope === scope ? status.percent : null,
        start,
    };
}
