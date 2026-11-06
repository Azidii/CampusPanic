import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

for(const file of ['active-nodes-map.js']) {
  test(`${file}: map tiles follow the saved theme and theme changes`,async()=>{
    let ready, observer;
    const urls=[];
    const tile={addTo(){return this;},setUrl(url){urls.push(url);}};
    const group={addTo(){return this;},clearLayers(){},getLayers(){return [];}};
    const elements=new Map();
    const document={documentElement:{dataset:{theme:'light'}},addEventListener(name,fn){ready=fn;},getElementById(id){
      if(!elements.has(id)) elements.set(id,{textContent:id==='nodesData'?'[]':id==='activeNodesData'?'{"activeNodes":[],"activeAlerts":[]}':'',dataset:{}});
      return elements.get(id);
    },querySelector(){return {children:[{}],append(){}};},querySelectorAll(){return [{},{},{}];},createElement(){return {};}};
    vm.runInNewContext(await readFile(new URL('../js/'+file,import.meta.url),'utf8'),{
      document,window:{filterBuilding:rows=>rows,addEventListener(){}},
      MutationObserver:class {constructor(fn){observer=fn;} observe(){}},
      L:{map(){return {fitWorld(){}};},tileLayer(url){urls.push(url);return tile;},featureGroup(){return group;}}
    });
    ready(); assert.match(urls[0],/\/light_all\//);
    document.documentElement.dataset.theme='dark'; observer(); assert.match(urls.at(-1),/\/dark_all\//);
  });
}

test('dashboard inherits the shared semantic palette',async()=>{
  const css=await readFile(new URL('../css/dashboard.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/--(?:bg-primary|bg-secondary|text-primary|signal-gunshot)\s*:/);
});

test('emergency labels meet AA text contrast in both themes',async()=>{
  const css=await readFile(new URL('../css/common.css',import.meta.url),'utf8');
  const declarations=block=>Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
  const dark=declarations(css.match(/:root\s*\{([\s\S]*?)\n\}/)[1]);
  const light={...dark,...declarations(css.match(/\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)[1])};
  const luminance=hex=>{
    const rgb=hex.slice(1).length===3?hex.slice(1).split('').map(c=>parseInt(c+c,16)):hex.slice(1).match(/../g).map(c=>parseInt(c,16));
    const linear=rgb.map(n=>n/255<=.04045?n/255/12.92:((n/255+.055)/1.055)**2.4);
    return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
  };
  for(const [theme,tokens] of Object.entries({dark,light})) {
    const resolve=name=>tokens[name].replace(/var\((--[\w-]+)\)/g,(_,ref)=>resolve(ref));
    const contrast=(a,b)=>{const [x,y]=[luminance(resolve(a)),luminance(resolve(b))].sort((x,y)=>y-x);return (x+.05)/(y+.05);};
    for(const kind of ['gunshot','medical','fire','panic']) assert.ok(contrast('--type-'+kind,'--type-'+kind+'-bg')>=4.5,theme+' '+kind+' label contrast');
    for(const kind of ['gunshot','medical','fire','panic']) assert.ok(contrast(kind==='fire'?'--summary-fire-ink':'--summary-ink','--summary-'+kind+'-bg')>=4.5,theme+' '+kind+' filled summary contrast');
    for(const ink of ['--text-primary','--text-secondary','--text-muted']) assert.ok(contrast(ink,'--bg-surface')>=4.5,theme+' '+ink+' contrast');
    assert.ok(contrast('--critical-ink','--critical-bg')>=4.5,theme+' verified banner contrast');
    assert.ok(contrast('--nav-muted','--nav-bg')>=4.5,theme+' navigation contrast');
    assert.ok(contrast('--nav-ink','--nav-active')>=4.5,theme+' selected navigation contrast');
    assert.equal(new Set(['gunshot','medical','fire','panic'].map(k=>resolve('--type-'+k))).size,4);
  }
  assert.notEqual(light['--nav-bg'],dark['--nav-bg'],'Light navigation has its own surface');
});

test('threat map cards and pins agree for every emergency classification',async()=>{
  const types=['gunshot','medical','fire','panic'];
  const nodes=types.map((emergencyType,i)=>({nodeId:String(i),lat:14+i/100,lng:121,building:'RSY',room:'Entrance',hud:{threats:{}}}));
  const alerts=types.map((emergencyType,i)=>({_id:String(i),nodeId:String(i),emergencyType,status:'new',building:'RSY',room:'Entrance'}));
  let ready;
  const icons=[],cards=[];
  const make=()=>({dataset:{},children:[],append(){},remove(){}});
  const elements=new Map();
  const sidebar={children:[make()],append(card){cards.push(card);}};
  const document={documentElement:{dataset:{theme:'light'}},addEventListener(name,fn){ready=fn;},getElementById(id){
    if(!elements.has(id))elements.set(id,{dataset:{},textContent:id==='activeNodesData'?JSON.stringify({activeNodes:nodes,activeAlerts:alerts}):''});
    return elements.get(id);
  },querySelector(){return sidebar;},createElement:make};
  const group={addTo(){return this;},clearLayers(){},getLayers(){return [];}};
  vm.runInNewContext(await readFile(new URL('../js/active-nodes-map.js',import.meta.url),'utf8'),{
    document,window:{filterBuilding:rows=>rows,isLegacyBuilding:()=>false,addEventListener(){}},
    MutationObserver:class {observe(){}},
    L:{map:()=>({fitWorld(){}}),tileLayer:()=>({addTo(){return this;}}),featureGroup:()=>group,divIcon(opts){icons.push(opts.className);return opts;},marker:()=>({addTo(){return this;},bindPopup(){}})}
  });
  ready();
  assert.deepEqual(cards.map(card=>card.dataset.emergency),types);
  assert.deepEqual(icons,['threat-pulse-pin pin-gunshot-verified','threat-pulse-pin pin-medical','threat-pulse-pin pin-fire','threat-pulse-pin pin-panic']);
});
