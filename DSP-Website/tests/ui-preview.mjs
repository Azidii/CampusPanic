// Local UI verification only: disposable MongoDB, fixture identities, no model/device writers.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
process.env.NODE_ENV='test';
for(const name of ['JWT_SECRET','DEVICE_API_KEY','ADMIN_PASSWORD']) process.env[name]=randomBytes(32).toString('hex');
const memory=await MongoMemoryServer.create();
process.env.MONGODB_URI=memory.getUri('ui_preview_isolated');
await mongoose.connect(process.env.MONGODB_URI);
const {app}=await import('../server.js');
const {User}=await import('../models/User.js'),{Node}=await import('../models/Node.js'),{Alert}=await import('../models/Alert.js');
const {installNodeNameIndex}=await import('../services/nodeNames.js');
await Promise.all([Node.init(),Alert.init(),User.init()]);await installNodeNameIndex();
const admin=await User.create({name:'QA Administrator',email:'qa@campus.invalid',role:'admin',passwordHash:await User.hashPassword('preview-only-password')});
const operator=await User.create({name:'QA Operator',email:'operator@campus.invalid',role:'user',passwordHash:await User.hashPassword('preview-only-password')});
await Node.create([{nodeId:'NODE-QA-RSY',name:'RSY entrance camera',building:'RSY',room:'Entrance',videoEnabled:true},
  {nodeId:'NODE-QA-BIRREY',name:'RG Birrey corridor camera',building:'RG Birrey',room:'Corridor',videoEnabled:true}]);
await Node.collection.insertOne({nodeId:'NODE-QA-LEGACY',name:'Archive fixture',building:'Unmapped fixture',room:'Unknown',status:'offline'});
await Alert.create(Array.from({length:17},(_,i)=>({nodeId:i%2?'NODE-QA-BIRREY':'NODE-QA-RSY',building:i%2?'RG Birrey':'RSY',room:i%2?'Corridor':'Entrance',emergencyType:['fire','medical','gunshot','panic'][i%4],threatStatus:i%4===2?'verified_threat':'manual_alert',sequenceNumber:i+1,checksum:'qa-fixture',status:i<4?(i===0?'acknowledged':'new'):'resolved'})));
const wrapper=express();
wrapper.get('/__qa',(req,res)=>{const user=req.query.role==='user'?operator:admin;res.cookie('token',jwt.sign({id:String(user._id)},process.env.JWT_SECRET),{httpOnly:true,sameSite:'lax'});res.redirect(typeof req.query.to==='string'&&req.query.to.startsWith('/')&&!req.query.to.startsWith('//')?req.query.to:'/');});
wrapper.use(app);
const server=wrapper.listen(5117,'127.0.0.1',()=>console.log('Isolated UI preview: http://127.0.0.1:5117/__qa'));
async function stop(){await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await mongoose.disconnect();await memory.stop();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
