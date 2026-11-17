// Synthetic host data shared by the installed module-format and browser proofs.
// It publishes an accepted scope; it does not stand in for the SDK presenter.
export const readonlyPortalListFixture = String.raw`
export function createListFixture(ui) {
 const fields=['title','detail'].map((id,index)=>({id:'fld_'+id,name:index?'Detail':'Title',description:null,isComputed:false,isPrimaryField:false,config:{type:'singleLineText',options:null}}));
 const initial={portalFieldId:'fld_children',linkedTableId:'tbl_children',records:[{id:'rec_B',fields:{fld_title:'Beta',fld_detail:'B detail'}},{id:'rec_A',fields:{fld_title:'Alpha',fld_detail:'A detail'}}],table:{airtableFields:fields},detailProjection:'present',detailFields:fields.map((field,index)=>({fieldId:field.id,fieldName:field.name,titleOverride:index?'Detail label':'Name label',isHidden:false,fieldIsInEditingChildForm:false,childFormField:null,miniExtConfig:{title:field.name,conditionalFields:{logicalOperator:'and',conditions:[]}}}))};
 let stamp={},projection=initial,subscriptions=0;const listeners=new Set(),calls=[];
 const scope=ui.createBorrowedPortalRenderScope({capture:()=>({stamp,projection}),isCurrent:expected=>expected===stamp,subscribe(listener){subscriptions++;listeners.add(listener);return()=>{subscriptions--;listeners.delete(listener);};},invokeIfCurrent(expected,target,isCurrent){if(expected!==stamp||!isCurrent())return false;calls.push(target);return true;}});
 return {scope,initial,calls,get subscriptions(){return subscriptions;},replace(next=initial){stamp={};projection=next;for(const listener of [...listeners])listener();}};
}
`;
