import type * as React from 'react';
import { createElement, useMemo, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import markdownIt from 'markdown-it';
import {
    Editor,
    Extension,
    Plugin,
    PluginKey,
    TextSelection,
    theme,
} from '../../vendor/rich-markdown-editor/sdk-runtime.js';
import { serializeEditorRichText } from '../forms/richTextSerialization.js';
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

const markdownTokenizer = markdownIt();

function convertRichTextEditorValue(value: string): string {
    if (!value.includes('\n\\\n') || !/```|~~~/.test(value))
        return serializeEditorRichText(value);

    const lineStarts = [0];
    for (const match of value.matchAll(/\r\n?|\n/g))
        lineStarts.push(match.index + match[0].length);
    const codeBackslashes = new Set<number>();
    for (const token of markdownTokenizer.parse(value, {})) {
        if (token.type !== 'fence' || token.map == null) continue;
        const [start, end] = token.map;
        for (let line = start + 1; line < end; line++) {
            const offset = lineStarts[line];
            if (value[offset] === '\\') codeBackslashes.add(offset);
        }
    }
    // A blank paragraph and a literal backslash in a code fence serialize to
    // the same sequence. Only the paragraph is an editor artifact.
    return serializeEditorRichText(value, (offset) =>
        codeBackslashes.has(offset)
    );
}

export const richTextEditorSerialization = {
    convert: convertRichTextEditorValue,
    normalize(value: string | null | undefined): string {
        return value == null
            ? ''
            : convertRichTextEditorValue(value.replace(/\r\n/g, '\n')).replace(
                  /\n+$/g,
                  ''
              );
    },
};

type PortalOwner = {
    renderNodeView(key: object, dom: HTMLElement, element: ReactElement): void;
    removeNodeView(key: object): void;
};

const nativeTextSelectionKey = new PluginKey<unknown>(
    'complete-rich-text-native-selection'
);

// Read a browser-owned text range without normalizing unsupported boundaries.
function readNativeTextSelection(
    view: Editor['view'],
    state: Editor['view']['state']
): TextSelection | null {
    const native = view.dom.ownerDocument.getSelection();
    if (native?.rangeCount !== 1 || !native.anchorNode) return null;
    let next: TextSelection;
    try {
        const range = native.getRangeAt(0);
        const position = (node: Node, offset: number) => {
            // Browsers may represent a text boundary as its
            // paragraph/mark element and child offset.
            if (
                !view.dom.contains(node) ||
                (node.nodeType !== 3 &&
                    (node.nodeType !== 1 || node.childNodes.length === 0))
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
                if (element.getAttribute('contenteditable') === 'false')
                    return null;
            }
            const resolved = state.doc.resolve(view.posAtDOM(node, offset));
            return resolved.parent.inlineContent ? resolved : null;
        };
        const start = position(range.startContainer, range.startOffset);
        const end = position(range.endContainer, range.endOffset);
        const anchor = position(native.anchorNode, native.anchorOffset);
        // Do not turn leaf/NodeView boundaries into a nearby
        // text selection or clamp an unsupported position.
        if (
            !start ||
            !end ||
            !anchor ||
            (anchor.pos !== start.pos && anchor.pos !== end.pos)
        )
            return null;
        // A single Range owns the selected contents; its
        // anchor identifies forward versus reverse motion.
        const head = anchor.pos === start.pos ? end : start;
        next = new TextSelection(anchor, head);
    } catch {
        return null;
    }
    return next;
}

function synchronizeNativeTextSelection(
    editor: Editor,
    view: Editor['view'],
    event?: KeyboardEvent
): boolean {
    const current = () =>
        editor.isViewCurrent(view) &&
        !view.isDestroyed &&
        view.editable &&
        view.hasFocus() &&
        view.dom.ownerDocument.activeElement === view.dom;
    if (
        !current() ||
        view.composing ||
        event?.isComposing ||
        event?.keyCode === 229 ||
        !(view.state.selection instanceof TextSelection) ||
        view.root !== view.dom.ownerDocument
    )
        return false;
    const state = view.state;
    const next = readNativeTextSelection(view, state);
    if (!next) return false;
    if (!current() || view.state !== state) return true;
    // Equal cursor selections retain their stored marks.
    if (next.eq(state.selection)) return false;
    view.dispatch(state.tr.setSelection(next));
    // Publication can retire this exact view or replace its
    // policy. Never continue input handling against a successor.
    return !current();
}

// Keep the leading timeout in the same realm and duration as the pinned
// ProseMirror focus fallback (prosemirror-view 1.33.1, src/input.ts).
const focusSelectionReconciliationMs = 20;

const nativeNavigationKeys = new Set([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'PageUp',
    'PageDown',
]);

type PendingFocusNavigation = {
    doc: Editor['view']['state']['doc'];
    before: TextSelection;
    keydown: KeyboardEvent;
};

type FocusWitness = {
    doc: Editor['view']['state']['doc'];
    selection: TextSelection;
    readOnly: boolean;
    editable: boolean;
};

// Conditional retained-caret policy, not a universal inference of focus intent.
// In particular, an unobserved range-set-and-focus in one task is ambiguous.
function createFocusWitnessController(editor: Editor, view: Editor['view']) {
    const document = view.dom.ownerDocument;
    let witness: FocusWitness | undefined;
    let disposed = false;
    let restoring = false;
    let focusNavigationTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingNavigation: PendingFocusNavigation | undefined;
    const activePointers = new Set<string>();
    const scoped = () =>
        !disposed &&
        editor.isViewCurrent(view) &&
        !view.isDestroyed &&
        view.root === document &&
        view.editable &&
        !editor.props.readOnly &&
        !view.composing;
    const focused = () =>
        scoped() && view.hasFocus() && document.activeElement === view.dom;
    const cancelFocusNavigation = () => {
        if (focusNavigationTimer !== undefined)
            clearTimeout(focusNavigationTimer);
        focusNavigationTimer = undefined;
        pendingNavigation = undefined;
    };
    const scheduleFocusNavigation = () => {
        cancelFocusNavigation();
        // ProseMirror calls handleDOMEvents.focus before queuing its equal
        // timeout. Publish confirmed native movement before its model-to-DOM
        // fallback can overwrite that movement.
        focusNavigationTimer = setTimeout(() => {
            const movement = pendingNavigation;
            focusNavigationTimer = undefined;
            pendingNavigation = undefined;
            if (
                !movement ||
                movement.keydown.defaultPrevented ||
                !focused() ||
                activePointers.size !== 0
            )
                return;
            const state = view.state;
            if (
                state.doc !== movement.doc ||
                !(state.selection instanceof TextSelection)
            )
                return;
            const native = readNativeTextSelection(view, state);
            if (
                native &&
                !native.eq(movement.before) &&
                !native.eq(state.selection) &&
                focused() &&
                view.state === state
            )
                view.dispatch(state.tr.setSelection(native));
        }, focusSelectionReconciliationMs);
    };
    const clearStaleWitness = () => {
        if (
            witness &&
            (!scoped() ||
                view.state.doc !== witness.doc ||
                !view.state.selection.eq(witness.selection) ||
                Boolean(editor.props.readOnly) !== witness.readOnly ||
                view.editable !== witness.editable)
        )
            witness = undefined;
    };
    const contains = (target: EventTarget | null): boolean =>
        target != null &&
        typeof (target as Node).nodeType === 'number' &&
        view.dom.contains(target as Node);
    const inEditor = (event: Event) => contains(event.target);
    const pointerStart = (event: Event) => {
        if (disposed || !inEditor(event)) return;
        cancelFocusNavigation();
        // Capture on the owner document runs before descendant handlers and
        // NodeView stopEvent. Even canceled/default-prevented intent refuses.
        witness = undefined;
        if (event.type === 'pointerdown')
            activePointers.add('pointer:' + (event as PointerEvent).pointerId);
        else if (event.type === 'mousedown')
            activePointers.add('mouse:' + (event as MouseEvent).button);
        else {
            const touches = (event as TouchEvent).changedTouches;
            if (!touches?.length) activePointers.add('touch:unknown');
            for (let index = 0; index < (touches?.length ?? 0); index++)
                activePointers.add('touch:' + touches[index]!.identifier);
        }
    };
    const pointerEnd = (event: Event) => {
        if (event.type === 'pointerup' || event.type === 'pointercancel')
            activePointers.delete(
                'pointer:' + (event as PointerEvent).pointerId
            );
        else if (event.type === 'mouseup')
            activePointers.delete('mouse:' + (event as MouseEvent).button);
        else {
            const touches = (event as TouchEvent).changedTouches;
            for (let index = 0; index < (touches?.length ?? 0); index++)
                activePointers.delete('touch:' + touches[index]!.identifier);
            if ((event as TouchEvent).touches?.length === 0)
                for (const token of activePointers)
                    if (token.startsWith('touch:'))
                        activePointers.delete(token);
        }
        // Finishing/canceling a gesture never re-creates its invalidated witness.
    };
    const selectionChange = () => {
        if (!witness || document.activeElement === view.dom) return;
        clearStaleWitness();
        if (!witness) return;
        const native = document.getSelection();
        if (
            !native ||
            (!view.dom.contains(native.anchorNode) &&
                !view.dom.contains(native.focusNode))
        )
            return;
        const selection = readNativeTextSelection(view, view.state);
        // An observed contained change while blurred is native intent. A focus-
        // created asynchronous selectionchange happens after focus instead.
        if (!selection || !selection.eq(witness.selection)) witness = undefined;
    };
    const nestedFocus = (event: FocusEvent) => {
        if (event.target !== view.dom && inEditor(event)) witness = undefined;
    };
    const starts = ['pointerdown', 'mousedown', 'touchstart'] as const;
    const ends = [
        'pointerup',
        'pointercancel',
        'mouseup',
        'touchend',
        'touchcancel',
    ] as const;
    for (const type of starts)
        document.addEventListener(type, pointerStart, {
            capture: true,
            passive: true,
        });
    for (const type of ends)
        document.addEventListener(type, pointerEnd, {
            capture: true,
            passive: true,
        });
    document.addEventListener('selectionchange', selectionChange);
    document.addEventListener('focus', nestedFocus, true);
    return {
        blur(event: FocusEvent): boolean {
            if (event.target !== view.dom) return false;
            cancelFocusNavigation();
            witness = undefined;
            if (
                !scoped() ||
                activePointers.size !== 0 ||
                contains(event.relatedTarget)
            )
                return false;
            const state = view.state;
            const selection = state.selection;
            if (!(selection instanceof TextSelection) || !selection.empty)
                return false;
            const first = TextSelection.atStart(state.doc);
            if (!(first instanceof TextSelection) || selection.eq(first))
                return false;
            const native = readNativeTextSelection(view, state);
            if (
                native?.empty &&
                native.eq(selection) &&
                scoped() &&
                view.state === state
            )
                witness = {
                    doc: state.doc,
                    selection,
                    readOnly: Boolean(editor.props.readOnly),
                    editable: view.editable,
                };
            return false;
        },
        focus(event: FocusEvent): boolean {
            if (event.target !== view.dom || restoring) return false;
            if (focused()) scheduleFocusNavigation();
            clearStaleWitness();
            const retained = witness;
            // Consume before restoration, including unsupported or reentrant focus.
            witness = undefined;
            if (!retained || activePointers.size !== 0 || !focused())
                return false;
            const state = view.state;
            const selection = state.selection;
            if (
                !(selection instanceof TextSelection) ||
                !selection.empty ||
                state.doc !== retained.doc ||
                !selection.eq(retained.selection)
            )
                return false;
            const first = TextSelection.atStart(state.doc);
            const native = readNativeTextSelection(view, state);
            if (
                !(first instanceof TextSelection) ||
                !native?.empty ||
                !native.eq(first) ||
                selection.eq(first)
            )
                return false;
            if (!focused() || view.state !== state) return true;
            restoring = true;
            try {
                // Public model-to-DOM focus only; no transaction or private PM state.
                view.focus();
            } finally {
                restoring = false;
            }
            return !focused();
        },
        recordNativeNavigation(event: KeyboardEvent) {
            if (focusNavigationTimer === undefined) return;
            pendingNavigation = undefined;
            if (
                !event.isTrusted ||
                event.defaultPrevented ||
                event.isComposing ||
                event.keyCode === 229 ||
                !nativeNavigationKeys.has(event.key) ||
                !focused() ||
                activePointers.size !== 0
            )
                return;
            const state = view.state;
            if (!(state.selection instanceof TextSelection)) return;
            const before = readNativeTextSelection(view, state);
            if (before)
                pendingNavigation = { doc: state.doc, before, keydown: event };
        },
        finishNativeNavigation(event: KeyboardEvent) {
            if (event.isTrusted && pendingNavigation?.keydown.key === event.key)
                pendingNavigation = undefined;
        },
        update() {
            clearStaleWitness();
        },
        destroy() {
            disposed = true;
            cancelFocusNavigation();
            witness = undefined;
            activePointers.clear();
            for (const type of starts)
                document.removeEventListener(type, pointerStart, true);
            for (const type of ends)
                document.removeEventListener(type, pointerEnd, true);
            document.removeEventListener('selectionchange', selectionChange);
            document.removeEventListener('focus', nestedFocus, true);
        },
    };
}

class NativeTextSelectionExtension extends Extension {
    override get name(): string {
        return 'complete-rich-text-native-selection';
    }

    override get plugins(): Plugin<unknown>[] {
        const synchronize = (view: Editor['view'], event?: KeyboardEvent) =>
            synchronizeNativeTextSelection(this.editor, view, event);
        const focusWitnesses = new WeakMap<
            Editor['view'],
            ReturnType<typeof createFocusWitnessController>
        >();
        return [
            new Plugin<unknown>({
                key: nativeTextSelectionKey,
                view: (view) => {
                    const controller = createFocusWitnessController(
                        this.editor,
                        view
                    );
                    focusWitnesses.set(view, controller);
                    return {
                        update: () => controller.update(),
                        destroy: () => {
                            focusWitnesses.delete(view);
                            controller.destroy();
                        },
                    };
                },
                props: {
                    handleKeyDown: (view, event) => {
                        const handled = synchronize(view, event);
                        if (!handled)
                            focusWitnesses
                                .get(view)
                                ?.recordNativeNavigation(event);
                        return handled;
                    },
                    handleDOMEvents: {
                        keydown: (view, event) => {
                            const button = view.dom.ownerDocument.activeElement;
                            const editorState = this.editor.state;
                            const menuNavigation =
                                (event.key === 'ArrowDown' ||
                                    event.key === 'ArrowUp') &&
                                'blockMenuOpen' in editorState &&
                                editorState.blockMenuOpen === true;
                            // Let the focused widget activate as a button. When
                            // the menu is open, its window listener owns arrows.
                            // Returning true skips ProseMirror, without cancelling
                            // native activation or stopping the event.
                            return (
                                (event.key === 'Enter' || menuNavigation) &&
                                !event.isComposing &&
                                event.keyCode !== 229 &&
                                this.editor.isViewCurrent(view) &&
                                view.editable &&
                                button === event.target &&
                                !!button?.matches(
                                    'button.block-menu-trigger[type="button"]'
                                ) &&
                                view.dom.contains(button)
                            );
                        },
                        focus: (view, event) =>
                            focusWitnesses.get(view)?.focus(event) ?? false,
                        blur: (view, event) =>
                            focusWitnesses.get(view)?.blur(event) ?? false,
                        // Arrow and boundary movement happens after keydown.
                        // Publish that native caret before metadata controls blur
                        // the editor and a later focus restores model selection.
                        keyup: (view, event) => {
                            if (!nativeNavigationKeys.has(event.key))
                                return false;
                            focusWitnesses
                                .get(view)
                                ?.finishNativeNavigation(event);
                            const handled = synchronize(view, event);
                            if (handled) event.preventDefault();
                            return handled;
                        },
                        paste: (view, event) => {
                            const handled = synchronize(view);
                            if (handled) event.preventDefault();
                            return handled;
                        },
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
    if (!(handle instanceof Editor)) return;
    const { view } = handle;
    if (!view || view.isDestroyed || !handle.isViewCurrent(view)) return;
    // Updating outer attributes can restore the model selection into the DOM.
    // First publish any current focused native text range under the same guards.
    if (synchronizeNativeTextSelection(handle, view)) return;
    if (handle.view !== view || view.isDestroyed || !handle.isViewCurrent(view))
        return;
    view.setProps({ attributes });
}
