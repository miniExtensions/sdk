import type { AirtableFormProps } from '../src/react/index.js';
import { AirtableForm } from '../src/react/index.js';
import type {
    FormRenderScope,
    BorrowedFormRenderScope,
} from '../src/ui/index.js';

// Compile-only public witnesses; no React hook is executed by the test runner.
export function legacyFormProps(props: AirtableFormProps) {
    const scope: FormRenderScope = props.scope;
    const pages: FormRenderScope['pages'] = props.scope.pages;
    const ownsPages: boolean = props.scope.ownsPages;
    const destroy: () => void = props.scope.destroy;
    return { scope, pages, ownsPages, destroy };
}
export function borrowedVoidForm(scope: BorrowedFormRenderScope<void>) {
    return AirtableForm({
        scope,
        renderers: {},
        children: (state) => {
            const submit: () => Promise<void> = state.actions.submit;
            return null;
        },
    });
}
