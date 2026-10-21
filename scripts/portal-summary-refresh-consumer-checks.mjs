import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const portalSummaryRefreshTypedConsumer = `
import {refreshPortalSummaryFields,type PortalSummaryRefreshOptions} from '@miniextensions/sdk/portals';
const summaryOptions:PortalSummaryRefreshOptions<{title:string}>={generation:7,isLatestGeneration:g=>g===7,fetchRecord:async()=>({title:'Synthetic'}),onFresh:record=>{record.title.toUpperCase();},onStale:()=>{}};
const summaryRefresh:Promise<void>=refreshPortalSummaryFields(summaryOptions);
// @ts-expect-error the host's ownership guard is required
refreshPortalSummaryFields({generation:7,fetchRecord:async()=>({title:'Synthetic'}),onFresh:()=>{},onStale:()=>{}});
// @ts-expect-error returned records remain typed through the application boundary
refreshPortalSummaryFields({...summaryOptions,onFresh:(record:{other:number})=>{}});
void summaryRefresh;
`;

export async function checkPortalSummaryRefreshConsumer({ consumerDirectory }) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/portals/index.js'
            )
        )
    );
    let groups = 0;
    for (const api of [esm, consumer('@miniextensions/sdk/portals')]) {
        const record = { title: 'Synthetic summary' };
        let reads = 0;
        let applications = 0;
        let stale = 0;
        const options = {
            generation: 7,
            isLatestGeneration: (g) => g === 7,
            fetchRecord: async () => {
                if (++reads === 1) throw new Error('Synthetic read failure');
                return record;
            },
            onFresh: (value) => {
                assert.equal(value, record);
                applications++;
            },
            onStale: () => {
                stale++;
            },
        };
        await api.refreshPortalSummaryFields(options);
        assert.equal(reads, 2);
        assert.equal(applications, 1);
        assert.equal(stale, 0);
        await api.refreshPortalSummaryFields({
            ...options,
            isLatestGeneration: () => false,
        });
        assert.equal(reads, 2);
        assert.equal(applications, 1);
        const failure = new Error('Synthetic host application failure');
        await assert.rejects(
            api.refreshPortalSummaryFields({
                ...options,
                onFresh: () => {
                    throw failure;
                },
            }),
            (error) => error === failure
        );
        assert.equal(reads, 3);
        assert.equal(stale, 0);
        groups++;
    }
    return groups;
}
