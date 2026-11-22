#!/usr/bin/env python3
"""Build the PUBLIC-SAFE asset catalog for the GitHub PR.

Reads the private dev-index.json (325 records) and emits only the 94
original-vector SVG kit records, with:
  - namespaced public IDs (ins:/px: + folder category + basename), NO Drive IDs
  - NO md5, NO thumbnailLink, NO folderPath, NO sizes, NO modifiedTime
  - rights carried honestly: INS kit has no rights field in its catalog
    (unverified); pixel kit states original-vector with a reference-only
    policy (commercial use unverified).
  - preview paths point at design-intelligence/public/previews/ in the repo.
Reference photos (231 records incl. the 72 classified) are NOT included:
they stay in the private bundle + Codex's authenticated D1.
"""
import json, re, datetime

SRC = "dev-index.json"
OUT = "pr/design-intelligence/data/asset-catalog-public.json"
MANIFEST = "previews/svg-manifest.json"

dev = json.load(open(SRC, encoding="utf-8"))
man = json.load(open(MANIFEST, encoding="utf-8"))
# manifest is a top-level list: {kit, category, preview, pngBytes, ...}
previews = {}
for e in man:
    key = (e["kit"], e["category"], e["preview"].split("/")[-1].removesuffix(".png"))
    previews[key] = e

CATMAP = {"icon": "icons", "sticker": "stickers", "frame": "frames"}

def folder_cat(folder_path: str) -> str:
    # "ui/01 粉黑INS套件/icons 交互图标/heart.svg" -> "icons"
    parts = folder_path.split("/")
    folder = parts[-2]
    return folder.split(" ")[0].strip().lower()

def kit_of(source: str) -> str:
    return "ins" if "ins" in source else "px"

records = []
seen = {}
for r in dev["records"]:
    if r.get("mimeType") != "image/svg+xml":
        continue
    kit = kit_of(r.get("source", ""))
    cat = folder_cat(r.get("folderPath", ""))
    base = r["name"].removesuffix(".svg")
    pub_id = f"{kit}:{cat}:{base}"
    assert pub_id not in seen, f"duplicate public id {pub_id} ({r['name']})"
    seen[pub_id] = r["name"]
    png = f"{kit}/{cat}/{base}.png"
    pentry = previews.get((kit, cat, base))
    assert pentry is not None, f"preview missing for {pub_id}: {png}"
    assert pentry["pngBytes"] > 0, f"preview empty for {pub_id}"
    rights = r.get("rights")
    if rights == "original-vector":
        rights_note = r.get("rightsDetail") or "Catalog states original-vector."
    else:
        rights_note = ("Redrawn original vector; the kit catalog carries no "
                       "rights/license field, so commercial use is unverified "
                       "(audit 2026-11-22).")
    records.append({
        "id": pub_id,
        "kit": kit,
        "name": r["name"],
        "category": r.get("category"),
        "style": r.get("style"),
        "palette": r.get("palette") or [],
        "preview": f"design-intelligence/public/previews/{png}",
        "viewBox": r.get("viewBox"),
        "catalogSize": r.get("catalogSize"),
        "kitStatus": r.get("status"),
        "rights": "original-vector",
        "rightsNote": rights_note,
        "reviewStatus": r.get("reviewStatus"),
        "source": r.get("source"),
    })

records.sort(key=lambda x: (x["kit"], x["category"], x["name"]))
out = {
    "kind": "shirley-design-catalog-public",
    "schema": 1,
    "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "source": "dev-index.json schema 2 (325 records) — public subset only",
    "scope": ("94 original-vector SVG kit assets (INS S1 + pixel-retro S2). "
              "Reference photos (231 records incl. 72 classified 2026-11-22) "
              "and all private Drive metadata are excluded; they live in the "
              "private delivery bundle and Codex's authenticated D1."),
    "recordCount": len(records),
    "records": records,
}
import os
os.makedirs("pr/design-intelligence/data", exist_ok=True)
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"wrote {OUT}: {len(records)} records")
from collections import Counter
print("kits:", Counter(r["kit"] for r in records))
print("categories:", Counter(r["category"] for r in records))
print("styles:", Counter(r["style"] for r in records))
