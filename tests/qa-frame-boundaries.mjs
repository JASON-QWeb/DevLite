import { strict as assert } from 'node:assert';
import { frameFixtureHtml } from './qa-containers.mjs';

export function nestedFrameHtml(url) {
  const leaf = new URL('/frame-fixture', url); leaf.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return `<!doctype html><html><body style="margin:0;padding:12px"><qa-nested></qa-nested><script>
  const root=document.querySelector('qa-nested').attachShadow({mode:'closed'});
  root.innerHTML='<iframe id="leaf" name="nested-leaf" style="width:340px;height:200px;border:3px solid" src="${leaf.href}"></iframe>';
  addEventListener('message',event=>{if(event.data?.channel==='qa-frame-state'){const frame=root.querySelector('iframe'),r=frame.getBoundingClientRect();parent.postMessage({...event.data,x:event.data.x+r.x+frame.clientLeft,y:event.data.y+r.y+frame.clientTop},'*')}});
  </script></body></html>`;
}

export async function runFrameBoundaryChecks({page,evaluate,shadowClick,shadowSetValue,waitForEval,record,demoUrl,fromDocument,contexts,restartWorker,readSession}) {
  const run = code => evaluate(page,code);
  async function waitValue(fn,predicate,label) {
    const deadline=Date.now()+10000;
    do {const value=await fn();if(predicate(value)) return value;await new Promise(resolve=>setTimeout(resolve,100));} while(Date.now()<deadline);
    throw new Error(`Timed out: ${label}`);
  }
  async function start() { await fromDocument({type:'element-inspector-set',active:true}); }
  async function click(point, label='button#frame-button') {
    for(const [type,buttons] of [['mouseMoved',0],['mousePressed',1],['mouseReleased',0]]) await page.send('Input.dispatchMouseEvent',{type,...point,button:type==='mouseMoved'?'none':'left',buttons,clickCount:1});
    await waitForEval(page,`shadowRoot()?.querySelector('.style-editor-head strong')?.textContent === ${JSON.stringify(label)}`,'child target');
  }
  async function pick(name='test-frame',host='document.getElementById("test-frame")') {
    await start();
    await click(await run(`(()=>{const frame=${host};frame.scrollIntoView({block:'center'});const r=frame.getBoundingClientRect(),s=frameStates[${JSON.stringify(name)}];return {x:r.x+frame.clientLeft+s.x,y:r.y+frame.clientTop+s.y}})()`));
  }
  async function editAndUndo(name='test-frame') {
    await shadowSetValue(page,'[data-prop="font-size"]','30px');
    await waitForEval(page,`frameStates[${JSON.stringify(name)}].font==='30px'`,'frame edited');
    await shadowClick(page,'[data-style-action="undo"]');
    await waitForEval(page,`frameStates[${JSON.stringify(name)}].font===''`,'frame undone');
  }
  await page.send('Page.navigate',{url:new URL('/empty',demoUrl).href});
  await waitForEval(page,`!!shadowRoot()?.querySelector('.devlite-launcher')`,'new boundary page');
  await shadowClick(page,'.devlite-launcher');
  await run(`window.frameStates={};addEventListener('message',event=>{if(event.data?.channel==='qa-frame-state')frameStates[event.data.name]=event.data})`);

  for(const kind of ['about:blank','blob','data','sandbox-scripts','sandbox-origin','sandbox-none']) {
    await run(`(()=>{document.getElementById('test-frame')?.remove();delete frameStates['test-frame'];const f=document.createElement('iframe');f.id=f.name='test-frame';f.style.cssText='margin:30px;width:400px;height:240px;border:3px solid';
      const html=${JSON.stringify(frameFixtureHtml)};const kind=${JSON.stringify(kind)};
      if(kind==='blob') {window.fixtureBlob=URL.createObjectURL(new Blob([html],{type:'text/html'}));f.src=fixtureBlob}
      else if(kind==='data') f.src='data:text/html;charset=utf-8,'+encodeURIComponent(html);
      else if(kind.startsWith('sandbox')) {f.setAttribute('sandbox',kind==='sandbox-scripts'?'allow-scripts':kind==='sandbox-origin'?'allow-same-origin':'');f.srcdoc=html}
      document.body.append(f);if(kind==='about:blank'){f.contentDocument.open();f.contentDocument.write(html);f.contentDocument.close()}
      return true})()`);
    if(kind==='sandbox-none'||kind==='sandbox-origin') {
      // Page scripts are disabled; the extension's own isolated executor can still be allowed by Chrome.
      const online=await waitValue(contexts,list=>list.some(i=>i.frameId!==0),'sandbox extension context');
      assert(online.some(i=>i.frameId!==0));
      await start();
      const p=await run(`(()=>{const f=document.getElementById('test-frame'),r=f.getBoundingClientRect();return {x:r.x+f.clientLeft+100,y:r.y+f.clientTop+48}})()`);
      await click(p);
      await shadowSetValue(page,'[data-prop="font-size"]','30px');
      const session=await waitValue(readSession,s=>s?.styleChanges.some(c=>c.after['font-size']==='30px'),'sandbox edit saved');
      const change=session.styleChanges.find(c=>c.after['font-size']==='30px');
      const result=await fromDocument({type:'element-command',change,command:{action:'undo'}});
      assert.equal(result.ok,true);
    } else {
      await waitForEval(page,`frameStates['test-frame']?.x>0`,`${kind} ready`);
      await pick();await editAndUndo();
    }
    await run(`if(window.fixtureBlob){URL.revokeObjectURL(fixtureBlob);fixtureBlob=null}`);
    record(`F04/F05: ${kind} actual isolated injection, selection and undo`,true);
  }

  await start();
  await run(`(()=>{document.getElementById('test-frame').remove();const host=document.createElement('qa-frame-shell');host.id='frame-shell';window.frameShell=host.attachShadow({mode:'closed'});frameShell.innerHTML='<iframe id="outer" style="margin:25px;width:420px;height:260px;border:4px solid" src="'+new URL('/nested-frame',location).href+'"></iframe>';document.body.append(host);return true})()`);
  await waitForEval(page,`frameStates['nested-leaf']?.x>40`,'nested late frame loads');
  // Do not restart picking: the newly injected frame must join the running session.
  await click(await run(`(()=>{const f=frameShell.querySelector('iframe'),r=f.getBoundingClientRect(),s=frameStates['nested-leaf'];return{x:r.x+f.clientLeft+s.x,y:r.y+f.clientTop+s.y}})()`));
  await shadowSetValue(page,'[data-prop="font-size"]','30px');
  const nestedSession=await waitValue(readSession,s=>s?.styleChanges.some(c=>c.context?.framePath.length===2),'nested path');
  const nested=nestedSession.styleChanges.find(c=>c.context?.framePath.length===2);
  assert.equal(nested.context.framePath[0].shadowPath.length,1);
  assert.equal(nested.context.framePath[1].shadowPath.length,1);
  await shadowClick(page,'[data-style-action="undo"]');
  await waitForEval(page,`frameStates['nested-leaf'].font===''`,'nested undo');
  record('F02/F03/F07: closed shadow → frame → closed shadow → cross-origin frame; late injection joins picker',true);

  await run(`document.getElementById('frame-shell').remove();const f=document.createElement('iframe');f.id=f.name='test-frame';f.src='/frame-fixture';f.style.cssText='margin:30px;width:400px;height:240px';document.body.append(f)`);
  await waitForEval(page,`!!document.getElementById('test-frame').contentDocument?.querySelector('button')`,'navigation fixture');
  await pick();
  await shadowSetValue(page,'[data-prop="font-size"]','30px');
  const beforeNav=await waitValue(readSession,s=>s?.styleChanges.some(c=>c.context?.framePath.at(-1)?.selector==='#test-frame'&&c.after['font-size']==='30px'),'old edit');
  const old=beforeNav.styleChanges.find(c=>c.context?.framePath.at(-1)?.selector==='#test-frame'&&c.after['font-size']==='30px');
  await run(`document.getElementById('test-frame').src='/frame-fixture?new-document'`);
  await waitForEval(page,`document.getElementById('test-frame').contentDocument?.URL.endsWith('?new-document')&&!!document.getElementById('test-frame').contentDocument.querySelector('button')`,'new document');
  const stale=await fromDocument({type:'element-command',change:old,command:{action:'style',property:'font-size',value:'48px'}});
  assert.equal(stale.ok,false);assert.equal(stale.status,'document-unavailable');
  assert.equal(await run(`document.getElementById('test-frame').contentDocument.querySelector('button').style.fontSize`),'');
  record('F06/R01: navigation rejects a write to the old document without touching the new page',true);

  await pick();
  await shadowSetValue(page,'[data-prop="font-size"]','30px');
  const current=await waitValue(readSession,s=>s?.styleChanges.some(c=>c.context?.url.endsWith('?new-document')&&c.after['font-size']==='30px'),'new edit');
  const owned=current.styleChanges.find(c=>c.context?.url.endsWith('?new-document')&&c.after['font-size']==='30px');
  const top=(await contexts()).find(c=>c.frameId===0);
  const forged={...owned,id:old.id,context:top,after:{'font-size':'99px'},updatedAt:Date.now()+1000};
  const rejected=await fromDocument({type:'element-updated',snapshot:{change:forged}},owned.context.documentId);
  assert.equal(rejected.ok,false);
  assert.equal((await readSession()).styleChanges.find(c=>c.id===old.id).after['font-size'],'30px');
  const contextAttack=await fromDocument({type:'page-context',page:{url:'https://fake.invalid'}},owned.context.documentId);
  assert.equal(contextAttack.ok,false);
  record('R02: child snapshots cannot replace another document record or top page context',true);

  const request={type:'element-command',requestId:'qa-delete-once',change:owned,command:{action:'delete'}};
  assert.equal((await fromDocument(request)).ok,true);
  assert.equal((await fromDocument(request)).ok,true);
  assert.equal((await fromDocument({type:'element-command',change:owned,command:{action:'undo'}})).ok,true);
  assert.equal((await fromDocument(request)).replayed,true);
  assert.equal((await readSession()).styleChanges.some(change=>change.id===owned.id),false,'a duplicate response after undo must not resurrect the deleted record');
  assert.equal(await run(`document.getElementById('test-frame').contentDocument.querySelectorAll('button').length`),1);
  record('R01/E04: repeated delete request is idempotent and undo restores exactly one original node',true);

  await start();
  await run(`document.getElementById('test-frame').requestFullscreen()`);
  await click(await run(`(()=>{const f=document.getElementById('test-frame'),r=f.getBoundingClientRect(),b=f.contentDocument.querySelector('button').getBoundingClientRect();return{x:r.x+f.clientLeft+b.x+b.width/2,y:r.y+f.clientTop+b.y+b.height/2}})()`));
  await waitForEval(page,`!document.fullscreenElement`,'fullscreen child returns to main editor');
  await editAndUndo();
  record('V02: selection inside fullscreen iframe returns to the single main editor',true);
  async function selectChild(selector,label) {
    await start();
    await click(await run(`(async()=>{const f=document.getElementById('test-frame'),b=f.contentDocument.querySelector(${JSON.stringify(selector)});b.scrollIntoView({block:'center'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=f.getBoundingClientRect(),t=b.getBoundingClientRect();return{x:r.x+f.clientLeft+t.x+t.width/2,y:r.y+f.clientTop+t.y+t.height/2}})()`),label);
  }
  async function saveSelection(selector) {
    await shadowSetValue(page,'[data-prop="opacity"]','0.91');
    const s=await waitValue(readSession,s=>s?.styleChanges.some(c=>c.selector===selector&&c.after.opacity==='0.91'),'selection persisted');
    return s.styleChanges.filter(c=>c.selector===selector&&c.after.opacity==='0.91').sort((a,b)=>b.updatedAt-a.updatedAt)[0];
  }
  const execute=(change,command)=>fromDocument({type:'element-command',change,command});
  await run(`(()=>{const d=document.getElementById('test-frame').contentDocument;d.querySelector('button').style.setProperty('font-size','18px','important');d.querySelector('button').innerHTML='<span>Original</span>';window.originalChild=d.querySelector('button span');window.restoredClicks=0;originalChild.addEventListener('click',()=>restoredClicks++);return true})()`);
  await selectChild('button','span');
  await shadowClick(page,'[data-style-action="select-parent"]');
  await waitForEval(page,`shadowRoot()?.querySelector('.style-editor-head strong')?.textContent==='button#frame-button'`,'parent selection');
  const textChange=await saveSelection('#frame-button');
  assert.equal((await execute(textChange,{action:'style',property:'font-size',value:'31px'})).ok,true);
  assert.equal((await execute(textChange,{action:'text-start'})).ok,true);
  await page.send('Input.imeSetComposition',{text:'中文输入',selectionStart:4,selectionEnd:4});
  await page.send('Input.insertText',{text:'中文输入'});
  await execute(textChange,{action:'text-stop'});
  assert.equal(await run(`document.getElementById('test-frame').contentDocument.querySelector('button').textContent`),'中文输入');
  assert.equal((await execute(textChange,{action:'undo'})).ok,true);
  assert.equal(await run(`document.getElementById('test-frame').contentDocument.querySelector('button span')===originalChild`),true);
  await run('originalChild.click()');assert.equal(await run('restoredClicks'),1);
  assert.equal(await run(`document.getElementById('test-frame').contentDocument.querySelector('button').style.getPropertyPriority('font-size')`),'important');
  assert.equal(await run(`document.getElementById('test-frame').contentDocument.querySelector('button').style.fontSize`),'18px');
  record('E02/E03/E04: native Chinese IME in child document, exact inline priority and original descendant listener restored',true);

  await run(`document.getElementById('test-frame').contentDocument.body.insertAdjacentHTML('beforeend','<input id="controlled" value="Business value" style="display:block;width:170px;height:40px">')`);
  await selectChild('#controlled','input#controlled');
  assert.equal(await run(`shadowRoot().querySelector('[data-style-action="text"]').disabled`),true);
  record('E02: business form values are outside plain text editing capabilities',true);

  const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="70"><rect width="100" height="70" fill="blue"/></svg>');
  const replacement='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="70"><rect width="100" height="70" fill="red"/></svg>');
  await run(`(()=>{const d=document.getElementById('test-frame').contentDocument;d.body.insertAdjacentHTML('beforeend','<picture><source srcset="${image}"><img id="picture-target" width="100" height="70" src="${image}"></picture><svg width="100" height="70"><image id="svg-image" width="100" height="70" href="${image}"/></svg>');return true})()`);
  for(const [selector,label] of [['#picture-target','img#picture-target'],['#svg-image','image#svg-image']]) {
    await selectChild(selector,label);const change=await saveSelection(selector);
    const before=await run(`document.getElementById('test-frame').contentDocument.querySelector(${JSON.stringify(selector)}).outerHTML`);
    assert.equal((await execute(change,{action:'image',src:replacement,label:'replacement'})).ok,true);
    assert.equal((await execute(change,{action:'undo'})).ok,true);
    assert.equal(await run(`document.getElementById('test-frame').contentDocument.querySelector(${JSON.stringify(selector)}).getAttribute('src')||document.getElementById('test-frame').contentDocument.querySelector(${JSON.stringify(selector)}).getAttribute('href')`),image);
    if(selector==='#picture-target') assert.equal(await run(`document.getElementById('test-frame').contentDocument.querySelector('source').srcset`),image);
    else assert.equal(await run(`document.getElementById('test-frame').contentDocument.querySelector('#svg-image').hasAttributeNS('http://www.w3.org/1999/xlink','href')`),false);
  }
  record('E04: picture/source and SVG image replacement restore all original attributes',true);

  await selectChild('button span','span');
  const restartChange=await saveSelection('span');
  await restartWorker();
  const restarted=await execute(restartChange,{action:'style',property:'font-size',value:'24px'});
  assert.equal(restarted.ok,true);
  assert.equal(await run(`document.getElementById('test-frame').contentDocument.querySelector('button span').style.fontSize`),'24px');
  assert.equal((await execute(restartChange,{action:'undo'})).ok,true);
  record('L05: service worker termination and lazy restart recover document routing and undo',true);


  await selectChild('button span','span');
  const ambiguousChange=await saveSelection('span');
  await run(`(()=>{const d=document.getElementById('test-frame').contentDocument;window.savedSpan=d.querySelector('button span');d.querySelector('button').replaceChildren(savedSpan.cloneNode(true),savedSpan.cloneNode(true));return true})()`);
  const ambiguous=await execute(ambiguousChange,{action:'style',property:'font-size',value:'55px'});
  assert.equal(ambiguous.ok,false);assert.equal(ambiguous.status,'ambiguous');
  assert.equal(await run(`Array.from(document.getElementById('test-frame').contentDocument.querySelectorAll('button span')).some(el=>el.style.fontSize==='55px')`),false);
  await run(`document.getElementById('test-frame').contentDocument.querySelector('button').replaceChildren(savedSpan)`);
  assert.equal((await execute(ambiguousChange,{action:'undo'})).ok,true);
  record('L02/R01: replaced node with two identical candidates is rejected without modifying either',true);

  await run(`window.qaBackMarker='preserved';window.qaRestored=false;addEventListener('pageshow',event=>{window.qaRestored=event.persisted})`);
  const history=await page.send('Page.getNavigationHistory');
  const previous=history.entries[history.currentIndex].id;
  await page.send('Page.navigate',{url:new URL('/empty?away',demoUrl).href});
  await waitForEval(page,`location.search==='?away'`,'away page');
  await page.send('Page.navigateToHistoryEntry',{entryId:previous});
  await waitForEval(page,`location.search===''&&!!shadowRoot()?.querySelector('.devlite-launcher')`,'history return');
  assert.equal(await run(`window.qaBackMarker==='preserved'&&window.qaRestored`),true,'browser must actually restore from BFCache for this assertion');
  await selectChild('button span','span');
  const backChange=await saveSelection('span');
  assert.equal((await execute(backChange,{action:'undo'})).ok,true);
  assert.equal(await run(`document.querySelectorAll('#devlite-overlay-root').length`),1);
  record('L05: actual BFCache restoration keeps one editor and restores frame selection/undo',true);

  await page.send('HeapProfiler.collectGarbage');
  const memoryBefore=await page.send('Memory.getDOMCounters');
  await run(`(()=>{document.body.replaceChildren();window.stressRoots=[];window.stressLongTasks=[];window.stressObserver=new PerformanceObserver(list=>stressLongTasks.push(...list.getEntries().map(e=>e.duration)));stressObserver.observe({type:'longtask'});for(let i=0;i<100;i++){const host=document.createElement('qa-stress');host.style.display='block';host.id='stress-'+i;const root=host.attachShadow({mode:i%2?'closed':'open'});root.innerHTML='<button id="stress-target">Stress</button>'+'<span>x</span>'.repeat(199);stressRoots.push(root);document.body.append(host)}for(let i=0;i<20;i++){const frame=document.createElement('iframe');frame.name='stress-frame-'+i;frame.srcdoc='<p>Stress frame</p>';frame.style.cssText='width:100px;height:50px';document.body.append(frame)}return true})()`);
  await waitValue(contexts,list=>list.length===21,'twenty frame executors');
  await start();
  await run(`stressLongTasks=[];stressStart=performance.now();stressRoots[99].querySelector('button').scrollIntoView({block:'center'})`);
  await click(await run(`(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=stressRoots[99].querySelector('button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`),'button#stress-target');
  const metrics=await run(`({selectionMs:Math.round(performance.now()-stressStart),longTasks:stressLongTasks.length,maxLongTaskMs:Math.round(Math.max(0,...stressLongTasks))})`);
  assert(metrics.selectionMs<3000,'large page remains selectable within the interaction budget');
  await fromDocument({type:'element-inspector-set',active:false});
  await run(`document.body.replaceChildren();stressRoots=[];stressObserver.disconnect()`);
  for(let pass=0;pass<4;pass++) {
    await start();
    await run(`(()=>{for(let i=0;i<100;i++){const host=document.createElement('qa-transient');host.attachShadow({mode:'closed'}).innerHTML='<button>Temporary</button>';document.body.append(host)}return new Promise(resolve=>requestAnimationFrame(()=>{document.body.replaceChildren();resolve(true)}))})()`);
    await fromDocument({type:'element-inspector-set',active:false});
  }
  assert.equal((await contexts()).length,1,'removed documents are not present in native inventory');
  assert.equal(await run(`document.querySelectorAll('#devlite-overlay-root').length`),1);
  const memoryAfter=await waitValue(async()=>{await page.send('HeapProfiler.collectGarbage');return page.send('Memory.getDOMCounters')},value=>value.nodes<memoryBefore.nodes+1000,'removed roots release the stress DOM tree');
  metrics.nodesBefore=memoryBefore.nodes;metrics.nodesAfter=memoryAfter.nodes;metrics.listenersBefore=memoryBefore.jsEventListeners;metrics.listenersAfter=memoryAfter.jsEventListeners;
  record('P01: 20 frames, 100 roots, 20,000 root DOM nodes; repeated mounts/removals',true,JSON.stringify(metrics));

}
