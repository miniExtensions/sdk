import { BrowserMultiFormatReader, type Result } from '@zxing/library';

/** One camera attempt. Never shared with a retry or a successor scanner. */
export class ScannerReader extends BrowserMultiFormatReader {
    private retired = false;
    private cancelPlayback: (() => void) | undefined;
    private removeEnded: (() => void) | undefined;
    constructor(private readonly onEnded: () => void) {
        super();
    }
    private stopped = new WeakSet<MediaStreamTrack>();

    stopMediaStream(stream: MediaStream) {
        for (const track of stream.getTracks()) {
            if (this.stopped.has(track)) continue;
            this.stopped.add(track);
            track.stop();
        }
    }

    protected override stopStreams() {
        if (this.stream) this.stopMediaStream(this.stream);
        this.stopAsyncDecode();
        this.stopContinuousDecode();
    }

    dispose() {
        this.retired = true;
        this.removeEnded?.();
        this.removeEnded = undefined;
        this.cancelPlayback?.();
        this.reset();
    }

    protected override playVideoOnLoadAsync(video: HTMLVideoElement) {
        return new Promise<void>((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
                video.removeEventListener('canplay', play);
                video.removeEventListener('playing', playing);
                video.removeEventListener('error', failed);
                this.cancelPlayback = undefined;
            };
            const finish = (error?: unknown) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error !== undefined) reject(error);
                else resolve();
            };
            const playing = () => {
                if (!this.retired) finish();
            };
            const failed = () => finish(new Error('Video playback failed'));
            const play = () => {
                if (this.retired || settled) return;
                if (this.isVideoPlaying(video)) playing();
                else void video.play().catch((error: unknown) => finish(error));
            };
            const ended = () => {
                if (!this.retired) this.onEnded();
            };
            this.removeEnded = () => video.removeEventListener('ended', ended);
            video.addEventListener('ended', ended);
            this.cancelPlayback = () => finish(new Error('Scanner retired'));
            if (this.retired) {
                this.cancelPlayback();
                return;
            }
            // Own these listeners instead of relying on the vendor's reset:
            // v0.20 removes canplay under a different event name and doesn't
            // retain the registered playing callback.
            video.addEventListener('canplay', play);
            video.addEventListener('playing', playing);
            video.addEventListener('error', failed);
            play();
        });
    }

    override decodeOnce(
        element: HTMLVideoElement,
        retryIfNotFound?: boolean,
        retryIfChecksumOrFormatError?: boolean
    ): Promise<Result> {
        if (this.retired) return Promise.reject(new Error('Scanner retired'));
        return super.decodeOnce(
            element,
            retryIfNotFound,
            retryIfChecksumOrFormatError
        );
    }

    override decodeContinuously(
        element: HTMLVideoElement,
        callback: Parameters<BrowserMultiFormatReader['decodeContinuously']>[1]
    ) {
        if (!this.retired) super.decodeContinuously(element, callback);
    }
}
