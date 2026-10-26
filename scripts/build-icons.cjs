// Original DisplayBridge icon: two displays and a connecting arrow.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const dest=path.join(__dirname,'../assets');fs.mkdirSync(dest,{recursive:true});
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(t,b){const type=Buffer.from(t),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(b.length);sum.writeUInt32BE(crc(Buffer.concat([type,b])));return Buffer.concat([len,type,b,sum]);}
function rounded(x,y,l,t,w,h,r){const dx=Math.max(l+r-x,0,x-(l+w-r)),dy=Math.max(t+r-y,0,y-(t+h-r));return x>=l&&x<=l+w&&y>=t&&y<=t+h&&dx*dx+dy*dy<=r*r;}
function png(size){const raw=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  let color=[0,0,0,0];const u=(x+.5)*512/size,v=(y+.5)*512/size;
  if(rounded(u,v,16,16,480,480,108)){
    const f=(u+v)/1024;color=[Math.round(44-20*f),Math.round(155-63*f),Math.round(250-13*f),255];
    const screen=(l,t,w,h)=>rounded(u,v,l,t,w,h,16)&&!rounded(u,v,l+12,t+12,w-24,h-24,7);
    if(screen(82,116,218,160))color=[184,221,255,255];
    if(rounded(u,v,211,219,218,160,16))color=[32,108,239,255];
    if(screen(211,219,218,160)||rounded(u,v,303,379,32,25,2)||rounded(u,v,268,403,101,12,6))color=[255,255,255,255];
    if(rounded(u,v,139,277,104,12,6)||(u>=140&&u<=152&&v>=283&&v<=333)||(u>=140&&u<=196&&v>=327&&v<=339)||(u>=181&&u<=199&&Math.abs(v-333)<=199-u))color=[255,255,255,255];
  }
  const i=y*(size*4+1)+1+x*4;for(let c=0;c<4;c++)raw[i+c]=color[c];
}const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
fs.writeFileSync(path.join(dest,'icon.png'),png(512));
const icoImage=png(256),ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(icoImage.length,14);ico.writeUInt32LE(22,18);fs.writeFileSync(path.join(dest,'icon.ico'),Buffer.concat([ico,icoImage]));
const entries=[[128,'ic07'],[256,'ic08'],[512,'ic09']].map(([s,type])=>{const data=png(s),head=Buffer.alloc(8);head.write(type);head.writeUInt32BE(data.length+8,4);return Buffer.concat([head,data]);});const icns=Buffer.alloc(8);icns.write('icns');icns.writeUInt32BE(8+entries.reduce((n,b)=>n+b.length,0),4);fs.writeFileSync(path.join(dest,'icon.icns'),Buffer.concat([icns,...entries]));
console.log('Generated original PNG, ICO and ICNS icons.');
