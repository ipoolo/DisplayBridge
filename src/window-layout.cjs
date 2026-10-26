const {cleanName}=require('./core.cjs');
function sameBounds(a,b){return a&&b&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<=2);}
function linkDisplays(local,displays){
  const bindings={};
  for(const n of local){
    let matches=n.displayId!=null?displays.filter(d=>String(d.id)===String(n.displayId)):[];
    if(!matches.length&&n.bounds)matches=displays.filter(d=>sameBounds(n.bounds,d.physicalBounds||d.bounds));
    if(!matches.length&&cleanName(n.name))matches=displays.filter(d=>cleanName(d.label)===cleanName(n.name));
    if(matches.length===1&&!Object.values(bindings).includes(matches[0].id))bindings[n.id]=matches[0].id;
  }
  return bindings;
}
function relocationTarget({profile,states,identityId,bindings,currentDisplayId,assignments={},displays}){
  const displayFor=m=>bindings[m.endpoints[identityId]];
  const current=profile.monitors.find(m=>displayFor(m)===currentDisplayId);if(!current)return null;
  const leaving=Object.hasOwn(assignments,current.id)?assignments[current.id]!==identityId:states[current.id]?.confirmed&&states[current.id]?.deviceId&&states[current.id].deviceId!==identityId;
  if(!leaving)return null;
  const target=profile.monitors.find(m=>m.id!==current.id&&states[m.id]?.confirmed&&states[m.id].deviceId===identityId&&(!Object.hasOwn(assignments,m.id)||assignments[m.id]===identityId)&&displays.some(d=>d.id===displayFor(m)));
  return target?displays.find(d=>d.id===displayFor(target)):null;
}
function fitWindow(bounds,workArea){
  const width=Math.min(bounds.width,workArea.width),height=Math.min(bounds.height,workArea.height);
  return {x:Math.round(workArea.x+(workArea.width-width)/2),y:Math.round(workArea.y+(workArea.height-height)/2),width,height};
}
module.exports={linkDisplays,relocationTarget,fitWindow};
