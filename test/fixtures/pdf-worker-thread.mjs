// Source-test adapter only. Chromium uses the actual packaged module worker.
import { parentPort } from 'node:worker_threads';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
if (!parentPort) throw Error('Missing owned worker port');
const port = {
    postMessage(message, transfer) {
        parentPort.postMessage(message, transfer);
    },
    addEventListener(type, receive, options) {
        if (type !== 'message') return;
        const listener = (data) => {
            receive({ data });
        };
        parentPort.on('message', listener);
        options?.signal?.addEventListener(
            'abort',
            () => parentPort.off('message', listener),
            { once: true }
        );
    },
};
WorkerMessageHandler.initializeFromPort(port);
