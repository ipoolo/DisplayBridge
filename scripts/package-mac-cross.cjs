// Packages the JavaScript application on Windows. Native DDC is compiled on first Mac launch.
const fs=require('node:fs'),path=require('node:path');
function copyTree(from,to){fs.mkdirSync(to,{recursive:true});for(const e of fs.readdirSync(from,{withFileTypes:true})){const src=path.join(from,e.name),dest=path.join(to,e.name);if(e.isDirectory())copyTree(src,dest);else fs.copyFileSync(src,dest);}}
(async()=>{
  const {packager}=await import('@electron/packager');
  const root=path.join(__dirname,'..'),stage=path.join(root,'artifacts/mac-staging');
  fs.mkdirSync(stage,{recursive:true});
  copyTree(path.join(root,'src'),path.join(stage,'src'));
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,main:pkg.main,description:pkg.description,author:pkg.author,license:pkg.license}));
  const native=path.join(root,'artifacts/native-source');fs.mkdirSync(native,{recursive:true});
  fs.copyFileSync(path.join(root,'native/macos/DisplayDdc.m'),path.join(native,'DisplayDdc.m'));
  for(const dir of ['headers','sources'])copyTree(path.join(root,'vendor/m1ddc',dir),path.join(native,'vendor',dir));
  fs.copyFileSync(path.join(root,'vendor/m1ddc/LICENSE'),path.join(native,'vendor/LICENSE'));
  const outputs=await packager({dir:stage,name:'DisplayBridge',platform:'darwin',arch:'arm64',electronVersion:pkg.devDependencies.electron,appBundleId:'local.displaybridge.app',appVersion:pkg.version,buildVersion:pkg.version,appCategoryType:'public.app-category.utilities',out:path.join(root,'release/mac-cross'),overwrite:true,asar:true,prune:false,osxSign:false,extraResource:[native,path.join(root,'THIRD_PARTY_NOTICES.md')],download:{mirrorOptions:{mirror:'https://npmmirror.com/mirrors/electron/',customDir:'{{ version }}'},checksums:require('../node_modules/electron/checksums.json')}});
  for(const output of outputs){fs.copyFileSync(path.join(root,'scripts/Mac 首次启动.command'),path.join(output,'Mac 首次启动.command'));fs.copyFileSync(path.join(root,'README.md'),path.join(output,'README.md'));}
  console.log(outputs);
})().catch(e=>{console.error(e);process.exitCode=1;});
