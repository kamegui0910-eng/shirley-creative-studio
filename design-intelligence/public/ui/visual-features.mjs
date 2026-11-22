export const MODEL = 'pixels-v1';
export const SAMPLE = 48;
export function analyzePixels(data, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) throw Error('Invalid pixel buffer');
  const bins = new Map();
  const cells = Array.from({ length: 16 }, () => ({ edges: 0, samples: 0 }));
  const luma = i => .2126 * data[i] + .7152 * data[i+1] + .0722 * data[i+2];
  let filled = 0;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    const cell=cells[Math.floor(4*y/height)*4+Math.floor(4*x/width)];
    cell.samples++;
    if (x > 0 && (Math.abs(data[i+3]-data[i-1])>48 || (data[i+3]>96 && Math.abs(luma(i)-luma(i-4))>35))) cell.edges++;
    if (y > 0 && (Math.abs(data[i+3]-data[i-width*4+3])>48 || (data[i+3]>96 && Math.abs(luma(i)-luma(i-width*4))>35))) cell.edges++;
    if(data[i+3]<96) continue;
    const rgb=[data[i],data[i+1],data[i+2]];
    const key=rgb.map(v=>v>>5).join(':');
    const bin=bins.get(key)??[0,0,0,0];
    rgb.forEach((value,channel)=>bin[channel]+=value);
    bin[3]++;
    bins.set(key,bin);
    filled++;
  }
  const palette=[...bins.values()].sort((a,b)=>b[3]-a[3]).slice(0,6).map(([r,g,b,count])=>({
    hex:'#'+[r,g,b].map(x=>Math.round(x/count).toString(16).padStart(2,'0')).join(''),
    share:Number((count/filled).toFixed(4))
  }));
  return { model:MODEL, palette, layout:{ density:cells.map(c=>Number((c.edges/(2*c.samples||1)).toFixed(4))) },
    typography:{ status:'unverified' }, components:{ status:'unverified' } };
}
export async function analyzeImage(file) {
  const bitmap=await createImageBitmap(file);
  try {
    const canvas=Object.assign(document.createElement('canvas'),{width:SAMPLE,height:SAMPLE});
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0,SAMPLE,SAMPLE);
    const result=analyzePixels(ctx.getImageData(0,0,SAMPLE,SAMPLE).data,SAMPLE,SAMPLE);
    result.layout.width=bitmap.width;
    result.layout.height=bitmap.height;
    return result;
  } finally { bitmap.close(); }
}
