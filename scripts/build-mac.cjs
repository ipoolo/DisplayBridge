const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
if(process.platform!=='darwin'){console.error('Mac 控制组件必须在 macOS 上构建。');process.exit(1);}
if(process.arch!=='arm64'){console.error('本版本要求 Apple Silicon Mac，请使用原生 ARM64 Node.js。');process.exit(1);}
const root=path.join(__dirname,'..'),vendor=path.join(root,'vendor/m1ddc');
const output=path.join(root,'native/bin');fs.mkdirSync(output,{recursive:true});
const args=['clang','-arch','arm64','-mmacosx-version-min=13.0','-O2','-fmodules','-DMAX_DISPLAYS=16','-I',path.join(vendor,'headers'),path.join(root,'native/macos/DisplayDdc.m'),path.join(vendor,'sources/i2c.m'),path.join(vendor,'sources/ioregistry.m'),'-framework','Foundation','-framework','IOKit','-framework','CoreGraphics','-framework','ApplicationServices','-framework','CoreDisplay','-o',path.join(output,'m1ddc')];
const result=spawnSync('xcrun',args,{stdio:'inherit'});if(result.error)console.error(result.error.message);if(result.status!==0)process.exit(1);
fs.copyFileSync(path.join(vendor,'LICENSE'),path.join(output,'m1ddc-LICENSE.txt'));
fs.chmodSync(path.join(output,'m1ddc'),0o755);console.log('Apple Silicon 控制组件构建完成。');
const keyboard=spawnSync('xcrun',['clang','-arch','arm64','-mmacosx-version-min=13.0','-O2','-fobjc-arc',path.join(root,'native/macos/KeyboardProbe.m'),'-framework','Foundation','-framework','IOKit','-o',path.join(output,'keyboard-probe')],{stdio:'inherit'});
if(keyboard.error)console.error(keyboard.error.message);if(keyboard.status!==0)process.exit(1);
fs.chmodSync(path.join(output,'keyboard-probe'),0o755);console.log('键盘与鼠标控制组件构建完成。');
