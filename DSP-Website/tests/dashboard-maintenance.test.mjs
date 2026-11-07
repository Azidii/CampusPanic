import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {readFile,access} from 'node:fs/promises';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

test('dashboard isolation, building filters, unique node names and guarded alert maintenance', { timeout: 120000 }, async t => {
  process.env.NODE_ENV = 'test';
  for (const key of ['JWT_SECRET','DEVICE_API_KEY','ADMIN_PASSWORD']) process.env[key] = randomBytes(32).toString('hex');
  const memory = await MongoMemoryServer.create();
  process.env.MONGODB_URI = memory.getUri('dashboard_maintenance_isolated');
  let server;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    ({server} = await import('../server.js'));
    const {User} = await import('../models/User.js'), {Node} = await import('../models/Node.js');
    const {Camera} = await import('../models/Camera.js'), {Alert} = await import('../models/Alert.js');
    const {EspDevice} = await import('../models/EspDevice.js');
    const {installNodeNameIndex} = await import('../services/nodeNames.js');
    const {resetPreview,deleteAllAlerts} = await import('../services/alertReset.js');
    const {withIncidentWrite,withIncidentReset} = await import('../services/incidentGuard.js');
    const {recordVisionThreat} = await import('../services/threatState.js');
    const {cleanupAlertSnapshot} = await import('../utils/retentionCleaner.js');
    const {removeSnapshot} = await import('../utils/snapshots.js');
    await Promise.all([Node.init(), Alert.init(), EspDevice.init(), User.init()]);
    await installNodeNameIndex();
    const users = {}, cookies = {};
    for (const [name,role] of [['admin','admin'],['alice','user'],['bob','user']]) {
      users[name] = await User.create({name,email:name+'@test.invalid',role,passwordHash:await User.hashPassword('isolated-test-password')});
      cookies[name] = 'token=' + jwt.sign({id:String(users[name]._id)},process.env.JWT_SECRET);
    }
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const request=(route,{user='admin',method='GET',body,headers={}}={})=>fetch(base+route,{method,redirect:'manual',
      headers:{...(user?{Cookie:cookies[user]}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
    const feed = async(user='alice',query='') => {
      const response=await request('/api/live?dashboard=true'+query,{user});assert.equal(response.status,200);return (await response.json()).dashboard;
    };
    let nodeId;
    await t.test('building and name validation; case/space duplicates, concurrent submissions and unchanged edits',async()=>{
      for(const body of [{name:'  ',building:'RSY',room:'A'},{name:'Gate',building:'Other',room:'A'},{name:'Gate',building:'rsy',room:'A'}]) assert.equal((await request('/api/nodes',{method:'POST',body})).status,400);
      const responses=await Promise.all([' Gate ','gAtE'].map((name,i)=>request('/api/nodes',{method:'POST',body:{name,building:i?'RG Birrey':'RSY',floor:'1',room:i?'R101':'C101',lat:0,lng:0}})));
      assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
      const duplicate=await responses.find(r=>r.status===409).json();assert.match(duplicate.message,/name already exists/);
      const created=await responses.find(r=>r.status===201).json();nodeId=created.node.nodeId;
      const body={name:'Gate',building:'RSY',floor:'1',room:'C102',lat:0,lng:0};
      assert.equal((await request('/api/nodes/'+nodeId,{method:'PUT',body})).status,200);
      const camera=await Camera.findOne({nodeId});assert.equal(camera.label,'Gate');assert.equal(camera.building,'RSY');assert.equal(camera.room,'C102');
      const cameras=await (await request('/api/cameras?building=RSY')).json();assert.equal(cameras.cameras.length,1);assert.equal(cameras.cameras[0].label,'Gate');
      assert.equal((await Node.findOne({nodeId})).lat,null);
      const other=await request('/api/nodes',{method:'POST',body:{name:'Courtyard',building:'RG Birrey',floor:'1',room:'Main Hall'}});assert.equal(other.status,201);
      const otherId=(await other.json()).node.nodeId;
      assert.equal((await request('/api/nodes/'+otherId,{method:'PUT',body:{...body,name:' gATE '}})).status,409);
      assert.equal((await request('/api/nodes',{user:'alice',method:'POST',body})).status,403);
      assert.equal((await Node.collection.indexes()).find(i=>i.name==='unique_node_name').unique,true);
    });
    const packet=(sequenceNumber,extra={})=>({nodeId,sequenceNumber,building:'RSY',room:'B',emergencyType:'fire',threatStatus:'manual_alert',checksum:'fixture',...extra});
    await t.test('all open incidents survive over 100 records; history pages and totals are independent',async()=>{
      await Alert.create(Array.from({length:112},(_,i)=>packet(i+1,{status:i===0?'acknowledged':'new'})));
      await Alert.create(Array.from({length:23},(_,i)=>packet(200+i,{status:'resolved'})));
      await Alert.create(packet(400,{building:'RG Birrey',emergencyType:'medical',threatStatus:'verified_threat'}));
      await Alert.create(packet(401,{building:'Legacy Hall',status:'resolved'}));
      const selected=await feed('alice','&building=RSY&historyPage=2');
      assert.equal(selected.alerts.length,112);assert.equal(selected.history.length,10);assert.equal(selected.historyPage,2);assert.equal(selected.historyTotal,23);assert.equal(selected.historyPages,3);
      assert.equal(selected.counts.total,135);assert.equal(selected.counts.unresolved,112);assert.equal(selected.outsideOpen,1);assert.equal(selected.latestThreat,null);
      const combined=await feed('alice','&building=RSY&type=fire&status=acknowledged&search=B');assert.equal(combined.alerts.length,1);assert.equal(combined.counts.total,135);
      assert.equal((await feed('alice','&building=RG+Birrey&type=fire')).alerts.length,0);
      assert.equal((await feed('alice','&search=.*')).alerts.length,0,'search treats regex operators as literal text');
      assert.equal((await feed('alice')).counts.total,137);
      assert.ok((await feed('alice','&showCleared=true')).history.some(a=>a.building==='Legacy Hall'));
      const first=(await feed('alice','&building=RSY')).history;assert.ok(!first.some(a=>selected.history.some(b=>a._id===b._id)));
      for(const query of ['&building[ne]=RSY','&building=Other','&historyPage=-1','&search[$ne]=x']) assert.equal((await request('/api/live?dashboard=true'+query)).status,400);
      assert.equal((await request('/api/alerts?limit=-1')).status,400);
    });
    await t.test('clearing is server-persisted per user; new and acknowledged incidents cannot be hidden',async()=>{
      const response=await request('/api/alerts/clear-resolved',{user:'alice',method:'POST',body:{building:'RSY',userId:String(users.bob._id)}});assert.equal(response.status,200);assert.equal((await response.json()).cleared,23);
      const alice=await feed('alice','&building=RSY'),bob=await feed('bob','&building=RSY');
      assert.equal(alice.historyTotal,0);assert.equal(alice.alerts.length,112);assert.equal(bob.historyTotal,23);assert.equal(alice.counts.total,bob.counts.total);
      assert.equal((await feed('alice','&building=RSY&showCleared=true')).historyTotal,23);
      const old=await Alert.findOne({status:'resolved',building:'RSY'});assert.equal((await request('/api/alerts/'+old._id,{user:'alice'})).status,200);
      await Alert.updateOne({_id:old._id},{status:'acknowledged'});assert.ok((await feed('alice','&building=RSY')).alerts.some(a=>a._id===String(old._id)));
      assert.equal((await request('/api/alerts/clear-resolved',{user:null,method:'POST',body:{building:'all'}})).status,401);
      assert.equal((await request('/api/alerts/clear-resolved',{user:'alice',method:'POST',headers:{Origin:'https://hostile.example'},body:{building:'all'}})).status,403);
      assert.equal(await Alert.countDocuments(),137);
    });
    await t.test('retention and reset preserve failed snapshot references and reject unsafe paths',async()=>{
      const alert=await Alert.create(packet(500,{status:'resolved',imageUrl:'/uploads/alerts/retained.jpg'}));
      const failed=async()=>{throw Object.assign(new Error('locked'),{code:'EACCES'});};
      await assert.rejects(cleanupAlertSnapshot(alert,failed));assert.equal((await Alert.findById(alert._id)).imageUrl,alert.imageUrl);
      await assert.rejects(removeSnapshot('/uploads/alerts/../outside.jpg'));
      await removeSnapshot('/uploads/alerts/missing.jpg',async()=>{throw Object.assign(new Error(),{code:'ENOENT'});});
      const result=await deleteAllAlerts(await resetPreview(),async url=>{if(url)await failed();});
      assert.equal(result.remaining,1);assert.equal(result.failures.length,1);assert.equal(result.reconciled,true);
      assert.equal((await Alert.findById(alert._id)).imageUrl,alert.imageUrl);
      await cleanupAlertSnapshot(alert,async()=>{});assert.equal((await Alert.findById(alert._id)).imageUrl,null);
    });
    await t.test('admin-only, same-origin, explicit count-bound reset; other records survive',async()=>{
      await EspDevice.create({deviceId:'ESP-AABBCCDDEEFF',tokenHash:'test-hash',pinHash:'test-pin',pinExpiresAt:new Date(0),lastSeen:new Date(0),nodeId});
      await Node.updateOne({nodeId},{status:'active',lastSeen:new Date(0)});
      for(const user of [null,'alice']) {
        assert.equal((await request('/api/alerts/reset-preview',{user})).status,user?403:401);
        assert.equal((await request('/api/alerts',{user,method:'DELETE',body:{}})).status,user?403:401);
      }
      let preview=await (await request('/api/alerts/reset-preview')).json();
      const confirmed=()=>({confirmation:'DELETE ALL ALERTS',confirmationToken:preview.confirmationToken});
      assert.equal((await request('/api/alerts',{method:'DELETE',body:confirmed()})).status,400);
      assert.equal((await request('/api/alerts',{method:'DELETE',headers:{'X-CampusPanic-Action':'reset-alerts',Origin:'https://hostile.example'},body:confirmed()})).status,403);
      const {saveBase64Image} = await import('../middleware/upload.js');
      const imageUrl=saveBase64Image((await readFile(new URL('./fixtures/blank.jpg',import.meta.url))).toString('base64'));
      await Alert.create(packet(501,{imageUrl}));
      assert.equal((await request('/api/alerts',{method:'DELETE',headers:{'X-CampusPanic-Action':'reset-alerts'},body:confirmed()})).status,409);
      preview=await (await request('/api/alerts/reset-preview')).json();
      const counts=await Promise.all([User.countDocuments(),Node.countDocuments(),Camera.countDocuments(),EspDevice.countDocuments()]);
      const response=await request('/api/alerts',{method:'DELETE',headers:{'X-CampusPanic-Action':'reset-alerts',Origin:base},body:confirmed()});
      assert.equal(response.status,200);const result=await response.json();assert.equal(result.deleted,2);assert.equal(result.remaining,0);assert.equal(result.reconciled,true);
      await assert.rejects(access(new URL('..'+imageUrl,import.meta.url)));
      assert.deepEqual(await Promise.all([User.countDocuments(),Node.countDocuments(),Camera.countDocuments(),EspDevice.countDocuments()]),counts);
      assert.equal((await Node.findOne({nodeId})).status,'offline');
    });
    await t.test('writers exclude reset across database guards; detections can create fresh alerts after reset',async()=>{
      await withIncidentWrite(async()=>{await assert.rejects(deleteAllAlerts(await resetPreview()),{statusCode:503});});
      await withIncidentReset(async()=>{await assert.rejects(recordVisionThreat(nodeId,[{label:'gun',confidence:.9,box:[0,0,10,10]}]),{statusCode:503});});
      const first=await recordVisionThreat(nodeId,[{label:'gun',confidence:.9,box:[0,0,10,10]}]);assert.ok(first);
      await deleteAllAlerts(await resetPreview());
      const fresh=await recordVisionThreat(nodeId,[{label:'gun',confidence:.9,box:[0,0,10,10]}]);assert.ok(fresh);assert.notEqual(String(first._id),String(fresh._id));
      await deleteAllAlerts(await resetPreview());
    });
    await t.test('resolved reset is admin-only, count-bound and building-scoped; open incidents survive',async()=>{
      assert.match(await (await request('/')).text(), /id="resetResolved"/);
      assert.doesNotMatch(await (await request('/',{user:'alice'})).text(), /id="resetResolved"/);
      const resolved=await Alert.create(packet(800,{status:'resolved',clearedBy:[users.alice._id]}));
      const open=await Alert.create(packet(801));
      const other=await Alert.create(packet(802,{status:'resolved',building:'RG Birrey'}));
      for(const user of [null,'alice']) {
        assert.equal((await request('/api/alerts/resolved-reset-preview',{user})).status,user?403:401);
        assert.equal((await request('/api/alerts/resolved',{user,method:'DELETE',body:{}})).status,user?403:401);
      }
      assert.equal((await request('/api/alerts/resolved-reset-preview?building=Other')).status,400);
      let preview=await (await request('/api/alerts/resolved-reset-preview?building=RSY')).json();
      assert.equal(preview.count,1);
      const reset=(headers={})=>request('/api/alerts/resolved',{method:'DELETE',headers:{'X-CampusPanic-Action':'reset-resolved',...headers},body:{confirmation:'DELETE RESOLVED',confirmationToken:preview.confirmationToken}});
      assert.equal((await reset({Origin:'https://hostile.example'})).status,403);
      assert.equal((await request('/api/alerts/resolved',{method:'DELETE',body:{}})).status,400);
      const changed=await Alert.create(packet(803,{status:'resolved'}));
      assert.equal((await reset()).status,409);
      preview=await (await request('/api/alerts/resolved-reset-preview?building=RSY')).json();
      const result=await reset();assert.equal(result.status,200);assert.equal((await result.json()).deleted,2);
      assert.equal(await Alert.findById(resolved._id),null);assert.equal(await Alert.findById(changed._id),null);
      assert.ok(await Alert.findById(open._id));assert.ok(await Alert.findById(other._id));
      const current=await feed('alice','&building=RSY');assert.equal(current.counts.fire,1);assert.equal(current.historyTotal,0);assert.equal(current.alerts.length,1);
      await deleteAllAlerts(await resetPreview());
    });
    await t.test('resetting all resolved detections returns the three dashboard counters to zero',async()=>{
      for(const [index,emergencyType] of ['gunshot','medical','fire'].entries()) {
        await Alert.create(packet(900+index,{emergencyType,status:'resolved'}));
      }
      const before=await feed();
      assert.deepEqual(['gunshot','medical','fire'].map(type=>before.counts[type]),[1,1,1]);
      const preview=await (await request('/api/alerts/resolved-reset-preview?building=all')).json();
      const response=await request('/api/alerts/resolved',{method:'DELETE',headers:{'X-CampusPanic-Action':'reset-resolved'},body:{confirmation:'DELETE RESOLVED',confirmationToken:preview.confirmationToken}});
      assert.equal(response.status,200);
      const after=await feed('alice','&showCleared=true');
      assert.deepEqual(['gunshot','medical','fire'].map(type=>after.counts[type]),[0,0,0]);
      assert.equal(after.historyTotal,0);
      const html=await (await request('/')).text();
      for(const type of ['gunshot','medical','fire']) assert.ok(html.includes('id="count-'+type+'">0</span>'));
    });
    await t.test('several visible tabs do not exhaust the shared mutation rate limit',async()=>{
      for(let batch=0;batch<55;batch++) {
        const responses=await Promise.all(Array.from({length:20},()=>request('/api/live')));
        assert.ok(responses.every(r=>r.status===200));await Promise.all(responses.map(r=>r.arrayBuffer()));
      }
      assert.equal((await request('/api/nodes/'+nodeId,{method:'PUT',body:{name:'Gate',building:'RG Birrey',floor:'2',room:'R602'}})).status,200);
    });
  } finally {
    if(server?.listening) await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    await mongoose.disconnect();await memory.stop();
  }
});

