import fs from 'node:fs/promises';
import WebSocket from 'ws';
const target=(await (await fetch('http://127.0.0.1:9223/json')).json()).find(t=>t.type==='page');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.once('open',r));
let id=0;const pending=new Map();ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){pending.get(m.id)?.(m.result);pending.delete(m.id)}});
const call=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}))});
try{
 console.log(JSON.stringify(await call('Runtime.evaluate',{expression:"__SP__.net.request('g.autoplay',{on:false})",awaitPromise:true,returnByValue:true})));
 await new Promise(r=>setTimeout(r,1000));
 const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('test/e2e/out/android-offline-game.png',Buffer.from(shot.data,'base64'));
 console.log(JSON.stringify(await call('Runtime.evaluate',{expression:"({round:__SP__.store.get().match.public.round,phase:__SP__.store.get().match.public.phase,canvases:document.querySelectorAll('canvas').length})",returnByValue:true})));
}finally{ws.close()}
