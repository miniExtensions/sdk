// A synthetic host for the installed React package. The renderer owns buttons;
// the host owns the rows, cursor, admission, and settlement.
export const portalPagingControlsFixture = String.raw`
import {createListFixture} from './list-fixture.mjs';

export function createPagingFixture({React,api,ui,layout='list',emptyAcceptedPage=false}) {
 const h=React.createElement;
 const records=createListFixture(ui);
 let presenterSubscriptions=0;
 const scope={
  getSnapshot:()=>records.scope.getSnapshot(),
  subscribe(listener){
   presenterSubscriptions++;
   const unsubscribe=records.scope.subscribe(listener);
   return()=>{presenterSubscriptions--;unsubscribe();};
  },
 };
 const [first,second]=records.initial.records.map((record,index)=>({
  ...record,fields:{...record.fields,fld_title:index?'Second':'First'},
 }));
 const acceptedFirstPage=emptyAcceptedPage?[]:[first];
 records.replace({...records.initial,records:acceptedFirstPage});

 const requests=[];
 const activations=[];
 let cursor=emptyAcceptedPage?'after_empty_page':'page_2';
 let redraw=()=>{};
 let state={type:'ready',hasNextPage:true};
 let offer;
 let currentRequest;
 let lastGuard;
 let failNextPageImmediately=false;

 function fail() {
  if(!currentRequest) throw new Error('No read to fail');
  const firstPage=currentRequest.offset===null;
  currentRequest=undefined;
  publish(
   {type:firstPage?'first-error':'next-error',message:firstPage?'First page unavailable':'Next page unavailable'},
   firstPage?'retry-first-page':'retry-next-page'
  );
 }

 function publish(next,intent) {
  state=next;
  offer=undefined;
  if(intent) {
   const issued={
    activate(actual,isCurrent) {
     activations.push(actual);
     if(offer!==issued||state!==next||actual!==intent||!isCurrent()) return;
     lastGuard=isCurrent;
     const offset=actual==='retry-first-page'?null:cursor;
     if(actual!=='retry-first-page'&&offset===null) throw new Error('Missing next cursor');
     currentRequest={intent:actual,offset};
     requests.push(currentRequest);
     // The controller's publication follows the event. A duplicate activation
     // before React processes the publication must have no additional effect.
     publish({type:offset===null?'initial-loading':'next-loading'});
     if(actual==='next-page'&&failNextPageImmediately) {
      failNextPageImmediately=false;
      fail();
     }
    },
   };
   offer=issued;
  }
  redraw();
 }

 publish(state,'next-page');
 return {
  records,
  get presenterSubscriptions(){return presenterSubscriptions;},
  requests,
  activations,
  labels:{loadMore:'Más registros',retry:'Reintentar'},
  connect(render){redraw=render;},
  guard(){return lastGuard;},
  replaceOffer(){publish({type:'ready',hasNextPage:true},'next-page');},
  fail,
  failNextPageImmediately(){failNextPageImmediately=true;},
  succeed({empty=false}={}) {
   if(!currentRequest) throw new Error('No read to complete');
   const firstPage=currentRequest.offset===null;
   currentRequest=undefined;
   cursor=null;
   const page=empty?[]:[firstPage?first:second];
   records.replace({...records.initial,records:firstPage?page:[...acceptedFirstPage,...page]});
   publish({type:'ready',hasNextPage:false});
  },
  firstFailure() {
   currentRequest=undefined;
   records.replace({...records.initial,records:[]});
   publish({type:'first-error',message:'First page unavailable'},'retry-first-page');
  },
  configurationError() {
   currentRequest=undefined;
   publish({type:'configuration-error',message:'View is unavailable'});
  },
  retire() {
   currentRequest=undefined;
   publish({type:'initial-loading'});
  },
  element(options={}) {
   const rowProps={
    scope,layout,label:'Records',
    grid:{
     ready:true,preferenceScopeKey:'view',primaryFieldId:null,hiddenColumns:{},columnWidths:{},
     showEmptyStatus:state.type==='ready'&&!state.hasNextPage,
    },
    renderers:{renderSingleLineTextField(field){return h('span',null,String(field.value??''));}},
   };
   return h(React.StrictMode,null,
    h(api.ReadonlyPortalRecords,rowProps),
    h(api.PortalPagingControls,{state,offer,labels:this.labels,...options}),
   );
  },
 };
}
`;
