const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {validateProfile}=require('./core.cjs');
let backupClock=0;

// Roaming AppData can be redirected when launched by an MSIX-packaged parent.
function dataDirectory(platform,home,legacy){return platform==='win32'?path.join(home,'.displaybridge'):legacy;}
function validateSettings(value){
  if(!value?.identity?.id||!value.preferences||!Array.isArray(value.preferences.shortcuts))throw Error('配置文件格式无效');
  validateProfile(value.profile);
  if(!value.profile.devices.some(d=>d.id===value.identity.id))throw Error('配置中缺少本机');
  return value;
}
function backup(file){
  if(!fs.existsSync(file))return;
  const dir=path.join(path.dirname(file),'backups');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  backupClock=Math.max(Date.now(),backupClock+1);
  const name=path.basename(file)+'-'+new Date(backupClock).toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
  const target=path.join(dir,name);fs.copyFileSync(file,target);fs.chmodSync(target,0o600);
  const entries=fs.readdirSync(dir).filter(n=>n.startsWith(path.basename(file)+'-')).sort().reverse();
  for(const old of entries.slice(20))fs.unlinkSync(path.join(dir,old));
}
function atomic(file,value){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
  if(fs.existsSync(file)&&fs.readFileSync(file).equals(bytes))return;
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.'+randomUUID()+'.tmp';
  try{
    const fd=fs.openSync(temp,'wx',0o600);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    backup(file);fs.renameSync(temp,file);
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function loadSettings(file){
  if(fs.existsSync(file)){
    try{return {saved:validateSettings(JSON.parse(fs.readFileSync(file,'utf8')))};}catch{}
  }
  const dir=path.join(path.dirname(file),'backups');
  const entries=fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.startsWith('settings.json-')).sort().reverse():[];
  for(const entry of entries){
    let saved;try{saved=validateSettings(JSON.parse(fs.readFileSync(path.join(dir,entry),'utf8')));}catch{continue;}
    if(fs.existsSync(file)){const damaged=file+'.damaged-'+randomUUID();fs.copyFileSync(file,damaged);fs.chmodSync(damaged,0o600);}
    atomic(file,JSON.stringify(saved,null,2));
    return {saved,warning:'配置文件异常，已从最近有效备份恢复；原文件已保留'};
  }
  if(fs.existsSync(file)||entries.length)throw Error('配置文件损坏，未创建空配置。请检查配置目录中的 backups 备份');
  return {saved:{}};
}
function legacyCandidates(directories){
  const seen=new Set(),result=[];
  for(const dir of directories){
    const file=path.join(dir,'settings.json');if(!fs.existsSync(file))continue;
    // Fail visibly on damaged legacy data rather than silently creating a new identity.
    const bytes=fs.readFileSync(file),saved=validateSettings(JSON.parse(bytes.toString('utf8')));
    const signature=JSON.stringify(saved);if(seen.has(signature))continue;seen.add(signature);
    result.push({dir,saved});
  }
  return result;
}
function migrateLegacy(target,source){
  if(fs.existsSync(path.join(target,'settings.json')))return false;
  const sourceFile=path.join(source,'settings.json');
  validateSettings(JSON.parse(fs.readFileSync(sourceFile,'utf8')));
  fs.mkdirSync(target,{recursive:true,mode:0o700});
  // Windows safeStorage's encrypted key lives in Chromium's Local State. Moving
  // peers.secure without its matching key makes an otherwise valid pairing unreadable.
  const localState=path.join(source,'Local State');
  if(fs.existsSync(localState))atomic(path.join(target,'Local State'),fs.readFileSync(localState));
  // Credentials must come from the same source as the identity, never another profile.
  const peers=path.join(source,'peers.secure');if(fs.existsSync(peers))atomic(path.join(target,'peers.secure'),fs.readFileSync(peers));
  atomic(path.join(target,'settings.json'),fs.readFileSync(sourceFile));
  return true;
}
module.exports={dataDirectory,validateSettings,atomic,loadSettings,legacyCandidates,migrateLegacy};
