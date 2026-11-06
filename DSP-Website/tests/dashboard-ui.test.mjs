import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/dashboard.js', import.meta.url), 'utf8');
function dashboard({unresolved = 0, connected = 0, total = 0, search = ''} = {}) {
  const events = new Map(), elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {dataset:{},textContent:'',innerHTML:'',addEventListener(){},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)}});
    }
    return elements.get(id);
  };
  const feed = {alerts:[],history:[],counts:{unresolved,gunshot:0,medical:0,fire:0,panic:0},historyPage:1,historyPages:1,historyTotal:0,outsideOpen:0};
  element('dashboardData').textContent = JSON.stringify(feed);
  Object.assign(element('alertEmptyState').dataset, {connected:String(connected),total:String(total)});
  let ready;
  vm.runInNewContext(source, {
    document:{getElementById:element,addEventListener(type,fn){if(type==='DOMContentLoaded')ready=fn;}},
    window:{escapeHtml:String,isLegacyBuilding:()=>false,matchMedia:()=>({matches:false}),filterBuilding:rows=>rows,addEventListener:(type,fn)=>events.set(type,fn)},
    location:{search},URL,URLSearchParams,Date,setTimeout,clearTimeout
  });
  ready();
  return {element,feed,emit:(name,detail)=>events.get(name)({detail})};
}

test('no connected nodes never presents the empty incident queue as healthy coverage', () => {
  const {element} = dashboard();
  assert.equal(element('radarTitle').textContent, 'No open incidents');
  assert.match(element('radarDescription').textContent, /No nodes connected.*coverage is unavailable/);
});

test('a filtered empty queue discloses the open incidents hidden by the filters', () => {
  const {element} = dashboard({unresolved:3});
  assert.equal(element('radarTitle').textContent, 'No matching incidents');
  assert.match(element('radarDescription').textContent, /^3 open incidents/);
});

test('live coverage updates distinguish partial coverage and recover from a failed connection', () => {
  const {element,emit,feed} = dashboard();
  emit('campus:state',{dashboard:feed,nodes:[{audio:{connected:true}},{}]});
  assert.match(element('radarDescription').textContent, /1 of 2 nodes connected.*unavailable/);
  assert.equal(element('count-active-nodes').textContent,'1 / 2');
  emit('campus:offline');
  assert.equal(element('alertEmptyState').classList.contains('is-offline'),true);
  assert.equal(element('radarTitle').textContent,'Live updates interrupted');
  assert.match(element('radarConnection').textContent,/interrupted/);
  emit('campus:state',{dashboard:feed,nodes:[{video:{cameraConnected:true}}]});
  assert.equal(element('alertEmptyState').classList.contains('is-offline'),false);
  assert.equal(element('radarTitle').textContent,'No open incidents');
  assert.match(element('radarDescription').textContent,/reported by the connected campus nodes/);
  assert.match(element('radarConnection').textContent,/Live feed/);
});

test('a building-scoped phone URL keeps its filter controls expanded', () => {
  const {element} = dashboard({search:'?building=RSY'});
  assert.equal(element('incidentFilters').open,true);
});

test('manual incident rows remain available without restoring the redundant panic total',()=>{
  const {element,emit,feed}=dashboard();
  const incident={_id:'panic-1',nodeId:'NODE-1',room:'Entrance',building:'RSY',emergencyType:'panic',threatStatus:'manual_alert',status:'new',priority:2,timestamp:new Date().toISOString()};
  emit('campus:state',{dashboard:{...feed,alerts:[incident],counts:{...feed.counts,panic:3,unresolved:1}},nodes:[]});
  assert.equal(element('count-panic').textContent,'');
  assert.match(element('alertFeedList').innerHTML,/data-emergency="panic"/);
  assert.match(element('alertFeedList').innerHTML,/data-status="new"/);
  assert.equal(element('openIncidentCount').dataset.open,'true');
});

 test('dashboard summary excludes the redundant manual panic total',async()=>{
  const template=await readFile(new URL('../views/dashboard.ejs',import.meta.url),'utf8');
  assert.doesNotMatch(template,/\['panic','Panic'\]/);
 });
