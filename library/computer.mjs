export async function uploadToComputer(file,d,{post,raw,sha256,onProgress=()=>{}}){
 const start={requestId:d.requestId,assetId:d.assetId,clientScope:d.clientScope,name:d.name,mimeType:d.mimeType,bytes:d.bytes,lastModified:d.lastModified||0,rights:d.rights};
 if(file.size<=32*1024**2)start.sha256=await sha256(file);
 let state=await post('upload-start',start);
 for(const c of state.chunks||[]){if(await sha256(file.slice(c.offset,c.offset+c.bytes))!==c.sha256)throw Error('重新选择的文件与已上传部分不同；原进度保留，请选择原文件');}
 onProgress(state.received/file.size*100);
 while(state.received<file.size){const offset=state.received,blob=file.slice(offset,Math.min(file.size,offset+state.chunkBytes));state=await raw('upload-chunk',{requestId:d.requestId,clientScope:d.clientScope,offset,sha256:await sha256(blob)},blob);onProgress(state.received/file.size*100);}
 state=await post('upload-complete',{requestId:d.requestId,clientScope:d.clientScope});
 if(state.status!=='complete'||!state.record)throw Error('电脑未确认原件入库');
 return state.record;
}
