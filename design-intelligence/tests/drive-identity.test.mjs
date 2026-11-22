import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDriveIdentity,driveFolderState,selectDriveFolder,DRIVE_FILE} from '../public/ui/drive-identity.mjs';
import {uploadDrive} from '../public/ui/drive-upload.mjs';

test('GIS requests only drive.file and clears the local session on expiration or logout',async()=>{
 let options,requests=0,clock=0;
 const google={accounts:{oauth2:{
  initTokenClient(config){options=config;return {requestAccessToken(request){requests++;assert.equal(request.prompt,'');}};},
  hasGrantedAllScopes(reply,scope){return reply.scope===scope;}
 }}};
 const identity=createDriveIdentity({clientId:'project.apps.googleusercontent.com'},google,{now:()=>clock});
 assert.equal(options.scope,DRIVE_FILE);
 assert.equal(options.include_granted_scopes,false);
 const a=identity.connect();
 assert.equal(identity.connect(),a);
 options.callback({access_token:'short-lived',expires_in:90,scope:DRIVE_FILE});
 assert.equal(await a,'short-lived');
 assert.equal(requests,1);
 assert.equal(identity.token(),'short-lived');
 clock=60001;
 assert.equal(identity.token(),'');
 const denied=identity.connect();
 options.callback({access_token:'wrong-grant',expires_in:90,scope:'profile'});
 await assert.rejects(denied,/未授予/);
 const excess=identity.connect();
 options.callback({access_token:'excess-grant',expires_in:90,scope:DRIVE_FILE+' profile'});
 await assert.rejects(excess,/未授予/);
 const cancelled=identity.connect();identity.clear();
 await assert.rejects(cancelled,/已取消/);
 options.callback({access_token:'stale-result',expires_in:90,scope:DRIVE_FILE});
 assert.equal(identity.token(),'');
});

test('Folder preflight differentiates expiration from a missing write grant',async()=>{
 const send=(status,body)=>async(url,options)=>{
  assert.equal(url.origin,'https://www.googleapis.com');
  assert.equal(url.pathname,'/drive/v3/files/folder');
  assert.equal(options.headers.Authorization,'Bearer test-credential');
  return body?Response.json(body,{status}):new Response(null,{status});
 };
 assert.equal(await driveFolderState('folder','test-credential',send(401)),'expired');
 assert.equal(await driveFolderState('folder','test-credential',send(404)),'needs-folder');
 const body={id:'folder',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}};
 assert.equal(await driveFolderState('folder','test-credential',send(200,body)),'ready');
 assert.equal(await driveFolderState('folder','test-credential',send(200,{...body,trashed:true})),'needs-folder');
});

test('Picker passes same-project config and rejects non-sandbox folders',async()=>{
 let result,callback;
 class View{
  constructor(id){assert.equal(id,'FOLDERS');}
  setIncludeFolders(value){assert.equal(value,true);return this;}
  setSelectFolderEnabled(value){assert.equal(value,true);return this;}
  setMimeTypes(value){assert.equal(value,'application/vnd.google-apps.folder');return this;}
 }
 class Builder{
  addView(view){assert.ok(view instanceof View);return this;}
  setDeveloperKey(key){assert.equal(key,'picker-key');return this;}
  setAppId(id){assert.equal(id,'123456');return this;}
  setOAuthToken(token){assert.equal(token,'token');return this;}
  setOrigin(origin){assert.equal(origin,'https://example.test');return this;}
  setCallback(fn){callback=fn;return this;}
  build(){return {setVisible(active){assert.equal(active,true);callback(result);}};}
 }
 const google={picker:{DocsView:View,PickerBuilder:Builder,ViewId:{FOLDERS:'FOLDERS'},Response:{ACTION:'action',DOCUMENTS:'docs'},
  Action:{CANCEL:'cancel',PICKED:'picked'},Document:{ID:'id'}}};
 const gapi={load(name,options){assert.equal(name,'picker');options.callback();}};
 const args={folder:'sandbox',token:'token',picker:{key:'picker-key',appId:'123456'},google,gapi,origin:'https://example.test'};
 result={action:'picked',docs:[{id:'elsewhere'}]};
 await assert.rejects(selectDriveFolder(args),/测试目录/);
 result={action:'picked',docs:[{id:'sandbox'}]};
 assert.equal(await selectDriveFolder(args),true);
 result={action:'cancel'};
 assert.equal(await selectDriveFolder(args),false);
});

test('Resumable upload initializes, recovers an interrupted chunk and completes from confirmed offset',async()=>{
 const file=new File([new Uint8Array(1048596)],'image.png',{type:'image/png'});
 const url='https://www.googleapis.com/upload/drive/v3/files?upload_id=shape';
 const ranges=[];let created,count=0;
 const result=await uploadDrive(file,{token:'oauth',folder:'folder',fingerprint:'abc',
  checkpoint:value=>{created=value;},progress:()=>{},
  fetcher:async(address,request)=>{
   count++;
   if(count===1){assert.equal(request.method,'POST');assert.equal(JSON.parse(request.body).parents[0],'folder');return new Response(null,{status:200,headers:{Location:url}});}
   assert.equal(address,url);
   ranges.push(request.headers['Content-Range']);
   if(count===2)throw Error('simulated interruption');
   if(count===3)return new Response(null,{status:308,headers:{Range:'bytes=0-1048575'}});
   return Response.json({id:'uploaded'}, {status:201});
  }});
 assert.equal(created,url);
 assert.equal(result.id,'uploaded');
 assert.deepEqual(ranges,['bytes 0-1048575/1048596','bytes */1048596','bytes 1048576-1048595/1048596']);
});
