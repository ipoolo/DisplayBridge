// IP/port matches are hints only. Rebinding requires an authenticated new pairing
// and the user's explicit choice that it replaces an older computer identity.
function rebindDevice(profile,oldId,newId){
  if(oldId===newId)return profile;
  const old=profile.devices.find(d=>d.id===oldId),next=profile.devices.find(d=>d.id===newId);
  if(!old||!next||old.os!==next.os)throw Error('不能合并不同系统或未知设备');
  const move=map=>{
    if(!map||!Object.hasOwn(map,oldId))return;
    if(Object.hasOwn(map,newId)&&map[newId]!==map[oldId])throw Error('两份设备配置存在冲突，已保留原配对，请先确认接口和通道');
    map[newId]=map[oldId];delete map[oldId];
  };
  for(const key of ['keyboardChannels','mouseChannels'])move(profile[key]);
  for(const m of profile.monitors){
    move(m.inputs);move(m.endpoints);
    if(m.cycleDeviceIds)m.cycleDeviceIds=[...new Set(m.cycleDeviceIds.map(id=>id===oldId?newId:id))];
  }
  for(const s of profile.scenes)for(const mid of Object.keys(s.assignments))if(s.assignments[mid]===oldId)s.assignments[mid]=newId;
  next.name=old.name;profile.devices=profile.devices.filter(d=>d.id!==oldId);return profile;
}
function rebindShortcuts(shortcuts,oldId,newId){return shortcuts.map(s=>s.action.deviceId===oldId?{...s,action:{...s.action,deviceId:newId}}:s);}
module.exports={rebindDevice,rebindShortcuts};
