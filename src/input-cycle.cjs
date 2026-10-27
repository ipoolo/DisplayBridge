// Resolve one shared target from the mouse; never run two independent cycles.
async function cycleInputs(service,keyboard,mouse){
  const revision=service.profile.revision;
  const ids=[service.identity.id,...service.peers.filter(p=>service.online().has(p.id)).map(p=>p.id)];
  const checks=await Promise.all([keyboard,mouse].map(controller=>Promise.all(ids.map(async id=>{
    try{return await controller.status(id);}catch{return {deviceId:id};}
  }))));
  const controllers=[keyboard,mouse],sources=[];
  for(let i=0;i<2;i++){
    const label=i?'鼠标':'键盘',attached=checks[i].filter(s=>s.probe?.status==='ready');
    if(attached.length!==1)throw Error(label+'当前连接无法唯一确认，请唤醒设备并重新检测');
    const source=attached[0];
    if(source.probe.currentChannel!==controllers[i].channel(source.deviceId))throw Error(label+'当前通道与配置不一致');
    if(!source.manualSwitch)throw Error('请更新'+label+'当前连接电脑的屏间版本');
    sources.push(source);
  }
  const order=service.profile.devices.filter(d=>Number.isInteger(mouse.channel(d.id))).sort((a,b)=>mouse.channel(a.id)-mouse.channel(b.id));
  const current=order.findIndex(d=>d.id===sources[1].deviceId);
  if(current<0)throw Error('鼠标当前电脑未配置');
  let target;
  for(let step=1;step<order.length;step++){
    const candidate=order[(current+step)%order.length];
    if(service.online().has(candidate.id)&&Number.isInteger(keyboard.channel(candidate.id))){target=candidate;break;}
  }
  if(!target)throw Error('没有其他在线且键盘、鼠标通道均已配置的电脑');
  if(checks.some(list=>!list.find(s=>s.deviceId===target.id)?.manualSwitch))throw Error('目标电脑未响应键鼠控制，请检查连接与版本');
  if(revision!==service.profile.revision)throw Error('键鼠配置已变化，请重试');
  const results=await Promise.all(controllers.map(async(controller,i)=>{
    try{return await controller.manual({type:controller.kind+'-switch',deviceId:target.id},{revision,sourceDeviceId:sources[i].deviceId});}
    catch(e){return {status:'failed',message:e.message};}
  }));
  const confirmed=results.every(r=>r.status==='confirmed');
  return {status:confirmed?'confirmed':'failed',targetDeviceId:target.id,keyboard:results[0],mouse:results[1],message:confirmed?'键盘与鼠标已同步切换到 '+target.name:
    '键鼠同步切换未全部完成：'+results.map((r,i)=>(i?'鼠标':'键盘')+(r.status==='confirmed'?'已确认':'失败（'+r.message+'）')).join('；')};
}
module.exports={cycleInputs};
