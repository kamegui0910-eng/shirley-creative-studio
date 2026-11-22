import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzePixels, MODEL, SAMPLE } from '../public/ui/visual-features.mjs';

// The operator supplies a private receipt after reading the exact files back
// from the approved Drive folder. This is a management-plane import.
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node tools/export-verified-drive-intake.mjs <verified-receipt> <private-batch>');
const receipt = JSON.parse(readFileSync(input, 'utf8'));
const isId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id);
if (!isId(receipt.folderId) || !Array.isArray(receipt.files) || !receipt.files.length || receipt.files.length > 30) throw Error('Invalid receipt');
const keys = ['studio', 'shirley-drive'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const temporary = mkdtempSync(join(tmpdir(), 'verified-drive-'));
const batch = [];
const assets = [];
const add = (sql, ...params) => batch.push({sql, params});
try {
  for (const file of receipt.files) {
    if (!isId(file.driveFileId) || typeof file.name !== 'string' || !/\.png$/i.test(file.name) ||
        file.name.length > 255 || file.mimeType !== 'image/png' || typeof file.path !== 'string') throw Error('Expected a verified PNG receipt');
    const bytes = readFileSync(file.path);
    if (bytes.length !== file.size || bytes.length < 24 || bytes.length > 25*1024*1024 ||
        bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw Error('Invalid Drive PNG');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width < 1 || height < 1 || width * height > 40000000) throw Error('Image dimensions out of range');
    const fingerprint = digest(bytes);
    const version = 'sha256:' + fingerprint;
    const id = 'a_' + digest(file.driveFileId).slice(0,32);
    const cacheKey = keys.join('/') + '/' + id + '/' + fingerprint + '.png';
    const raw = join(temporary, 'pixels.raw');
    const preview = join(temporary, 'preview.png');
    execFileSync('convert', [file.path, '-resize', SAMPLE+'x'+SAMPLE+'!', '-alpha', 'on', '-depth', '8', 'rgba:'+raw], {stdio:'ignore', timeout:15000});
    execFileSync('convert', [file.path, '-thumbnail', '240x240>', '-depth', '8', 'PNG8:'+preview], {stdio:'ignore', timeout:15000});
    const visual = analyzePixels(readFileSync(raw), SAMPLE, SAMPLE);
    visual.layout.width = width;
    visual.layout.height = height;
    const content = readFileSync(preview).toString('base64');
    if (content.length > 98304) throw Error('Preview exceeds the private cache limit');
    const now = new Date().toISOString();
    const guard = ' WHERE EXISTS (SELECT 1 FROM assets WHERE tenant_id=? AND brand_id=? AND asset_id=? AND version=?)';
    const current = [...keys,id,version];
    add("INSERT INTO assets SELECT ?,?,?,?,?,'reference',?,'unverified','pending',NULL WHERE NOT EXISTS (SELECT 1 FROM drive_intake WHERE tenant_id=? AND brand_id=? AND fingerprint=? AND asset_id<>?) ON CONFLICT DO NOTHING",
      ...keys,id,file.driveFileId,file.name,version,...keys,fingerprint,id);
    add('INSERT INTO drive_intake SELECT ?,?,?,?'+guard+' ON CONFLICT DO NOTHING',...keys,fingerprint,id,...current);
    add('INSERT INTO asset_sources SELECT ?,?,?,?,?,?'+guard+' ON CONFLICT DO NOTHING',...keys,id,'drive-connector',id,
      JSON.stringify({source:'Google Drive connector',fileId:file.driveFileId,folderId:receipt.folderId,fingerprint,mimeType:file.mimeType,size:file.size}),...current);
    add('INSERT INTO preview_cache SELECT ?,?,?,?'+guard+' ON CONFLICT DO NOTHING',...keys,cacheKey,content,...current);
    add("INSERT INTO asset_variants SELECT ?,?,?,?,'preview',NULL,?,'image/png'"+guard+' ON CONFLICT DO NOTHING',
      ...keys,id,id+':preview',cacheKey,...current);
    add('INSERT INTO asset_analyses SELECT ?,?,?,?,?,?,?'+guard+' ON CONFLICT DO NOTHING',...keys,id,version,MODEL,JSON.stringify(visual),now,...current);
    add('INSERT INTO asset_search_metadata SELECT ?,?,?,?,?,?'+guard+' ON CONFLICT DO NOTHING',...keys,id,'Private Drive upload verification',
      JSON.stringify(visual.palette.map(item=>item.hex)),file.name.replace(/[.-]/g,' '),...current);
    assets.push({id,name:file.name,fingerprint});
  }
  writeFileSync(output, JSON.stringify({folderId:receipt.folderId,batch,assets}), {mode:0o600});
  console.log(JSON.stringify({files:assets.length,statements:batch.length}));
}finally{rmSync(temporary,{recursive:true,force:true});}
