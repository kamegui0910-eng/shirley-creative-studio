const CLIENT=/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;
const FOLDER=/^[A-Za-z0-9_-]{5,200}$/;
export function mergeGoogleConfig(saved={},config={}){
 const settings={clientId:String(saved.clientId||''),folderId:String(saved.folderId||''),includeExternal:!!saved.includeExternal};
 const client=String(config.googleClientId||config.clientId||'').trim(),folder=String(config.folderId||'').trim();
 if(!settings.clientId&&CLIENT.test(client))settings.clientId=client;
 if(!settings.folderId&&FOLDER.test(folder))settings.folderId=folder;
 return {settings,expectedEmail:typeof config.targetEmail==='string'?config.targetEmail.trim().toLowerCase():''};
}
export function matchesGoogleAccount(account,expectedEmail){
 return !expectedEmail||String(account?.user?.emailAddress||'').trim().toLowerCase()===expectedEmail.trim().toLowerCase();
}

