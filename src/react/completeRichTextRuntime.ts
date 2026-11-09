import { createElement, useMemo, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
    Editor,
    theme,
} from '../../vendor/rich-markdown-editor/sdk-runtime.js';
import { GeneralPasteHandlerExtension } from './completeRichTextPaste.js';
import type {
    NativeRichTextEditorHandle,
    NativeRichTextEditorRenderProps,
} from './NativeRichTextEditor.js';

const inheritedTheme = {
    ...theme,
    text: 'inherit',
    background: 'inherit',
    link: 'inherit',
};

type PortalOwner = {
    renderNodeView(key: object, dom: HTMLElement, element: ReactElement): void;
    removeNodeView(key: object): void;
};

function RuntimeEditor({
    native,
    focused,
    portals,
}: {
    native: NativeRichTextEditorRenderProps;
    focused: boolean;
    portals: PortalOwner;
}) {
    // Extensions hold their owning editor; never share one across instances.
    const extensions = useMemo(() => [new GeneralPasteHandlerExtension()], []);
    return createElement(Editor, {
        ...native,
        ...portals,
        className: `me-rich-text-editor${focused ? ' me-rich-text-focused' : ''}`,
        theme: inheritedTheme,
        disableExtensions: [
            'highlight',
            'table',
            'container_notice',
            'markdown-paste',
        ],
        extensions,
    });
}

export function renderEditor(
    native: NativeRichTextEditorRenderProps,
    focused: boolean,
    portals: PortalOwner
) {
    return createElement(RuntimeEditor, { native, focused, portals });
}

export const createNodePortal = createPortal;

export function setEditorAttributes(
    handle: NativeRichTextEditorHandle,
    attributes: Record<string, string>
) {
    if (handle instanceof Editor && handle.view && !handle.view.isDestroyed)
        handle.view.setProps({ attributes });
}
