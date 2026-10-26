// Electron 45 uses asynchronous ClipboardItem / Blob APIs.
function createClipboardAdapter({clipboard,ClipboardItem,nativeImage}){
  return {
    async read(){
      const items=await clipboard.read();
      if(items.some(item=>item.types.some(type=>/concealed|ExcludeClipboardContentFromMonitorProcessing/i.test(type))))return null;
      for(const item of items){
        const type=item.types.find(t=>t==='image/png')||item.types.find(t=>t==='image/jpeg');
        if(type){const blob=await item.getType(type);if(blob.size>8*1024*1024)throw Error('图片超过 8 MB');const bytes=Buffer.from(await blob.arrayBuffer()),image=nativeImage.createFromBuffer(bytes);if(!image.isEmpty())return {kind:'image',png:image.toPNG().toString('base64')};}
      }
      for(const item of items)if(item.types.includes('text/plain')){const blob=await item.getType('text/plain');if(blob.size>1024*1024)throw Error('文本超过 1 MB');const text=await blob.text();if(text)return {kind:'text',text};}
      return null;
    },
    async write(item){
      if(item.kind==='text')await clipboard.writeText(item.text);
      else{const bytes=Buffer.from(item.png,'base64');if(nativeImage.createFromBuffer(bytes).isEmpty())throw Error('图片无法解码');await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(bytes)],{type:'image/png'})})]);}
    }
  };
}
module.exports={createClipboardAdapter};
