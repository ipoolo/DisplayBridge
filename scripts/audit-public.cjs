// Scan both Git's index and the current tracked working files without printing secrets.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
const files=git(['ls-files','-z']).toString().split('\0').filter(Boolean);
if(!files.length)throw Error('No tracked files; stage the public allowlist before auditing.');
const forbidden=/(^|\/)(artifacts|release|node_modules|\.ssh|\.codex|\.codex-lan-bridge)(\/|$)|(^|\/)(MAC_HANDOFF\.md|settings\.json|peers\.(secure|json)|\.env(?:\..*)?)$|\.(pem|p12|pfx|key|log|dmp)$/i;
const checks=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['credential-url',/https?:\/\/[^\s/:@]{2,}:[^\s/@]{3,}@/],
  ['home-path',/(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+|(?<!https:\/\/api\.github\.com)\/Users\/[^/\s"']+|\/home\/[^/\s"']+)/],
  ['private-key-file',/id_(?:rsa|ed25519)\s*[:=]\s*["'][^"']+["']/],
];
const findings=[];
for(const file of files){
  if(forbidden.test(file))findings.push({file,rule:'excluded-file'});
  for(const [location,data] of [['index',git(['show',':'+file])],['working',fs.existsSync(path.join(root,file))?fs.readFileSync(path.join(root,file)):Buffer.alloc(0)]]){
    // Scan binary strings too; do not assume only source files can contain paths.
    for(const text of [data.toString('utf8'),data.toString('utf16le')])for(const [rule,re] of checks)if(re.test(text))findings.push({file,location,rule});
  }
}
if(findings.length){console.error(JSON.stringify({ok:false,findings},null,2));process.exitCode=1;}
else console.log(JSON.stringify({ok:true,trackedFiles:files.length,scanned:'index and working tree'}));
