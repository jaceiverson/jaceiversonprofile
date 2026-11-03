const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const art=require('../../js/camels-art.local.js');
const read=name=>fs.readFileSync(path.join(__dirname,'../..',name),'utf8');
test('experimental drawing supports all seven colors and reverses only the crazy camels',()=>{
 assert.deepEqual(art.colors,['blue','green','yellow','purple','red','black','white']);
 assert.equal((art.filters().match(/<filter id=/g)||[]).length,7);
 for(const c of art.colors){
  const svg=art.drawing(c);assert.match(svg,new RegExp('drawing-color-'+c));assert.match(svg,/camel-clean\.png/);
  assert.equal(svg.includes('scale(-1 1)'),c==='black'||c==='white');
 }
 assert.throws(()=>art.drawing('orange'));
});
test('comparison page renders current and experimental art together without replacing the shared drawing',()=>{
 const elements=new Map();const context={window:null,document:{body:{dataset:{},insertAdjacentHTML(){}},getElementById(id){if(!elements.has(id))elements.set(id,{innerHTML:''});return elements.get(id);}}};context.window=context;
 vm.runInNewContext(read('js/camels-results.js'),context);
 const current=context.CamelsResults.camelSvg;
 vm.runInNewContext(read('js/camels-art.local.js'),context);
 const page=read('games/camels-art-preview.html');const inline=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');vm.runInNewContext(inline,context);
 assert.equal(context.CamelsResults.camelSvg,current);
 assert.equal((elements.get('currentArt').innerHTML.match(/class="art-sample"/g)||[]).length,7);
 assert.equal((elements.get('drawingArt').innerHTML.match(/class="art-sample"/g)||[]).length,7);
 assert.match(elements.get('currentArt').innerHTML,/M14 46/);
 assert.match(elements.get('drawingArt').innerHTML,/camel-clean\.png/);
 assert.doesNotMatch(read('games/camels.html'),/camels-art|camels-experiment/);
});
test('experimental game can toggle both renderings and all experimental files are deployment-excluded',()=>{
 const context={window:null,document:{body:{dataset:{camelDrawing:'true'},insertAdjacentHTML(){}}}};context.window=context;
 vm.runInNewContext(read('js/camels-results.js'),context);vm.runInNewContext(read('js/camels-art.local.js'),context);
 const svg=context.CamelsResults.camelSvg('red');assert.match(svg,/class="art-current"/);assert.match(svg,/class="art-drawing"/);
 assert.match(svg,/M14 46/);assert.match(svg,/camel-clean\.png/);
 const config=read('_config.yml');for(const excluded of ['games/camels-art-preview.html','games/camels-art-local.html','js/camels-art.local.js','img/camels-experiment/'])assert.ok(config.includes('  - '+excluded));
 const page=read('games/camels-art-local.html');assert.match(page,/id="useDrawing"/);assert.match(page,/data-camel-drawing="true"/);
 assert.ok(page.indexOf('camels-art.local.js')<page.indexOf('js/camels.js'));
 const png=fs.readFileSync(path.join(__dirname,'../../img/camels-experiment/camel-clean.png'));assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(png[25],6,'RGBA image retains its alpha channel');
});
