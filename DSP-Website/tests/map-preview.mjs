// Local-only visual QA. Uses isolated fixture data, never a campus database or device.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot } from './fixtures/map.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const user = { name: 'Map fixture preview', role: 'admin' };
function preview(directory, port, before = false) {
  const app = express(); let state = structuredClone(snapshot), unavailable = false;
  app.set('views', path.join(directory, 'views')); app.set('view engine','ejs'); app.use(express.json());
  for (const name of ['js','css','public']) app.use('/'+name,express.static(path.join(directory,name)));
  app.get('/api/live', (req,res) => unavailable ? res.status(503).json({success:false}) : res.json(state));
  app.post('/__fixture', (req,res) => {
    unavailable = Boolean(req.body.unavailable); state = req.body.state || structuredClone(snapshot);
    res.json({success:true});
  });
  app.get(['/','/map'], (req,res) => res.render('map-view',{title:'Map fixture preview',page:'map-view',user,nodes:state.nodes},(error,html)=>{
    if(error) return res.status(500).send(error.message);
    res.send(html.replace('<h1>Campus map</h1>','<h1>Campus map</h1><p>Isolated test fixtures · Not live campus data</p>'));
  }));
  app.get('/cam-view',(req,res)=>res.render('cam-view',{title:'Test feed route',page:'cam-view',user,
    nodes:state.nodes,cameras:[],latestAlerts:[],selectedNode:state.nodes.find(n=>n.nodeId===req.query.nodeId)||null,selectedAlert:null}));
  return app.listen(port,'127.0.0.1',()=>console.log(`${before?'Before':'After'} fixture preview: http://127.0.0.1:${port}/map`));
}
const servers = [preview(root,5129)];
if(process.env.MAP_BEFORE_ROOT) servers.push(preview(process.env.MAP_BEFORE_ROOT,5130,true));
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{for(const server of servers){server.close();server.closeAllConnections();}process.exit(0);});
