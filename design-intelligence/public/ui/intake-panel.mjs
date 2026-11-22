import { $, el } from './core.mjs';
import { analyzeImage } from './visual-features.mjs';
import { fileFingerprint, uploadDrive } from './drive-upload.mjs';

export function wireIntelligence({ api, actions }) {
  const dialog=$('intelligence-dialog');
  $('intelligence-open').onclick=async()=>{
    dialog.showModal();
    try{
      const config=await api.json('/intake/config');
      $('upload-submit').disabled=!config.enabled;
      $('upload-config').textContent=config.enabled?'使用现有授权的 Google Drive 上传令牌。':'此环境尚未配置 Drive 上传文件夹。';
    }catch(error){$('upload-config').textContent=error.message;}
  };
  $('intelligence-close').onclick=()=>dialog.close();
  const sessionKey=(scope,digest)=>'shirley-upload:'+scope.tenantId+':'+scope.brandId+':'+digest;
  $('intake-form').onsubmit=async event=>{
    event.preventDefault();
    const token=$('drive-token').value.trim();
    const button=$('upload-submit');
    button.disabled=true;
    try{
      const [scope,config]=await Promise.all([api.json('/session'),api.json('/intake/config')]);
      if(!config.enabled||!token) throw Error('需要现有 Drive 令牌及已配置文件夹');
      const files=Array.from($('upload-files').files);
      if(!files.length||files.length>30) throw Error('每批请选择 1 至 30 个文件');
      $('upload-results').replaceChildren();
      for(const file of files){
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
    finally{button.disabled=false;$('drive-token').value='';}
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
}
