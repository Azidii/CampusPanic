import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import '../js/map-data.js';

test('node create/edit validates schematic locations and preserves existing coordinates', {timeout:60000}, async t => {
  process.env.NODE_ENV='test';
  process.env.JWT_SECRET='isolated-location-test-secret';
  process.env.DEVICE_API_KEY='isolated-location-device-secret';
  process.env.ADMIN_PASSWORD='isolated-location-admin-password';
  const memory=await MongoMemoryServer.create(); process.env.MONGODB_URI=memory.getUri('node_locations_isolated');
  let server;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    ({server}=await import('../server.js'));
    const {Node}=await import('../models/Node.js'),{Camera}=await import('../models/Camera.js'),{User}=await import('../models/User.js');
    await Promise.all([Node.init(),User.init()]);
    const users={};
    for(const role of ['admin','user']) {
      const user=await User.create({name:role,email:role+'@locations.invalid',role,passwordHash:'test-only',isActive:true});
      users[role]='token='+jwt.sign({id:String(user._id)},process.env.JWT_SECRET);
    }
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const request=(method,route,body,role='admin')=>fetch(base+route,{method,headers:{...(role?{Cookie:users[role]}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});
    const valid={name:'Location test',building:'RSY',floor:'1',room:'C101'};
    await t.test('missing or conflicting choices cannot create a node',async()=>{
      for(const body of [ {...valid,floor:undefined}, {...valid,floor:'2'}, {...valid,floor:1}, {...valid,room:'C201'},
        {...valid,room:'Unknown'}, {...valid,building:'RG Birrey'}, {...valid,building:'Other'}, {...valid,floor:['1']}, {...valid,room:{$ne:null}} ]) {
        const response=await request('POST','/api/nodes',body);assert.equal(response.status,400,JSON.stringify(body));
      }
      assert.equal(await Node.countDocuments(),0);assert.equal(await Camera.countDocuments(),0);
      assert.equal((await request('POST','/api/nodes',valid,null)).status,401);
      assert.equal((await request('POST','/api/nodes',valid,'user')).status,403);
    });
    let first;
    await t.test('all 37 diagram rooms create nodes that map to the selected floor',async()=>{
      for(const [index,room] of globalThis.CampusMap.rooms.entries()) {
        const response=await request('POST','/api/nodes',{name:'Test location '+index,building:room.building.label,floor:room.floor.id,room:room.label});
        assert.equal(response.status,201,room.key);
        const result=await response.json();const mapped=globalThis.CampusMap.locate(result.node);
        assert.equal(mapped.key,room.key);assert.equal(result.node.lat,null);assert.equal(result.node.lng,null);
        assert.match(result.pairing.code,/^\d{8}$/);first ||= result.node;
      }
    });
    await t.test('edits update the camera and map location, ignore coordinates and reject cross-floor rooms',async()=>{
      await Node.updateOne({nodeId:first.nodeId},{lat:14.5,lng:120.9});
      const route='/api/nodes/'+first.nodeId;
      const moved={...valid,name:first.name,room:'Library',floor:'2',lat:0,lng:0};
      assert.equal((await request('PUT',route,{...moved,floor:'1'})).status,400);
      assert.equal((await Node.findOne({nodeId:first.nodeId})).room,first.room);
      assert.equal((await request('PUT',route,moved,'user')).status,403);
      assert.equal((await request('PUT',route,moved)).status,200);
      const node=await Node.findOne({nodeId:first.nodeId}),camera=await Camera.findOne({nodeId:first.nodeId});
      assert.equal(globalThis.CampusMap.locate(node).key,'rsy/2/library');assert.equal(camera.room,'Library');
      assert.equal(node.lat,14.5);assert.equal(node.lng,120.9,'location edits do not erase legacy coordinates');
    });
    await t.test('legacy locations require correction and canonical labels are stored',async()=>{
      await Node.collection.insertOne({nodeId:'LEGACY-TEST',name:'Legacy test',building:'Legacy building',room:'Unmapped'});
      assert.equal((await request('PUT','/api/nodes/LEGACY-TEST',{name:'Legacy test',building:'Legacy building',floor:'1',room:'Unmapped'})).status,400);
      assert.equal((await Node.findOne({nodeId:'LEGACY-TEST'})).room,'Unmapped');
      assert.equal((await request('PUT','/api/nodes/LEGACY-TEST',{name:'Legacy test',building:'RG Birrey',floor:'1',room:'r201'})).status,200);
      assert.equal((await Node.findOne({nodeId:'LEGACY-TEST'})).room,'R201');
    });
  } finally {
    if(server?.listening) await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    await mongoose.disconnect();await memory.stop();
  }
});
