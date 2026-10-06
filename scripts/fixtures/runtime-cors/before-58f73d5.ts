import type { ServerResponse } from 'http';
import type { NextApiRequest } from 'next';

// These are the existing visitor-authorized Form/Portal procedures. Workspace,
// builder and other private procedures keep their existing same-origin ingress.
const publicRuntimeProcedures = new Set([
    'airtable.deleteRecord',
    'airtable.addNewAirtableOptionForFormField',
    'airtable.getUserRecord',
    'airtable.updatePortalRecord',
    'airtable.unlinkPortalRecord',
    'airtable.updateRecordKanbanCategory',
    'publicExtensions.fetchInitialTableIdsToLinkedTableStates',
    'publicExtensions.createPublicUploadLink',
    'airtable.getAirtableCommentsForRecord',
    'airtable.addAirtableCommentForRecord',
]);

const allowedRequestHeaders = new Set(['content-type', 'miniext-context']);

/**
 * Adds only transport headers; canonical procedures retain visitor authority.
 * Returns true when the response is complete, so preflight never invokes tRPC
 * or its authentication context. Mixed batches receive no CORS permission.
 */
export const handlePublicRuntimeTrpcCors = (
    req: Pick<NextApiRequest, 'method' | 'query' | 'headers'>,
    res: Pick<ServerResponse, 'setHeader' | 'end' | 'statusCode'>
): boolean => {
    const paths = req.query.trpc;
    const isPublicRuntime =
        typeof paths === 'string' &&
        paths.split(',').every((path) => publicRuntimeProcedures.has(path));

    if (req.method === 'OPTIONS') {
        const requestedMethod = req.headers['access-control-request-method'];
        const requestedHeaders = req.headers['access-control-request-headers'];
        const isAllowedPreflight =
            isPublicRuntime &&
            (requestedMethod === 'GET' || requestedMethod === 'POST') &&
            (requestedHeaders == null ||
                (typeof requestedHeaders === 'string' &&
                    requestedHeaders
                        .split(',')
                        .every((header) =>
                            allowedRequestHeaders.has(
                                header.trim().toLowerCase()
                            )
                        )));

        if (isAllowedPreflight) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader(
                'Access-Control-Allow-Headers',
                'Content-Type, miniext-context'
            );
        }
        res.statusCode = 204;
        res.end();
        return true;
    }

    if (isPublicRuntime && (req.method === 'GET' || req.method === 'POST')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        // GET inputs contain visitor tokens; public responses must not be cached.
        res.setHeader('Cache-Control', 'private, no-store');
    }

    return false;
};
