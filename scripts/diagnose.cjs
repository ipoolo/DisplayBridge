const fs=require('node:fs');
const path=require('node:path');
const {NativeBackend}=require('../src/native.cjs');
(async()=>{
  const backend=new NativeBackend(path.join(__dirname,'../native/bin'));
  const report={platform:process.platform,time:new Date().toISOString(),monitors:await backend.scan(true)};
  const dir=path.join(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'hardware-probe.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
