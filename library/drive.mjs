// Drive originals and immutable sidecars; OAuth tokens are read only at request time.
export const DRIVE_FILE_SCOPE='https://www.googleapis.com/auth/drive.file';
export const DRIVE_READONLY_SCOPE='https://www.googleapis.com/auth/drive.readonly';
export const LIBRARY_MARKER='shirley-assets-v1';
const API='https://www.googleapis.com/drive/v3/';
const UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
const FIELDS='id,name,mimeType,size,md5Checksum,modifiedTime,appProperties';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_ID=/^[A-Za-z0-9_-]{1,200}$/;
const SAMPLE_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const CHUNK=2*1024*1024;
const JSON_LIMIT=2*1024*1024;
const EXT_MIME={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',gif:'image/gif',avif:'image/avif',tif:'image/tiff',tiff:'image/tiff',mp4:'video/mp4',mov:'video/quicktime',m4v:'video/x-m4v',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo',wmv:'video/x-ms-wmv',mpeg:'video/mpeg',mpg:'video/mpeg',ts:'video/mp2t',mts:'video/mp2t',m2ts:'video/mp2t','3gp':'video/3gpp'};
const mediaMime=file=>/^(image|video)\//i.test(file?.type||'')?file.type.toLowerCase():EXT_MIME[String(file?.name||'').split('.').at(-1).toLowerCase()]||'';
export class DriveError extends Error{
 constructor(code,message,status=0){super(message);this.name='DriveError';this.code=code;this.status=status;}
}
const fail=(code,message,status=0)=>new DriveError(code,message,status);
const assertId=id=>{if(!FILE_ID.test(String(id||'')))throw fail('invalid','Drive 文件编号无效');return String(id)};
const assertUUID=(id,label)=>{if(!UUID.test(String(id||'')))throw fail('invalid',label+'须为 UUID');return String(id)};
const memoryStore=()=>{const m=new Map();return {get:k=>m.get(k),put:(k,v)=>m.set(k,structuredClone(v)),remove:k=>m.delete(k)}};
const canonical=v=>JSON.stringify(v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])));
function metadata(v){
 if(!v?.id)throw fail('response','Drive 未返回文件编号，尚不能确认成功');
 const n=Number(v.size);
 return {fileId:assertId(v.id),id:v.id,name:String(v.name||''),mimeType:String(v.mimeType||''),size:Number.isSafeInteger(n)&&n>=0?n:v.size??null,md5Checksum:v.md5Checksum||null,modifiedTime:v.modifiedTime||null};
}
function sessionURL(value){
 let u;try{u=new URL(value)}catch{throw fail('session','上传恢复地址无效')}
 if(u.protocol!=='https:'||u.hostname!=='www.googleapis.com'||u.port||u.username||u.password||u.hash||!/^\/upload\/drive\/v3\/files(?:\/[A-Za-z0-9_-]+)?$/.test(u.pathname)||u.searchParams.get('uploadType')!=='resumable'||!u.searchParams.get('upload_id'))throw fail('session','上传恢复地址不属于 Google Drive');
 return u.href;
}
function received(response,total){
 const value=response.headers.get('Range');
 if(!value)return 0;
 const m=/^bytes=0-(\d+)$/i.exec(value);
 if(!m||!Number.isSafeInteger(Number(m[1]))||Number(m[1])+1>total)throw fail('response','Drive 上传进度响应无效');
 return Number(m[1])+1;
}
export class DriveLibrary{
 constructor({token,fetcher=globalThis.fetch.bind(globalThis),folderId='',sessionStore=memoryStore(),onProgress=()=>{}}={}){
  if(typeof token!=='function')throw fail('config','需要当前 Google 授权读取函数');
  this.token=token;this.fetcher=fetcher;this.folderId=folderId?assertId(folderId):'';this.sessionStore=sessionStore;this.onProgress=onProgress;this.inflight=new Map();this.folderPending=null;
  if(!sessionStore||!['get','put','remove'].every(k=>typeof sessionStore[k]==='function'))throw fail('config','上传恢复存储接口无效');
 }
 async _fetch(url,options={}){
  const token=this.token();if(!token)throw fail('auth','Google 授权已失效，请重新连接',401);
  try{return await this.fetcher(url,{...options,headers:{...options.headers,Authorization:'Bearer '+token},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(90000)})}
  catch(e){if(e instanceof DriveError)throw e;throw fail('network','Drive 网络请求未确认；恢复时将先核对服务器进度')}
 }
 async _checked(response){
  if(response.status===401)throw fail('auth','Google 授权已过期或被撤销，请重新连接',401);
  if(response.status===403)throw fail('forbidden','Drive 权限不足、存储已满或额度受限；原件与恢复记录保留',403);
  if(response.status===429)throw fail('rate-limit','Drive 请求过于频繁，请稍后重试；恢复记录保留',429);
  if(!response.ok)throw fail(response.status>=500?'server':'http','Drive 请求未完成（'+response.status+'）',response.status);
  return response;
 }
 async _json(path,{query={},method='GET',body}={}){
  const u=new URL(path,API);for(const [k,v]of Object.entries(query))u.searchParams.set(k,String(v));
  const r=await this._checked(await this._fetch(u.href,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}));
  try{return await r.json()}catch{throw fail('response','Drive 返回的资料格式无效')}
 }
 async account(){return this._json('about',{query:{fields:'user(emailAddress,permissionId,displayName),storageQuota,maxUploadSize'}})}
 async _getFile(id,missing=false){
  const u=new URL('files/'+assertId(id),API);u.searchParams.set('fields',FIELDS+',trashed,capabilities(canAddChildren)');
  const r=await this._fetch(u.href);if(missing&&r.status===404)return null;await this._checked(r);
  try{return await r.json()}catch{throw fail('response','Drive 文件资料格式无效')}
 }
 async _list(q){
  let pageToken='',all=[];const seen=new Set();
  do{
   const p={q,pageSize:1000,fields:'nextPageToken,incompleteSearch,files('+FIELDS+')'};
   if(pageToken)p.pageToken=pageToken;
   const data=await this._json('files',{query:p});
   if(data.incompleteSearch||!Array.isArray(data.files))throw fail('incomplete','Drive 列表未完整读取；未用部分资料替换缓存');
   all.push(...data.files);pageToken=data.nextPageToken||'';
   if(pageToken&&seen.has(pageToken))throw fail('incomplete','Drive 分页重复；未用部分资料替换缓存');
   if(pageToken)seen.add(pageToken);
  }while(pageToken);
  return all;
 }
 async ensureFolder(){
  if(this.folderPending)return this.folderPending;
  this.folderPending=(async()=>{
   if(this.folderId){
    const f=await this._getFile(this.folderId);
    if(f.mimeType!=='application/vnd.google-apps.folder'||f.trashed)throw fail('folder','配置的素材库文件夹不可用');
    if(f.capabilities?.canAddChildren===false)throw fail('forbidden','当前账号不能向素材库文件夹上传',403);
    return this.folderId;
   }
   const matches=await this._list("trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '"+LIBRARY_MARKER+"'");
   if(matches.length>1)throw fail('folder','发现多个同名素材库，请在设置中指定文件夹编号');
   if(matches.length===1){this.folderId=assertId(matches[0].id);return this.folderId}
   const ids=await this._json('files/generateIds',{query:{count:1,space:'drive'}});
   const id=assertId(ids.ids?.[0]);
   try{await this._json('files',{method:'POST',query:{fields:'id'},body:{id,name:LIBRARY_MARKER,mimeType:'application/vnd.google-apps.folder',appProperties:{library:LIBRARY_MARKER}}})}
   catch(e){if(e.status!==409)throw e;const f=await this._getFile(id);if(f.mimeType!=='application/vnd.google-apps.folder')throw fail('conflict','素材库创建结果冲突')}
   this.folderId=id;return id;
  })().finally(()=>{this.folderPending=null});
  return this.folderPending;
 }
 _emit(state,sent,callback,phase='uploading'){
  const value={assetId:state.assetId,fileId:state.fileId,sent,total:state.size,percent:state.size?Math.min(100,Math.round(sent/state.size*100)):100,phase};
  this.onProgress(value);if(callback&&callback!==this.onProgress)callback(value);
 }
 async _finish(key,state,value,callback){
  if(!value?.id||value.size===undefined)value=await this._getFile(state.fileId);
  const result=metadata(value);
  if(result.fileId!==state.fileId||Number(result.size)!==state.size)throw fail('response','Drive 完成结果与原件编号或大小不一致，保留恢复记录');
  const complete={...state,status:'complete',offset:state.size,metadata:result};delete complete.sessionUrl;
  await this.sessionStore.put(key,complete);this._emit(state,state.size,callback,'complete');return result;
 }
 async _status(state){
  const r=await this._fetch(sessionURL(state.sessionUrl),{method:'PUT',headers:{'Content-Range':'bytes */'+state.size},body:new Blob([])});
  if(r.status===200||r.status===201)return {complete:await r.json()};
  if(r.status===308)return {offset:received(r,state.size)};
  if(r.status===404)return {expired:true};
  await this._checked(r);throw fail('response','Drive 上传状态无效');
 }
 async _upload(blob,{assetId,key,name,kind,requestId='',sampleId='',mimeType='',onProgress}){
  if(!blob||typeof blob.slice!=='function'||!Number.isSafeInteger(blob.size)||blob.size<1)throw fail('invalid','待上传文件为空或无效');
  if(this.inflight.has(key))return this.inflight.get(key);
  const work=(async()=>{
   const folder=await this.ensureFolder();
   const storeKey='drive-upload:'+folder+':'+key;
   const signature={assetId,requestId,name,mimeType:mimeType||blob.type||'application/octet-stream',size:blob.size,lastModified:blob.lastModified??null};
   let state=await this.sessionStore.get(storeKey);
   if(state&&Object.keys(signature).some(k=>state[k]!==signature[k]))throw fail('conflict','同一素材上传请求对应的文件已改变，请建立新素材或沿用原请求编号');
   if(!state){
    const ids=await this._json('files/generateIds',{query:{count:1,space:'drive'}});
    state={...signature,fileId:assertId(ids.ids?.[0]),folderId:folder,kind,sampleId,offset:0,status:'prepared'};
    await this.sessionStore.put(storeKey,state);
   }else{
    const existing=await this._getFile(state.fileId,true);
    if(existing)return this._finish(storeKey,state,existing,onProgress);
   }
   let offset=0,recoveries=0;
   if(state.sessionUrl){
    const status=await this._status(state);
    if(status.complete)return this._finish(storeKey,state,status.complete,onProgress);
    if(status.expired){delete state.sessionUrl;await this.sessionStore.put(storeKey,state)}
    else offset=status.offset;
   }
   if(!state.sessionUrl){
    const url=new URL(UPLOAD);url.searchParams.set('uploadType','resumable');url.searchParams.set('fields',FIELDS);
    const appProperties={library:LIBRARY_MARKER,kind,assetId};if(requestId)appProperties.requestId=requestId;if(sampleId)appProperties.sampleId=sampleId;
    const response=await this._fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':signature.mimeType,'X-Upload-Content-Length':String(blob.size)},body:JSON.stringify({id:state.fileId,name,mimeType:signature.mimeType,parents:[folder],appProperties})});
    if(response.status===409){const f=await this._getFile(state.fileId);return this._finish(storeKey,state,f,onProgress)}
    await this._checked(response);
    state.sessionUrl=sessionURL(response.headers.get('Location'));state.status='uploading';
    await this.sessionStore.put(storeKey,state);
   }
   while(offset<blob.size){
    this._emit(state,offset,onProgress);
    const end=Math.min(offset+CHUNK,blob.size);
    let response;
    try{response=await this._fetch(state.sessionUrl,{method:'PUT',headers:{'Content-Type':signature.mimeType,'Content-Range':'bytes '+offset+'-'+(end-1)+'/'+blob.size},body:blob.slice(offset,end)})}
    catch(e){
     if(e.code!=='network'||recoveries++>=1)throw e;
     const status=await this._status(state);
     if(status.complete)return this._finish(storeKey,state,status.complete,onProgress);
     if(status.expired){delete state.sessionUrl;await this.sessionStore.put(storeKey,state);throw fail('session-expired','上传会话已过期；重试将核对原件并使用同一文件编号重新上传',404)}
     offset=status.offset;continue;
    }
    if(response.status===200||response.status===201)return this._finish(storeKey,state,await response.json(),onProgress);
    if(response.status===308){
     const confirmed=received(response,blob.size);
     if(confirmed<=offset||confirmed>end)throw fail('response','Drive 未确认新的上传字节；恢复记录保留');
     offset=confirmed;state.offset=offset;await this.sessionStore.put(storeKey,state);continue;
    }
    if(response.status===404){delete state.sessionUrl;await this.sessionStore.put(storeKey,state);throw fail('session-expired','上传会话已过期；重试将使用同一文件编号',404)}
    if(response.status>=500&&recoveries++<1){
     const status=await this._status(state);
     if(status.complete)return this._finish(storeKey,state,status.complete,onProgress);
     if(!status.expired){offset=status.offset;continue}
    }
    await this._checked(response);
   }
   // A fully acknowledged final range is not itself a completion response.
   const status=await this._status(state);
   if(status.complete)return this._finish(storeKey,state,status.complete,onProgress);
   throw fail('uncertain','所有字节已发送，但Drive尚未确认完成；请稍后恢复核对');
  })();
  this.inflight.set(key,work);try{return await work}finally{this.inflight.delete(key)}
 }
 upload(file,{assetId,requestId,onProgress}={}){
  assetId=assertUUID(assetId,'素材编号');requestId=assertUUID(requestId,'上传请求编号');
  const mimeType=mediaMime(file);if(!mimeType)throw fail('invalid','请选择照片或视频原件；浏览器无法预览不影响支持格式的原件上传');
  return this._upload(file,{assetId,requestId,key:'original:'+assetId,name:file.name||'original-'+assetId,kind:'original',mimeType,onProgress});
 }
 uploadSample(blob,{assetId,sampleId}={}){
  assetId=assertUUID(assetId,'素材编号');if(!SAMPLE_ID.test(String(sampleId||'')))throw fail('invalid','样本编号无效');
  if(!/^image\//.test(blob?.type||''))throw fail('invalid','分析样本须为图片');
  return this._upload(blob,{assetId,sampleId,key:'sample:'+assetId+':'+sampleId,name:'shirley-sample-'+assetId+'-'+sampleId,kind:'sample'});
 }
 async fileInfo(fileId){return metadata(await this._getFile(fileId));}
 async readBlob(fileId){
  const u=new URL('files/'+assertId(fileId),API);u.searchParams.set('alt','media');
  return (await this._checked(await this._fetch(u.href))).blob();
 }
 async _readRecord(f){
  if(Number(f.size)>JSON_LIMIT)throw fail('record','分析记录过大，未读取为有效资料');
  const blob=await this.readBlob(f.id);
  if(blob.size>JSON_LIMIT)throw fail('record','分析记录过大，未读取为有效资料');
  try{return JSON.parse(await blob.text())}catch{throw fail('record','分析记录JSON损坏，未用部分资料替换缓存')}
 }
 async listRecords(){
  const folder=await this.ensureFolder();
  const files=await this._list("'"+folder+"' in parents and trashed = false and name contains 'shirley-asset-'");
  const out=[];
  for(const f of files){
   const match=/^shirley-asset-([0-9a-f-]{36})-([0-9a-f-]{36})\.json$/i.exec(f.name||'');
   if(!match||!UUID.test(match[1])||!UUID.test(match[2]))continue;
   const record=await this._readRecord(f);
   if(record?.assetId!==match[1]||record?.revision!==match[2])throw fail('record','分析记录内容与文件编号不一致');
   out.push({fileId:assertId(f.id),record});
  }
  return out;
 }
 async saveRecord(record){
  if(!record||typeof record!=='object'||Array.isArray(record))throw fail('record','分析记录须为JSON对象');
  const assetId=assertUUID(record.assetId,'素材编号'),revision=assertUUID(record.revision,'记录版本');
  let encoded;try{encoded=JSON.stringify(record)}catch{throw fail('record','分析记录无法序列化')}
  const blob=new Blob([encoded],{type:'application/json'});if(blob.size>JSON_LIMIT)throw fail('record','分析记录超过2MB，请分为独立记录');
  const folder=await this.ensureFolder(),name='shirley-asset-'+assetId+'-'+revision+'.json';
  const existing=await this._list("'"+folder+"' in parents and trashed = false and name = '"+name+"'");
  if(existing.length>1)throw fail('conflict','同一不可变版本有多个云端文件，请核对后再保存');
  if(existing.length){
   if(canonical(await this._readRecord(existing[0]))!==canonical(JSON.parse(encoded)))throw fail('conflict','同一记录版本内容不同，不能覆盖；请创建新版本');
   return {fileId:existing[0].id};
  }
  const result=await this._upload(blob,{assetId,key:'record:'+assetId+':'+revision,name,kind:'record'});
  return {fileId:result.fileId};
 }
 async listExternal(){
  const folder=await this.ensureFolder();
  const files=await this._list("'"+folder+"' in parents and trashed = false");
  return {files:files.filter(f=>/^(image|video)\//.test(f.mimeType||'')&&!String(f.name||'').startsWith('shirley-sample-')&&!(f.appProperties?.library===LIBRARY_MARKER&&f.appProperties.kind==='sample')).map(metadata),coverage:'accessible-to-app',requiresReadonly:true};
 }
}
