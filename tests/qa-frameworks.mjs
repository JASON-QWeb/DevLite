import { strict as assert } from "node:assert";

export function frameworkPage(kind) {
  if (!kind) return '<!doctype html><html><body></body></html>';
  const library = kind.startsWith('wujie') ? 'wujie' : kind.startsWith('micro') ? 'micro' : 'qiankun';
  return `<!doctype html><html><head><style>body{margin:0;padding:25px}#framework-container{width:700px;height:400px}micro-app{display:block;width:700px;height:400px}</style></head><body>
    <div id="framework-container"></div><script>window.frameworkKind=${JSON.stringify(kind)};window.qaQueries={doc:Document.prototype.querySelectorAll,element:Element.prototype.querySelectorAll,shadow:DocumentFragment.prototype.querySelectorAll};</script><script src="/framework-lib/${library}.js"></script><script>
    window.frameworkError='';
    window.scanFramework = function(root=document, x=0,y=0, seen=new Set()) {
      const out=[];
      for(const node of (root.nodeType===9?qaQueries.doc:root.nodeType===11?qaQueries.shadow:qaQueries.element).call(root,'*')) {
        if(seen.has(node)) continue; seen.add(node);
        if(node.id==='framework-target') {const r=node.getBoundingClientRect(); if(r.width&&r.height) out.push({node,x:x+r.x+r.width/2,y:y+r.y+r.height/2});}
        if(node.shadowRoot) out.push(...scanFramework(node.shadowRoot,x,y,seen));
        if(node.localName==='iframe') {const r=node.getBoundingClientRect(); if(r.width&&r.height) try {if(node.contentDocument) out.push(...scanFramework(node.contentDocument,x+r.x+node.clientLeft,y+r.y+node.clientTop,seen));}catch{}}
      }
      return out;
    };
    window.frameworkTarget=()=>scanFramework()[0]?.node;
    window.frameworkPoint=()=>{const found=scanFramework()[0];return found?{x:found.x,y:found.y}:null};
    (async()=>{
      const kind=${JSON.stringify(kind)};
      if(kind.startsWith('wujie')) {
        const config={name:'qa-wujie',url:location.origin+'/framework-child?kind=wujie',el:'#framework-container',alive:true,degrade:kind==='wujie-degrade',attrs:{src:location.origin+'/empty'}};
        window.frameworkUnmount=await wujie.startApp(config);
        window.frameworkRemount=async()=>{document.querySelector('#framework-container').replaceChildren();window.frameworkUnmount=await wujie.startApp(config)};
        if(kind==='wujie-multi') {const second=document.createElement('div');second.id='framework-second';document.body.append(second);await wujie.startApp({...config,name:'qa-wujie-second',el:'#framework-second'})}
      } else if(kind==='qiankun') {
        window.frameworkApp=qiankun.loadMicroApp({name:'qa-qiankun',entry:location.origin+'/framework-child?kind=qiankun',container:'#framework-container'},{sandbox:{strictStyleIsolation:true},singular:false});
        await window.frameworkApp.mountPromise;
      } else {
        microApp.default.start();
        const app=document.createElement('micro-app');app.setAttribute('name','qa-micro');app.setAttribute('url',location.origin+'/framework-child?kind=micro');
        app.setAttribute('shadowDOM','true');if(kind==='micro-iframe')app.setAttribute('iframe','true');
        document.getElementById('framework-container').append(app);
      }
      window.frameworkStarted=true;
    })().catch(error=>{window.frameworkError=String(error.stack||error)});
    </script></body></html>`;
}

export function frameworkChild(kind) {
  const script = kind === 'qiankun'
    ? `window['qa-qiankun']={bootstrap:async()=>{},mount:async(props)=>{props.container.querySelector('#framework-target').onclick=()=>{}},unmount:async()=>{}};`
    : `document.querySelector('#framework-target').addEventListener('click',()=>{window.childClicks=(window.childClicks||0)+1});`;
  return `<!doctype html><html><head><style>body{margin:0}button{margin:30px;padding:24px;font-size:16px}</style></head><body><button id="framework-target">Framework target</button><script>${script}</script></body></html>`;
}

export async function runFrameworkChecks({ page, evaluate, shadowClick, shadowSetValue, waitForEval, record, demoUrl }) {
  const run = (code) => evaluate(page, code);
  async function pick() {
    await shadowClick(page, '.devlite-launcher');
    await shadowClick(page, '[data-tab="element"]');
    await shadowClick(page, '[data-action="quick-select"]');
    const point = await run('frameworkPoint()');
    for (const [type, buttons] of [['mouseMoved',0],['mousePressed',1],['mouseReleased',0]]) {
      await page.send('Input.dispatchMouseEvent', {type,...point,button:type==='mouseMoved'?'none':'left',buttons,clickCount:1});
    }
    await waitForEval(page, `shadowRoot()?.querySelector('.style-editor-head strong')?.textContent === 'button#framework-target'`, 'real framework target selected');
  }
  for (const kind of ['wujie','wujie-degrade','wujie-multi','qiankun','micro','micro-iframe']) {
    await page.send('Page.navigate', {url:new URL('/framework?kind='+kind,demoUrl).href});
    await waitForEval(page, `window.frameworkKind === '${kind}' && (window.frameworkError || (window.frameworkStarted && !!window.frameworkTarget?.()))`, `${kind} starts`, 20000).catch(async(error)=>{console.error('framework diagnostics',await run(`({error:frameworkError,started:frameworkStarted,body:document.body.innerHTML.slice(0,800),point:frameworkPoint()})`));throw error});
    assert.equal(await run('frameworkError'), '', `${kind} fixture must mount successfully`);
    await waitForEval(page, `!!shadowRoot()?.querySelector('.devlite-launcher')`, `${kind} DevLite ready`);
    await pick();
    await shadowSetValue(page, '[data-prop="font-size"]', '32px');
    await waitForEval(page, `frameworkTarget()?.style.fontSize === '32px'`, `${kind} style edited`);
    if(kind==='wujie-multi') {assert.equal(await run('scanFramework().length'),2);assert.equal(await run('scanFramework()[1].node.style.fontSize'),'');}
    await shadowClick(page, '[data-style-action="undo"]');
    await waitForEval(page, `frameworkTarget()?.style.fontSize === ''`, `${kind} style undone`);
    if (kind === 'wujie') {
      await run(`window.keptFrameworkNode=frameworkTarget();frameworkRemount()`);
      await waitForEval(page, `frameworkTarget() === keptFrameworkNode`, 'wujie keep-alive preserves DOM');
      await pick();
      await shadowSetValue(page, '[data-prop="opacity"]', '0.6');
      await waitForEval(page, `frameworkTarget()?.style.opacity === '0.6'`, 'wujie keep-alive edit');
      await shadowClick(page, '[data-style-action="undo"]');
    }
    record(`real framework ${kind}: mount, real selection, edit and undo${kind==='wujie'?', keep-alive remount':''}`, true);
  }
}
