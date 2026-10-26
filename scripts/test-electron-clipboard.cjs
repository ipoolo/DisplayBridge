const {app,clipboard,ClipboardItem,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createClipboardAdapter}=require('../src/electron-clipboard.cjs');
app.whenReady().then(async()=>{
  const adapter=createClipboardAdapter({clipboard,ClipboardItem,nativeImage}),backup=[];
  // Read all existing representations before writing anything; abort if a format
  // cannot be backed up. Restore in finally and never print clipboard contents.
  for(const item of await clipboard.read()){const values={};for(const type of item.types)values[type]=await item.getType(type);backup.push(new ClipboardItem(values));}
  const result={platform:process.platform,text:false,image:false,restored:false};
  try{
    const marker='DisplayBridge native clipboard test · 文本';await adapter.write({kind:'text',text:marker});assert.equal((await adapter.read()).text,marker);result.text=true;
    const source=nativeImage.createFromPath(path.join(__dirname,'../assets/icon.png'));await adapter.write({kind:'image',png:source.toPNG().toString('base64')});const received=await adapter.read();assert.equal(received.kind,'image');assert.deepEqual(nativeImage.createFromBuffer(Buffer.from(received.png,'base64')).toBitmap(),source.toBitmap());result.image=true;
  }finally{if(backup.length)await clipboard.write(backup);else await clipboard.clear();result.restored=true;fs.mkdirSync(path.join(__dirname,'../artifacts'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../artifacts/native-clipboard-result.json'),JSON.stringify(result,null,2));}
  console.log(JSON.stringify(result));app.quit();
}).catch(e=>{console.error(e.message);app.exit(1);});
