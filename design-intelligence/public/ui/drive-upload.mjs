const GOOGLE = 'https://www.googleapis.com';
const FILES = GOOGLE + '/upload/drive/v3/files';
const CHUNK = 1024 * 1024;
export const MAX_UPLOAD = 25 * CHUNK;
const retryable = code => [408,429,500,502,503,504].includes(code);
const offsetOf = response => {
  const value = response.headers.get('Range');
  if (!value) return 0;
  const match = /^bytes=0-(\d+)$/.exec(value);
  if (!match) throw Error('Drive returned an invalid byte range');
  return Number(match[1])+1;
};
function sessionURL(value) {
  let url;
  try { url=new URL(value); } catch { throw Error('Missing Drive session URL'); }
  if (url.origin !== GOOGLE || url.pathname !== '/upload/drive/v3/files' || !url.searchParams.has('upload_id')) throw Error('Unexpected Drive session URL');
  return url.href;
}
export async function fileFingerprint(file) {
  if (!file.size || file.size > MAX_UPLOAD) throw Error('文件大小须在 1 B 至 25 MiB');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export async function uploadDrive(file, { token, folder, fingerprint, resume, checkpoint, progress, fetcher=fetch }) {
  const headers = { Authorization:'Bearer '+token };
  let session = resume && sessionURL(resume);
  let offset = 0;
  const probe = url => fetcher(url,{ method:'PUT',headers:{...headers,'Content-Range':'bytes */'+file.size},body:new Blob([]) });
  if (session) {
    const result = await probe(session);
    if (result.ok) return result.json();
    if (result.status === 308) offset=offsetOf(result);
    else if ([404,410].includes(result.status)) session=null;
    else throw Error('Drive 续传查询失败 · '+result.status);
  }
  if (!session) {
    const response=await fetcher(FILES+'?uploadType=resumable&fields=id,name,size,mimeType,version,appProperties', {
      method:'POST', redirect:'error', headers:{...headers,'Content-Type':'application/json','X-Upload-Content-Type':file.type,'X-Upload-Content-Length':String(file.size)},
      body:JSON.stringify({name:file.name,parents:[folder],appProperties:{shirleySha256:fingerprint}}) });
    if(!response.ok) throw Error('Drive 无法创建上传会话 · '+response.status);
    session=sessionURL(response.headers.get('Location'));
    checkpoint(session);
  }
  let stalls=0;
  while(offset<file.size) {
    const end=Math.min(offset+CHUNK,file.size);
    let response;
    try {
      response=await fetcher(session,{ method:'PUT', headers:{...headers,'Content-Type':file.type,
        'Content-Range':`bytes ${offset}-${end-1}/${file.size}`},body:file.slice(offset,end) });
    } catch { response=await probe(session); }
    if (retryable(response.status)) response=await probe(session);
    if (response.ok) { progress(file.size);return response.json(); }
    if(response.status!==308) throw Error('Drive 分片失败 · '+response.status);
    const next=offsetOf(response);
    if(next<offset || next>end || (next===offset && ++stalls>=3)) throw Error('Drive 分片确认异常，可重试');
    if(next>offset) stalls=0;
    offset=next;
    progress(offset);
  }
  throw Error('Drive 未返回最终文件回执，可重试查询');
}
