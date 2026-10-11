import { it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as forms from '../src/forms/index.js';
import * as ui from '../src/ui/index.js';
import { createRendererProps } from '../src/ui/rendererRegistry.js';

it('publishes coherent detached readonly select availability through accepted Form bindings', async () => {
    const { checkSelectAvailabilityBridgeModules } = await import(
        pathToFileURL(
            resolve('scripts/select-availability-bridge-consumer-checks.mjs')
        ).href
    );
    await checkSelectAvailabilityBridgeModules(forms, ui, createRendererProps);
});
