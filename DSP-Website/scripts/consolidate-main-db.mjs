import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient, BSON } from 'mongodb';
import { config } from '../config/config.js';
import { configureMongoDns } from '../config/mongoConfig.js';

const SOURCES = ['test', 'campuspanic'];
const canonical = value => {
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  return JSON.stringify(sorted(BSON.EJSON.serialize(value, { relaxed: false })));
};
const digest = value => createHash('sha256').update(value).digest('hex');
const contents = docs => digest(docs.map(canonical).sort().join('\n'));
const json = value => BSON.EJSON.stringify(value, {relaxed:false});
const parse = value => BSON.EJSON.parse(value, {relaxed:false});
const writeJSON = (file, value) => fs.writeFile(file, json(value), {flag:'wx'});

export async function snapshot(db) {
  // shortcut: this small deployment fits in memory; stream batches before migrating a large database.
  const result = [];
  for (const item of (await db.listCollections().toArray()).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (item.type !== 'collection' || item.name.startsWith('system.')) throw new Error('Unsupported collection type; review before migration.');
    const collection = db.collection(item.name);
    const docs = await collection.find({}, {promoteValues:false, promoteLongs:false}).toArray();
    result.push({name:item.name, options:item.options || {}, indexes:await collection.indexes(), docs});
  }
  return result;
}
export async function backup(db, destination) {
  const data = await snapshot(db), metadata = [];
  await fs.mkdir(destination, {recursive:false});
  for (const [index, item] of data.entries()) {
    const bytes = Buffer.concat(item.docs.map(doc => BSON.serialize(doc)));
    const file = index + '.bson'; await fs.writeFile(path.join(destination,file),bytes,{flag:'wx'});
    metadata.push({name:item.name,options:item.options,indexes:item.indexes,file,count:item.docs.length,
      sha256:digest(bytes),contents:contents(item.docs)});
  }
  await writeJSON(path.join(destination,'manifest.ejson'),metadata);
  return data;
}
export async function readBackup(destination) {
  const metadata = parse(await fs.readFile(path.join(destination,'manifest.ejson'),'utf8')), result=[];
  for (const item of metadata) {
    if (!/^\d+\.bson$/.test(item.file)) throw new Error('Invalid backup filename.');
    const bytes = await fs.readFile(path.join(destination,item.file));
    if (digest(bytes) !== item.sha256) throw new Error('Backup checksum mismatch.');
    const docs=[]; let offset=0;
    while(offset<bytes.length) {
      if(offset+4>bytes.length) throw new Error('Truncated backup.');
      const size=bytes.readInt32LE(offset);if(size<5||offset+size>bytes.length) throw new Error('Invalid BSON backup.');
      docs.push(BSON.deserialize(bytes.subarray(offset,offset+size),{promoteValues:false,promoteLongs:false}));offset+=size;
    }
    if(docs.length!==Number(item.count)||contents(docs)!==item.contents) throw new Error('Backup content mismatch.');
    result.push({name:item.name,options:item.options,indexes:item.indexes,docs});
  }
  return result;
}
export async function restore(db, data) {
  if((await db.listCollections().toArray()).length) throw new Error('Restore destination must be empty.');
  for(const item of data) {
    const collection=await db.createCollection(item.name,item.options);
    if(item.docs.length) await collection.insertMany(item.docs);
    const indexes=item.indexes.filter(index=>index.name!=='_id_');
    if(indexes.length) await collection.createIndexes(indexes);
  }
}
export async function verify(db, expected, allowExtraIndexes = false) {
  const actual=await snapshot(db);
  const maintenance=allowExtraIndexes ? actual.find(item=>item.name==='maintenance'&&!expected.some(other=>other.name==='maintenance')) : null;
  if(maintenance && (maintenance.docs.length!==1 || maintenance.docs[0]._id!=='alerts' || maintenance.docs[0].resetting!==false || maintenance.docs[0].writers?.length!==0)) throw new Error('Unexpected maintenance state.');
  if(actual.length-(maintenance?1:0)!==expected.length) throw new Error('Collection count mismatch.');
  for(const item of expected) {
    const found=actual.find(other=>other.name===item.name);
    if(!found||canonical(found.options)!==canonical(item.options)||contents(found.docs)!==contents(item.docs)) throw new Error('Document or collection setting mismatch: '+item.name);
    const keys=indexes=>indexes.map(canonical).sort();
    if(allowExtraIndexes) {
      if(!keys(item.indexes).every(index=>keys(found.indexes).includes(index))) throw new Error('Missing source index: '+item.name);
    } else if(canonical(keys(found.indexes))!==canonical(keys(item.indexes))) throw new Error('Index mismatch: '+item.name);
  }
}
export function mergeSources(primary, secondary) {
  const merged=primary.map(item=>({...item,docs:[...item.docs],indexes:[...item.indexes]})), conflicts=[], identical=[];
  for(const item of secondary) {
    let target=merged.find(other=>other.name===item.name);
    if(!target){merged.push({...item,docs:[...item.docs],indexes:[...item.indexes]});continue;}
    if(canonical(item.options)!==canonical(target.options)) throw new Error('Conflicting collection settings: '+item.name);
    for(const index of item.indexes) {
      const old=target.indexes.find(other=>other.name===index.name);
      if(old&&canonical(old)!==canonical(index)) throw new Error('Conflicting index: '+item.name+'.'+index.name);
      if(!old)target.indexes.push(index);
    }
    for(const doc of item.docs) {
      const old=target.docs.find(other=>canonical(other._id)===canonical(doc._id));
      if(old&&canonical(old)===canonical(doc)){identical.push({collection:item.name,id:String(doc._id)});continue;}
      const sameEmail=item.name==='users'&&target.docs.some(other=>other.email===doc.email);
      if(item.name==='users'&&(old||sameEmail)){conflicts.push(doc);continue;}
      if(old) throw new Error('Unresolved document ID conflict: '+item.name);
      target.docs.push(doc);
    }
  }
  if(conflicts.length) {
    if(merged.some(item=>item.name==='migration_user_conflicts')) throw new Error('Conflict archive already exists; review needed.');
    merged.push({name:'migration_user_conflicts',options:{},indexes:[{v:2,key:{_id:1},name:'_id_'}],docs:conflicts});
  }
  return {merged,identical,archivedUserConflicts:conflicts.length};
}

async function run() {
  const [mode, directory]=process.argv.slice(2);
  if(!['prepare','copy','cleanup'].includes(mode)||!directory) throw new Error('Usage: node scripts/consolidate-main-db.mjs prepare|copy|cleanup PRIVATE_BACKUP_DIRECTORY');
  configureMongoDns();
  const deployment=new URL(config.mongoUri).hostname;
  const client=new MongoClient(config.mongoUri,{serverSelectionTimeoutMS:10000});
  try {
    await client.connect();
    if(mode==='prepare') {
      await fs.mkdir(directory,{recursive:false});
      const sources={};
      for(const name of [...SOURCES,'mainDB']) sources[name]=await backup(client.db(name),path.join(directory,name));
      const {merged,identical,archivedUserConflicts}=mergeSources(sources.test,sources.campuspanic);
      // Verify every source archive and the complete proposed merge in an isolated local server.
      const {MongoMemoryServer}=await import('mongodb-memory-server');
      const memory=await MongoMemoryServer.create(),isolated=new MongoClient(memory.getUri());
      try {
        await isolated.connect();
        for(const name of [...SOURCES,'mainDB']) {
          const data=await readBackup(path.join(directory,name));
          await restore(isolated.db('restore_'+name),data);await verify(isolated.db('restore_'+name),data);
        }
        await restore(isolated.db('planned_mainDB'),merged);await verify(isolated.db('planned_mainDB'),merged);
      } finally {await isolated.close();await memory.stop();}
      const report={deployment,preparedAt:new Date(),backupsVerified:true,policy:'Keep test user accounts on conflicts; preserve campuspanic conflicts unchanged in migration_user_conflicts.',
        sourceCounts:Object.fromEntries(Object.entries(sources).map(([name,items])=>[name,items.map(item=>({collection:item.name,count:item.docs.length,indexes:item.indexes.length,options:item.options,contents:contents(item.docs)}))])),
        proposedCounts:merged.map(item=>({collection:item.name,count:item.docs.length,indexes:item.indexes.length})),identical,archivedUserConflicts,
        buildingCorrections:[],nameCorrections:[],legacyHistory:'Preserve original incident buildings and rooms.',unresolved:sources.mainDB.length?['mainDB already contains collections; inspect before writing.']:[]};
      const nodeIds=new Set((merged.find(item=>item.name==='nodes')?.docs||[]).map(doc=>doc.nodeId));
      report.relationships={historicalAlertsWithoutCurrentNode:(merged.find(item=>item.name==='alerts')?.docs||[]).filter(doc=>!nodeIds.has(doc.nodeId)).length,
        espDevicesWithoutCurrentNode:(merged.find(item=>item.name==='espdevices')?.docs||[]).filter(doc=>doc.nodeId&&!nodeIds.has(doc.nodeId)).length};
      await writeJSON(path.join(directory,'dry-run.ejson'),report);
      console.log(JSON.stringify(report,null,2));
    } else {
      const report=parse(await fs.readFile(path.join(directory,'dry-run.ejson'),'utf8'));
      if(report.deployment!==deployment||!report.backupsVerified||report.unresolved.length)throw new Error('Deployment or preflight verification mismatch.');
      const sources={};for(const name of SOURCES){sources[name]=await readBackup(path.join(directory,name));await verify(client.db(name),sources[name]);}
      const {merged}=mergeSources(sources.test,sources.campuspanic);
      if(mode==='copy') {
        await restore(client.db('mainDB'),merged);await verify(client.db('mainDB'),merged);
        await writeJSON(path.join(directory,'copied.ejson'),{deployment,copiedAt:new Date(),sourceVerification:true,targetVerification:true});
        console.log('Copied and verified all documents, indexes and collection settings. Sources retained.');
      } else {
        const proof=JSON.parse(await fs.readFile(path.join(directory,'application-verified.json'),'utf8'));
        if(proof.deployment!==deployment||proof.database!=='mainDB'||!proof.login||!proof.views||!proof.pairingRecords||!proof.nameConstraint)throw new Error('Application verification incomplete; sources retained.');
        if(new URL(config.mongoUri).pathname!=='/mainDB')throw new Error('Application URI does not explicitly select mainDB.');
        await verify(client.db('mainDB'),merged,true);
        // The only permitted deletion targets are these exact source names on the verified deployment.
        for(const name of SOURCES) {
          if(!['test','campuspanic'].includes(name)||name==='mainDB')throw new Error('Invalid deletion target.');
          await client.db(name).dropDatabase();
        }
        for(const name of SOURCES) if((await client.db(name).listCollections().toArray()).length)throw new Error('Source deletion verification failed.');
        await writeJSON(path.join(directory,'completed.ejson'),{deployment,target:'mainDB',deleted:SOURCES,completedAt:new Date()});
        console.log('Verified deletion of exactly test and campuspanic. mainDB and private backups retained.');
      }
    }
  } finally {await client.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(error=>{console.error('Maintenance failed:',error.code||error.name);process.exitCode=1;});
