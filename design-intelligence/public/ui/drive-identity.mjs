export const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';

export function loadGoogleScript(src, ready, documentNode = document) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const script=documentNode.createElement('script');
    script.src=src;
    script.async=true;
    script.onload=()=>ready()?resolve():reject(Error('Google 登录组件不可用'));
    script.onerror=()=>{script.remove();reject(Error('无法载入 Google 组件'));};
    documentNode.head.append(script);
  });
}

export function createDriveIdentity(config, google, { now=Date.now }={}) {
  const oauth=google?.accounts?.oauth2;
  if(!oauth?.initTokenClient) throw Error('Google 登录组件尚未就绪');
  let pending, access='', expiresAt=0;
  const fail=message=>{pending?.reject(Error(message));pending=undefined;};
  const client=oauth.initTokenClient({
    client_id:config.clientId,
    scope:DRIVE_FILE,
    include_granted_scopes:false,
    callback(reply){
      if(!pending)return;
      const scopes=String(reply?.scope??'').trim().split(/\s+/);
      if(reply?.error||!reply?.access_token||scopes.some(scope=>scope!==DRIVE_FILE)||!oauth.hasGrantedAllScopes(reply,DRIVE_FILE)){
        fail('Google 未授予所需的文件权限');return;
      }
      const ttl=Number(reply.expires_in);
      if(!Number.isFinite(ttl)||ttl<=30){fail('Google 授权有效期不足，请重试');return;}
      access=reply.access_token;
      expiresAt=now()+ttl*1000-30000;
      pending.resolve(access);
      pending=undefined;
    },
    error_callback(){fail('Google 登录窗口未完成，请重试');}
  });
  return {
    token:()=>now()<expiresAt?access:'',
    connect(){
      if(pending)return pending.promise;
      let resolve,reject;
      const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad;});
      pending={promise,resolve,reject};
      try{client.requestAccessToken({prompt:''});}catch{fail('无法打开 Google 登录窗口');}
      return promise;
    },
    clear(){
      access='';expiresAt=0;
      if(pending)fail('Google 登录已取消');
    }
  };
}

export async function driveFolderState(folder, token, fetcher=fetch) {
  const url=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(folder));
  url.searchParams.set('fields','id,mimeType,trashed,capabilities(canAddChildren)');
  const response=await fetcher(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(response.status===401)return 'expired';
  if([403,404].includes(response.status))return 'needs-folder';
  if(!response.ok)throw Error('无法检查 Google Drive 目录 · '+response.status);
  const data=await response.json();
  return data.id===folder&&data.mimeType==='application/vnd.google-apps.folder'&&!data.trashed&&data.capabilities?.canAddChildren
    ?'ready':'needs-folder';
}

export function selectDriveFolder({ folder, token, picker, google, gapi, origin }) {
  return new Promise((resolve,reject)=>{
    gapi.load('picker',{
      callback(){
        try{
          const api=google.picker;
          const view=new api.DocsView(api.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true)
            .setMimeTypes('application/vnd.google-apps.folder');
          new api.PickerBuilder().addView(view).setDeveloperKey(picker.key).setAppId(picker.appId)
            .setOAuthToken(token).setOrigin(origin).setCallback(data=>{
              const action=data[api.Response.ACTION];
              if(action===api.Action.CANCEL)resolve(false);
              if(action===api.Action.PICKED){
                const selected=data[api.Response.DOCUMENTS]?.[0]?.[api.Document.ID];
                if(selected===folder)resolve(true);
                else reject(Error('请选择设置中的私有测试目录'));
              }
            }).build().setVisible(true);
        }catch{reject(Error('无法打开 Google Drive 目录选择器'));}
      },
      onerror:()=>reject(Error('无法载入 Google Drive 目录选择器')),
      timeout:10000,
      ontimeout:()=>reject(Error('Google Drive 目录选择器载入超时'))
    });
  });
}
