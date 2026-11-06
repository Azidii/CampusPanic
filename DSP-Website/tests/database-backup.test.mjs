import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {MongoClient,Long,Double,Binary,ObjectId} from 'mongodb';
import {MongoMemoryServer} from 'mongodb-memory-server';

test('BSON backups restore every collection, setting and index; account conflicts preserve both source records', {timeout:60000}, async()=>{
  process.env.NODE_ENV='test';
  process.env.JWT_SECRET='isolated-backup-test-secret';process.env.DEVICE_API_KEY='isolated-backup-device';process.env.ADMIN_PASSWORD='isolated-backup-admin';
  const memory=await MongoMemoryServer.create(),client=new MongoClient(memory.getUri());
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'campuspanic-backup-test-'));
  try {
    await client.connect();
    const {backup,readBackup,restore,verify,mergeSources}=await import('../scripts/consolidate-main-db.mjs');
    const db=client.db('source_isolated');
    const collection=await db.createCollection('espdevices',{validator:{deviceId:{$type:'string'}},validationLevel:'moderate',collation:{locale:'en',strength:2}});
    await collection.createIndex({deviceId:1},{unique:true});
    await collection.createIndex({nodeId:1},{unique:true,partialFilterExpression:{nodeId:{$type:'string'}}});
    await collection.insertOne({_id:new ObjectId(),deviceId:'ESP-TEST',nodeId:null,sequence:Long.fromString('9007199254740999'),confidence:new Double(1),data:new Binary(Buffer.from([0,1,255])),createdAt:new Date('2026-01-01T00:00:00Z')});
    await db.createCollection('emptyCollection');
    const saved=await backup(db,path.join(dir,'archive')),read=await readBackup(path.join(dir,'archive'));
    await restore(client.db('restored_isolated'),read);await verify(client.db('restored_isolated'),saved);
    await assert.rejects(restore(client.db('restored_isolated'),read),/empty/);
    const spec=docs=>[{name:'users',options:{},indexes:[{v:2,key:{_id:1},name:'_id_'}],docs}];
    const primary={_id:new ObjectId(),email:'admin@test.invalid',passwordHash:'primary-test-hash'};
    const secondary={_id:new ObjectId(),email:'admin@test.invalid',passwordHash:'secondary-test-hash'};
    const unique={_id:new ObjectId(),email:'unique@test.invalid',passwordHash:'unique-test-hash'};
    const result=mergeSources(spec([primary]),spec([secondary,unique]));
    assert.equal(result.archivedUserConflicts,1);assert.deepEqual(result.merged.find(c=>c.name==='users').docs,[primary,unique]);
    assert.deepEqual(result.merged.find(c=>c.name==='migration_user_conflicts').docs,[secondary]);
    assert.throws(()=>mergeSources([{name:'alerts',docs:[{_id:'same',a:1}],options:{},indexes:[]}],[{name:'alerts',docs:[{_id:'same',a:2}],options:{},indexes:[]}]),/conflict/);
    await fs.writeFile(path.join(dir,'archive','0.bson'),Buffer.from('corrupted'));await assert.rejects(readBackup(path.join(dir,'archive')),/checksum/);
  } finally {
    await client.close();await memory.stop();
    assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true});
  }
});
