const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const tree=JSON.parse(fs.readFileSync(path.join(root,'native/m1ddc-tree.json'),'utf8')).tree;
let verified=0;
for(const entry of tree){const file=path.join(root,'vendor/m1ddc',entry.path);if(entry.type!=='blob'||!fs.existsSync(file))continue;const data=fs.readFileSync(file);const hash=crypto.createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex');if(hash!==entry.sha)throw Error('Upstream hash mismatch: '+entry.path);verified++;}
if(verified<9)throw Error('Missing upstream files');console.log(`Verified ${verified} upstream files against Git commit tree.`);
