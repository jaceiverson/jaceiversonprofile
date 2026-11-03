// Exercise the actual browser controller in isolated JS contexts with a fake PeerJS
// transport. This verifies state protocol and UI wiring; it does not verify WebRTC/audio.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {EventEmitter} = require('node:events');
const E = require('../../js/camels-engine.js');
const dialogsSource = fs.readFileSync(require.resolve('../../js/game-dialogs.js'),'utf8');
const resultsSource = fs.readFileSync(require.resolve('../../js/camels-results.js'),'utf8');
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
function element(){return {value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:false,style:{},dataset:{},offsetWidth:900,classList:{add(){},remove(){},toggle(){}},focus(){},addEventListener(type,handler){this['on'+type]=handler;},contains(){return true;},querySelectorAll(){return [];},querySelector(){return element();},getBoundingClientRect(){return {width:900,height:650};},showModal(){this.open=true;},close(){this.open=false;}};}
function client(name,{local=new Map(),session=new Map(),engine=E,protocol='http:',replaceState=()=>{},select=()=>null}={}){
 const els=new Map(ids.map(id=>[id,element()]));
 const get=id=>{if(!els.has(id))els.set(id,element());return els.get(id);};
 const storage=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)});
 const timeouts=new Set();
 const motion={matches:false};
 const context={window:null,CamelUp:engine,document:{getElementById:get,querySelector:selector=>{assert.doesNotMatch(selector,/ style=/);return select(selector);}},Peer,GameVoice:class{constructor(){this.joined=false;}attach(){}leave(){this.joined=false;}sync(){}isSpeaking(){return false;}async join(){this.joined=true;}setMuted(v){this.muted=v;}},localStorage:storage(local),sessionStorage:storage(session),crypto:require('node:crypto').webcrypto,history:{replaceState},location:{protocol,pathname:'/games/camels.html',search:'',origin:'http://localhost'},navigator:{clipboard:{writeText:async()=>{}}},ResizeObserver:class{observe(){}},matchMedia:()=>motion,addEventListener(){},URLSearchParams,confirm:()=>true,setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();timeouts.add(t);return t;},clearTimeout};
 context.window=context;vm.runInNewContext(dialogsSource,context);vm.runInNewContext(resultsSource,context);vm.runInNewContext(source,context);
 get('name').value=name;get('practicePlayers').value='3';
 const click=(id,data={})=>get(id).onclick?.({target:{id:data.id||(id==='score'?'acknowledgeRound':id),dataset:data,disabled:false,closest(){return this;}}});
 return {get,click,local,session,motion,dispose(){for(const t of timeouts)clearTimeout(t);},context};
}
const tick=()=>new Promise(r=>setImmediate(r));
const walkRound=c=>{for(let i=0;i<3;i++)c.click('score',{id:'roundPayoutNext'});};
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
 assert.equal(c.motion.matches,false);assert.doesNotMatch(markup,/id="reduceMotion"/);
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
 c.motion.matches=true;c.motion.onchange();
 const next=client('Family',{local:c.local});assert.equal(next.motion.matches,false);
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
 c.motion.matches=true;c.motion.onchange();
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
 c.motion.matches=true;c.motion.onchange();
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

test('local results modal closes after one acknowledgement for all players',()=>{
 const c=client('Family',{engine:{...E,create:p=>E.create(p,()=>.1),apply:(g,s,a)=>E.apply(g,s,a,()=>0)}});c.click('practiceBtn');c.motion.matches=true;c.motion.onchange();
 for(let i=0;i<5;i++)c.click('pyramidRoll');
 assert.equal(c.get('roundModal').open,true);
 assert.doesNotMatch(c.get('score').innerHTML,/players ready/);
 let prevented=false;c.get('roundModal').oncancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);
 walkRound(c);c.click('score');assert.equal(c.get('roundModal').open,false);
 if(c.get('leg').textContent==='Leg 2') assert.equal(c.get('dice').innerHTML,'');
 else assert.equal(c.get('finalResult').hidden,false);
 c.dispose();
});

test('online players can acknowledge simultaneously and the host cannot skip anyone',async()=>{
 const h=client('Host',{engine:{...E,create:p=>E.create(p,()=>.1),apply:(g,s,a)=>E.apply(g,s,a,()=>0)}}),g=client('Guest');h.click('hostBtn');await tick();
 g.get('code').value=h.get('roomCode').textContent;g.click('joinBtn');await tick();
 h.get('starter').value='0';h.click('startBtn');await tick();
 for(const c of [h,g]){c.motion.matches=true;c.motion.onchange();}
 for(let i=0;i<5;i++){(i%2===0?h:g).click('pyramidRoll');await tick();}
 assert.equal(h.get('roundModal').open,true);assert.equal(g.get('roundModal').open,true);
 for(let i=0;i<3;i++){h.click('score',{id:'roundPayoutNext'});await tick();}
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
 const c=client('Family',{engine:{...E,create:()=>game}});c.click('practiceBtn');c.motion.matches=true;c.motion.onchange();c.click('pyramidRoll');
 assert.equal(c.get('roundModal').open,true);assert.match(c.get('fireworks').innerHTML,/firework-spark/);
 walkRound(c);c.click('score');
 assert.match(c.get('score').innerHTML,/0 \/ 2/);assert.match(c.get('score').innerHTML,/Reveal winner card 1/);
 assert.doesNotMatch(c.get('score').innerHTML,/Player 2.*Backed/);
 c.click('score',{id:'revealNext'});assert.equal(game.players[1].money,11);
 assert.match(c.get('score').innerHTML,/1 \/ 2/);assert.match(c.get('score').innerHTML,/Reveal loser card 1/);
 c.click('score',{id:'revealNext'});assert.equal(game.players[2].money,11);
 assert.match(c.get('score').innerHTML,/share the win/);assert.doesNotMatch(c.get('score').innerHTML,/players ready/);
 c.click('score');assert.equal(c.get('roundModal').open,false);assert.equal(c.get('finalResult').hidden,false);
 c.dispose();
});

test('journal opens the current round and collapses past rounds while preserving manual toggles',()=>{
 const c=client('Family',{engine:{...E,create:players=>E.create(players,()=>.1),apply:(g,seat,a)=>E.apply(g,seat,a,()=>0)}});
 c.click('practiceBtn');c.motion.matches=true;c.motion.onchange();
 assert.match(c.get('journal').innerHTML,/data-round="1" open/);
 for(let i=0;i<5;i++)c.click('pyramidRoll');
 walkRound(c);c.click('score');
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
  g.board=g.board.map(stack=>stack.filter(c=>E.COLORS.includes(c)));g.board[14]=['black'];g.board[15]=['white'];
  const c=client('Family',{engine:{...E,create:()=>g,apply:(game,seat,action)=>{const values=[0,.4,face==='black'?.1:.9];let i=0;return E.apply(game,seat,action,()=>values[i++]);}}});
  c.click('practiceBtn');c.motion.matches=true;c.motion.onchange();c.click('pyramidRoll');
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
  c.motion.matches=true;c.motion.onchange();c.click('pyramidRoll');
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
 vm.runInNewContext(dialogsSource,context);vm.runInNewContext(fs.readFileSync(require.resolve('../../js/super-tic-tac-toe.js'),'utf8'),context);get('nameInput').value=name;
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

test('local practice supports 5–8 players and makes alliances available at 6+',()=>{
 for(const count of [5,6,7,8]){
  const c=client('Family');c.get('practicePlayers').value=String(count);c.click('practiceBtn');
  assert.equal((c.get('players').innerHTML.match(/data-player=/g)||[]).length,count);
  if(count>=6){
   assert.equal(c.get('partnerControls').hidden,false);
   assert.match(c.get('partnerControls').innerHTML,/Choose a betting partner/);
   assert.doesNotMatch(c.get('actions').innerHTML,/Choose a betting partner/);
   c.click('partnerControls',{screen:'partner'});c.click('partnerControls',{partner:'1'});
   assert.match(c.get('journal').innerHTML,/Family partnered with Player 2/);
   assert.match(c.get('players').innerHTML,/Partner: <strong>Player 2<\/strong>/);
   assert.match(c.get('players').innerHTML,/Partner: <strong>Family<\/strong>/);
  }else { assert.equal(c.get('partnerControls').hidden,true); assert.equal(c.get('partnerControls').innerHTML,''); }
  c.dispose();
 }
 const c=client('Family');c.get('practicePlayers').value='';c.click('practiceBtn');
 assert.equal((c.get('players').innerHTML.match(/data-player=/g)||[]).length,8);c.dispose();
});

test('file:// pages can launch local practice and host a room without History API access',async()=>{
 let attempts=0;
 const c=client('Family',{protocol:'file:',replaceState(){attempts++;throw Error('SecurityError: file URLs cannot be rewritten');}});
 assert.equal(attempts,0);
 c.get('practicePlayers').value='8';c.click('practiceBtn');
 assert.equal(c.get('welcome').hidden,true);assert.equal(c.get('table').hidden,false);
 assert.equal((c.get('players').innerHTML.match(/data-player=/g)||[]).length,8);
 c.click('leaveBtn');assert.equal(c.get('welcome').hidden,false);
 c.click('hostBtn');await tick();assert.match(c.get('roomCode').textContent,/^[A-Z2-9]{6}$/);
 assert.equal(c.get('lobby').hidden,false);assert.equal(attempts,0);
 c.dispose();for(const p of [...peers.values()])p.destroy();
});
test('blocked URL cleanup cannot prevent game initialization on hosted pages',()=>{
 const c=client('Family',{replaceState(){throw Error('SecurityError');}});
 c.click('practiceBtn');assert.equal(c.get('table').hidden,false);c.dispose();
});

test('coin stacks represent each exact balance with gold fives and silver ones',()=>{
 const balances=[0,1,4,5,12,25,37,100];
 const g=E.create(balances.map((_,i)=>({name:'Player '+i,connected:true})),()=>.1);
 g.players.forEach((p,i)=>{p.money=balances[i];});
 const c=client('Family',{engine:{...E,create:()=>g}});c.click('practiceBtn');
 const purses=[...c.get('players').innerHTML.matchAll(/<div class="coin-purse"[^>]*>([\s\S]*?)<\/div>/g)];
 assert.equal(purses.length,8);
 assert.doesNotMatch(c.get('players').innerHTML,/<span class="coin-count">/);
 purses.forEach((purse,i)=>{
  const gold=(purse[1].match(/class="coin gold"/g)||[]).length;
  const silver=(purse[1].match(/class="coin silver"/g)||[]).length;
  assert.equal(gold,Math.floor(balances[i]/5));assert.equal(silver,balances[i]%5);
  assert.equal(gold*5+silver,balances[i]);
 });
 assert.match(c.get('players').innerHTML,/<div class="player-identity"><div class="player-name">Player 4[\s\S]*?<div class="player-money">12 <span>GOLD/);
 c.dispose();
});

test('payout coins travel from the pyramid into player pills, then update the displayed stacks',async()=>{
 const game=E.create(['Family','Player 2','Player 3'].map(name=>({name,connected:true})),()=>.1);
 game.board=Array.from({length:21},()=>[]);game.board[5]=['red'];game.board[4]=['blue'];game.board[3]=['green'];game.board[2]=['purple'];game.board[1]=['yellow'];game.board[14]=['black'];game.board[15]=['white'];
 game.players[0].tickets=[{color:'red',value:5},{color:'red',value:2}];E.scoreLeg(game);game.phase='scoring';
 const c=client('Family',{engine:{...E,create:()=>game},select:selector=>selector.startsWith('[data-payout-seat=')?{getBoundingClientRect:()=>({left:100,top:400,width:120,height:80})}:null});
 c.click('practiceBtn');assert.match(c.get('score').innerHTML,/Let’s count the round bets/);
 c.click('score',{id:'roundPayoutNext'});
 assert.equal((c.get('coinFlights').innerHTML.match(/coin-flight/g)||[]).length,3);
 assert.match(c.get('coinFlights').innerHTML,/coin gold/);assert.match(c.get('coinFlights').innerHTML,/coin silver/);
 assert.match(c.get('score').innerHTML,/Moving the coins/);
 c.click('score',{id:'roundPayoutNext'});assert.equal(game.roundStep,1);
 await new Promise(resolve=>setTimeout(resolve,1100));
 assert.equal(c.get('coinFlights').innerHTML,'');assert.match(c.get('players').innerHTML,/<div class="player-money">10 <span>GOLD/);
 c.motion.matches=true;walkRound(c);c.dispose();
});
test('final round review precedes separate winner and loser reveal columns',()=>{
 const g=E.create(['Family','Player 2','Player 3'].map(name=>({name,connected:true})),()=>.1);
 g.board=Array.from({length:21},()=>[]);g.board[16]=['red'];g.board[2]=['blue','green','purple','yellow'];g.board[14]=['black'];g.board[15]=['white'];g.dice=['red'];
 g.bets.winner=[{seat:1,color:'red'}];g.bets.loser=[{seat:2,color:'blue'}];
 const c=client('Family',{engine:{...E,create:()=>g}});c.click('practiceBtn');c.motion.matches=true;c.motion.onchange();c.click('pyramidRoll');
 assert.match(c.get('score').innerHTML,/ROUND 1 SCORING/);assert.doesNotMatch(c.get('score').innerHTML,/final-pile-columns/);
 walkRound(c);assert.match(c.get('score').innerHTML,/View final bet cards/);assert.equal(g.finalCardsOpened,false);
 c.click('score');assert.equal(g.finalCardsOpened,true);assert.match(c.get('score').innerHTML,/final-pile-columns/);
 assert.match(c.get('score').innerHTML,/<h3>Overall winner<\/h3>/);assert.match(c.get('score').innerHTML,/<h3>Overall loser<\/h3>/);
 assert.doesNotMatch(markup,/id="diceCount"/);c.dispose();
});

test('round payouts show only the camel color for the placement being paid',()=>{
 const g=E.create(['Family','Player 2','Player 3'].map(name=>({name,connected:true})),()=>.1);
 g.board=Array.from({length:21},()=>[]);g.board[5]=['red'];g.board[4]=['blue'];g.board[3]=['green'];g.board[2]=['purple'];g.board[1]=['yellow'];g.board[14]=['black'];g.board[15]=['white'];E.scoreLeg(g);g.phase='scoring';
 const c=client('Family',{engine:{...E,create:()=>g}});c.motion.matches=true;c.click('practiceBtn');
 c.click('score',{id:'roundPayoutNext'});
 let line=c.get('score').innerHTML.match(/<p class="payout-camel">([\s\S]*?)<\/p>/)[1];
 assert.match(line,/First place:/);assert.match(line,/var\(--red\)/);assert.doesNotMatch(line,/blue/);
 c.click('score',{id:'roundPayoutNext'});
 line=c.get('score').innerHTML.match(/<p class="payout-camel">([\s\S]*?)<\/p>/)[1];
 assert.match(line,/Second place:/);assert.match(line,/var\(--blue\)/);assert.doesNotMatch(line,/red/);
 c.dispose();
});

function standaloneFinalPreview() {
 const html=fs.readFileSync(require.resolve('../../games/camels-final-screen.html'),'utf8');
 const elements=new Map();
 const context={window:null,document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{innerHTML:''});return elements.get(id);}}};context.window=context;
 vm.runInNewContext(resultsSource,context);
 const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
 vm.runInNewContext(inline,context);return elements.get('finalPreview').innerHTML;
}
test('winners preview shows stick figures, GOLD overhead and 3 / 2 / sideways-camel podiums without starting a game',()=>{
 const peerIds=[...peers.keys()];const html=standaloneFinalPreview();
 assert.match(html,/Jace wins!/);
 const first=html.match(/<div class="podium-place podium-rank-1"[\s\S]*?(?=<div class="podium-place|<\/div><details class="final-standings")/)[0];
 const second=html.match(/<div class="podium-place podium-rank-2"[\s\S]*?(?=<div class="podium-place)/)[0];
 assert.equal((first.match(/class="podium-camel podium-camel-/g)||[]).length,3);
 assert.equal((second.match(/class="podium-camel podium-camel-/g)||[]).length,2);
 assert.match(html,/crazy-podium/);assert.match(html,/podium-camel-black/);assert.match(html,/podium-camel-white/);
 assert.ok(first.indexOf('podium-gold')<first.indexOf('podium-person'));
 assert.match(first,/<strong>42<\/strong><span>GOLD/);
 assert.match(first,/stroke="#141414"/);
 assert.deepEqual([...peers.keys()],peerIds);
});
test('final winners screen preserves joint winners and uses the real GOLD standings',()=>{
 const g=E.create(['First','Joint First','Third'].map(name=>({name,connected:true})),()=>.1);
 g.players.forEach((p,i)=>{p.money=i<2?42:20;});g.phase='finished';g.roundReviewed=true;g.winners=[0,1];g.ranks=E.ranking(g);g.summary=[];g.finishResults=[];
 const c=client('Family',{engine:{...E,create:()=>g}});c.click('practiceBtn');
 const html=c.get('finalResult').innerHTML;
 assert.match(html,/First &amp; Joint First share the win!/);
 assert.equal((html.match(/class="podium-place podium-rank-1"/g)||[]).length,2);
 assert.equal((html.match(/class="podium-place podium-rank-3"/g)||[]).length,1);
 assert.match(html,/Play Again/);assert.match(html,/All players & final GOLD/);c.dispose();
});

test('remaining players stand below the camel podium with GOLD above their heads and an optional full list',()=>{
 const html=standaloneFinalPreview();
 const remaining=html.match(/<section class="victory-other-players"[\s\S]*?<\/section>/)[0];
 assert.equal((remaining.match(/class="other-player"/g)||[]).length,5);
 assert.equal((remaining.match(/class="podium-person"/g)||[]).length,5);
 assert.ok(remaining.indexOf('podium-gold')<remaining.indexOf('podium-person'));
 assert.match(remaining,/<strong>17<\/strong><span>GOLD/);assert.match(remaining,/Player 8/);
 assert.doesNotMatch(remaining,/podium-camel/);
 assert.ok(html.indexOf('camel-winners-podium')<html.indexOf('victory-other-players'));
 assert.ok(html.indexOf('victory-other-players')<html.indexOf('class="final-standings"'));
 assert.match(html,/<details class="final-standings"><summary>/);
});

test('standalone final-screen preview is excluded from deployment and not linked from the game',()=>{
 const config=fs.readFileSync(require.resolve('../../_config.yml'),'utf8');
 assert.match(config,/^  - games\/camels-final-screen\.html(?:\s|$)/m);
 assert.doesNotMatch(markup,/id="previewVictory"|id="winnerPreview"/);
 assert.doesNotMatch(source,/function previewVictory|preview.*=== 'final'/);
 const preview=fs.readFileSync(require.resolve('../../games/camels-final-screen.html'),'utf8');
 assert.match(preview,/camels-results\.js/);assert.doesNotMatch(preview,/peerjs|camels-engine\.js|src="[^"]*camels\.js/);
});

test('local reveal preview bootstraps the real game modal and walks six cards into the winners screen',()=>{
 const page=fs.readFileSync(require.resolve('../../games/camels-final-reveal.local.html'),'utf8');
 const bootstrap=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('const createGame = CamelUp.create'));
 assert.ok(bootstrap);
 const c=client('Preview',{engine:{...E}});
 c.context.document.addEventListener=(type,handler)=>{if(type==='DOMContentLoaded')handler();};
 c.get('practiceBtn').click=()=>c.click('practiceBtn');
 vm.runInNewContext(bootstrap,c.context);
 assert.equal(c.get('roundModal').open,true);
 assert.match(c.get('score').innerHTML,/0 \/ 6/);
 assert.ok(c.get('score').innerHTML.indexOf('id="revealNext"')<c.get('score').innerHTML.indexOf('class="final-pile-columns"'));
 for(let i=0;i<6;i++)c.click('score',{id:'revealNext'});
 assert.match(c.get('score').innerHTML,/Jace wins!/);assert.match(c.get('score').innerHTML,/<strong>47<\/strong><span>GOLD/);
 c.dispose();
});
test('interactive modal preview is excluded from deployment and accessible from the local preview page',()=>{
 const config=fs.readFileSync(require.resolve('../../_config.yml'),'utf8');
 const page=fs.readFileSync(require.resolve('../../games/camels-final-screen.html'),'utf8');
 assert.match(config,/^  - games\/camels-final-reveal\.local\.html(?:\s|$)/m);
 assert.match(page,/src="camels-final-reveal.local.html"/);assert.match(page,/Final card reveals/);assert.match(page,/Winners podium/);
 assert.doesNotMatch(markup,/camels-final-reveal\.local\.html|showRevealPreview/);
});
