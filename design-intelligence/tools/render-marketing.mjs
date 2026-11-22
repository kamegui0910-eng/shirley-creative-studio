import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, realpathSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [manifestPath, outputPath] = process.argv.slice(2);
if(!manifestPath||!outputPath) throw Error('Usage: node tools/render-marketing.mjs <recipe.json> <output-directory>');
const recipe=JSON.parse(readFileSync(manifestPath,'utf8'));
const {brandKit,scenes}=recipe;
const imageRoot=realpathSync(resolve(dirname(manifestPath),recipe.imageRoot??'.'));
if(recipe.version!==1||!brandKit||!Array.isArray(scenes)||!scenes.length||scenes.length>10||
    !/^#[0-9a-f]{6}$/i.test(brandKit.background??'')||!/^#[0-9a-f]{6}$/i.test(brandKit.textColor??'')) throw Error('Invalid marketing recipe');
const presets={vertical:[720,1280],square:[720,720],landscape:[1280,720]};
const dimensions=Object.hasOwn(presets,recipe.format)?presets[recipe.format]:null;
if(!dimensions) throw Error('Unsupported video format');
const [width,height]=dimensions;
const directory=mkdtempSync(join(tmpdir(),'shirley-render-'));
const output=resolve(outputPath);
const ff=(args)=>execFileSync('ffmpeg',['-nostdin','-loglevel','error','-threads','1','-y',...args],{cwd:directory,stdio:['ignore','ignore','inherit'],timeout:60000});
const timestamp=ms=>{
  const parts=[Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60];
  return parts.map(n=>String(n).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');
};
function image(path) {
  const absolute=realpathSync(resolve(imageRoot,path));
  if(!absolute.startsWith(imageRoot+'/')||!/\.(png|jpe?g)$/i.test(absolute)) throw Error('Expected a local PNG or JPEG inside the recipe image folder');
  return absolute;
}
let duration=0;
const subtitles=[];
const evidence=[];
try {
  for(const [index,scene] of scenes.entries()){
    if(!Number.isFinite(scene.seconds)||scene.seconds<1||scene.seconds>10||typeof scene.caption!=='string'||scene.caption.length>140||
      !['verified','pending'].includes(scene.sourceStatus)||typeof scene.asset!=='string') throw Error('Invalid marketing scene');
    const source=image(scene.asset);
    const padded='scale='+width+':'+height+':force_original_aspect_ratio=decrease,pad='+width+':'+height+':(ow-iw)/2:(oh-ih)/2:color=0x'+brandKit.background.slice(1)+',setsar=1';
    const seconds=(Math.round(scene.seconds*24)/24);
    const end=duration+Math.round(seconds*1000);
    const caption=scene.caption.replace(/[\r\n\u0000-\u001f]/g,' ').trim();
    if(caption)subtitles.push([String(subtitles.length+1),timestamp(duration)+' --> '+timestamp(end),caption].join('\n'));
    evidence.push({ scene:index+1,sourceStatus:scene.sourceStatus });
    duration=end;
    ff(['-protocol_whitelist','file,pipe','-loop','1','-framerate','24','-i',source,'-t',String(seconds),'-an',
      '-vf',padded,'-c:v','libx264','-pix_fmt','yuv420p','-preset','fast','shot-'+index+'.mp4']);
    if(index===0)ff(['-protocol_whitelist','file,pipe','-i',source,'-vf',padded,'-frames:v','1','-update','1','cover.png']);
  }
  writeFileSync(join(directory,'concat.txt'),scenes.map((_,i)=>"file 'shot-"+i+".mp4'").join('\n')+'\n');
  writeFileSync(join(directory,'captions.srt'),subtitles.join('\n\n')+(subtitles.length?'\n':''));
  const encode=subtitles.length?['-vf',"subtitles=captions.srt:force_style='PrimaryColour=&H00"+
    brandKit.textColor.slice(1).match(/../g).reverse().join('')+"&,OutlineColour=&H00131313&,MarginV=40'" ,
    '-c:v','libx264','-preset','fast','-pix_fmt','yuv420p']:['-c:v','copy'];
  ff(['-f','concat','-safe','1','-i','concat.txt',...encode,'-an','-movflags','+faststart','preview.mp4']);
  execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,pix_fmt:format=duration',
    '-of','json','-o','qa.json','preview.mp4'],{cwd:directory,stdio:['ignore','ignore','inherit'],timeout:10000});
  const probe=JSON.parse(readFileSync(join(directory,'qa.json'),'utf8'));
  const stream=probe.streams[0];
  if(stream.width!==width||stream.height!==height||stream.pix_fmt!=='yuv420p'||Math.abs(Number(probe.format.duration)*1000-duration)>150) throw Error('Rendered file failed QA');
  writeFileSync(join(directory,'qa.json'),JSON.stringify({ ...probe,scenes:evidence,publication:'internal-preview' },null,2));
  mkdirSync(output,{recursive:true});
  for(const filename of ['preview.mp4','cover.png','captions.srt','qa.json'])copyFileSync(join(directory,filename),join(output,filename),constants.COPYFILE_EXCL);
  console.log(JSON.stringify({scenes:scenes.length,width,height,durationMs:duration,unverifiedSources:evidence.filter(row=>row.sourceStatus==='pending').length}));
}finally{rmSync(directory,{recursive:true,force:true});}
