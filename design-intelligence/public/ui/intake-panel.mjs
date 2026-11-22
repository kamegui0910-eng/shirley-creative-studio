import { $, el } from './core.mjs';
import { analyzeImage } from './visual-features.mjs';
import { fileFingerprint, uploadDrive } from './drive-upload.mjs';
import { createDriveIdentity, driveFolderState, loadGoogleScript, selectDriveFolder } from './drive-identity.mjs';

export function wireIntelligence({ api, actions }) {
  const dialog=$('intelligence-dialog');
  const login=$('drive-connect'), picker=$('drive-picker'), status=$('upload-config');
  let config, identity, authorizedFolder='', generation=0;
  let connectedClient='';
  const clear=()=>{
    generation++;
    identity?.clear();
    identity=undefined;
    connectedClient='';
    authorizedFolder='';
    config=undefined;
    $('drive-token').value='';
    picker.hidden=true;
    if(dialog.open)dialog.close();
  };
  const check=async(token,current)=>{
    const state=await driveFolderState(config.folder,token);
    if(current!==generation)return;
    authorizedFolder=state==='ready'?config.folder:'';
    picker.hidden=state!=='needs-folder'||!config.oauth?.picker;
    if(state==='expired')identity?.clear();
    status.textContent=state==='ready'?'Google Drive 已连接，可以上传。':
      state==='expired'?'Google 授权已过期，请重新连接。':
      config.oauth?.picker?'请选择已配置的私有 Drive 测试目录。':'此 Google 应用尚未获得测试目录的写入权限。';
  };
  $('intelligence-open').onclick=async()=>{
    dialog.showModal();
    const current=++generation;
    login.hidden=true;picker.hidden=true;
    $('upload-submit').disabled=true;
    try{
      const settings=await api.json('/intake/config');
      if(current!==generation)return;
      config=settings;
      $('upload-submit').disabled=!config.enabled;
      if(!config.enabled){status.textContent='此环境尚未配置 Drive 上传文件夹。';return;}
      if(!config.oauth){status.textContent='此测试环境尚未绑定 Google 网页客户端。可用已有应用令牌测试。';return;}
      if(identity?.token()&&connectedClient===config.oauth.clientId){
        login.hidden=false;await check(identity.token(),current);return;
      }
      status.textContent='准备 Google 登录…';
      const tasks=[loadGoogleScript('https://accounts.google.com/gsi/client',()=>Boolean(globalThis.google?.accounts?.oauth2))];
      if(config.oauth.picker)tasks.push(loadGoogleScript('https://apis.google.com/js/api.js',()=>Boolean(globalThis.gapi?.load)));
      const [gis,loader]=await Promise.allSettled(tasks);
      if(current!==generation)return;
      if(gis.status==='rejected')throw gis.reason;
      if(loader?.status==='rejected')config={...config,oauth:{clientId:config.oauth.clientId}};
      identity?.clear();
      identity=createDriveIdentity(config.oauth,globalThis.google);
      connectedClient=config.oauth.clientId;
      login.hidden=false;login.disabled=false;
      status.textContent='连接 Google Drive 后即可检查目录访问权限。';
    }catch(error){if(current===generation)status.textContent=error.message;}
  };
  login.onclick=async()=>{
    if(!identity)return;
    const current=generation;
    login.disabled=true;
    try{const token=await identity.connect();if(current===generation)await check(token,current);}
    catch(error){if(current===generation)status.textContent=error.message;}
    finally{if(current===generation)login.disabled=false;}
  };
  picker.onclick=async()=>{
    const current=generation;
    const token=identity?.token();
    if(!token){status.textContent='请重新连接 Google Drive。';return;}
    dialog.close();
    try{
      const picked=await selectDriveFolder({folder:config.folder,token,picker:config.oauth.picker,
        google:globalThis.google,gapi:globalThis.gapi,origin:location.origin});
      if(picked&&current===generation)await check(token,current);
    }catch(error){if(current===generation)status.textContent=error.message;}
    finally{if(current===generation&&!dialog.open)dialog.showModal();}
  };
  $('intelligence-close').onclick=()=>dialog.close();
  const sessionKey=(scope,digest)=>'shirley-upload:'+scope.tenantId+':'+scope.brandId+':'+digest;
  $('intake-form').onsubmit=async event=>{
    event.preventDefault();
    const manual=$('drive-token').value.trim();
    const token=manual||identity?.token();
    const current=generation;
    const button=$('upload-submit');
    button.disabled=true;
    try{
      const [scope,config]=await Promise.all([api.json('/session'),api.json('/intake/config')]);
      if(!config.enabled||!token) throw Error('请先连接 Google Drive 或提供现有应用令牌');
      if(manual||authorizedFolder!==config.folder){
        const state=await driveFolderState(config.folder,token);
        if(current!==generation)return;
        if(state!=='ready')throw Error(state==='expired'?'Google 授权已过期，请重试。':'当前 Google 授权无法写入配置的目录。');
      }
      const files=Array.from($('upload-files').files);
      if(!files.length||files.length>30) throw Error('每批请选择 1 至 30 个文件');
      $('upload-results').replaceChildren();
      for(const file of files){
        if(current!==generation)break;
        const row=el('li',{text:file.name+' · 等待上传'});
        $('upload-results').append(row);
        const status=value=>{row.textContent=file.name+' · '+value;};
        try {
          if(!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw Error('只接受 PNG、JPEG 或 WebP');
          const fingerprint=await fileFingerprint(file);
          const key=sessionKey(scope,fingerprint);
          const prior=await api.json('/intake/dedupe?fingerprint='+fingerprint);
          let assetId=prior.assetId;
          if(!assetId){
            const fileResult=await uploadDrive(file,{token,folder:config.folder,fingerprint,resume:sessionStorage.getItem(key),
              checkpoint:value=>sessionStorage.setItem(key,value),progress:sent=>status(Math.floor(100*sent/file.size)+'%')});
            const response=await api.json('/intake/register',{method:'POST',headers:{'Content-Type':'application/json','X-Drive-Access-Token':token},
              body:JSON.stringify({driveFileId:fileResult.id,fingerprint})});
            assetId=response.assetId;
            sessionStorage.removeItem(key);
          }
          const state=await api.json('/assets/'+assetId+'/analysis');
          if(state.status!=='ready') await api.put('/assets/'+assetId+'/analysis',{fileVersion:state.fileVersion,result:await analyzeImage(file)});
          status(prior.assetId?'已去重，分析可用':'已上传并分析');
          row.append(' ',el('button',{type:'button',text:'查看分析',onclick:()=>showAnalysis(assetId)}));
        }catch(error){status('失败，可重新选取同一文件重试 · '+error.message);}
      }
    }catch(error){$('upload-config').textContent=error.message;}
    finally{if(current===generation){button.disabled=false;$('drive-token').value='';}}
  };
  async function showAnalysis(id){
    const node=$('upload-analysis');
    try{
      const analysis=await api.json('/assets/'+id+'/analysis');
      node.textContent=analysis.result
        ? '配色 '+analysis.result.palette.map(item=>item.hex).join('、')+'；布局 '+analysis.result.layout.width+' × '+analysis.result.layout.height+'，已提取 4 × 4 边缘分布。'
        : '等待分析';
      if(analysis.result){
        const grid=el('div',{class:'analysis-grid','aria-label':'四乘四边缘密度'});
        analysis.result.layout.density.forEach(value=>grid.append(el('span',{text:Math.round(value*100)+'%'})));
        node.append(grid);
      }
    }catch(error){node.textContent=error.message;}
  }
  $('recommend-form').onsubmit=async event=>{
    event.preventDefault();
    const list=$('recommend-results');
    list.textContent='检索中…';
    const file=$('recommend-image').files[0];
    try{
      if(file&&file.size>26214400) throw Error('参考图不可超过 25 MiB');
      const result=await api.post('/assets/recommend',{q:$('recommend-text').value.trim(),...(file?{visual:await analyzeImage(file)}:{})});
      list.replaceChildren(...result.items.map(item=> el('li',{},
        el('button',{type:'button',text:item.name,onclick:()=>{dialog.close();actions.openDetail(item.assetId);}}),
        ' '+Object.entries(item.signals).map(([key,score])=>({text:'关键字',color:'配色',layout:'布局',brand:'品牌'}[key])+': '+Math.round(score*100)+'%').join(' · '),
        ' ',el('button',{type:'button',text:'分析',onclick:()=>showAnalysis(item.assetId)}))));
      if(!result.items.length)list.textContent='没有符合条件的素材。';
    }catch(error){list.textContent=error.message;}
  };
  return {clear};
}
