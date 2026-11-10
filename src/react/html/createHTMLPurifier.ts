import createDOMPurify from 'dompurify';

// Match the native Formula/description policy. Each caller supplies an owned
// factory instance; no embedding application's sanitizer hooks are changed.
const iframeSandbox = [
    'allow-downloads',
    'allow-forms',
    'allow-popups',
    'allow-presentation',
    'allow-same-origin',
    'allow-scripts',
].join(' ');

function isExplicitHTTPSURL(value: string): boolean {
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

export function createHTMLPurifier(ownerWindow: Window) {
    const purifier = createDOMPurify(ownerWindow);
    purifier.addHook('afterSanitizeAttributes', (node) => {
        if (node.tagName.toLowerCase() !== 'iframe') return;
        const source = node.getAttribute('src');
        if (source == null || !isExplicitHTTPSURL(source)) {
            node.remove();
            return;
        }
        node.setAttribute('sandbox', iframeSandbox);
        node.setAttribute('referrerpolicy', 'no-referrer');
        node.setAttribute('loading', 'lazy');
        node.removeAttribute('srcdoc');
    });
    return purifier;
}
