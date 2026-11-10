import { createElement, useMemo, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
    Editor,
    Extension,
    Plugin,
    PluginKey,
    TextSelection,
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

const nativeTextSelectionKey = new PluginKey<unknown>(
    'complete-rich-text-native-selection'
);

class NativeTextSelectionExtension extends Extension {
    override get name(): string {
        return 'complete-rich-text-native-selection';
    }

    override get plugins(): Plugin<unknown>[] {
        return [
            new Plugin<unknown>({
                key: nativeTextSelectionKey,
                props: {
                    // Extension plugins precede keymaps. Native selectionchange
                    // may be coalesced beyond the next formatting shortcut.
                    handleKeyDown: (view, event) => {
                        const current = () =>
                            this.editor.isViewCurrent(view) &&
                            !view.isDestroyed &&
                            view.editable &&
                            view.hasFocus() &&
                            view.dom.ownerDocument.activeElement === view.dom;
                        if (
                            !current() ||
                            view.composing ||
                            event.isComposing ||
                            event.keyCode === 229 ||
                            !(view.state.selection instanceof TextSelection) ||
                            view.root !== view.dom.ownerDocument
                        )
                            return false;
                        const native = view.dom.ownerDocument.getSelection();
                        if (native?.rangeCount !== 1 || !native.anchorNode)
                            return false;
                        const state = view.state;
                        let next: TextSelection;
                        try {
                            const range = native.getRangeAt(0);
                            const position = (node: Node, offset: number) => {
                                // Browsers may represent a text boundary as its
                                // paragraph/mark element and child offset.
                                if (
                                    !view.dom.contains(node) ||
                                    (node.nodeType !== 3 &&
                                        (node.nodeType !== 1 ||
                                            node.childNodes.length === 0))
                                )
                                    return null;
                                for (
                                    let element =
                                        node.nodeType === 1
                                            ? (node as Element)
                                            : node.parentElement;
                                    element && element !== view.dom;
                                    element = element.parentElement
                                ) {
                                    if (
                                        element.getAttribute(
                                            'contenteditable'
                                        ) === 'false'
                                    )
                                        return null;
                                }
                                const resolved = state.doc.resolve(
                                    view.posAtDOM(node, offset)
                                );
                                return resolved.parent.inlineContent
                                    ? resolved
                                    : null;
                            };
                            const start = position(
                                range.startContainer,
                                range.startOffset
                            );
                            const end = position(
                                range.endContainer,
                                range.endOffset
                            );
                            const anchor = position(
                                native.anchorNode,
                                native.anchorOffset
                            );
                            // Do not turn leaf/NodeView boundaries into a nearby
                            // text selection or clamp an unsupported position.
                            if (
                                !start ||
                                !end ||
                                !anchor ||
                                (anchor.pos !== start.pos &&
                                    anchor.pos !== end.pos)
                            )
                                return false;
                            // A single Range owns the selected contents; its
                            // anchor identifies forward versus reverse motion.
                            const head = anchor.pos === start.pos ? end : start;
                            next = new TextSelection(anchor, head);
                        } catch {
                            return false;
                        }
                        if (!current() || view.state !== state) return true;
                        // Equal cursor selections retain their stored marks.
                        if (next.eq(state.selection)) return false;
                        view.dispatch(state.tr.setSelection(next));
                        // Publication can retire this exact view or replace its
                        // policy. Never continue its keymap against a successor.
                        return !current();
                    },
                },
            }),
        ];
    }
}

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
    const extensions = useMemo(
        () => [
            new NativeTextSelectionExtension(),
            new GeneralPasteHandlerExtension(),
        ],
        []
    );
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
