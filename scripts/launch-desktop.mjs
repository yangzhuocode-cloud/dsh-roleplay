import { spawn } from 'node:child_process';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
const [exe, home, userData, evidence, port='19478', sourceApp] = process.argv.slice(2);
if (![exe,home,userData,evidence].every(Boolean)) throw Error('Explicit isolated paths required');
await mkdir(userData,{recursive:true});await mkdir(evidence,{recursive:true});
const env={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',DSH_DESKTOP_OPEN_DEVTOOLS:'0'};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(exe,['--inspect-brk=127.0.0.1:0',`--remote-debugging-port=${port}`,`--user-data-dir=${userData}`,...(sourceApp?[sourceApp]:[])],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let ws;
try {
let output='';let found;const endpoint=new Promise(r=>found=r);
const log=b=>{const text=b.toString();output+=text;appendFile(evidence+'/desktop.log',text);const match=output.match(/Debugger listening on (ws:\/\/[^\s]+)/);if(match)found(match[1]);};child.stdout.on('data',log);child.stderr.on('data',log);
const url=await Promise.race([endpoint,new Promise((_,rej)=>setTimeout(()=>rej(Error('Inspector timeout')),30000))]);
ws=new WebSocket(url);await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map();let onPaused;const paused=new Promise(r=>onPaused=r);
function send(method,params={}){return new Promise((r,reject)=>{const i=++id;const timer=setTimeout(()=>{pending.delete(i);reject(Error('Desktop debugger timeout: '+method));},15000);pending.set(i,value=>{clearTimeout(timer);r(value);});ws.send(JSON.stringify({id:i,method,params}));});}
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Debugger.paused')onPaused(m.params);};
await send('Debugger.enable');await send('Runtime.runIfWaitingForDebugger');const stop=await paused;
const expression=`(()=>{const app=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron').app;app.setAsDefaultProtocolClient=()=>false;app.setPath('userData',${JSON.stringify(userData)});app.setPath('sessionData',${JSON.stringify(userData)});return {userData:app.getPath('userData'),home:process.env.DSH_HOME,version:app.getVersion(),protocolRegistrationDisabled:true}})()`;
const result=await send('Debugger.evaluateOnCallFrame',{callFrameId:stop.callFrames[0].callFrameId,expression,returnByValue:true});
if(result.result?.exceptionDetails||result.error)throw Error(JSON.stringify(result));
await writeFile(evidence+'/launch.json',JSON.stringify({pid:child.pid,...result.result.result.value},null,2));console.log(JSON.stringify(result.result.result.value));
await send('Debugger.resume');
if(sourceApp){
 const expected=JSON.parse(await readFile(sourceApp+'/package.json','utf8')).version;
 let finalState;
 for(let attempt=0;attempt<100;attempt++){
  await new Promise(r=>setTimeout(r,200));
  const check=await send('Runtime.evaluate',{expression:`(()=>{const app=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron').app;return {version:app.getVersion(),appPath:app.getAppPath(),userData:app.getPath('userData'),home:process.env.DSH_HOME}})()`,returnByValue:true});
  finalState=check.result?.result?.value;if(finalState?.version===expected)break;
 }
 if(finalState?.version!==expected){child.kill();throw Error('Source desktop identity did not initialize');}
 await writeFile(evidence+'/launch.json',JSON.stringify({pid:child.pid,...finalState,protocolRegistrationDisabled:true,sourceBuild:true},null,2));console.log(JSON.stringify(finalState));
}
ws.close();console.log('Isolated desktop resumed');
await new Promise(r=>child.on('exit',r));

} catch(error) { ws?.close(); child.kill(); throw error; }
