import fs from 'node:fs/promises';
import WebSocket from 'ws';
const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
const target = targets.find(t => t.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j)});
let id=0;const pending=new Map();const errors=[];
socket.on('message',raw=>{const m=JSON.parse(raw);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text)});
function call(method,params={}){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}))})}
try {
 await call('Runtime.enable');
 const result=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
 const {enterSession}=await import('/js/screens/title.js');enterSession('ADB离线博士');
 await new Promise(r=>setTimeout(r,200));const {net}=__SP__;
 await net.request('room.create',{mode:'coop',difficulty:'FUNNY'});
 for(let i=0;i<7;i++)await net.request('room.addBot',{});
 await net.request('room.start',{});await net.request('g.autoplay',{on:true});await net.request('g.infoReady',{});
 const started=Date.now();while((__SP__.store.get().match.public?.round||0)<2){if(Date.now()-started>240000)throw new Error('Round 2 timeout');await new Promise(r=>setTimeout(r,500))}
 return {local:net.local,round:__SP__.store.get().match.public.round,phase:__SP__.store.get().match.public.phase,seats:__SP__.store.get().room.seats.filter(Boolean).length,canvases:document.querySelectorAll('canvas').length,body:document.body.innerText.slice(0,700)};
})()`});
 console.log(JSON.stringify(result,null,2));console.log({errors});
 if(result.exceptionDetails||errors.length)throw new Error('Android offline test failed');
 const shot=await call('Page.captureScreenshot',{format:'png'});
 await fs.mkdir('test/e2e/out',{recursive:true});await fs.writeFile('test/e2e/out/android-offline-round2.png',Buffer.from(shot.data,'base64'));
}finally{socket.close()}
