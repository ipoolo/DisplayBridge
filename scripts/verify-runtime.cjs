const fs=require('node:fs'),path=require('node:path');
module.exports=async context=>{
  const mac=context.electronPlatformName==='darwin';
  const root=mac?path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app','Contents','Resources','native'):path.join(context.appOutDir,'resources','native');
  for(const name of mac?['m1ddc','keyboard-probe']:['display-ddc.exe','keyboard-control.exe']){
    const file=path.join(root,name);if(!fs.existsSync(file)||!fs.statSync(file).size)throw Error('Packaged runtime component missing: '+name);
    if(mac)fs.accessSync(file,fs.constants.X_OK);
  }
};
