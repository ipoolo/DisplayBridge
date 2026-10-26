const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ZipFile}=require('yazl');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),dest=path.join(root,'release/deliverables');
const version=require('../package.json').version;
fs.mkdirSync(dest,{recursive:true});
function executable(file){
  if(file.endsWith('.command')||file.endsWith('.sh'))return true;
  const fd=fs.openSync(file,'r'),magic=Buffer.alloc(4);try{fs.readSync(fd,magic,0,4,0);}finally{fs.closeSync(fd);}
  return ['cffaedfe','cefaedfe','feedfacf','feedface','cafebabe','bebafeca'].includes(magic.toString('hex'));
}
function addTree(zip,from,prefix){
  for(const e of fs.readdirSync(from,{withFileTypes:true})) {
    const full=path.join(from,e.name),name=prefix+'/'+e.name,stat=fs.lstatSync(full);
    if(stat.isSymbolicLink()){let target=fs.readlinkSync(full).replaceAll('\\','/');if(path.isAbsolute(target))target=path.relative(path.dirname(full),target).replaceAll('\\','/');zip.addBuffer(Buffer.from(target),name,{mode:0o120777});}
    else if(stat.isDirectory()){zip.addEmptyDirectory(name,{mode:0o40755});addTree(zip,full,name);}
    else zip.addFile(full,name,{mode:executable(full)?0o100755:0o100644});
  }
}
async function archive(name,entries){
  const zip=new ZipFile(),file=path.join(dest,name);
  const complete=new Promise((resolve,reject)=>{const stream=fs.createWriteStream(file);zip.outputStream.pipe(stream);zip.outputStream.on('error',reject);stream.on('error',reject);stream.on('close',resolve);});
  for(const [source,target] of entries){const full=path.join(root,source);if(fs.statSync(full).isDirectory())addTree(zip,full,target);else zip.addFile(full,target,{mode:executable(full)?0o100755:0o100644});}
  zip.end();await complete;
  const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
  const digest=hash.digest('hex');fs.writeFileSync(file+'.sha256',digest+'  '+name+'\n');console.log(JSON.stringify({file,bytes:fs.statSync(file).size,sha256:digest}));
}
(async()=>{
  const mode=process.argv[2]||'source';
  if(mode==='win')await archive(`DisplayBridge-${version}-Windows-x64.zip`,[['release/win-unpacked','DisplayBridge-Windows'],['README.md','DisplayBridge-Windows/README.md'],['LICENSE','DisplayBridge-Windows/LICENSE.DisplayBridge.txt']]);
  else if(mode==='mac')await archive(`DisplayBridge-${version}-Mac-arm64-preview.zip`,[['release/mac-cross/DisplayBridge-darwin-arm64','DisplayBridge-Mac']]);
  else {
    execFileSync(process.execPath,[path.join(__dirname,'audit-public.cjs')],{cwd:root,stdio:'inherit'});
    execFileSync('git',['diff','--exit-code'],{cwd:root,stdio:'ignore'});
    const files=execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
    await archive(`DisplayBridge-${version}-Source.zip`,files.map(p=>[p,'DisplayBridge/'+p]));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
