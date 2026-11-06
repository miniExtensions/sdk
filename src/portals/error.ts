import type { PortalCollectionErrorCode } from './types.js';

export class PortalCollectionError extends Error {
    readonly code: PortalCollectionErrorCode;

    constructor(code: PortalCollectionErrorCode, message: string) {
        super(message);
        this.name = 'PortalCollectionError';
        this.code = code;
    }
}
