// Development-only test client. The application must explicitly opt into a
// loopback Chromium debugging port; never used by the packaged application.
const fs=require('node:fs');
async function evaluate(port,expression){
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid loopback port');
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target=targets.find(t=>t.type==='page'&&t.url.includes('/src/ui/index.html'));if(!target)throw Error('DisplayBridge page not found');
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  const result=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.close();reject(Error('Evaluation timed out'));},90000);
    ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Debugger connection failed'));},{once:true});
    ws.addEventListener('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})));
    ws.addEventListener('message',e=>{const data=JSON.parse(e.data);if(data.id!==1)return;clearTimeout(timer);ws.close();if(data.error||data.result?.exceptionDetails)reject(Error(JSON.stringify(data.error||data.result.exceptionDetails)));else resolve(data.result.result.value);});
  });return result;
}
module.exports={evaluate};
if(require.main===module)evaluate(Number(process.argv[2]),fs.readFileSync(process.argv[3],'utf8')).then(result=>console.log(JSON.stringify(result,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
