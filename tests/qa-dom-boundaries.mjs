import { strict as assert } from "node:assert";

export async function runDomBoundaryChecks({ page, evaluate, shadowClick, shadowSetValue, waitForEval, record, readSession }) {
  const run = (code) => evaluate(page, code);
  const edit = (property, value) => shadowSetValue(page, `[data-prop="${property}"]`, value);
  async function select(expression, label) {
    await shadowClick(page, '[data-style-action="select"]').catch(async () => {
      await shadowClick(page, '.devlite-launcher');
      await shadowClick(page, '[data-tab="element"]');
      await shadowClick(page, '[data-action="quick-select"]');
    });
    const point = await run(`(async () => { const el=${expression}; el.scrollIntoView({block:'center'}); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    for (const [type, buttons] of [['mouseMoved',0],['mousePressed',1],['mouseReleased',0]]) {
      await page.send('Input.dispatchMouseEvent', {type,...point,button:type==='mouseMoved'?'none':'left',buttons,clickCount:1});
    }
    await waitForEval(page, `shadowRoot()?.querySelector('.style-editor-head strong')?.textContent === ${JSON.stringify(label)}`, label);
  }
  async function waitSession(predicate, label) {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      const session = await readSession();
      if (predicate(session)) return session;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Timed out: ${label}`);
  }

  await run(`(() => {
    document.body.innerHTML='<main style="padding:30px" id="boundary-main"></main>';
    const host=document.createElement('qa-shell'); host.id='boundary-shell';
    const first=host.attachShadow({mode:'open'}); const middle=document.createElement('qa-middle'); first.append(middle);
    const second=middle.attachShadow({mode:'closed'}); const inner=document.createElement('qa-inner'); second.append(inner);
    const third=inner.attachShadow({mode:'open'}); third.innerHTML='<style>button{padding:25px;color:rgb(10,20,30)}</style><button id="deep">Deep</button>';
    window.deepRoot=third; window.deepButton=third.querySelector('button');
    document.querySelector('main').append(host);
    return true;
  })()`);
  await select('deepButton', 'button#deep');
  await edit('font-size', '33px');
  await waitForEval(page, `deepButton.style.fontSize === '33px'`, 'three-level shadow edit');
  const deepSession = await waitSession((session) => session?.styleChanges.some((change) => change.selector === '#deep'), 'deep address saved');
  assert.equal(deepSession.styleChanges.find((change) => change.selector === '#deep').address.shadowPath.length, 3);
  await shadowClick(page, '[data-style-action="undo"]');
  record('S02: three-level open/closed Shadow DOM persists all container boundaries', true);

  await run(`(() => {
    const host=document.createElement('qa-slot'); host.id='slot-host';
    host.innerHTML='<button id="slotted" slot="action" style="padding:24px">Slotted</button>';
    host.attachShadow({mode:'closed'}).innerHTML='<div><slot name="action"></slot></div>';
    document.querySelector('main').append(host); return true;
  })()`);
  await select(`document.getElementById('slotted')`, 'button#slotted');
  await edit('opacity', '0.6');
  await waitForEval(page, `document.getElementById('slotted').style.opacity === '0.6'`, 'slotted element edited');
  const slotSession = await waitSession((session) => session?.styleChanges.some((change) => change.selector === '#slotted'), 'slot address saved');
  assert.equal(slotSession.styleChanges.find((change) => change.selector === '#slotted').address.shadowPath.length, 0, 'slot display does not change DOM ownership');
  await shadowClick(page, '[data-style-action="undo"]');
  record('S03: slot display and actual DOM ownership are resolved separately', true);

  await run(`document.querySelector('main').insertAdjacentHTML('beforeend','<qa-late id="late-host"></qa-late>')`);
  await run(`(() => { window.lateRoot=document.getElementById('late-host').attachShadow({mode:'closed'}); lateRoot.innerHTML='<button id="late" style="padding:22px">Late</button>'; return true; })()`);
  await select(`lateRoot.querySelector('button')`, 'button#late');
  await edit('font-size', '26px');
  await waitForEval(page, `lateRoot.querySelector('button').style.fontSize === '26px'`, 'late root edited');
  await shadowClick(page, '[data-style-action="undo"]');
  record('S04: a closed root attached to an existing host is immediately selectable', true);

  await run(`document.querySelector('main').insertAdjacentHTML('beforeend','<svg width="180" height="90"><path id="svg-path" d="M10 10H160V80H10Z" fill="blue"/></svg>')`);
  await select(`document.getElementById('svg-path')`, 'path#svg-path');
  assert.equal(await run(`shadowRoot().querySelector('[data-style-action="text"]').disabled`), true);
  assert.equal(await run(`shadowRoot().querySelector('[data-style-action="replace-icon"]').disabled`), true);
  await edit('opacity', '0.5');
  await waitForEval(page, `document.getElementById('svg-path').style.opacity === '0.5'`, 'SVG style edit');
  await shadowClick(page, '[data-style-action="undo"]');
  record('S05: SVG paths are selected precisely and expose supported actions', true);

  await run(`document.querySelector('main').insertAdjacentHTML('beforeend','<button id="reused" data-key="first" style="padding:20px">Row</button>')`);
  await select(`document.getElementById('reused')`, 'button#reused');
  await run(`document.getElementById('reused').dataset.key='second'`);
  await waitForEval(page, `shadowRoot().querySelector('.style-editor-popover').hidden`, 'reused node invalidates selection');
  assert.equal(await run(`document.getElementById('reused').style.fontSize`), '');
  record('L02: virtual-list identity changes invalidate a still-connected node', true);

  await run(`(() => { const host=document.createElement('qa-css'); host.id='css-host'; window.cssRoot=host.attachShadow({mode:'open'}); const sheet=new CSSStyleSheet(); sheet.replaceSync('button{padding:20px;font-size:16px}'); cssRoot.adoptedStyleSheets=[sheet]; cssRoot.innerHTML='<button id="css-target">CSS</button>'; document.querySelector('main').append(host); return true; })()`);
  await select(`cssRoot.querySelector('button')`, 'button#css-target');
  await edit('font-size', '35px');
  await shadowClick(page, '[data-style-action="requirement-copy-now"]');
  const exported = await waitSession((session) => session?.styleChanges.some((change) => change.selector === '#css-target' && change.exportedAt), 'CSS change marked');
  const cssId = exported.styleChanges.find((change) => change.selector === '#css-target').id;
  assert(exported.styleChanges.find((change) => change.id === cssId).locator.matchedCssRules.some((rule) => rule.style.includes('font-size')), 'adopted stylesheet is collected');
  await run(`cssRoot.adoptedStyleSheets[0].replaceSync('button{padding:20px;font-size:35px}')`);
  await waitSession((session) => session?.archivedStyleChanges.some((entry) => entry.change.id === cssId && entry.archiveReason === 'verified'), 'CSSOM-only update verified');
  record('C01: adopted stylesheets are collected and CSSOM-only fixes verify without preview inline styles', true);

  await select(`lateRoot.querySelector('button')`, 'button#late');
  await shadowClick(page, '[data-style-action="delete-element"]');
  await shadowClick(page, '.devlite-launcher');
  await shadowClick(page, '[data-tab="element"]');
  await shadowClick(page, '[data-action="copy-prompt"]');
  const deletion = await waitSession((session) => session?.styleChanges.some((change) => change.selector === '#late' && change.exportedAt), 'deletion exported');
  const deletedId = deletion.styleChanges.find((change) => change.selector === '#late').id;
  await run(`document.getElementById('late-host').remove()`);
  await shadowClick(page, '[data-action="verify-style-records"]');
  const deletionState = await readSession();
  assert(!deletionState.archivedStyleChanges.some((entry) => entry.change.id === deletedId), 'missing app cannot prove deletion');
  record('C02/L03: unloading an application does not automatically verify a deletion', true);

  await run(`(() => { const dialog=document.createElement('dialog'); dialog.id='qa-dialog'; dialog.innerHTML='<button id="modal-target" style="padding:30px">Modal</button>'; document.body.append(dialog); dialog.showModal(); return true; })()`);
  await select(`document.getElementById('modal-target')`, 'button#modal-target');
  assert.equal(await run(`document.getElementById('devlite-overlay-root').parentElement.id`), 'qa-dialog');
  await edit('font-size','28px');
  await waitForEval(page, `document.getElementById('modal-target').style.fontSize === '28px'`, 'modal edit');
  await shadowClick(page, '[data-style-action="undo"]');
  await run(`document.getElementById('qa-dialog').close()`);
  record('V02: modal dialog remains selectable and the editor is outside the inert background', true);

  await run(`document.documentElement.requestFullscreen()`);
  await select(`document.getElementById('slotted')`, 'button#slotted');
  await edit('opacity','0.7');
  await waitForEval(page, `document.getElementById('slotted').style.opacity === '0.7'`, 'fullscreen edit');
  await shadowClick(page, '[data-style-action="undo"]');
  await run(`document.exitFullscreen()`);
  record('V02: native top-layer overlay supports fullscreen editing', true);
  await run(`document.documentElement.style.zoom='1.25'`);
  await select(`document.getElementById('slotted')`, 'button#slotted');
  await waitForEval(page,`(()=>{const target=document.getElementById('slotted').getBoundingClientRect(),box=shadowRoot().querySelector('.devlite-highlighter').getBoundingClientRect();return Math.abs(target.x-box.x)<2&&Math.abs(target.y-box.y)<2&&Math.abs(target.width-box.width)<2})()`,'CSS zoom highlight coordinates');
  await run(`document.documentElement.style.zoom=''`);
  record('V01: root CSS zoom keeps highlight aligned with the selected box',true);

}
