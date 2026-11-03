const {test}=require('node:test');
const assert=require('node:assert/strict');
const {bind}=require('../../js/game-dialogs.js');
function dialog(){
 const handlers=new Map(),closeHandlers=[];
 const button={hidden:false,addEventListener(type,fn){if(type==='click')closeHandlers.push(fn);},click(){closeHandlers.forEach(fn=>fn());}};
 const d={open:true,closes:0,querySelectorAll:()=>[button],getBoundingClientRect:()=>({left:10,right:310,top:20,bottom:220}),addEventListener(type,fn){handlers.set(type,fn);},close(){this.open=false;this.closes++;},emit(type,{target=d,clientX=0,clientY=0}={}){const e={target,clientX,clientY,prevented:false,preventDefault(){this.prevented=true;}};handlers.get(type)?.(e);return e;}};
 return {d,button};
}
test('optional dialogs close with X or a complete outside click, and permit Escape',()=>{
 const {d,button}=dialog();bind(d);button.click();assert.equal(d.closes,1);
 d.open=true;d.emit('pointerdown');d.emit('click');assert.equal(d.closes,2);
 assert.equal(d.emit('cancel').prevented,false);
});
test('inside padding, dragging out of content, and canceled pointers do not dismiss dialogs',()=>{
 const {d}=dialog();bind(d);
 d.emit('pointerdown',{clientX:15,clientY:30});d.emit('click',{clientX:15,clientY:30});assert.equal(d.closes,0);
 d.emit('pointerdown',{target:{},clientX:50,clientY:50});d.emit('click');assert.equal(d.closes,0);
 d.emit('pointerdown');d.emit('pointercancel');d.emit('click');assert.equal(d.closes,0);
 d.emit('pointerdown');d.emit('click',{clientX:50,clientY:50});assert.equal(d.closes,0);
});
test('required reviews hide X and block outside clicks and Escape until confirmation is no longer needed',()=>{
 const {d,button}=dialog();let required=true;
 const dismissal=bind(d,{requiresConfirmation:()=>required});assert.equal(button.hidden,true);
 button.click();d.emit('pointerdown');d.emit('click');assert.equal(d.closes,0);assert.equal(d.emit('cancel').prevented,true);
 required=false;dismissal.update();assert.equal(button.hidden,false);button.click();assert.equal(d.closes,1);
});
