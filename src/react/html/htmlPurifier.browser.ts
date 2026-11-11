import type * as DOMPurify from 'dompurify';
import { createHTMLPurifier } from './createHTMLPurifier.js';

let purifier: ReturnType<typeof createHTMLPurifier> | undefined;
let ownerWindow: Window | undefined;

// The package browser map selects this file in both output formats. Import is
// DOM-free; the first actual sanitization requires the real browser document.
export function getHTMLPurifier() {
    const currentWindow = globalThis.window;
    if (currentWindow == null || currentWindow.document?.nodeType !== 9)
        throw new Error('HTML sanitization requires a browser document');
    if (purifier == null || ownerWindow !== currentWindow) {
        purifier = createHTMLPurifier(currentWindow);
        ownerWindow = currentWindow;
    }
    return purifier;
}
