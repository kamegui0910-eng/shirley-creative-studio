import json, subprocess, os, re, sys
sys.path.insert(0,"/home/hatch/workspace/shirley-design-intelligence/.venv/lib/python3.12/site-packages")
import cairosvg
from PIL import Image
BASE="/home/hatch/workspace/shirley-design-intelligence"
inv=json.load(open(f"{BASE}/inventory.json"))
svgdir=f"{BASE}/svg-originals"; prevdir=f"{BASE}/previews/svg"
os.makedirs(svgdir,exist_ok=True); os.makedirs(prevdir,exist_ok=True)
# the 23 missing Drive thumbnails (from audit)
MISSING={
 "ui/01 粉黑INS套件/stickers 装饰贴纸/bow.svg","ui/01 粉黑INS套件/stickers 装饰贴纸/cloud-planet.svg",
 "ui/01 粉黑INS套件/stickers 装饰贴纸/flower-black.svg","ui/01 粉黑INS套件/stickers 装饰贴纸/flower.svg",
 "ui/01 粉黑INS套件/stickers 装饰贴纸/heart.svg","ui/01 粉黑INS套件/stickers 装饰贴纸/loading-bubble.svg",
 "ui/01 粉黑INS套件/stickers 装饰贴纸/postmark.svg","ui/01 粉黑INS套件/stickers 装饰贴纸/sparkle-pink.svg",
 "ui/01 粉黑INS套件/stickers 装饰贴纸/sparkle.svg","ui/01 粉黑INS套件/stickers 装饰贴纸/tag-for-you.svg",
 "ui/01 粉黑INS套件/stickers 装饰贴纸/tag-special-day.svg","ui/01 粉黑INS套件/stickers 装饰贴纸/tape-black.svg",
 "ui/01 粉黑INS套件/stickers 装饰贴纸/tape-pink.svg","ui/01 粉黑INS套件/stickers 装饰贴纸/y2k-phone.svg",
 "ui/01 粉黑INS套件/frames 边框面板/bubble-left.svg","ui/01 粉黑INS套件/frames 边框面板/bubble-right.svg",
 "ui/01 粉黑INS套件/frames 边框面板/dialog.svg","ui/01 粉黑INS套件/frames 边框面板/media.svg",
 "ui/01 粉黑INS套件/frames 边框面板/note.svg","ui/01 粉黑INS套件/frames 边框面板/polaroid.svg",
 "ui/01 粉黑INS套件/frames 边框面板/stamp.svg","ui/01 粉黑INS套件/frames 边框面板/window.svg",
 "ui/02 粉色像素复古/icons 交互图标/gear.svg"}
manifest=[]
svgs=[x for x in inv if x["_lib"]=="ui" and x["mimeType"]=="image/svg+xml"]
for x in svgs:
    kit="ins" if "/01 " in x["_path"] else "px"
    cat={"icons 交互图标":"icons","frames 边框面板":"frames","stickers 装饰贴纸":"stickers"}[x["_path"].split("/")[2]]
    sp=f"{svgdir}/{kit}-{cat}-{x['name']}"
    if not os.path.exists(sp):
        r=subprocess.run(["/opt/hatch/bin/hatch_gws_cli","drive","files","get","--params",
            json.dumps({"fileId":x["id"],"alt":"media"}),"-o",sp],capture_output=True,text=True,timeout=60)
        if r.returncode!=0 or not os.path.exists(sp):
            print("DL-FAIL",x["_path"]); manifest.append({"path":x["_path"],"status":"download-failed"}); continue
    data=open(sp,"rb").read()
    m=re.search(rb'width="(\d+)" height="(\d+)"',data)
    w,h=(int(m.group(1)),int(m.group(2))) if m else (120,120)
    outdir=f"{prevdir}/{kit}/{cat}"; os.makedirs(outdir,exist_ok=True)
    out=f"{outdir}/{x['name'][:-4]}.png"
    try:
        cairosvg.svg2png(bytestring=data,write_to=out,output_width=w*2,output_height=h*2,background_color="white")
        im=Image.open(out).convert("RGB")
        colors=im.getcolors(maxcolors=1000000) or []
        distinct=len(colors)
        manifest.append({"path":x["_path"],"driveFileId":x["id"],"kit":kit,"category":cat,
            "preview":f"previews/svg/{kit}/{cat}/{x['name'][:-4]}.png","pngBytes":os.path.getsize(out),
            "width":w*2,"height":h*2,"distinctColors":distinct,
            "missingDriveThumbnail":x["_path"] in MISSING,"status":"ok" if distinct>1 else "blank?"})
    except Exception as e:
        print("RENDER-FAIL",x["_path"],e); manifest.append({"path":x["_path"],"status":"render-failed","error":str(e)[:120]})
json.dump(manifest,open(f"{BASE}/previews/svg-manifest.json","w"),ensure_ascii=False,indent=1)
ok=[m for m in manifest if m.get("status")=="ok"]
print(f"SVG previews: total={len(manifest)} ok={len(ok)} missing-thumb-covered={sum(1 for m in ok if m.get('missingDriveThumbnail'))}/23 failed={len(manifest)-len(ok)}")
print("blank?:",[m["path"] for m in manifest if m.get("status")=="blank?"])
