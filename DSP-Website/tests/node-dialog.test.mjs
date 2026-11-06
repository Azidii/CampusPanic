import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('saving closes the node dialog only after success; errors keep edits visible', async () => {
  const dom = new Map(), events = new Map(), windowEvents = new Map();
  function element(id) {
    const el = { dataset:{}, value:'', textContent:'', open:false, elements:{}, classList:{toggle(){}},
      addEventListener(type,fn) { events.set(id+':'+type,fn); }, querySelectorAll:()=>[],
      showModal(){this.open=true;}, close(){this.open=false;}, setAttribute(){} };
    dom.set(id,el); return el;
  }
  const dialog=element('nodeDialog'), form=element('editNodeForm');
  for (const key of ['name','building','room']) form.elements[key]={value:''};
  for (const id of ['nodeDialogTitle','nodeDialogLocation','nodeActionMessage','manageSelectedNode']) element(id);
  element('singleNodePage').dataset.nodeId='NODE-TEST';
  let fail=false, savedBody, toast;
  const document={hidden:false, getElementById:id=>dom.get(id)||null, querySelectorAll:()=>[], addEventListener:(type,fn)=>events.set(type,fn)};
  const window={location:{search:''}, escapeHtml:String, addEventListener:(type,fn)=>windowEvents.set(type,fn),
    refreshCampus:async()=>{}, showToast:message=>{toast=message;}};
  vm.runInNewContext(await readFile(new URL('../js/nodes-ui.js',import.meta.url),'utf8'), {
    document,window,URLSearchParams,setInterval(){},AbortSignal,URL,
    FormData:class { constructor(form){ return Object.entries(form.elements).map(([key,el])=>[key,el.value]); } },
    fetch:async(url,options)=>{savedBody=JSON.parse(options.body);return {ok:!fail,json:async()=>fail?{message:'Save rejected'}:{node:{nodeId:'NODE-TEST',...savedBody}}};}
  });
  events.get('DOMContentLoaded')();
  windowEvents.get('campus:state')({detail:{nodes:[{nodeId:'NODE-TEST',name:'Library',building:'Library',room:'Entrance',lat:0,lng:0}],receiver:{}}});
  events.get('manageSelectedNode:click')();
  assert.equal(dialog.open,true);
  form.elements.name.value='New name';
  events.get('editNodeForm:submit')({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dialog.open,false);
  assert.equal(savedBody.name,'New name');
  assert.equal(savedBody.lat,0,'hidden coordinates survive editing');
  assert.equal(savedBody.lng,0);
  assert.equal(toast,'Node details saved.');
  events.get('manageSelectedNode:click')();
  fail=true; form.elements.name.value='Unsaved edit';
  events.get('editNodeForm:submit')({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dialog.open,true);
  assert.equal(form.elements.name.value,'Unsaved edit');
  assert.equal(dom.get('nodeActionMessage').textContent,'Save rejected');
});
