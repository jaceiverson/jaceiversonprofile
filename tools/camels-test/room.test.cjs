// Exercise the actual browser controller in isolated JS contexts with a fake PeerJS
// transport. This verifies state protocol and UI wiring; it does not verify WebRTC/audio.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {EventEmitter} = require('node:events');
const E = require('../../js/camels-engine.js');
const source = fs.readFileSync(require.resolve('../../js/camels.js'),'utf8');
const markup = fs.readFileSync(require.resolve('../../games/camels.html'),'utf8');
const ids = [...markup.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
const peers = new Map();
let serial = 0;
class Connection extends EventEmitter {
  constructor(id){super();this.peer=id;this.open=true;}
  send(data){const other=this.other;queueMicrotask(()=>{if(other.open)other.emit('data',structuredClone(data));});}
  close(){if(!this.open)return;this.open=false;this.emit('close');if(this.other.open){this.other.open=false;this.other.emit('close');}}
}
class Peer extends EventEmitter {
  constructor(id){super();this.id=id||'guest-'+(++serial);this.destroyed=false;this.links=[];if(peers.has(this.id))queueMicrotask(()=>this.emit('error',{type:'unavailable-id'}));else{peers.set(this.id,this);queueMicrotask(()=>this.emit('open',this.id));}}
  connect(id){const c=new Connection(id);this.links.push(c);const target=peers.get(id);if(!target){queueMicrotask(()=>this.emit('error',{type:'peer-unavailable'}));return c;}const other=new Connection(this.id);c.other=other;other.other=c;target.links.push(other);queueMicrotask(()=>{target.emit('connection',other);c.emit('open');});return c;}
  destroy(){this.destroyed=true;peers.delete(this.id);for(const c of this.links)if(c.other)c.close();}
  reconnect(){}
}
function element(){return {value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:false,style:{},dataset:{},offsetWidth:900,classList:{add(){},remove(){},toggle(){}},focus(){},addEventListener(type,handler){this['on'+type]=handler;},contains(){return true;},querySelector(){return element();},getBoundingClientRect(){return {width:900,height:650};},showModal(){this.open=true;},close(){this.open=false;}};}
function client(name,{local=new Map(),session=new Map(),engine=E}={}){
 const els=new Map(ids.map(id=>[id,element()]));
 const get=id=>{if(!els.has(id))els.set(id,element());return els.get(id);};
 const storage=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)});
 const timeouts=new Set();
 const context={window:null,CamelUp:engine,document:{getElementById:get,querySelector:selector=>{assert.doesNotMatch(selector,/ style=/);return null;}},Peer,GameVoice:class{constructor(){this.joined=false;}attach(){}leave(){this.joined=false;}sync(){}isSpeaking(){return false;}async join(){this.joined=true;}setMuted(v){this.muted=v;}},localStorage:storage(local),sessionStorage:storage(session),crypto:require('node:crypto').webcrypto,history:{replaceState(){}},location:{pathname:'/games/camels.html',search:'',origin:'http://localhost'},navigator:{clipboard:{writeText:async()=>{}}},ResizeObserver:class{observe(){}},matchMedia:()=>({matches:false}),addEventListener(){},URLSearchParams,confirm:()=>true,setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();timeouts.add(t);return t;},clearTimeout};
 context.window=context;vm.runInNewContext(source,context);
 get('name').value=name;
 const click=(id,data={})=>get(id).onclick?.({target:{id:data.id||(id==='score'?'acknowledgeRound':id),dataset:data,disabled:false,closest(){return this;}}});
 return {get,click,local,session,dispose(){for(const t of timeouts)clearTimeout(t);},context};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('actual room controller: join, start, secret bets, voice, disconnect, token rejoin, host refresh',async()=>{
 const h=client('Host'),g=client('Guest');
 h.click('hostBtn');await tick();const code=h.get('roomCode').textContent;assert.match(code,/^[A-Z2-9]{6}$/);
 g.get('code').value=code;g.click('joinBtn');await tick();assert.match(h.get('players').innerHTML,/Guest/);assert.equal(g.get('lobby').hidden,false);
 h.get('starter').value='0';h.click('startBtn');await tick();assert.equal(g.get('table').hidden,false);assert.match(h.get('turnTitle').textContent,/Your turn/);
 h.click('finishPiles',{finishKind:'winner'});h.click('finishChoices',{bet:'red',kind:'winner'});await tick();
 assert.match(h.get('satchel').innerHTML,/red.*winner/);assert.doesNotMatch(g.get('satchel').innerHTML,/red.*winner/);
 assert.match(g.get('turnTitle').textContent,/Your turn/);
 await g.get('voiceJoin').onclick();await tick();assert.equal(h.get('voiceJoin').hidden,false);assert.equal(g.get('voiceMute').hidden,false);
 // A second guest is not allowed to enter after the race starts.
 const stranger=client('Stranger');stranger.get('code').value=code;stranger.click('joinBtn');await tick();assert.match(stranger.get('message').textContent,/started/);
 // Simulate a refresh without running the explicit leave UI.
 const guestPeer=[...peers.values()].find(p=>p.id.startsWith('guest-')&&p.links.some(c=>c.peer===('jiv-camelup-v1-'+code)));
 guestPeer.destroy();await tick();assert.match(h.get('players').innerHTML,/Disconnected/);
 const returning=client('Guest',{local:g.local,session:g.session});returning.get('code').value=code;returning.click('joinBtn');await tick();assert.doesNotMatch(h.get('players').innerHTML,/Disconnected/);assert.match(returning.get('turnTitle').textContent,/Your turn/);
 // Host snapshot preserves the game and tokens after reloading the same tab.
 peers.get('jiv-camelup-v1-'+code).destroy();await tick();assert.equal(returning.get('rejoinBtn').hidden,false);
 const restored=client('Host',{local:h.local,session:h.session});restored.get('code').value=code;restored.click('joinBtn');await tick();
 returning.click('rejoinBtn');await tick();assert.match(restored.get('players').innerHTML,/Guest/);assert.doesNotMatch(restored.get('players').innerHTML,/Disconnected/);assert.match(restored.get('satchel').innerHTML,/red.*winner/);
 for(const c of [h,g,stranger,returning,restored])c.dispose();for(const p of [...peers.values()])p.destroy();
});
test('shared-device table switches players and keeps finish cards out of satchel',async()=>{
 const c=client('Family');c.click('practiceBtn');assert.equal(c.get('table').hidden,false);c.click('finishPiles',{finishKind:'winner'});c.click('finishChoices',{bet:'red',kind:'winner'});assert.match(c.get('turnTitle').textContent,/Player 2/);assert.doesNotMatch(c.get('satchel').innerHTML,/red.*winner/);c.dispose();
});

test('board tile placement, visible public slips, secret card backs and reduced-motion preference',()=>{
 const c=client('Family');c.click('practiceBtn');
 assert.equal(c.get('reduceMotion').checked,false);
 assert.match(c.get('players').innerHTML,/mobile-selected" data-player="0"/);
 assert.match(c.get('bettingSlips').innerHTML,/bet-slip/);
 c.click('track',{space:'8'});
 assert.doesNotMatch(c.get('journal').innerHTML,/placed/);
 c.click('jeerTile');
 const space=Array.from({length:15},(_,i)=>i+2).find(s=>!c.get('space-'+s).disabled);
 assert.ok(space);
 c.click('track',{space:String(space)});
 assert.match(c.get('journal').innerHTML,new RegExp('placed jeer on space '+space));
 assert.match(c.get('turnTitle').textContent,/Player 2/);
 const color='blue';c.click('bettingSlips',{ticket:color});
 assert.match(c.get('players').innerHTML,/mini-slip[\s\S]*blue[\s\S]*<strong>5<\/strong>/);
 assert.match(c.get('turnTitle').textContent,/Player 3/);
 c.click('finishPiles',{finishKind:'winner'});c.click('finishChoices',{bet:'red',kind:'winner'});
 assert.doesNotMatch(c.get('players').innerHTML,/card-back/);
 assert.match(c.get('players').innerHTML,/<strong>4<\/strong> final-bet cards left/);
 assert.doesNotMatch(c.get('players').innerHTML,/title="winner finish bet: red"/);
 c.get('reduceMotion').checked=true;c.get('reduceMotion').onchange();
 const next=client('Family',{local:c.local});assert.equal(next.get('reduceMotion').checked,true);
 c.dispose();next.dispose();
});

test('player browser defaults to active player, wraps, swipes and follows the next turn',()=>{
 const c=client('Family');c.click('practiceBtn');
 const selected=()=>{const m=c.get('players').innerHTML.match(/mobile-selected" data-player="(\d+)"/);assert.ok(m);return Number(m[1]);};
 assert.equal(selected(),0);
 assert.equal((c.get('players').innerHTML.match(/mobile-selected/g)||[]).length,1);
 c.click('previousPlayer');assert.equal(selected(),2);
 c.click('nextPlayer');assert.equal(selected(),0);
 c.get('players').ontouchstart({touches:[{clientX:200,clientY:100}]});
 c.get('players').ontouchend({changedTouches:[{clientX:100,clientY:105}]});assert.equal(selected(),1);
 c.click('activePlayer');assert.equal(selected(),0);
 c.click('nextPlayer');c.click('nextPlayer');assert.equal(selected(),2);
 c.click('bettingSlips',{ticket:'blue'});assert.equal(selected(),1);
 assert.match(c.get('playerPosition').textContent,/2 \/ 3 · Player 2 · active/);
 c.dispose();
});

test('pyramid and final slips act directly and respect the active turn',()=>{
 const c=client('Family');c.click('practiceBtn');
 assert.equal(c.get('pyramidRoll').disabled,false);
 c.get('reduceMotion').checked=true;c.get('reduceMotion').onchange();
 c.click('pyramidRoll');
 assert.match(c.get('journal').innerHTML,/Family rolled [a-z]+ [123] and earned 1 GOLD/);
 assert.match(c.get('turnTitle').textContent,/Player 2/);
 c.click('finishPiles',{finishKind:'loser'});
 assert.match(c.get('finishChoices').innerHTML,/data-kind="loser"/);
 assert.match(c.get('turnTitle').textContent,/Player 2/);
 c.click('finishChoices',{bet:'green',kind:'winner'});
 assert.match(c.get('turnTitle').textContent,/Player 2/);
 c.click('finishChoices',{bet:'green',kind:'loser'});
 assert.match(c.get('journal').innerHTML,/Player 2 secretly backed the overall loser/);
 assert.match(c.get('turnTitle').textContent,/Player 3/);
 assert.equal(c.get('finishChoices').innerHTML,'');
 assert.doesNotMatch(c.get('actions').innerHTML,/Roll the pyramid|Take a leg ticket/);
 c.dispose();
});

test('dice remain inside the board between turns and roll GOLD is immediately visible',()=>{
 const c=client('Family');c.click('practiceBtn');
 c.get('reduceMotion').checked=true;c.get('reduceMotion').onchange();
 assert.ok(markup.indexOf('id="dice"')>markup.indexOf('class="infield"'));
 assert.ok(markup.indexOf('id="dice"')<markup.indexOf('id="camels"'));
 for(let i=1;i<=3;i++){
   c.click('pyramidRoll');
   const dice=c.get('dice').innerHTML;
   assert.equal((dice.match(/class="die-slot"/g)||[]).length,i);
   assert.equal((dice.match(/class="die-face /g)||[]).length,i*6);
   assert.match(dice,/aria-label="[a-z]+ die: [123]/);
   assert.doesNotMatch(dice,/rolling/);
 }
 assert.equal((c.get('players').innerHTML.match(/<div class="player-money">4 <span>GOLD/g)||[]).length,3);
 c.dispose();
});

test('results modal waits for every local player and closes after the final acknowledgement',()=>{
 const c=client('Family');c.click('practiceBtn');c.get('reduceMotion').checked=true;c.get('reduceMotion').onchange();
 for(let i=0;i<5;i++)c.click('pyramidRoll');
 assert.equal(c.get('roundModal').open,true);
 assert.match(c.get('score').innerHTML,/0 \/ 3/);
 let prevented=false;c.get('roundModal').oncancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);
 c.click('score');assert.equal(c.get('roundModal').open,true);assert.match(c.get('score').innerHTML,/1 \/ 3/);
 c.click('score');assert.equal(c.get('roundModal').open,true);assert.match(c.get('score').innerHTML,/2 \/ 3/);
 c.click('score');assert.equal(c.get('roundModal').open,false);
 if(c.get('leg').textContent==='Leg 2') assert.equal(c.get('dice').innerHTML,'');
 else assert.equal(c.get('finalResult').hidden,false);
 c.dispose();
});

test('online players can acknowledge simultaneously and the host cannot skip anyone',async()=>{
 const h=client('Host'),g=client('Guest');h.click('hostBtn');await tick();
 g.get('code').value=h.get('roomCode').textContent;g.click('joinBtn');await tick();
 h.get('starter').value='0';h.click('startBtn');await tick();
 for(const c of [h,g]){c.get('reduceMotion').checked=true;c.get('reduceMotion').onchange();}
 for(let i=0;i<5;i++){(i%2===0?h:g).click('pyramidRoll');await tick();}
 assert.equal(h.get('roundModal').open,true);assert.equal(g.get('roundModal').open,true);
 // Both clicks use the same starting revision; both must count.
 g.click('score');h.click('score');await tick();
 assert.equal(h.get('roundModal').open,false);assert.equal(g.get('roundModal').open,false);
 assert.equal(h.get('leg').textContent,g.get('leg').textContent);
 assert.ok(h.get('leg').textContent==='Leg 2'||h.get('finalResult').hidden===false);
 h.dispose();g.dispose();for(const p of [...peers.values()])p.destroy();
});

test('finish celebration and paced card reveals lead into the everyone-ready final modal',()=>{
 const game=E.create(['Family','Player 2','Player 3'].map(name=>({name,connected:true})),()=>.1);
 game.board=Array.from({length:21},()=>[]);
 game.board[16]=['red'];game.board[2]=['blue','green','purple','yellow'];game.board[14]=['white'];game.board[15]=['black'];
 game.dice=['red'];game.bets.winner=[{seat:1,color:'red'}];game.bets.loser=[{seat:2,color:'blue'}];
 game.players[1].hand=game.players[1].hand.filter(c=>c!=='red');game.players[2].hand=game.players[2].hand.filter(c=>c!=='blue');
 const c=client('Family',{engine:{...E,create:()=>game}});c.click('practiceBtn');c.get('reduceMotion').checked=true;c.get('reduceMotion').onchange();c.click('pyramidRoll');
 assert.equal(c.get('roundModal').open,true);assert.match(c.get('fireworks').innerHTML,/firework-spark/);
 assert.match(c.get('score').innerHTML,/0 \/ 2/);assert.match(c.get('score').innerHTML,/Reveal winner card 1/);
 assert.doesNotMatch(c.get('score').innerHTML,/Player 2.*Backed/);
 c.click('score',{id:'revealNext'});assert.equal(game.players[1].money,11);
 assert.match(c.get('score').innerHTML,/1 \/ 2/);assert.match(c.get('score').innerHTML,/Reveal loser card 1/);
 c.click('score',{id:'revealNext'});assert.equal(game.players[2].money,11);
 assert.match(c.get('score').innerHTML,/share the win/);assert.match(c.get('score').innerHTML,/0 \/ 3/);
 c.click('score');c.click('score');assert.equal(c.get('roundModal').open,true);
 c.click('score');assert.equal(c.get('roundModal').open,false);assert.equal(c.get('finalResult').hidden,false);
 c.dispose();
});

test('journal opens the current round and collapses past rounds while preserving manual toggles',()=>{
 const c=client('Family',{engine:{...E,create:players=>E.create(players,()=>.1),apply:(g,seat,a)=>E.apply(g,seat,a,()=>0)}});
 c.click('practiceBtn');c.get('reduceMotion').checked=true;c.get('reduceMotion').onchange();
 assert.match(c.get('journal').innerHTML,/data-round="1" open/);
 for(let i=0;i<5;i++)c.click('pyramidRoll');
 c.click('score');c.click('score');c.click('score');
 assert.match(c.get('journal').innerHTML,/data-round="2" open/);
 assert.doesNotMatch(c.get('journal').innerHTML,/data-round="1" open/);
 c.get('journal').ontoggle({target:{dataset:{round:'1'},open:true,matches:()=>true}});
 c.click('bettingSlips',{ticket:'blue'});
 assert.match(c.get('journal').innerHTML,/data-round="1" open/);
 assert.match(c.get('journal').innerHTML,/data-round="2" open/);
 c.dispose();
});

test('grey die has three faces of each pip color and settles on its selected color and value',()=>{
 for(const face of ['black','white']){
  const g=E.create(['Family','Player 2','Player 3'].map(name=>({name,connected:true})),()=>.1);g.dice=['grey'];
  const c=client('Family',{engine:{...E,create:()=>g,apply:(game,seat,action)=>{const values=[0,.4,face==='black'?.1:.9];let i=0;return E.apply(game,seat,action,()=>values[i++]);}}});
  c.click('practiceBtn');c.get('reduceMotion').checked=true;c.get('reduceMotion').onchange();c.click('pyramidRoll');
  const html=c.get('dice').innerHTML;
  const faces=[...html.matchAll(/class="die-face ([a-z]+)" style="--pip-color:(#[a-f0-9]+)">([\s\S]*?)<\/span>/g)];
  assert.equal(faces.length,6);
  assert.equal(faces.filter(m=>m[2]==='#26332e').length,3);assert.equal(faces.filter(m=>m[2]==='#fffaf0').length,3);
  const front=faces.find(m=>m[1]==='front');assert.equal(front[2],face==='black'?'#26332e':'#fffaf0');
  assert.equal((front[3].match(/class="pip /g)||[]).length,2);
  for(const color of ['#26332e','#fffaf0'])assert.deepEqual(faces.filter(m=>m[2]===color).map(m=>(m[3].match(/class="pip /g)||[]).length).sort(),[1,2,3]);
  assert.match(html,new RegExp('grey die: 2, '+face+' face'));
  c.dispose();
 }
});

test('finishing camels cross the checkered line and continue through their remaining spaces',()=>{
 const destinations=[];
 for(const steps of [1,2,3]){
  const g=E.create(['Family','Player 2','Player 3'].map(name=>({name,connected:true})),()=>.1);
  g.board=Array.from({length:21},()=>[]);g.board[16]=['red','blue'];g.board[14]=['green'];g.board[15]=['purple','yellow'];g.board[12]=['black'];g.board[13]=['white'];g.dice=['red'];
  const c=client('Family',{engine:{...E,create:()=>g,apply:(game,seat,a)=>E.apply(game,seat,a,()=>(steps-.5)/3)}});
  c.click('practiceBtn');const start=c.get('camel-red').style.transform;
  c.get('reduceMotion').checked=true;c.get('reduceMotion').onchange();c.click('pyramidRoll');
  assert.equal(E.locate(g,'red').space,16+steps);
  const transform=c.get('camel-red').style.transform;
  assert.notEqual(transform,start);
  const [x,y]=[...transform.matchAll(/[-\d.]+(?=px)/g)].map(m=>Number(m[0]));
  const [carriedX,carriedY]=[...c.get('camel-blue').style.transform.matchAll(/[-\d.]+(?=px)/g)].map(m=>Number(m[0]));
  assert.equal(carriedX,x);assert.ok(carriedY<y,'carried camel remains above its moving camel');
  assert.ok(x < 900/6, 'finished camel is beyond the line on its left side');
  destinations.push(y);c.dispose();
 }
 assert.equal(new Set(destinations).size,3,'rolls of 1, 2, and 3 finish on distinct physical spaces');
});

test('Camel Up Play Again keeps the same peers and voice sessions for all players',async()=>{
 let first=true;
 const engine={...E,create(players,...args){const g=E.create(players,...args);if(first){first=false;g.phase='finished';g.roundReviewed=true;g.winners=[0];g.ranks=E.ranking(g);g.summary=[];g.finishResults=[];}return g;}};
 const h=client('Host',{engine}),g=client('Guest');h.click('hostBtn');await tick();
 const code=h.get('roomCode').textContent;g.get('code').value=code;g.click('joinBtn');await tick();
 await h.get('voiceJoin').onclick();await g.get('voiceJoin').onclick();await tick();
 const peerIds=[...peers.keys()].sort();h.get('starter').value='0';h.click('startBtn');await tick();
 assert.match(h.get('finalResult').innerHTML,/Play Again/);
 h.click('finalResult',{id:'playAgain'});await tick();
 assert.equal(h.get('leg').textContent,'Leg 1');assert.equal(g.get('leg').textContent,'Leg 1');
 assert.match(h.get('players').innerHTML,/Host/);assert.match(h.get('players').innerHTML,/Guest/);
 assert.equal(h.get('roomCode').textContent,code);assert.deepEqual([...peers.keys()].sort(),peerIds);
 for(const c of [h,g]){assert.equal(c.get('voiceJoin').hidden,true);assert.equal(c.get('voiceLeave').hidden,false);assert.equal(c.get('finalResult').hidden,true);c.dispose();}
 for(const p of [...peers.values()])p.destroy();
});

function ticClient(name){
 const els=new Map();
 function make(){const el=element();el.children=[];el.setAttribute=()=>{};el.appendChild=child=>el.children.push(child);Object.defineProperty(el,'innerHTML',{get(){return this.html||'';},set(value){this.html=value;this.children=[];}});return el;}
 const get=id=>{if(!els.has(id))els.set(id,make());return els.get(id);};
 let voice;
 const context={window:null,document:{getElementById:get,querySelectorAll:()=>[],createElement:make},Peer,GameVoice:class{constructor(){voice=this;this.joined=false;this.leaves=0;}attach(){}leave(){this.joined=false;this.leaves++;}sync(){}isSpeaking(){return false;}async join(){this.joined=true;}setMuted(v){this.muted=v;}},localStorage:{getItem:()=>'',setItem(){}},history:{replaceState(){}},location:{pathname:'/games/super-tic-tac-toe.html',search:'',origin:'http://localhost'},navigator:{clipboard:{writeText:async()=>{}}},URLSearchParams,setTimeout,clearTimeout};context.window=context;
 vm.runInNewContext(fs.readFileSync(require.resolve('../../js/super-tic-tac-toe.js'),'utf8'),context);get('nameInput').value=name;
 return {get,voice,click:id=>get(id).onclick?.(),cell:(b,c)=>get('board').children[b].children[c]};
}
test('Tic Tac Toe locks the host to X while waiting and alternates authorized turns without dropping voice on replay',async()=>{
 const h=ticClient('Host');h.click('hostBtn');await tick();
 assert.ok(h.get('board').children.every(b=>b.children.every(c=>c.disabled)));
 h.cell(0,0).onclick();assert.equal(h.cell(0,0).textContent,'');
 const hostPeer=[...peers.values()].find(p=>p.id.startsWith('jace-sttt-'));
 const g=ticClient('Guest');g.get('joinInput').value=hostPeer.id.replace('jace-sttt-','');g.click('joinBtn');await tick();
 assert.equal(h.cell(0,0).disabled,false);assert.equal(g.cell(0,0).disabled,true);
 h.cell(0,0).onclick();await tick();assert.equal(h.cell(0,0).textContent,'X');
 assert.equal(h.cell(0,1).disabled,true);h.cell(0,1).onclick();assert.equal(h.cell(0,1).textContent,'');
 assert.equal(g.cell(0,1).disabled,false);g.cell(0,1).onclick();await tick();assert.equal(h.cell(0,1).textContent,'O');
 await h.get('voiceJoinBtn').onclick();await g.get('voiceJoinBtn').onclick();await tick();
 const peerIds=[...peers.keys()].sort();h.click('newBtn');await tick();
 assert.equal(h.cell(0,0).textContent,'');assert.equal(g.cell(0,1).textContent,'');
 assert.equal(h.voice.joined,true);assert.equal(g.voice.joined,true);assert.equal(h.voice.leaves,0);assert.equal(g.voice.leaves,0);
 assert.deepEqual([...peers.keys()].sort(),peerIds);
 for(const p of [...peers.values()])p.destroy();
 assert.ok(h.get('board').children.every(b=>b.children.every(c=>c.disabled)));
});
