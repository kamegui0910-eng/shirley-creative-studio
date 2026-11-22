import { MODEL } from '../public/ui/visual-features.mjs';

const ink = /^#[0-9a-f]{6}$/i;
const fingerprintPattern = /^[0-9a-f]{64}$/;
const driveIdPattern = /^[a-zA-Z0-9_-]{1,160}$/;
const rgb = hex => hex.slice(1).match(/../g).map(x=>Number.parseInt(x,16));
export const DEFAULT_DNA = Object.freeze({ weights:{ text:.40,color:.25,layout:.25,brand:.10 }, styleIds:[], palette:[] });

export function visualGeometry(document) {
  if (document?.model!==MODEL || !Array.isArray(document.palette) || document.palette.length>6 ||
      document.palette.some(color=>!ink.test(color?.hex??'') || !Number.isFinite(color.share) || color.share<0 || color.share>1)) return null;
  const {width,height,density}=document.layout??{};
  if (![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=32768) ||
      !Array.isArray(density) || density.length!==16 || density.some(n=>!Number.isFinite(n)||n<0||n>1)) return null;
  const palette=document.palette.map(({hex,share})=>({hex:hex.toLowerCase(),share}));
  return { model:MODEL, palette, colorTokens:Object.fromEntries(palette.map(({hex},i)=>['--sample-'+(i+1),hex])), layout:{width,height,density},
    typography:{status:'unverified'},components:{status:'unverified'} };
}
const normalized = values => {
  const n=Object.values(values).reduce((a,b)=>a+b,0);
  return Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value/n]));
};
function words(value) {
  const words=value.toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]+/gu)??[];
  return [...new Set(words.flatMap(word=>{
    const chars=[...word];
    if (!/\p{Script=Han}/u.test(word) || chars.length<=2) return [word];
    return chars.slice(0,-1).map((char,i)=>char+chars[i+1]);
  }).filter(word=>!['a','an','the','with','of','and','for'].includes(word)))];
}
function colorFit(a,b) {
  if(!a.length||!b.length) return 0;
  const target=b.map(x=>rgb(x.hex));
  const weight=a.reduce((sum,x)=>sum+x.share,0);
  return weight ? a.reduce((sum,x)=>{
    const src=rgb(x.hex);
    return sum+x.share*Math.max(...target.map(t=>1-Math.hypot(...src.map((v,i)=>v-t[i]))/442));
  },0)/weight : 0;
}
export function rankVisual(row, query, dna=DEFAULT_DNA) {
  const visual=row.result?JSON.parse(row.result):null;
  const haystack=(row.name+' '+(row.summary??'')+' '+(row.keywords??'')+' '+(row.styleIds??'')).toLowerCase();
  const terms=words(query.q??'');
  const queryPalette=query.visual?.palette??dna.palette.map(hex=>({hex,share:1}));
  const styleIds=JSON.parse(row.styleIds??'[]');
  const sources={
    text:terms.length ? terms.filter(term=>haystack.includes(term)).length/terms.length : null,
    color:queryPalette.length ? colorFit(queryPalette,visual?.palette??JSON.parse(row.colors??'[]').map(hex=>({hex,share:1}))) : null,
    layout:query.visual ? (visual ? (1-visual.layout.density.reduce((sum,x,i)=>sum+Math.abs(x-query.visual.layout.density[i]),0)/16) /
      (1+Math.abs(Math.log((visual.layout.width/visual.layout.height)/(query.visual.layout.width/query.visual.layout.height)))) : 0) : null,
    brand:dna.styleIds.length?Number(dna.styleIds.some(id=>styleIds.includes(id))):null
  };
  const weights=normalized(Object.fromEntries(Object.entries(dna.weights).filter(([key])=>sources[key]!==null)));
  const scores=Object.fromEntries(Object.entries(weights).map(([key,w])=>[key,Number((w*sources[key]).toFixed(4))]));
  return {assetId:row.asset_id,name:row.name,rights:row.rights,score:Math.min(1,Number(Object.values(scores).reduce((a,b)=>a+b,0).toFixed(4))),signals:scores};
}
async function driveFile(fileId, accessToken, fetcher) {
  const url=new URL('https://www.googleapis.com/drive/v3/files/'+fileId);
  url.searchParams.set('fields','id,name,version,size,mimeType,parents,trashed,appProperties');
  const result=await fetcher(url,{headers:{Authorization:'Bearer '+accessToken},redirect:'error',signal:AbortSignal.timeout(10000)});
  return result.ok?result.json():null;
}

export async function intelligence(request, env, url, scope, {select,one,all,json,failure,boundedJSON}) {
  const path=url.pathname;
  const keys=[scope.tenantId,scope.brandId];
  const configuredFolder=scope.tenantId==='studio'&&scope.brandId===(env.DESIGN_UPLOAD_BRAND??'shirley-drive')?env.DESIGN_UPLOAD_FOLDER:null;
  const isWrite=request.method==='PUT'||(request.method==='POST'&&path!=='/assets/recommend');
  const assetMatch=path.match(/^\/assets\/([\w-]+)\/analysis$/);
  if (!assetMatch && !['/assets/recommend','/design-dna','/intake/config','/intake/register','/intake/dedupe'].includes(path)) return;
  if (isWrite && scope.write!==true) return failure('Write forbidden',403);
  const dna=async()=> {
    const row=await one('SELECT configuration FROM design_dna WHERE tenant_id=? AND brand_id=?',...keys);
    return row?JSON.parse(row.configuration):DEFAULT_DNA;
  };
  if (request.method==='GET') {
    if(path==='/design-dna') return json({global:DEFAULT_DNA,effective:await dna()});
    if(path==='/intake/config'){
      const enabled=scope.write===true&&Boolean(configuredFolder);
      const clientId=env.DESIGN_DRIVE_CLIENT_ID;
      const picker=[env.DESIGN_DRIVE_PICKER_KEY,env.DESIGN_DRIVE_APP_ID];
      const validPicker=/^[A-Za-z0-9_-]{20,120}$/.test(picker[0]??'')&&/^\d{5,24}$/.test(picker[1]??'');
      const oauth=enabled&&/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId??'')
        ?{clientId,...(validPicker?{picker:{key:picker[0],appId:picker[1]}}:{})}:null;
      return json({enabled,folder:enabled?configuredFolder:null,...(oauth?{oauth}:{})});
    }
    if(path==='/intake/dedupe'){
      const hash=url.searchParams.get('fingerprint')??'';
      if(!fingerprintPattern.test(hash)) return failure('Invalid fingerprint',400);
      const row=await one('SELECT asset_id AS assetId FROM drive_intake WHERE tenant_id=? AND brand_id=? AND fingerprint=?',...keys,hash);
      return json({assetId:row?.assetId??null});
    }
    if(assetMatch){
      const record=await one('SELECT version FROM assets WHERE tenant_id=? AND brand_id=? AND asset_id=?',...keys,assetMatch[1]);
      if(!record) return failure('Asset not found',404);
      const work=await one('SELECT result FROM asset_analyses WHERE tenant_id=? AND brand_id=? AND asset_id=? AND file_version=? AND model_version=?',...keys,assetMatch[1],record.version,MODEL);
      return json({status:work?'ready':'pending',result:work?visualGeometry(JSON.parse(work.result)):null,fileVersion:record.version,modelVersion:MODEL});
    }
    return failure('Method not allowed',405);
  }
  if(!['PUT','POST'].includes(request.method)) return failure('Method not allowed',405);
  let body;
  try {body=await boundedJSON(request);} catch {return failure('Invalid request body',400);}
  if(path==='/design-dna'&&request.method==='PUT'){
    const {weights,styleIds,palette}=body??{};
    if(!weights||!Array.isArray(styleIds)||styleIds.length>12||styleIds.some(k=>typeof k!=='string'||!/^[-\w]{1,100}$/.test(k))||
      !Array.isArray(palette)||palette.length>12||palette.some(c=>!ink.test(c))||
      Object.keys(DEFAULT_DNA.weights).some(k=>!Number.isFinite(weights[k])||weights[k]<0.01||weights[k]>1)) return failure('Invalid DNA settings',400);
    const canonical={weights:normalized(Object.fromEntries(Object.keys(DEFAULT_DNA.weights).map(k=>[k,weights[k]]))),styleIds,palette};
    await one('INSERT INTO design_dna VALUES (?,?,?) ON CONFLICT(tenant_id,brand_id) DO UPDATE SET configuration=excluded.configuration RETURNING brand_id',...keys,JSON.stringify(canonical));
    return json(canonical);
  }
  if(assetMatch&&request.method==='PUT'){
    const data=visualGeometry(body?.result);
    if(!data||typeof body?.fileVersion!=='string') return failure('Invalid analysis',400);
    const asset=await one('SELECT version FROM assets WHERE tenant_id=? AND brand_id=? AND asset_id=?',...keys,assetMatch[1]);
    if(!asset) return failure('Asset not found',404);
    if(asset.version!==body.fileVersion) return failure('Asset version changed',409);
    const insert=await one('INSERT INTO asset_analyses VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING asset_id',...keys,assetMatch[1],asset.version,MODEL,JSON.stringify(data),new Date().toISOString());
    return json({stored:Boolean(insert),modelVersion:MODEL},insert?201:200);
  }
  if(path==='/assets/recommend'&&request.method==='POST'){
    const q=body?.q??'';
    const visual=body?.visual===undefined?null:visualGeometry(body.visual);
    const wantsCommercial=body?.purpose==='commercial';
    if(typeof q!=='string'||q.length>160||(body?.visual!==undefined&&!visual)||(!q.trim()&&!visual)||
      (body?.purpose!==undefined&&!['internal','commercial'].includes(body.purpose))) return failure('Invalid recommendation query',400);
    const rows=await all(`SELECT a.asset_id,a.name,a.rights,m.colors,m.summary,m.keywords,x.result,
      (SELECT json_group_array(style_id) FROM asset_tags t WHERE t.tenant_id=a.tenant_id AND t.brand_id=a.brand_id AND t.asset_id=a.asset_id AND style_id IS NOT NULL) AS styleIds
      FROM assets a LEFT JOIN asset_search_metadata m USING(tenant_id,brand_id,asset_id)
      LEFT JOIN asset_analyses x ON x.tenant_id=a.tenant_id AND x.brand_id=a.brand_id AND x.asset_id=a.asset_id AND x.file_version=a.version AND x.model_version=?
      WHERE a.tenant_id=? AND a.brand_id=? AND (a.rights<>'restricted') AND (?=0 OR a.rights='commercial_ready') LIMIT 501`,MODEL,...keys,Number(wantsCommercial));
    const config=await dna();
    return json({model:MODEL,exhaustive:rows.length<=500,items:rows.slice(0,500)
      .filter(row=>!visual||row.result).map(row=>rankVisual(row,{q,visual},config)).filter(row=>row.score>0)
      .sort((a,b)=>b.score-a.score||a.assetId.localeCompare(b.assetId)).slice(0,24)});
  }
  if(path==='/intake/register'&&request.method==='POST'){
    if(!configuredFolder) return failure('Drive intake folder is not configured',503);
    const access=request.headers.get('X-Drive-Access-Token');
    const {driveFileId,fingerprint}=body??{};
    if(!access||!/^[-_.~a-zA-Z0-9]{20,2048}$/.test(access)||!driveIdPattern.test(driveFileId??'')||!fingerprintPattern.test(fingerprint??''))
      return failure('Missing Drive upload receipt or credential',400);
    const old=await one('SELECT asset_id AS assetId FROM drive_intake WHERE tenant_id=? AND brand_id=? AND fingerprint=?',...keys,fingerprint);
    if(old) return json({...old,duplicate:true});
    const file=await driveFile(driveFileId,access,env.DRIVE_FETCH??fetch);
    if(!file||file.id!==driveFileId||file.trashed||!file.parents?.includes(configuredFolder)||file.appProperties?.shirleySha256!==fingerprint||
      typeof file.name!=='string'||!file.name||file.name.length>255||!/^image\/(png|jpe?g|webp)$/i.test(file.mimeType??'')||
      !Number.isSafeInteger(Number(file.size))||Number(file.size)<1||Number(file.size)>26214400) return failure('Drive receipt could not be verified',422);
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(file.id));
    const id='a_'+[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
    const statements=[
      select("INSERT INTO assets SELECT ?,?,?,?,?,'reference',?,'unverified','pending',NULL WHERE NOT EXISTS (SELECT 1 FROM drive_intake WHERE tenant_id=? AND brand_id=? AND fingerprint=?) ON CONFLICT DO NOTHING",...keys,id,file.id,file.name,String(file.version??'1'),...keys,fingerprint),
      select("INSERT INTO drive_intake VALUES (?,?,?,?) ON CONFLICT DO NOTHING",...keys,fingerprint,id)
    ];
    const [insert]=await env.DB.batch(statements);
    const saved=await one('SELECT asset_id AS assetId FROM drive_intake WHERE tenant_id=? AND brand_id=? AND fingerprint=?',...keys,fingerprint);
    const created=Number(insert.meta?.changes??insert.changes??0)>0;
    return json({...saved,duplicate:!created},created?201:200);
  }
  return failure('Method not allowed',405);
}
