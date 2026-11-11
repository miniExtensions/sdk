import type * as DOMPurify from 'dompurify';
import { createRequire } from 'node:module';
import { createHTMLPurifier } from './createHTMLPurifier.js';

let purifier: ReturnType<typeof createHTMLPurifier> | undefined;

// This opt-in Node entry owns a private, lazy parser document. It never reads
// or assigns global.DOMPurify, window.DOMPurify, or an application's hooks.
export function getHTMLPurifier() {
    if (purifier == null) {
        // Load the existing Node parser only when sanitization is used. This
        // keeps unrelated headless exports bundleable without optional canvas.
        const { JSDOM } = createRequire(import.meta.url)(
            'jsdom'
        ) as typeof import('jsdom');
        const document = new JSDOM('<!DOCTYPE html>').window.document;
        const ownerWindow = document.defaultView;
        if (ownerWindow == null) throw new Error('Missing HTML parser window');
        purifier = createHTMLPurifier(ownerWindow);
    }
    return purifier;
}
