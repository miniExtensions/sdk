import type { ParentFormDraftScope } from '../forms/drafts.js';
import type {
    FormLoadedResult,
    LoadExtensionResult,
    MiniExtensionsClient,
} from '../runtime/types.js';
import type { PortalChildFormRequest } from './types.js';

type Dispatch = (
    current: () => boolean,
    options?: { signal?: AbortSignal }
) => Promise<LoadExtensionResult>;

const requests = new WeakMap<
    PortalChildFormRequest,
    { dispatch: Dispatch; current(): boolean }
>();
const portalEdits = new WeakMap<
    FormLoadedResult,
    {
        client: MiniExtensionsClient;
        parent: ParentFormDraftScope;
        current(): boolean;
        snapshot: string;
    }
>();

export function narrowPortalChildFormRequest(
    request: PortalChildFormRequest,
    current: () => boolean
): PortalChildFormRequest {
    const scoped = { ...request, isCurrent: current };
    const issued = requests.get(request);
    if (issued)
        requests.set(scoped, {
            dispatch: issued.dispatch,
            current: () => issued.current() && current() && issued.current(),
        });
    return scoped;
}

export function issuePortalChildFormRequest(
    request: PortalChildFormRequest,
    owner: {
        client: MiniExtensionsClient;
        workspaceId: string;
        baseId: string;
        session: ReturnType<MiniExtensionsClient['getSession']>;
        expired(): Error;
    }
): PortalChildFormRequest {
    const wire = structuredClone(request.input);
    const parent = structuredClone(request.parent);
    const { client, workspaceId, baseId, session, expired } = owner;
    const { childExtensionId, accessType } = wire.childExtensionInfo;
    const tableId = wire.context.linkedTableIdOfLinkedRecordField;

    const dispatch: Dispatch = async (current, options) => {
        const load = client.loadExtension;
        const signal = options?.signal;
        if (!current()) throw expired();
        signal?.throwIfAborted();
        const loaded = await load.call(client, structuredClone(wire), {
            signal,
            session: { ...session },
        });
        signal?.throwIfAborted();
        if (!current()) throw expired();

        if (
            accessType.type === 'edit' &&
            loaded.extensionScreen === 'form_loaded' &&
            loaded.extensionId === childExtensionId &&
            loaded.workspaceId === workspaceId &&
            loaded.payload.baseId === baseId &&
            loaded.payload.hasParentExtension === true &&
            loaded.payload.formRecord.type === 'edit' &&
            loaded.payload.formRecord.recordId ===
                accessType.childExtensionRecordId &&
            loaded.payload.formRecord.tableId === tableId &&
            loaded.payload.publicFields.state.tableId === tableId
        ) {
            const accepted = structuredClone(loaded);
            portalEdits.set(accepted, {
                client,
                parent,
                current,
                snapshot: JSON.stringify(accepted),
            });
            return accepted;
        }
        return loaded;
    };
    requests.set(request, { dispatch, current: request.isCurrent });
    return request;
}

/** Read the exact issued Portal child request and preserve the accepted Edit scope. */
export async function loadPortalChildForm(
    request: PortalChildFormRequest,
    options?: { signal?: AbortSignal }
): Promise<LoadExtensionResult> {
    const issued = requests.get(request);
    if (!issued)
        throw new TypeError('An SDK Portal child request is required.');
    return issued.dispatch(issued.current, options);
}

export function capturePortalProjectEdit(
    loaded: FormLoadedResult,
    client: MiniExtensionsClient,
    parent: ParentFormDraftScope | null | undefined
): (() => boolean) | null {
    const edit = portalEdits.get(loaded);
    if (
        !edit ||
        edit.client !== client ||
        parent?.portalId !== edit.parent.portalId ||
        parent.recordId !== edit.parent.recordId ||
        parent.portalFieldId !== edit.parent.portalFieldId ||
        JSON.stringify(loaded) !== edit.snapshot
    )
        return null;
    return edit.current;
}
