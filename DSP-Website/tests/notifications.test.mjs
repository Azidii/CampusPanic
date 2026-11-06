import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('notifications retain old open emergencies and deep-link to their affected node safely',async()=>{
  const elements=new Map(), events=new Map(), windowEvents=new Map();
  const make=()=>({children:[],dataset:{},hidden:true,textContent:'',setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},addEventListener(type,fn){this[type]=fn;}});
  for(const id of ['notificationToggle','notificationPanel','notificationPreview','notificationList','notificationCount','notificationNavCount','notificationSummary','notificationConnection','includeResolved'])elements.set(id,make());
  const document={getElementById:id=>elements.get(id),createElement:()=>make(),addEventListener:(type,fn)=>events.set(type,fn)};
  vm.runInNewContext(await readFile(new URL('../js/notifications.js',import.meta.url),'utf8'),{document,window:{addEventListener:(type,fn)=>windowEvents.set(type,fn)},URLSearchParams});
  events.get('DOMContentLoaded')();
  const active={_id:'old-incident',nodeId:'NODE & 1',room:'<script>alert(1)</script>',building:'Library',emergencyType:'fire',status:'new',priority:1,timestamp:'2026-01-01T00:00:00Z'};
  const recent={...active,_id:'recent-resolved',status:'resolved',priority:2};
  windowEvents.get('campus:state')({detail:{alerts:[recent],activeAlerts:[active]}});
  const rows=elements.get('notificationList').children;
  assert.equal(rows.length,1);
  assert.equal(rows[0].href,'/cam-view?nodeId=NODE+%26+1&alertId=old-incident');
  assert.equal(rows[0].children[0].textContent,'Fire · <script>alert(1)</script>');
  assert.equal(elements.get('notificationCount').textContent,1);
  elements.get('includeResolved').checked=true;elements.get('includeResolved').change();
  assert.equal(elements.get('notificationList').children.length,2);
  windowEvents.get('campus:offline')();
  assert.match(elements.get('notificationSummary').textContent,/Updates interrupted/);
  assert.equal(elements.get('notificationList').children.length,2,'keep last received reports when updates fail');
});
