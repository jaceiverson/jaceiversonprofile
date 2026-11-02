const {test} = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../js/camels-engine.js');
function approve(g) { const leg = g.leg; g.players.forEach((_,i) => E.acknowledge(g,i,leg)); }
const newGame = (n=3) => E.create(Array.from({length:n},(_,i)=>({name:'Player '+i,connected:true})),()=>.1);
function board(g, stacks) {g.board=Array.from({length:21},()=>[]);for(const [s,c] of Object.entries(stacks))g.board[s]=c;return g;}
function fixed(values) {let i=0;return ()=>values[i++%values.length];}
test('starting positions, coins and complete component supply',()=>{const g=newGame(8);assert.equal(g.players.length,8);assert.equal(g.board.flat().length,7);assert.ok(g.players.every(p=>p.money===3&&p.hand.length===5));assert.deepEqual(g.supply.red,[5,3,2,2]);});
test('stack splits at the moving camel and lands on top',()=>{const g=board(newGame(),{1:['red','blue','yellow'],3:['green'],14:['black'],15:['white'],2:['purple']});const m=E.move(g,'blue',2);assert.deepEqual(g.board[1],['red']);assert.deepEqual(g.board[3],['green','blue','yellow']);assert.deepEqual(m.unit,['blue','yellow']);assert.equal(E.ranking(g)[0],'yellow');});
test('jeering pays tile owner and puts moving unit underneath',()=>{const g=board(newGame(),{1:['red','blue'],2:['green'],4:['purple','yellow'],14:['black'],15:['white']});g.tiles=[{seat:2,space:3,side:-1}];E.move(g,'red',2);assert.deepEqual(g.board[2],['red','blue','green']);assert.equal(g.players[2].money,5);});
test('crazy camel spectator effects follow backward orientation',()=>{const g=board(newGame(),{8:['black','red'],6:['green'],10:['white'],1:['blue','purple','yellow']});g.tiles=[{seat:0,space:7,side:1}];E.move(g,'black',1);assert.deepEqual(g.board[6],['green','black','red']);assert.equal(g.players[0].money,5);});
test('grey die overrides: rider carrier, direct stacking, separated crazy camels',()=>{const g=board(newGame(),{5:['black','red'],7:['white'],1:['green','blue','purple','yellow']});assert.equal(E.crazy(g,'white'),'black');g.board[5]=['black','white','red'];g.board[7]=[];assert.equal(E.crazy(g,'black'),'white');g.board[5]=['black','red','white'];assert.equal(E.crazy(g,'white'),'black');g.board[7]=['white','blue'];g.board[5]=['black','red'];assert.equal(E.crazy(g,'white'),'white');});
test('spectator placement rejects first space, occupied and adjacent spaces',()=>{const g=newGame();g.tiles=[{seat:1,space:6,side:1},{seat:0,space:10,side:-1}];assert.equal(E.validTile(g,0,1),false);assert.equal(E.validTile(g,0,5),false);assert.equal(E.validTile(g,0,6),false);assert.equal(E.validTile(g,0,7),false);assert.equal(E.validTile(g,0,10),false);assert.equal(E.validTile(g,0,9),true);assert.equal(E.validTile(g,0,2),true);});
test('exactly five of six dice end a leg and next player starts the next leg',()=>{const g=board(newGame(),{1:['red','blue','green','yellow','purple'],16:['black','white']});for(let i=0;i<5;i++)assert.equal(E.apply(g,g.turn,{type:'roll'},()=>0),true);assert.equal(g.phase,'scoring');assert.equal(g.dice.length,1);assert.equal(g.rolled.length,5);const turn=g.turn;assert.equal(g.players.reduce((n,p)=>n+p.money,0),14);approve(g);assert.equal(g.turn,turn);assert.equal(g.leg,2);assert.equal(g.dice.length,6);assert.ok(g.players.every(p=>p.pyramids===0));});
test('turn validation and invalid actions preserve state',()=>{const g=newGame();for(const [seat,a] of [[1,{type:'roll'}],[0,{type:'ticket',color:'black'}],[0,{type:'tile',space:1,side:1}],[0,{type:'partner',seat:1}]]){const before=JSON.stringify(g);assert.equal(E.apply(g,seat,a),false);assert.equal(JSON.stringify(g),before);}});
test('leg scoring nets rewards before flooring; partnership copies best reward',()=>{const g=board(newGame(6),{1:['red'],2:['blue'],3:['purple'],4:['yellow'],5:['green'],14:['white'],15:['black']});g.players[0].money=0;g.players[0].tickets=[{color:'red',value:5},{color:'green',value:5}];g.players[0].partner=1;g.players[1].tickets=[{color:'green',value:3}];E.scoreLeg(g);assert.equal(g.players[0].money,7);assert.equal(g.summary[0].own,4);assert.equal(g.summary[0].bonus,3);});
test('finish cards use a single shared hand and stay private in guest views',()=>{const g=newGame();E.apply(g,0,{type:'bet',kind:'winner',color:'red'});assert.ok(!g.players[0].hand.includes('red'));assert.equal(E.view(g,1).bets.winner[0].color,undefined);assert.equal(E.view(g,0).bets.winner[0].color,'red');assert.equal(E.view(g,1).players[0].hand,null);g.turn=0;assert.equal(E.apply(g,0,{type:'bet',kind:'loser',color:'red'}),false);});
test('finish immediately scores current leg then chronological finish bets',()=>{const g=board(newGame(6),{16:['red'],2:['blue','green','yellow','purple'],14:['white'],15:['black']});g.dice=['red'];g.bets.winner=[{seat:0,color:'blue'},...Array.from({length:5},(_,seat)=>({seat,color:'red'}))];g.bets.loser=[{seat:5,color:'blue'}];E.apply(g,0,{type:'roll'},()=>0);assert.equal(g.phase,'revealing');while(g.phase==='revealing')E.revealNext(g,0,g.revealCursor);assert.equal(g.phase,'finished');assert.deepEqual(g.ranks,['red','purple','yellow','green','blue']);assert.deepEqual(g.finishResults.map(x=>x.reward),[-1,8,5,3,2,1,8]);assert.equal(g.players[0].money,11);assert.equal(g.players[5].money,11);assert.deepEqual(g.winners,[0,5]);});
test('crazy camel crossing backward ends game; carried racers rank last',()=>{const g=board(newGame(),{1:['black','red'],3:['white'],5:['blue','green','purple','yellow']});g.dice=['grey'];E.apply(g,0,{type:'roll'},()=>0);assert.equal(g.phase,'finished');assert.equal(g.ranks[4],'red');assert.equal(E.locate(g,'red').space,0);});
test('partnership available only at 6+ players and resets each leg',()=>{const g=newGame(6);assert.equal(E.apply(g,0,{type:'partner',seat:1}),true);assert.equal(g.players[1].partner,0);assert.equal(E.apply(g,1,{type:'partner',seat:2}),false);g.phase='scoring';approve(g);assert.ok(g.players.every(p=>p.partner===null));});
test('500 complete random races preserve camels, dice and nonnegative money',()=>{let state=163;const rng=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/4294967296);for(let trial=0;trial<500;trial++){const g=E.create(Array.from({length:2+trial%7},(_,i)=>({name:'P'+i})),rng);let turns=0;while(g.phase!=='finished'&&turns++<1000){if(g.phase==='scoring'){approve(g);continue;}const c=E.COLORS[Math.floor(rng()*5)];const a=rng()<.3&&g.supply[c].length?{type:'ticket',color:c}:{type:'roll'};assert.equal(E.apply(g,g.turn,a,rng),true);assert.deepEqual(g.board.flat().slice().sort(),E.ALL.slice().sort());assert.ok(g.players.every(p=>p.money>=0));assert.equal(g.dice.length+g.rolled.length,6);}assert.equal(g.phase,'finished');assert.ok(g.winners.length);}});

test('rolls pay GOLD immediately and leg scoring never pays them twice',()=>{
 const g=board(newGame(),{1:['red','blue','green','yellow','purple'],16:['black','white']});
 assert.equal(E.apply(g,0,{type:'roll'},()=>0),true);
 assert.equal(g.players[0].money,4);
 assert.equal(g.players[0].pyramids,1);
 assert.match(g.log[0],/earned 1 GOLD/);
 for(let i=1;i<5;i++) E.apply(g,g.turn,{type:'roll'},()=>0);
 assert.equal(g.phase,'scoring');
 assert.equal(g.players.reduce((sum,p)=>sum+p.money,0),14);
 assert.ok(g.summary.every(s=>s.own===0&&s.delta===0));
 approve(g);assert.equal(g.players.reduce((sum,p)=>sum+p.money,0),14);
});
test('partners can still copy a roll ticket already paid to its owner',()=>{
 const g=board(newGame(6),{1:['red','blue','green','yellow','purple'],16:['black','white']});
 E.apply(g,0,{type:'roll'},()=>0);
 g.players[0].partner=1;g.players[1].partner=0;
 E.scoreLeg(g);
 assert.equal(g.players[0].money,4);
 assert.equal(g.players[1].money,4);
 assert.equal(g.summary[1].bonus,1);
});

test('round waits for every acknowledgement, rejects duplicates and protects the next round',()=>{
 const g=board(newGame(),{1:['red','blue','green','yellow','purple'],16:['black','white']});
 for(let i=0;i<5;i++)E.apply(g,g.turn,{type:'roll'},()=>0);
 assert.equal(g.phase,'scoring');assert.equal(E.nextLeg(g),false);
 const ack={type:'acknowledge',leg:1,phase:'scoring'};
 assert.equal(E.apply(g,0,ack),true);assert.equal(E.apply(g,0,ack),false);
 assert.equal(E.apply(g,1,ack),true);assert.equal(g.phase,'scoring');
 assert.equal(E.apply(g,2,{...ack,leg:0}),false);
 assert.equal(E.apply(g,2,ack),true);assert.equal(g.phase,'playing');assert.equal(g.leg,2);
 assert.equal(E.apply(g,2,ack),false);assert.deepEqual(g.acknowledged,[false,false,false]);
});
test('public remaining-card counts update without exposing hidden colors',()=>{
 const g=newGame();E.apply(g,0,{type:'bet',kind:'winner',color:'red'});
 const v=E.view(g,1);assert.equal(v.players[0].finishCardsRemaining,4);
 assert.equal(v.players[1].finishCardsRemaining,5);assert.equal(v.players[0].hand,null);
 assert.equal(v.bets.winner[0].color,undefined);
});
test('final results require all acknowledgements and never start another leg',()=>{
 const g=board(newGame(),{16:['red'],2:['blue','green','purple','yellow'],14:['black'],15:['white']});
 g.dice=['red'];E.apply(g,0,{type:'roll'},()=>0);assert.equal(g.phase,'finished');
 E.acknowledge(g,0,1);E.acknowledge(g,1,1);assert.equal(g.roundReviewed,false);
 E.acknowledge(g,2,1);assert.equal(g.roundReviewed,true);assert.equal(g.phase,'finished');
 assert.equal(E.nextLeg(g),false);
});

test('finish reveals one card at a time, in pile order, without leaking future cards or paying twice',()=>{
 const g=board(newGame(),{16:['red'],2:['blue','green','yellow','purple'],14:['white'],15:['black']});
 g.bets.winner=[{seat:1,color:'blue'},{seat:2,color:'red'},{seat:1,color:'red'}];
 g.bets.loser=[{seat:0,color:'blue'}];g.dice=['red'];
 E.apply(g,0,{type:'roll'},()=>0);assert.equal(g.phase,'revealing');
 assert.equal(g.players[1].money,3);assert.equal(g.finishResults.length,0);
 assert.equal(E.view(g,0).bets.winner[1].color,undefined);
 assert.equal(E.acknowledge(g,0,g.leg),false);
 assert.equal(E.revealNext(g,1,0),false);
 assert.equal(E.revealNext(g,0,0),true);assert.equal(g.finishResults.length,1);assert.equal(g.players[1].money,2);
 assert.equal(E.view(g,0).bets.winner[0].color,'blue');assert.equal(E.view(g,0).bets.winner[1].color,undefined);
 assert.equal(E.revealNext(g,0,0),false);assert.equal(g.players[1].money,2);
 assert.equal(E.revealNext(g,0,1),true);assert.equal(g.players[2].money,11);
 assert.equal(E.revealNext(g,0,2),true);assert.equal(g.players[1].money,7);
 assert.equal(g.finishResults[2].kind,'winner');
 assert.equal(E.revealNext(g,0,3),true);assert.equal(g.finishResults[3].kind,'loser');assert.equal(g.players[0].money,12);
 assert.equal(g.phase,'finished');assert.deepEqual(g.winners,[0]);
 assert.equal(E.revealNext(g,0,4),false);
});

test('roll commentary names carried camels and the destination stack',()=>{
 const g=board(newGame(),{1:['yellow','red','blue'],3:['green','purple'],14:['black'],15:['white']});
 g.players[0].name='Jace';g.dice=['yellow'];E.apply(g,0,{type:'roll'},()=>.4);
 assert.equal(g.log[0],'Jace rolled yellow 2 and earned 1 GOLD. Yellow Moved 2 and Carried (RED, BLUE) camels. Landed on top of (GREEN, PURPLE) camels on space 3.');
 assert.equal(g.event.message,g.log[0]);assert.deepEqual(g.event.landedOn,['green','purple']);
});
test('roll commentary describes Cheer and Jeer movement and stack placement',()=>{
 for(const side of [1,-1]){
  const g=board(newGame(),{1:['yellow','red','blue'],[side===1?4:2]:['green','purple'],14:['black'],15:['white']});
  g.players[1].name='Tile Owner';g.tiles=[{seat:1,space:3,side}];g.dice=['yellow'];
  E.apply(g,0,{type:'roll'},()=>.4);
  assert.match(g.log[0],new RegExp('Hit a '+(side===1?'Cheer':'Jeer')+' on space 3 and moved 1 extra space '+(side===1?'forward':'backward')));
  assert.match(g.log[0],/Tile Owner earned 3 GOLD/);
  assert.match(g.log[0],new RegExp('Landed '+(side===1?'on top of':'underneath')+' \\(GREEN, PURPLE\\)'));
 }
});
test('crazy camel commentary describes its actual movement and reversed tile direction',()=>{
 const g=board(newGame(),{7:['black','red'],4:['green','blue','purple','yellow'],14:['white']});
 g.tiles=[{seat:1,space:5,side:1}];g.dice=['grey'];
 E.apply(g,0,{type:'roll'},()=>.4);
 assert.match(g.log[0],/rolled grey 2 and earned 1 GOLD. Black Moved 2 backward and Carried \(RED\) camels/);
 assert.match(g.log[0],/Hit a Cheer on space 5 and moved 1 extra space backward/);
 assert.match(g.log[0],/Landed on top of \(GREEN, BLUE, PURPLE, YELLOW\) camels on space 4/);
});

test('spectator tiles pay per arriving camel for cheers and jeers, excluding camels already at the destination',()=>{
 for(const side of [1,-1]){
  const g=board(newGame(),{1:['yellow','red','blue'],[side===1?4:2]:['green','purple'],14:['black'],15:['white']});
  g.tiles=[{seat:1,space:3,side}];
  const event=E.move(g,'yellow',2);
  assert.equal(g.players[1].money,6);assert.equal(event.tileGold,3);
  assert.equal(event.unit.length,3);assert.equal(g.board[event.to].length,5);
 }
});
test('journal preserves distinct round histories after the next leg begins',()=>{
 const g=board(newGame(),{1:['red','blue','green','yellow','purple'],16:['black','white']});
 for(let i=0;i<5;i++)E.apply(g,g.turn,{type:'roll'},()=>0);
 const first=g.journal[0].entries.slice();approve(g);
 E.apply(g,g.turn,{type:'ticket',color:'red'});
 assert.equal(g.journal.length,2);assert.equal(g.journal[0].round,1);
 assert.deepEqual(g.journal[0].entries,first);
 assert.equal(g.journal[1].round,2);assert.match(g.journal[1].entries[0],/red leg ticket/);
});
