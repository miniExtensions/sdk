import { JSDOM } from 'jsdom';
import { createHTMLPurifier } from './createHTMLPurifier.js';

let purifier: ReturnType<typeof createHTMLPurifier> | undefined;

// This opt-in Node entry owns a private, lazy parser document. It never reads
// or assigns global.DOMPurify, window.DOMPurify, or an application's hooks.
export function getHTMLPurifier() {
    if (purifier == null) {
        const document = new JSDOM('<!DOCTYPE html>').window.document;
        const ownerWindow = document.defaultView;
        if (ownerWindow == null) throw new Error('Missing HTML parser window');
        purifier = createHTMLPurifier(ownerWindow);
    }
    return purifier;
}
