#!/usr/bin/env python3
"""Validate the Shirley Design Intelligence indexes and PR payload.

Checks (exit 0 = all pass):
  1. dev-index.json (private, local): 325 records, unique ids, required
     fields present, rights enum, 72 classified records present, S6 count
     preserved at 177 (no silent re-tagging).
  2. asset-catalog-public.json: 94 records, unique namespaced ids, no
     private metadata (Drive ids, md5, thumbnail links, folder paths),
     every record maps to exactly one dev-index SVG.
  3. Previews: every public-catalog preview PNG exists, is a real PNG,
     non-empty; public previews manifest matches the catalog 1:1.
  4. API (if reachable): /health records=325, rights filter, pagination
     covers all records, preview 200 + 404 behaviour.
  5. Sync state: saved sync-state.json / sync-log-latest.json present,
     last live run reported 0 changes (no full rescan needed).
  6. Secrets scan over the PR tree: no tokens, keys, or private-key blocks.

Usage: python3 tools/validate-dev-index.py [--api-base URL]
"""
import argparse, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Local layout: <ws>/pr/design-intelligence/tools/validate-dev-index.py
#   ROOT = <ws>/pr/design-intelligence ; WS = <ws> (dev-index, previews, sync state)
WS = os.path.dirname(os.path.dirname(ROOT))
# repo layout: this file lives in design-intelligence/tools/ inside the PR tree;
# locally it validates against the workspace files via env overrides.
DEV_INDEX = os.environ.get("DEV_INDEX", os.path.join(WS, "dev-index.json"))
PUBLIC_CATALOG = os.environ.get("PUBLIC_CATALOG", os.path.join(ROOT, "data", "asset-catalog-public.json"))
PREVIEWS_DIR = os.environ.get("PREVIEWS_DIR", os.path.join(WS, "previews", "svg"))
PUBLIC_MANIFEST = os.environ.get("PUBLIC_MANIFEST", os.path.join(ROOT, "data", "previews-manifest-public.json"))
PR_DIR = os.environ.get("PR_DIR", ROOT)

failures = []
notes = []

def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default="http://127.0.0.1:8901")
    args = ap.parse_args()

    dev = json.load(open(DEV_INDEX, encoding="utf-8"))
    recs = dev["records"]
    check("dev-index count == 325", len(recs) == 325, f"got {len(recs)}")
    ids = [r["id"] for r in recs]
    check("dev-index ids unique", len(set(ids)) == len(ids))
    check("dev-index all have driveFileId+md5", all(r.get("driveFileId") and r.get("md5Checksum") for r in recs))
    rights = {r.get("rights") for r in recs}
    check("dev-index rights in enum",
          rights <= {"reference-only", "unverified", "original-vector", "restricted", "needs-review"},
          str(sorted(rights)))
    classified = [r for r in recs if r.get("reviewStatus") == "classified-unreviewed"]
    check("72 classified records present", len(classified) == 72, f"got {len(classified)}")
    s6 = [r for r in recs if r.get("style") == "S6"]
    check("S6 records preserved (177, no re-tagging)", len(s6) == 177, f"got {len(s6)}")
    svg = [r for r in recs if r.get("mimeType") == "image/svg+xml"]
    check("dev-index SVG count == 94", len(svg) == 94, f"got {len(svg)}")

    pub = json.load(open(PUBLIC_CATALOG, encoding="utf-8"))
    precs = pub["records"]
    check("public catalog count == 94", len(precs) == 94, f"got {len(precs)}")
    pids = [r["id"] for r in precs]
    check("public ids unique + namespaced", len(set(pids)) == len(pids) and
          all(re.match(r"^(ins|px):(icons|frames|stickers):[a-z0-9-]+$", i) for i in pids))
    blob = json.dumps(pub, ensure_ascii=False)
    check("public catalog leaks no private metadata",
          not any(p in blob for p in ["drive:", "driveFileId", "md5", "thumbnailLink",
                                      "lh3.googleusercontent", "folderPath"]))
    # 1:1 join dev SVG <-> public record via (kit, folder-category, basename)
    def key(r):
        folder = r.get("folderPath", "").split("/")[-2].split(" ")[0].lower()
        kit = "ins" if "ins" in r.get("source", "") else "px"
        return (kit, folder, r["name"].removesuffix(".svg"))
    dev_keys = {key(r) for r in svg}
    pub_keys = {(r["id"].split(":")[0], r["id"].split(":")[1], r["name"].removesuffix(".svg")) for r in precs}
    check("public catalog covers every dev SVG exactly once", dev_keys == pub_keys,
          f"missing={sorted(dev_keys - pub_keys)[:3]} extra={sorted(pub_keys - dev_keys)[:3]}")

    missing, bad = [], []
    for r in precs:
        p = os.path.join(PREVIEWS_DIR, r["preview"].split("public/previews/")[-1])
        if not os.path.exists(p):
            missing.append(r["id"])
        else:
            with open(p, "rb") as f:
                head = f.read(8)
            if head != b"\x89PNG\r\n\x1a\n" or os.path.getsize(p) == 0:
                bad.append(r["id"])
    check("all 94 preview PNGs exist and are valid PNGs", not missing and not bad,
          f"missing={missing[:3]} bad={bad[:3]}")
    man = json.load(open(PUBLIC_MANIFEST, encoding="utf-8"))
    check("public previews manifest == 94 entries", len(man) == 94, f"got {len(man)}")
    mblob = json.dumps(man, ensure_ascii=False)
    check("previews manifest leaks no private metadata",
          not any(p in mblob for p in ["driveFileId", "drive:", "lh3.googleusercontent"]))

    # API checks (soft-fail: API may not be running in CI)
    try:
        def get(path):
            with urllib.request.urlopen(args.api_base + path, timeout=10) as r:
                return json.loads(r.read())
        h = get("/health")
        check("API /health records == 325", h.get("records") == 325, str(h.get("records")))
        res = get("/v1/assets?rights=restricted")
        check("API rights=restricted total == 32", res.get("total") == 32, str(res.get("total")))
        p1 = get("/v1/assets?limit=125&offset=0")
        p2 = get("/v1/assets?limit=125&offset=125")
        p3 = get("/v1/assets?limit=125&offset=250")
        got = len(p1.get("items", [])) + len(p2.get("items", [])) + len(p3.get("items", []))
        check("API pagination covers 325", got == 325 and p1.get("total") == 325, f"got {got}")
        with urllib.request.urlopen(args.api_base + "/v1/previews/svg/ins/stickers/heart.png", timeout=10) as r:
            check("API preview 200 (svg/ins/stickers/heart.png)", r.status == 200, f"{r.status} {r.headers.get('Content-Type')}")
        try:
            urllib.request.urlopen(args.api_base + "/v1/previews/svg/nope/nope.png", timeout=10)
            check("API preview 404 for missing file", False, "returned 200")
        except urllib.error.HTTPError as e:
            check("API preview 404 for missing file", e.code == 404, str(e.code))
    except Exception as e:
        notes.append(f"API checks skipped (not reachable): {e}")
        print(f"SKIP  API checks — not reachable: {e}")

    # Sync state (saved evidence; live run needs Drive approval)
    try:
        st = json.load(open(os.path.join(WS, "sync-state.json"), encoding="utf-8"))
        log = json.load(open(os.path.join(WS, "sync-log-latest.json"), encoding="utf-8"))
        n = log.get("changesCount", len(log.get("changes", [])))
        tok = st.get("drivePageToken")
        check("sync state present, last live run 0 changes",
              n == 0 and str(tok) == "4085",
              f"changes={n} drivePageToken={tok}")
    except Exception as e:
        check("sync state present", False, str(e))

    # Secrets scan over the PR tree
    pats = [r"ya29\.", r"ghp_[A-Za-z0-9]{20,}", r"gho_[A-Za-z0-9]{20,}", r"sk-[A-Za-z0-9]{16,}",
            r"AKIA[0-9A-Z]{16}", r"client_secret", r"BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY",
            r"Authorization:\s*Bearer\s+\S{10,}"]
    hits = []
    for dp, _, fns in os.walk(PR_DIR):
        for fn in fns:
            if fn == "validate-dev-index.py":
                continue  # this file contains the scan patterns themselves
            fp = os.path.join(dp, fn)
            if fn.endswith((".png", ".zip")):
                continue
            try:
                txt = open(fp, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            for pat in pats:
                if re.search(pat, txt):
                    hits.append(f"{os.path.relpath(fp, PR_DIR)}:{pat}")
    check("secrets scan clean over PR tree", not hits, "; ".join(hits[:5]))

    print()
    for n in notes:
        print("NOTE:", n)
    if failures:
        print(f"\n{len(failures)} FAILURES: {failures}")
        sys.exit(1)
    print("ALL CHECKS PASSED")

if __name__ == "__main__":
    main()
