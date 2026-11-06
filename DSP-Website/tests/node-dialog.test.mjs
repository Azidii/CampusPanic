import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function fixture() {
  const dom=new Map(),events=new Map(),windowEvents=new Map();
  function element(id) {
    const el={dataset:{},value:'',textContent:'',open:false,elements:{},disabled:false,options:[],classList:{toggle(){}},
      addEventListener(type,fn){events.set(id+':'+type,fn);},querySelectorAll:()=>[],querySelector:()=>null,
      replaceChildren(...options){this.options=options;this.value='';},
      showModal(){this.open=true;},close(){this.open=false;},setAttribute(){}};
    dom.set(id,el);return el;
  }
  const dialog=element('nodeDialog');
  function form(id,prefix) {
    const form=element(id),help=element(prefix+'Help');form.querySelector=()=>help;
    for(const key of ['name','building','floor','room']) form.elements[key]=element(prefix+key);
    return form;
  }
  const edit=form('editNodeForm','edit'),create=form('createNodeForm','create');
  for(const id of ['nodeDialogTitle','nodeDialogLocation','nodeActionMessage','manageSelectedNode']) element(id);
  element('singleNodePage').dataset.nodeId='NODE-TEST';
  let fail=false,savedBody,toast;
  const document={hidden:false,getElementById:id=>dom.get(id)||null,querySelectorAll:()=>[],addEventListener:(type,fn)=>events.set(type,fn)};
  const window={location:{search:''},escapeHtml:String,addEventListener:(type,fn)=>windowEvents.set(type,fn),
    refreshCampus:async()=>{},showToast:message=>{toast=message;}};
  const context=vm.createContext({document,window,URLSearchParams,setInterval(){},AbortSignal,URL,
    Option:class {constructor(text,value){this.text=text;this.value=value;}},
    FormData:class {constructor(form){return Object.entries(form.elements).filter(([,el])=>!el.disabled).map(([key,el])=>[key,el.value]);}},
    fetch:async(url,options)=>{savedBody=JSON.parse(options.body);return {ok:!fail,json:async()=>fail?{message:'Save rejected'}:{node:{nodeId:'NODE-TEST',...savedBody}}};}});
  for(const file of ['map-data.js','nodes-ui.js']) vm.runInContext(await readFile(new URL('../js/'+file,import.meta.url),'utf8'),context);
  events.get('DOMContentLoaded')();
  return {edit,create,dialog,dom,events,windowEvents,change(field,value){field.value=value;events.get([...dom].find(([,el])=>el===field)[0]+':change')();},
    open(node){windowEvents.get('campus:state')({detail:{nodes:[{nodeId:'NODE-TEST',...node}],receiver:{}}});events.get('manageSelectedNode:click')();},
    fail(){fail=true;},body:()=>savedBody,toast:()=>toast};
}

test('location dropdowns enforce building, floor, room order and clear downstream selections',async()=>{
  const f=await fixture(),fields=f.create.elements;
  assert.equal(fields.floor.disabled,true);assert.equal(fields.room.disabled,true);
  f.change(fields.building,'RSY');
  assert.deepEqual(fields.floor.options.map(o=>o.text),['Choose a floor','1st Floor','2nd Floor']);
  assert.equal(fields.room.disabled,true);
  f.change(fields.floor,'1');
  assert.deepEqual(fields.room.options.map(o=>o.value),['',...Array.from({length:10},(_,i)=>'C'+(101+i)),'Cafeteria','Treasury, Admissions, Registrar','Faculty']);
  f.change(fields.room,'C101');f.change(fields.floor,'2');
  assert.equal(fields.room.value,'');assert.ok(fields.room.options.some(o=>o.value==='Library'));
  assert.ok(!fields.room.options.some(o=>o.value==='C101'));
  f.change(fields.building,'RG Birrey');
  assert.equal(fields.floor.value,'');assert.equal(fields.room.value,'');assert.equal(fields.room.disabled,true);
  assert.deepEqual(fields.floor.options.map(o=>o.text),['Choose a floor','1st Floor','2nd Floor','3rd Floor']);
  f.change(fields.floor,'1');assert.ok(fields.room.options.some(o=>o.value==='R201'));
  assert.ok(!fields.room.options.some(o=>o.value==='R602'));
  f.change(fields.floor,'3');assert.deepEqual(fields.room.options.map(o=>o.value),['','Main Hall (3rd Floor Faculty Room)']);
  f.change(fields.building,'');assert.equal(fields.floor.disabled,true);assert.equal(fields.room.disabled,true);
});
test('mapped edits preselect each level; unmapped locations do not guess a floor or room',async()=>{
  const f=await fixture(),fields=f.edit.elements;
  f.open({name:'Faculty',building:'RG Birrey',room:'R602'});
  assert.equal(fields.building.value,'RG Birrey');assert.equal(fields.floor.value,'2');assert.equal(fields.room.value,'R602');
  f.change(fields.room,'Main Hall (2nd Floor Faculty Room)');
  f.windowEvents.get('campus:state')({detail:{nodes:[{nodeId:'NODE-TEST',name:'Faculty',building:'RG Birrey',room:'R602'}],receiver:{}}});
  assert.equal(fields.room.value,'Main Hall (2nd Floor Faculty Room)','live updates preserve unsaved form choices');
  f.open({name:'Legacy',building:'RSY',room:'Entrance'});
  assert.equal(fields.building.value,'RSY');assert.equal(fields.floor.value,'');assert.equal(fields.room.value,'');assert.equal(fields.room.disabled,true);
  assert.match(f.dom.get('editHelp').textContent,/Saved location: RSY · Entrance/);
  f.open({name:'Legacy',building:'Unknown',room:'Library'});assert.equal(fields.building.value,'');assert.equal(fields.floor.disabled,true);
});
test('saving closes only after success, submits schematic fields and retains failed edits',async()=>{
  const f=await fixture();
  f.open({name:'Library camera',building:'RSY',room:'Library',lat:0,lng:0});
  assert.equal(f.dialog.open,true);f.edit.elements.name.value='New name';
  f.events.get('editNodeForm:submit')({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.dialog.open,false);assert.equal(f.body().name,'New name');assert.equal(f.body().floor,'2');assert.equal(f.body().room,'Library');
  assert.equal('lat' in f.body(),false);assert.equal('lng' in f.body(),false);assert.equal(f.toast(),'Node details saved.');
  f.open({name:'Library camera',building:'RSY',room:'Library'});f.fail();f.edit.elements.name.value='Unsaved edit';
  f.events.get('editNodeForm:submit')({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.dialog.open,true);assert.equal(f.edit.elements.name.value,'Unsaved edit');
  assert.equal(f.dom.get('nodeActionMessage').textContent,'Save rejected');
});
