import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

test('browser security and node permissions with admin, operator and anonymous identities', {timeout:60000}, async t => {
  process.env.NODE_ENV='test';
  for(const name of ['JWT_SECRET','DEVICE_API_KEY','ADMIN_PASSWORD']) process.env[name]=randomBytes(32).toString('hex');
  const memory=await MongoMemoryServer.create();
  let server;
  try {
    await mongoose.connect(memory.getUri('security_hardening'));
    ({server}=await import('../server.js'));
    const {User}=await import('../models/User.js');
    const {Node}=await import('../models/Node.js');
    const {Alert}=await import('../models/Alert.js');
    const identities={};
    for(const role of ['admin','user']) {
      const user=await User.create({name:role,email:role+'@test.invalid',role,passwordHash:'fixture-only',isActive:true});
      identities[role]='token='+jwt.sign({id:String(user._id)},process.env.JWT_SECRET);
    }
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const request=(route,{role,method='GET',body,headers={}}={})=>fetch(base+route,{method,redirect:'manual',headers:{...(role?{Cookie:identities[role]}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
    await t.test('CSP permits the console assets and blocks inline scripts; CORS never reflects an arbitrary origin',async()=>{
      const response=await request('/api/live',{role:'admin',headers:{Origin:'https://untrusted.example'}});
      assert.equal(response.status,200);
      assert.equal(response.headers.get('access-control-allow-origin'),null);
      assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
      assert.doesNotMatch(response.headers.get('content-security-policy'),/script-src[^;]*unsafe-inline/);
      assert.match(response.headers.get('cache-control'),/no-store/);
      assert.equal((await request('/api/nodes',{role:'admin',method:'POST',body:{name:'Blocked',building:'A',room:'1'},headers:{Origin:'https://untrusted.example'}})).status,403);
      assert.equal(await Node.countDocuments(),0);
    });
    let id;
    await t.test('only administrators create, edit and delete; operators and anonymous clients cannot mutate',async()=>{
      const body={name:'Library',building:'RSY',floor:'1',room:'C101'};
      assert.equal((await request('/api/nodes',{method:'POST',body})).status,401);
      assert.equal((await request('/api/nodes',{role:'user',method:'POST',body})).status,403);
      const created=await request('/api/nodes',{role:'admin',method:'POST',body,headers:{Origin:base}});
      assert.equal(created.status,201); id=(await created.json()).node.nodeId;
      for(const role of [undefined,'user']) for(const method of ['PUT','DELETE']) assert.equal((await request('/api/nodes/'+id,{role,method,body:method==='PUT'?body:undefined})).status,role?403:401);
      assert.equal((await request('/api/nodes/'+id,{role:'admin',method:'PUT',body:{...body,name:'Updated',lat:0,lng:0}})).status,200);
      assert.equal((await Node.findOne({nodeId:id})).name,'Updated');
      assert.equal((await request('/api/users',{role:'user'})).status,403);
      assert.equal((await request('/api/live')).status,401);
      assert.equal((await request('/api/live',{role:'user'})).status,200);
    });
    await t.test('incident images require authentication; raster validation blocks script files and oversized input',async()=>{
      const {saveBase64Image}=await import('../middleware/upload.js');
      for(const value of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=','data:image/jpeg;base64,PHNjcmlwdD4=',{},'A'.repeat(14*1024*1024)]) assert.throws(()=>saveBase64Image(value));
      const jpeg=await readFile(new URL('./fixtures/blank.jpg',import.meta.url));
      const url=saveBase64Image(jpeg.toString('base64'));
      try {
        assert.equal((await request(url)).status,401);
        const allowed=await request(url,{role:'user'});
        assert.equal(allowed.status,200); assert.match(allowed.headers.get('cache-control'),/no-store/);
        assert.match(allowed.headers.get('content-type'),/image\/jpeg/);
      } finally { await unlink(new URL('..'+url,import.meta.url)); }
    });
    await t.test('maps remain functional, node deep links retain the affected node and removed nodes never fall back to another camera',async()=>{
      for(const route of ['/map','/active-nodes-map','/active-threats-map']) {
        const response=await request(route,{role:'admin'});assert.equal(response.status,200);assert.match(await response.text(),route === '/map' ? /mapBuildingPanel/ : /buildingFilter/);
      }
      for(const route of ['/','/security-nodes','/cameras','/notifications','/profile','/settings','/admin/users','/cam-view?nodeId='+id]) {
        const response=await request(route,{role:'admin'}); assert.equal(response.status,200,route);
        const html=await response.text();assert.doesNotMatch(html,/onclick=/);
        assert.equal((html.match(/src="\/js\/notifications.js"/g) || []).length,1,'notification controls load once per page');
      }
      const html=await (await request('/cam-view?nodeId=NODE-REMOVED',{role:'user'})).text();
      assert.match(html,/Node unavailable/); assert.match(html,/data-node-id=""/);
      assert.equal((await request('/cam-view?alertId=bad',{role:'user'})).status,400);
      assert.equal((await request('/api/alerts?limit=-1',{role:'user'})).status,400);
      const alert=await Alert.create({nodeId:id,building:'RSY',room:'Entrance',emergencyType:'panic',threatStatus:'manual_alert',sequenceNumber:1,checksum:'test'});
      assert.equal((await request('/api/alerts/'+alert._id,{role:'user',method:'PATCH',body:{action:'invalid'}})).status,400);
      assert.equal((await request('/api/nodes/'+id,{role:'admin',method:'DELETE'})).status,200);
    });
  } finally {
    if(server?.listening) await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    await mongoose.disconnect();await memory.stop();
  }
});
