import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openIndex } from '../tools/import.mjs';
import { sqliteBinding } from '../tools/dev.mjs';
import worker,{tokenDigest} from '../src/worker.mjs';
import { analyzePixels } from '../public/ui/visual-features.mjs';
import { fileFingerprint,uploadDrive } from '../public/ui/drive-upload.mjs';

const pixel=()=>({...analyzePixels(new Uint8Array([242,155,177,255,10,10,10,255]),2,1),layout:{width:200,height:100,density:Array(16).fill(.1)}});
test('Drive resumable chunk query resumes at confirmed byte and never opens an unrelated origin',async()=>{
  const f=new File([new Uint8Array(1048596)],'test.png',{type:'image/png'});
  const fingerprint=await fileFingerprint(f);
  const session='https://www.googleapis.com/upload/drive/v3/files?upload_id=test-id';
  const calls=[];
  const progress=[];
  const result=await uploadDrive(f,{token:'mock',folder:'mock-folder',fingerprint,resume:session,
    checkpoint:()=>assert.fail('should not open a new session'),progress:value=>progress.push(value),
    fetcher:async(url,init)=>{
      calls.push([url,init.headers['Content-Range'],init.body.size]);
      return calls.length===1?new Response(null,{status:308,headers:{Range:'bytes=0-1048575'}}):Response.json({id:'uploaded'});
    }});
  assert.equal(result.id,'uploaded');
  assert.deepEqual(calls,[[session,'bytes */1048596',0],[session,'bytes 1048576-1048595/1048596',20]]);
  assert.deepEqual(progress,[f.size]);
  await assert.rejects(uploadDrive(f,{resume:'https://example.invalid/upload?upload_id=bad'}),/Unexpected/);
});

test('Verified Drive receipt, dedupe, versioned analysis, contextual search and tenant denial',async()=>{
  const db=openIndex(':memory:');
  db.exec("INSERT INTO brands VALUES ('studio','shirley-drive','{}'),('other','shirley-drive','{}')");
  const writer='test-intake-writer-secret',other='test-other-tenant-secret';
  const fingerprint='a'.repeat(64);
  const env={DB:sqliteBinding(db),DESIGN_UPLOAD_FOLDER:'test-folder',DESIGN_PRINCIPALS:JSON.stringify({
    [await tokenDigest(writer)]:{tenantId:'studio',brandId:'shirley-drive',write:true},
    [await tokenDigest(other)]:{tenantId:'other',brandId:'shirley-drive',write:true}
  }),DRIVE_FETCH:async(url,options)=>{
    assert.equal(url.origin,'https://www.googleapis.com');
    assert.equal(options.headers.Authorization,'Bearer testing-credential-for-google');
    return Response.json({id:'verified-file',name:'粉色窗口边框.png',version:'3',size:'120',mimeType:'image/png',parents:['test-folder'],appProperties:{shirleySha256:fingerprint}});
  }};
  const get=(path,{method='GET',token=writer,body,headers={}}={})=>worker.fetch(new Request('https://preview.invalid'+path,{
    method,headers:{Authorization:'Bearer '+token,...headers},body:body===undefined?undefined:JSON.stringify(body)
  }),env);
  try{
    const body={driveFileId:'verified-file',fingerprint};
    const headers={'X-Drive-Access-Token':'testing-credential-for-google'};
    assert.equal((await get('/intake/register',{method:'POST',body,headers,token:other})).status,503);
    const first=await get('/intake/register',{method:'POST',body,headers});
    assert.equal(first.status,201);
    const {assetId}=await first.json();
    const duplicate=await get('/intake/register',{method:'POST',body,headers});
    assert.deepEqual(await duplicate.json(),{assetId,duplicate:true});
    assert.equal(db.prepare('SELECT count(*) n FROM assets').get().n,1);
    assert.equal((await get('/assets/'+assetId+'/analysis',{token:other})).status,404);
    const status=await(await get('/assets/'+assetId+'/analysis')).json();
    assert.equal(status.status,'pending');
    const put=(fileVersion)=>get('/assets/'+assetId+'/analysis',{method:'PUT',body:{fileVersion,result:pixel()}});
    assert.equal((await put('2')).status,409);
    assert.equal((await put('3')).status,201);
    assert.equal((await put('3')).status,200);
    const saved=await(await get('/assets/'+assetId+'/analysis')).json();
    assert.equal(saved.result.typography.status,'unverified');
    assert.equal(saved.result.colorTokens['--sample-1'],'#f29bb1');
    const search=async body=>(await(await get('/assets/recommend',{method:'POST',body})).json()).items;
    const [firstHit]=await search({q:'找粉色窗口',visual:pixel()});
    assert.equal(firstHit.assetId,assetId);
    assert.ok(firstHit.signals.text>0&&firstHit.signals.layout>0&&firstHit.signals.color>0);
    assert.deepEqual(await search({q:'窗口',purpose:'commercial'}),[]);
    const dna=await get('/design-dna',{method:'PUT',body:{weights:{text:.4,color:.25,layout:.25,brand:.1},styleIds:[],palette:['#f29bb1']}});
    assert.equal(dna.status,200);
    assert.deepEqual((await(await get('/design-dna',{token:other})).json()).effective.palette,[]);
  }finally{ db.close(); }
});
