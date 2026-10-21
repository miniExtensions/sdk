import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

// The installed consumer starts from the same complete synthetic Portal envelope
// as the existing package checks. It never imports SDK source or makes requests.
const runtimeConsumer = `
const cases = [];
function check(name, exercise) {
    exercise();
    cases.push(name);
}
function freeze(value) {
    if (value !== null && typeof value === 'object') {
        for (const member of Object.values(value)) freeze(member);
        Object.freeze(value);
    }
    return value;
}
const base = ${JSON.stringify(portalRecipeFixtures.makePortal())};
const driver = {
    id:'fld_eligible',name:'Synthetic eligibility',description:null,
    isComputed:false,isPrimaryField:false,
    config:{type:'checkbox',options:{color:'greenBright',icon:'check'}}
};
function condition() {
    return {logicalOperator:'and',conditions:[{
        id:'synthetic_view_condition',type:'singleCondition',
        setting:{type:'is',fieldType:'checkbox',idOrName:{type:'id',id:driver.id},value:true}
    }]};
}
function make(config, eligible = false) {
    const portal = structuredClone(base);
    portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig = structuredClone(config);
    portal.payload.usersTableFields = [structuredClone(driver)];
    portal.payload.formRecord.data[driver.id] = eligible;
    return portal;
}
function evaluate(portal) {
    return evaluatePortalViewAvailability({portal,portalFieldId:'fld_children'});
}
function hidden() {
    return {id:'synthetic-hidden-view',config:{name:'Hidden synthetic view',customViewConditions:condition()}};
}
function neighbor() {
    return {id:' exact-visible-view ',config:{name:'Visible synthetic view'}};
}

check('hidden first view yields its exact eligible neighbor and fresh reevaluation', () => {
    const first = hidden();
    const next = neighbor();
    const portal = make({customViews:[first,next]});
    const before = structuredClone(portal);
    assert.deepEqual(evaluate(portal),{views:[next],legacy:false,unavailable:false});
    assert.deepEqual(portal,before);
    portal.payload.formRecord.data[driver.id] = true;
    assert.deepEqual(evaluate(portal),{views:[first,next],legacy:false,unavailable:false});
});
check('configured all-hidden list never becomes a legacy default', () => {
    assert.deepEqual(evaluate(make({customViews:[hidden()]})),{
        views:[],legacy:false,unavailable:false
    });
});
check('only eligible absent and empty lists select the explicit legacy branch', () => {
    for (const config of [{},{customViews:[]}]) {
        const portal = make(config);
        portal.payload.usersTableFields = [];
        assert.deepEqual(evaluate(portal),{views:[],legacy:true,unavailable:false});
    }
});
check('hidden owning field refuses legacy even with absent or empty views', () => {
    for (const config of [{},{customViews:[]}]) {
        assert.deepEqual(evaluate(make({...config,conditionalFields:condition()})),{
            views:[],legacy:false,unavailable:false
        });
    }
});
check('raw hidden duplicate identities are refused in both orders beside a unique neighbor', () => {
    for (const hiddenFirst of [true,false]) {
        const hiddenDuplicate = hidden();
        const visibleDuplicate = {id:hiddenDuplicate.id,config:{name:'Visible duplicate'}};
        const duplicates = hiddenFirst
            ? [hiddenDuplicate,visibleDuplicate]
            : [visibleDuplicate,hiddenDuplicate];
        const next = neighbor();
        assert.deepEqual(evaluate(make({customViews:[...duplicates,next]})),{
            views:[next],legacy:false,unavailable:true
        });
    }
});
check('snapshot configs detach recursively without mutating or freezing application data', () => {
    const view = {id:'snapshot-view',config:{
        name:'Snapshot',customViewConditions:condition(),layout:undefined
    }};
    const portal = freeze(make({customViews:[view]},true));
    const before = structuredClone(portal);
    const first = evaluate(portal);
    const second = evaluate(portal);
    assert.deepEqual(first,{views:[view],legacy:false,unavailable:false});
    assert.notEqual(first.views,second.views);
    assert.notEqual(first.views[0],second.views[0]);
    assert.notEqual(first.views[0].config,second.views[0].config);
    assert.notEqual(
        first.views[0].config.customViewConditions.conditions,
        second.views[0].config.customViewConditions.conditions
    );
    assert.equal(Object.hasOwn(second.views[0].config,'layout'),true);
    assert.equal(second.views[0].config.layout,undefined);
    first.views[0].config.name = 'Changed result';
    first.views[0].config.customViewConditions.conditions[0].setting.value = false;
    first.views.splice(0,1);
    assert.deepEqual(portal,before);
    assert.deepEqual(evaluate(portal),second);
    assert.deepEqual(Object.keys(second).sort(),['legacy','unavailable','views']);
});
check('defined malformed lists including null cannot enable legacy', () => {
    for (const customViews of [null,{},'synthetic-malformed-list']) {
        assert.deepEqual(evaluate(make({customViews})),{
            views:[],legacy:false,unavailable:true
        });
    }
});
check('omitted and null eligible configs normalize to detached null descriptors', () => {
    const portal = make({customViews:[{id:'omitted-config'},{id:'null-config',config:null}]});
    portal.payload.usersTableFields = [];
    assert.deepEqual(evaluate(portal),{
        views:[{id:'omitted-config',config:null},{id:'null-config',config:null}],
        legacy:false,unavailable:false
    });
});
console.log(JSON.stringify({checks:cases.length,cases}));
`;

// Appended to the existing strict .mts/.cts/Bundler consumers. These imports
// must resolve through the installed package's public declaration exports.
export const portalViewAvailabilityTypedConsumer = `
import type { PortalLoadedResult as AvailabilityPortalLoadedResult } from '@miniextensions/sdk';
import {
    evaluatePortalViewAvailability as publicEvaluatePortalViewAvailability,
    type PortalAvailableCustomView as PublicPortalAvailableCustomView,
    type PortalViewAvailability as PublicPortalViewAvailability,
} from '@miniextensions/sdk/portals';

export function checkPublicPortalViewAvailability(portal: AvailabilityPortalLoadedResult) {
    const result:PublicPortalViewAvailability = publicEvaluatePortalViewAvailability({portal,portalFieldId:'fld_children'});
    const views:readonly PublicPortalAvailableCustomView[] = result.views;
    const legacy:boolean = result.legacy;
    const unavailable:boolean = result.unavailable;
    for (const view of views) {
        const exactId:string = view.id;
        const config:PublicPortalAvailableCustomView['config'] = view.config;
        // @ts-expect-error descriptor identity is readonly application presentation
        view.id = 'replacement';
        void [exactId,config];
    }
    // @ts-expect-error the snapshot view array is readonly
    result.views.push({id:'invented',config:null});
    // @ts-expect-error legacy is a readonly calculated outcome
    result.legacy = true;
    // @ts-expect-error availability does not expose a read or mutation capability
    result.load();
    // @ts-expect-error backend permission is not a public helper input
    publicEvaluatePortalViewAvailability({portal,portalFieldId:'fld_children',permission:true});
    return {views,legacy,unavailable};
}
`;

/** Normal public exports from the actual installed TGZ; no DOM or transport. */
export function checkPortalViewAvailabilityConsumer({
    consumerDirectory,
    run,
}) {
    let checks = 0;
    for (const [filename, imports] of [
        [
            'portal-view-availability-consumer.mjs',
            "import assert from 'node:assert/strict';\nimport { evaluatePortalViewAvailability } from '@miniextensions/sdk/portals';\n",
        ],
        [
            'portal-view-availability-consumer.cjs',
            "const assert = require('node:assert/strict');\nconst { evaluatePortalViewAvailability } = require('@miniextensions/sdk/portals');\n",
        ],
    ]) {
        writeFileSync(
            join(consumerDirectory, filename),
            imports + runtimeConsumer
        );
        const result = JSON.parse(run(process.execPath, [filename]));
        assert.equal(result.checks, 8);
        assert.equal(result.cases.length, result.checks);
        assert.equal(new Set(result.cases).size, result.checks);
        checks += result.checks;
    }
    return checks;
}
