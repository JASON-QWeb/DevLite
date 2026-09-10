import { strict as assert } from "node:assert";

export const frameFixtureHtml = `<!doctype html><html><head><style>body{margin:0}button{margin:20px;width:160px;height:56px;font-size:16px}</style></head><body><button id="frame-button">Frame button</button><script>
window.businessClicks = 0;
const button = document.querySelector('button');
button.onclick = () => { window.businessClicks++; report(); };
const instance = Math.random().toString(36);
function report() { const r=button.getBoundingClientRect(); parent.postMessage({channel:'qa-frame-state',name:window.name,instance,font:button.style.fontSize,clicks:window.businessClicks,x:r.x+r.width/2,y:r.y+r.height/2},'*'); }
new MutationObserver(report).observe(document.documentElement,{attributes:true,subtree:true,childList:true});
report();
requestAnimationFrame(report);
addEventListener('load', report);
addEventListener('scroll', report, true);
addEventListener('resize', report);
addEventListener('mousemove',event=>parent.postMessage({channel:'qa-move',x:event.clientX,y:event.clientY,target:event.target.localName},'*'),true);
</script></body></html>`;

export async function runContainerChecks({ page, evaluate, shadowClick, shadowSetValue, waitForEval, record }) {
  const evaluateHere = (code) => evaluate(page, code);
  await evaluateHere(`(() => {
    document.body.innerHTML = '<main id="container-fixtures" style="display:flex;gap:40px;padding:30px"></main>';
    window.containerRoots = [];
    window.containerClicks = 0;
    window.containerPointerDowns = 0;
    for (const mode of ['open', 'closed']) {
      const host = document.createElement('qa-app');
      host.id = 'qa-' + mode;
      const root = host.attachShadow({ mode });
      root.innerHTML = '<style>button{display:block;padding:20px;margin:5px;color:rgb(20,30,40)}</style><button id="same-id">Submit</button>';
      const button = root.querySelector('button');
      button.addEventListener('click', () => window.containerClicks++);
      button.addEventListener('pointerdown', () => window.containerPointerDowns++);
      window.containerRoots.push(root);
      document.querySelector('main').append(host);
    }
    return true;
  })()`);

  async function select(expression) {
    await shadowClick(page, '[data-style-action="select"]').catch(async () => {
      await shadowClick(page, '.devlite-launcher');
      await shadowClick(page, '[data-tab="element"]');
      await shadowClick(page, '[data-action="quick-select"]');
    });
    const point = await evaluateHere(`(async () => { const el = ${expression}; el.scrollIntoView({block:'center'}); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await waitForEval(page, `shadowRoot()?.querySelector('.style-editor-head strong')?.textContent === 'button#same-id'`, 'container target selected');
  }

  for (let index = 0; index < 2; index++) {
    await select(`containerRoots[${index}].querySelector('button')`);
    await shadowSetValue(page, '[data-prop="font-size"]', '31px');
    await waitForEval(page, `containerRoots[${index}].querySelector('button').style.fontSize === '31px'`, 'shadow edit applied');
    assert.equal(await evaluateHere(`containerRoots[${1-index}].querySelector('button').style.fontSize`), '');
    await shadowClick(page, '[data-style-action="undo"]');
    await waitForEval(page, `containerRoots[${index}].querySelector('button').style.fontSize === ''`, 'original inline absence restored');
    record(`${index ? 'closed' : 'open'} Shadow DOM: real click, edit, isolated identity and undo`, true);
  }
  assert.equal(await evaluateHere('containerClicks'), 0, 'picker must consume business clicks');
  assert.equal(await evaluateHere('containerPointerDowns'), 0, 'picker must consume business pointerdown');
  record('picker consumes pointer and click actions in shadow roots', true);

  await select(`containerRoots[1].querySelector('button')`);
  await shadowClick(page, '[data-style-action="delete-element"]');
  await waitForEval(page, `!containerRoots[1].querySelector('button')`, 'shadow child deleted');
  await shadowClick(page, '.devlite-launcher');
  await shadowClick(page, '[data-tab="element"]');
  await shadowClick(page, '[data-action="undo-style-record"]');
  await waitForEval(page, `!!containerRoots[1].querySelector('button')`, 'shadow direct child restored');
  await evaluateHere(`containerRoots[1].querySelector('button').click()`);
  assert.equal(await evaluateHere('containerClicks'), 1, 'undo preserves the original event listener');
  record('deleting a direct child of a closed root restores the original node and listener', true);

  await evaluateHere(`(() => {
    window.frameStates = {};
    window.addEventListener('message', event => { if(event.data?.channel === 'qa-frame-state') frameStates[event.data.name] = event.data; });
    window.addEventListener('message', event => { if(event.data?.channel === 'qa-move') window.lastFrameMove=event.data; });
    document.querySelector('main').innerHTML = '';
    for (const name of ['same', 'cross', 'srcdoc']) {
      const frame = document.createElement('iframe'); frame.id=frame.name=name;
      frame.style.cssText='width:300px;height:240px;border:2px solid black';
      if(name==='srcdoc') frame.srcdoc=${JSON.stringify(frameFixtureHtml)};
      else { const url=new URL('/frame-fixture',location.href); if(name==='cross') url.hostname='localhost'; frame.src=url.href; }
      document.querySelector('main').append(frame);
    }
    return true;
  })()`);
  await waitForEval(page, `['same','cross','srcdoc'].every(name => frameStates[name]?.x > 0 && frameStates[name]?.y > 0)`, 'frame fixtures laid out');

  for (const name of ['same', 'cross', 'srcdoc']) {
    await shadowClick(page, '[data-style-action="select"]').catch(async () => {
      await shadowClick(page, '.devlite-launcher');
      await shadowClick(page, '[data-tab="element"]');
      await shadowClick(page, '[data-action="quick-select"]');
    });
    const point = await evaluateHere(`(async () => { const f=document.getElementById(${JSON.stringify(name)}); f.scrollIntoView({block:'center'}); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); const r=f.getBoundingClientRect(); const state=frameStates[${JSON.stringify(name)}]; return {x:r.x+f.clientLeft+state.x,y:r.y+f.clientTop+state.y}; })()`);
    await page.send('Input.dispatchMouseEvent', {type:'mouseMoved', ...point});
    await page.send('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left',buttons:1,clickCount:1});
    await page.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left',buttons:0,clickCount:1});
    await waitForEval(page, `shadowRoot()?.querySelector('.style-editor-head strong')?.textContent === 'button#frame-button'`, `${name} frame selection reaches main editor`).catch(async(error)=>{console.error('frame selection diagnostics', {name,point,state:await evaluateHere(`({states:frameStates,move:window.lastFrameMove,scroll:[scrollX,scrollY],frame:document.getElementById('${name}').getBoundingClientRect().toJSON(),zoom:visualViewport.scale})`)});throw error});
    await shadowSetValue(page, '[data-prop="font-size"]', '29px');
    await waitForEval(page, `frameStates[${JSON.stringify(name)}].font === '29px'`, `${name} frame style applied`);
    assert.equal(await evaluateHere(`frameStates[${JSON.stringify(name)}].clicks`), 0);
    await shadowClick(page, '[data-style-action="undo"]');
    await waitForEval(page, `frameStates[${JSON.stringify(name)}].font === ''`, `${name} frame style restored`);
    record(`${name} iframe: selection, main editor, local edit and undo`, true);
  }
}
