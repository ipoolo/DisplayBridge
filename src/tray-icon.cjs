const zlib=require('node:zlib');
function crc(b){let c=0xffffffff;for(const byte of b){c^=byte;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return (c^0xffffffff)>>>0;}
function chunk(t,b){const type=Buffer.from(t),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(b.length);sum.writeUInt32BE(crc(Buffer.concat([type,b])));return Buffer.concat([len,type,b,sum]);}
function createTrayIcon(template=false){
  const w=32,raw=Buffer.alloc((w*4+1)*w);
  for(let y=0;y<w;y++)for(let x=0;x<w;x++){
    const screen=((x>=3&&x<=20&&y>=6&&y<=21)&&(x<5||x>18||y<8||y>19))||((x>=12&&x<=29&&y>=11&&y<=26)&&(x<14||x>27||y<13||y>24));
    const i=y*(w*4+1)+1+x*4;raw[i]=template?0:37;raw[i+1]=template?0:112;raw[i+2]=template?0:235;raw[i+3]=screen?255:0;
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(w,0);header.writeUInt32BE(w,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
module.exports={createTrayIcon};
