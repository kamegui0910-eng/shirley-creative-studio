import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { analyzePixels, MODEL, SAMPLE } from '../public/ui/visual-features.mjs';

const [input='.local/index.sqlite', cache='.local/cache', output='.local/visual-backfill.json', targetBrand='shirley-drive', sample, originalManifest] = process.argv.slice(2);
const db=new DatabaseSync(input,{readOnly:true});
const root=resolve(cache);
const dir=mkdtempSync(join(tmpdir(),'shirley-visual-'));
const assets=db.prepare(`SELECT a.tenant_id,a.asset_id,a.kind,a.version,v.cache_key FROM assets a
 LEFT JOIN asset_variants v ON v.tenant_id=a.tenant_id AND v.brand_id=a.brand_id AND v.asset_id=a.asset_id AND v.kind='preview'
 ORDER BY a.asset_id`).all();
const existing=(()=>{try{return new Map(JSON.parse(readFileSync(output,'utf8')).batch.map(row=>[row.params[2]+'|'+row.params[3]+'|'+row.params[4],row]));}catch(error){if(error.code==='ENOENT')return new Map();throw error;}})();
const originals=new Map(originalManifest?JSON.parse(readFileSync(originalManifest,'utf8')).map(row=>[row.assetId,resolve(row.path)]):[]);
const plan={ready:0,needsPrivateImage:0,failed:0,deferred:0,reused:0,originals:0};
const batch=[];
try{
 for(const row of assets){
  const original=originals.get(row.asset_id);
  if(!row.cache_key&&!original){plan.needsPrivateImage++;continue;}
  if(original)plan.originals++;
  const previous=existing.get(row.asset_id+'|'+row.version+'|'+MODEL);
  if(previous && previous.params[1]===targetBrand){batch.push(previous);plan.ready++;plan.reused++;continue;}
  if(sample&&batch.length>=Number(sample)){plan.deferred++;continue;}
  const path=original??resolve(root,row.cache_key);
  if((!original&&!path.startsWith(root+'/'))||!/\.(png|jpe?g|webp)$/i.test(path))throw Error('Unsafe image path');
  try{
   const pixels=join(dir,'pixels.raw');
   const info=join(dir,'geometry.txt');
   execFileSync('convert',[path,'-auto-orient','-format','%w %h','-write','info:'+info,
     '-resize',SAMPLE+'x'+SAMPLE+'!','-alpha','on','-depth','8','rgba:'+pixels],{stdio:'ignore',timeout:10000});
   const result=analyzePixels(readFileSync(pixels),SAMPLE,SAMPLE);
   [result.layout.width,result.layout.height]=readFileSync(info,'utf8').trim().split(/\s+/).map(Number);
   if(!result.layout.width||!result.layout.height)throw Error('Invalid image geometry');
   batch.push({sql:'INSERT INTO asset_analyses VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
    params:[row.tenant_id,targetBrand,row.asset_id,row.version,MODEL,JSON.stringify(result),new Date().toISOString()]});
   plan.ready++;
  }catch{plan.failed++;}
 }
 writeFileSync(output,JSON.stringify({batch,plan}),{mode:0o600});
 console.log(JSON.stringify({total:assets.length,...plan}));
}finally{db.close();rmSync(dir,{recursive:true,force:true});}
if(plan.failed)process.exitCode=1;
