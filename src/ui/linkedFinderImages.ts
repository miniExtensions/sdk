/** Host-admitted image descriptors only. No attachment lookup or URL recovery. */
export type LinkedFinderImage = {
    readonly id?: string;
    readonly url: string;
    readonly filename: string;
    readonly largeUrl?: string | null;
};

export const linkedFinderListImageVector = (
    images: readonly LinkedFinderImage[]
) => JSON.stringify(images.map(({ id, url, filename }) => [id, url, filename]));

export type LinkedFinderCarouselImage = {
    readonly image: LinkedFinderImage;
    readonly identity: string;
    readonly source: string;
    readonly failureKey: string;
};

/** Slice before failures: a failed first-six image never admits a seventh. */
export function linkedFinderCarouselImages(
    images: readonly LinkedFinderImage[],
    failed: ReadonlySet<string>
): readonly LinkedFinderCarouselImage[] {
    return images.slice(0, 6).flatMap((image, index) => {
        const source = image.largeUrl || image.url;
        const identity =
            image.id != null
                ? JSON.stringify(['id', image.id])
                : JSON.stringify(['index-url', index, source]);
        const failureKey = JSON.stringify([identity, source]);
        return failed.has(failureKey)
            ? []
            : [{ image, identity, source, failureKey }];
    });
}

export function linkedFinderCarouselIndex(
    images: readonly LinkedFinderCarouselImage[],
    selectedIdentity: string | null,
    previousIndex: number
): number {
    const retained = images.findIndex(
        (image) => image.identity === selectedIdentity
    );
    return retained >= 0
        ? retained
        : Math.max(0, Math.min(previousIndex, images.length - 1));
}
