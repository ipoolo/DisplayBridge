const {randomUUID}=require('node:crypto');
function advance(profile,edited=false){
  profile.syncHistory=[...new Set([profile.revision,...(profile.syncHistory||[])])].slice(0,128);
  profile.revision=randomUUID();if(edited)profile.userEdited=true;return profile;
}
function pristine(profile,preferences){
  return profile.userEdited===false&&!preferences.shortcuts.length&&
    !Object.keys(profile.keyboardChannels||{}).length&&!Object.keys(profile.mouseChannels||{}).length&&
    profile.monitors.every(m=>!Object.keys(m.inputs).length);
}
function canReceive(current,incoming,{baseRevision,replace=false,bootstrap=false}){
  if(baseRevision!==current.revision)throw Error('对端配置已变化，未覆盖，请刷新后重试');
  if(current.revision===incoming.revision){
    if(JSON.stringify(current)!==JSON.stringify(incoming))throw Error('相同版本的配置内容不一致，已保留两端配置');
    return;
  }
  if(replace||bootstrap||(incoming.syncHistory||[]).includes(current.revision))return;
  throw Error('配置存在分歧或版本过旧，已保留两端配置；请在设备页选择覆盖方向');
}
module.exports={advance,pristine,canReceive};
