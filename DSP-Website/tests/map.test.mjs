import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { nodes, alerts } from './fixtures/map.mjs';
const context = vm.createContext({ URLSearchParams });
vm.runInContext(await readFile(new URL('../js/map-data.js', import.meta.url), 'utf8'), context);
const { buildings, rooms, locate, connection, feed, project } = context.CampusMap;
const plain = value => JSON.parse(JSON.stringify(value));

test('schematics preserve every reference room, row and floor (including unusual numbers)', () => {
  assert.deepEqual(plain(buildings.map(b => b.floors.map(f => f.rows.map(r => r.map(room => room.label))))), [
    [[['Main Hall','R101','R201','R301','R401','R501','R601','R701']],
      [['Main Hall (2nd Floor Faculty Room)','R602']], [['Main Hall (3rd Floor Faculty Room)']]],
    [[Array.from({length:10},(_,i)=>'C'+(101+i)), ['Cafeteria','Treasury, Admissions, Registrar','Faculty']],
      [Array.from({length:10},(_,i)=>'C'+(201+i)), ['Learning Commons','AVR','Library']]]
  ]);
  assert.equal(rooms.length, 37); assert.equal(new Set(rooms.map(r => r.key)).size, 37);
});
test('mapping uses explicit location and never node names, room-number guesses or coordinates', () => {
  assert.equal(locate({building:' rsy ',room:'c101'}).key,'rsy/1/c101');
  assert.equal(locate({building:'RG Birrey',room:'R201'}).floor.id,'1');
  assert.equal(locate({building:'RG Birrey',room:'R602'}).floor.id,'2');
  for (const node of [{building:'RSY',room:'C999',name:'C101'}, {building:'Wrong',room:'C101'},
    {building:'RG Birrey',room:'Faculty Room'}, {building:'RSY',room:'Entrance',lat:14,lng:121}]) assert.equal(locate(node),null);
});
test('multiple alerts and nodes, acknowledged/old incidents, deleted nodes and unmapped counts', () => {
  const model = project(nodes, [...alerts, alerts[0]]);
  assert.equal(model.rooms.get('rsy/1/c101').nodes.length,2);
  assert.equal(model.rooms.get('rsy/1/c101').alerts.length,2);
  assert.equal(model.rooms.get('rg-birrey/2/r602').alerts.length,1,'deleted node incident remains mapped');
  assert.equal(model.buildingCounts.get('rsy'),4,'count alerts, including known building with unknown room');
  assert.equal(model.buildingCounts.get('rg-birrey'),1);
  assert.equal(model.floorCounts.get('rsy/1'),2); assert.equal(model.floorCounts.get('rsy/2'),1);
  assert.equal(model.unmappedNodes.length,1); assert.equal(model.unmappedAlerts.length,2);
  assert.equal(model.active.length,6,'deduplicates snapshots and omits resolved alerts');
  const resolved = project(nodes, alerts.map(a => ({...a,status:'resolved'})));
  assert.equal(resolved.active.length,0); assert.equal(resolved.buildingCounts.get('rsy'),0);
  assert.equal(resolved.rooms.get('rsy/1/c101').alerts.length,0);
  const moved = project(nodes.map(n => ({...n,room:'C210'})),alerts);
  assert.equal(moved.rooms.get('rsy/1/c101').alerts.length,2,'node movement never relocates recorded incidents');
});
test('connectivity comes from existing heartbeat projections, independent of incident state', () => {
  assert.equal(connection(nodes[0]),'online'); assert.equal(connection(nodes[1]),'offline');
  assert.equal(connection(nodes[2]),'online'); assert.equal(connection(nodes[3]),'unknown');
  assert.equal(connection({status:'active',lastSeen:new Date()}),'unknown');
  assert.equal(connection({...nodes[1],audio:{paired:true,connected:true}}),'online');
  assert.equal(connection(nodes[0],false),'unknown');
  assert.equal(project(nodes,alerts).rooms.get('rsy/1/c101').alerts.length,2,'offline node still has emergency');
});
test('feed navigation keeps the exact node ID and explains every unavailable state', () => {
  assert.equal(feed({...nodes[0],nodeId:'NODE & ? /'}).href,'/cam-view?nodeId=NODE+%26+%3F+%2F');
  assert.match(feed(nodes[1]).reason,/disconnected/);
  assert.match(feed(nodes[2]).reason,/no configured camera/);
  assert.match(feed({...nodes[0],video:{cameraConnected:true,live:false}}).reason,/no fresh video/);
  assert.match(feed(nodes[0],false).reason,/unavailable/);
});
test('schematic theme uses the existing tokens and main Map no longer loads Leaflet', async () => {
  const css=await readFile(new URL('../css/map-view.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/#[a-f0-9]{3,8}\b/i);
  const head=await readFile(new URL('../views/partials/head.ejs',import.meta.url),'utf8');
  const scripts=await readFile(new URL('../views/partials/scripts.ejs',import.meta.url),'utf8');
  assert.match(head,/if \(page === 'active-nodes-map'\)/);
  assert.match(scripts,/\['map-view', 'all-cams', 'security-nodes', 'cam-view'\].*map-data\.js/);
});
