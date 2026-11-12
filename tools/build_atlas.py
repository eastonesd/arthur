# 東石知識圖譜：從 7 個 repo 的目前版本重建資料
# 用法：python tools/build_atlas.py atlas-data.js atlas-data.js（第一個參數提供各專案顏色、名稱等設定）
# 輸出檔名是 atlas-data.js 時寫成 window.ATLAS（A.R.T.H.U.R. 核心用），其他檔名寫成 const DATA（獨立圖譜網頁用）
import json, os, re, subprocess, sys
from pathlib import Path

OLD = json.loads(re.sub(r"^(const DATA=|window\.ATLAS=)|;\s*$", "", Path(sys.argv[1]).read_text(encoding="utf-8")))
OUT = Path(sys.argv[2])
ROOTS = {
    "arthur": "/home/claude/arthur", "eastone.com": "/home/claude/eastone.com", "eastone.ecommerce": "/tmp/ec",
    "eastone.saga": "/tmp/saga", "eastone.stock": "/tmp/stock", "eastone.dpf": "/home/claude/eastone.dpf",
    "eastone.trader": "/home/claude/eastone.trader",
}
DESC = {
    "eastone.dpf": ("數位商品", "AI 數位商品工廠：從企劃、內容生成、轉檔到 WooCommerce 上架與交付；在主人電腦上以 Docker 執行，向 A.R.T.H.U.R. 收件匣領取任務。"),
    "eastone.trader": ("交易研究", "台股量化交易研究：FinMind、證交所與永豐唯讀行情資料，回測與模擬交易引擎、風控、每日報告與 Discord 通知；目前只做模擬，不真實下單。"),
}
# 七個專案在球面上的位置（經度、緯度，弧度）：平均分散，避免檔案群互相重疊
POS = {"arthur": (0.0, 0.12), "eastone.com": (-1.2, 0.72), "eastone.ecommerce": (1.2, 0.72), "eastone.stock": (-1.25, -0.62),
       "eastone.saga": (1.25, -0.62), "eastone.trader": (-2.6, 0.2), "eastone.dpf": (2.6, -0.2)}
CODE = {".py", ".js", ".mjs", ".ts", ".html", ".yml", ".yaml", ".md", ".sql", ".toml", ".sh", ".php", ".bat", ".ps1", ".pine"}
SKIP_NAMES = {"package-lock.json"}

def git(root, *a):
    return subprocess.run(["git", "-C", root, *a], capture_output=True, text=True, check=True).stdout

def read(p):
    b = Path(p).read_bytes()
    for enc in ("utf-8", "cp950"):
        try: return b.decode(enc)
        except UnicodeDecodeError: pass
    return b.decode("utf-8", "replace")

def included(path):
    parts = path.split("/")
    if any(x.startswith(".") and x != ".github" for x in parts[:-1]): return False
    name = parts[-1]
    if name in SKIP_NAMES or name.startswith(".env"): return False
    if name == "Dockerfile": return True
    return Path(name).suffix.lower() in CODE

def symbols(path, text):
    ext = Path(path).suffix.lower(); out = []
    for i, line in enumerate(text.splitlines(), 1):
        if ext == ".py":
            m = re.match(r"\s*(?:async\s+)?def\s+(\w+)|\s*class\s+(\w+)", line)
        elif ext in (".js", ".mjs", ".ts"):
            m = re.search(r"\bfunction\*?\s+(\w+)\s*[<(]|^\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)", line)
        else:
            m = None
        if m: out.append([m.group(1) or m.group(2), i])
    return out

repos, nodes, edges = [], [], []
seen_edges = set()
def edge(a, b, rel, url):
    k = (a, b, rel)
    if a == b or k in seen_edges: return
    seen_edges.add(k); edges.append([a, b, rel, url])

files_of = {}
for i, old in enumerate(OLD["repos"]):
    r = old["r"]; root = ROOTS[r]; sha = git(root, "rev-parse", "HEAD").strip()
    base = f"https://github.com/eastonesd/{r}"
    meta = {**old, "sha": sha, "url": f"{base}/tree/{sha}"}
    if r in DESC: meta["kind"], meta["desc"] = DESC[r]
    meta["lon"], meta["lat"] = POS[r]
    repos.append(meta)
    nodes.append({"id": r, "r": i, "name": r, "type": "repo", "url": meta["url"]})
    paths = sorted(p for p in git(root, "ls-files", "-z").split("\0") if p and included(p))
    files_of[r] = {}
    for p in paths:
        text = read(os.path.join(root, p))
        files_of[r][p] = text
        nodes.append({"id": f"{r}/{p}", "r": i, "name": p, "type": "file", "url": f"{base}/blob/{sha}/{p}", "sy": symbols(p, text)})
        edge(r, f"{r}/{p}", "收錄檔案", f"{base}/blob/{sha}/{p}")

def blob(r, p, line): return f"https://github.com/eastonesd/{r}/blob/{repos[[x['r'] for x in repos].index(r)]['sha']}/{p}#L{line}"

# ---------- 專案內的引用 ----------
def resolve_rel(r, src, spec, exts):
    if not spec.startswith("."): return None
    base = os.path.normpath(os.path.join(os.path.dirname(src), spec)).replace("\\", "/")
    stem = re.sub(r"\.(js|mjs|ts)$", "", base)
    for c in [base] + [stem + e for e in exts] + [base + "/index" + e for e in exts]:
        if c in files_of[r]: return c
    return None

def py_packages(r):
    roots = {}
    for p in files_of[r]:
        if p.endswith("/__init__.py"):
            d = p[:-len("/__init__.py")]
            parent = os.path.dirname(d)
            if f"{parent}/__init__.py" not in files_of[r]:
                roots[os.path.basename(d)] = parent
    return roots

def py_module_file(r, mod, roots):
    top = mod.split(".")[0]
    if top not in roots: return None
    base = (roots[top] + "/" if roots[top] else "") + mod.replace(".", "/")
    for c in (base + ".py", base + "/__init__.py"):
        if c in files_of[r]: return c
    return None

for r in files_of:
    roots = py_packages(r)
    for p, text in files_of[r].items():
        ext = Path(p).suffix.lower(); lines = text.splitlines()
        for n, line in enumerate(lines, 1):
            targets = []
            if ext == ".html":
                targets += [resolve_rel(r, p, "./" + s.lstrip("./") if not s.startswith(".") else s, [""])
                            for s in re.findall(r"<script[^>]+src=[\"']([^\"':]+?)(?:\?[^\"']*)?[\"']", line)]
            if ext in (".js", ".mjs", ".ts", ".html"):
                for s in re.findall(r"(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)[\"']([^\"']+)[\"']", line):
                    targets.append(resolve_rel(r, p, s, [".ts", ".js", ".mjs"]))
                for s in re.findall(r"serviceWorker\.register\(\s*[\"']([^\"']+)[\"']", line):
                    targets.append(resolve_rel(r, p, s if s.startswith(".") else "./" + s, [""]))
            if ext == ".py":
                m = re.match(r"\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)", line)
                if m:
                    dots, mod, names = m.groups()
                    names = [x.strip().split(" as ")[0] for x in names.strip("()\\ ").split(",") if x.strip()]
                    if dots:
                        pkg = os.path.dirname(p)
                        for _ in range(len(dots) - 1): pkg = os.path.dirname(pkg)
                        base = pkg + ("/" + mod.replace(".", "/") if mod else "")
                        cands = [base + ".py", base + "/__init__.py"] if mod else []
                        cands += [base + "/" + nm + ".py" for nm in names]
                        targets += [c for c in cands if c in files_of[r]][:1] if mod else [c for c in cands if c in files_of[r]]
                    else:
                        t = py_module_file(r, mod, roots)
                        subs = [py_module_file(r, mod + "." + nm, roots) for nm in names]
                        subs = [s for s in subs if s]
                        targets += subs or [t]
                m = re.match(r"\s*import\s+([\w., ]+)$", line)
                if m:
                    targets += [py_module_file(r, x.strip().split(" as ")[0], roots) for x in m.group(1).split(",")]
            if ext in (".bat", ".ps1", ".sh", ".yml", ".yaml", ".toml") or p.endswith("Dockerfile"):
                for mod in re.findall(r"-m\s+([\w.]+)", line):
                    targets.append(py_module_file(r, mod, roots))
                ln = line.replace("\\", "/")
                m = re.search(r"\bbuild:\s*\.?/?([\w./-]+)", ln)
                if m: targets.append(m.group(1).strip("/") + "/Dockerfile")
                for q in files_of[r]:
                    if q == p or Path(q).suffix.lower() == ".md": continue
                    relq = os.path.relpath(q, os.path.dirname(p) or ".").replace("\\", "/")
                    for cand in {q, relq}:
                        same_dir = "/" not in cand and len(cand) >= 8
                        if ("/" in cand or same_dir) and re.search(r"(?<![A-Za-z_/.-])\.?/?" + re.escape(cand) + r"(?![\w/-])", ln):
                            targets.append(q); break
            for t in targets:
                if t and t in files_of[r]: edge(f"{r}/{p}", f"{r}/{t}", "引用模組", blob(r, p, n))

# ---------- 跨專案關聯（每條都有程式行號為依據） ----------
def line_of(r, p, pattern, nth=1):
    hits = [i for i, l in enumerate(files_of[r][p].splitlines(), 1) if re.search(pattern, l)]
    if len(hits) < nth: raise SystemExit(f"找不到依據：{r}/{p} /{pattern}/")
    return hits[nth - 1]

def cross(r, p, pattern, target, rel):
    edge(f"{r}/{p}", target, rel, blob(r, p, line_of(r, p, pattern)))

AD = "supabase/functions/arthur-discord/index.ts"; JL = "supabase/functions/jarvis-line/index.ts"; HUB = "supabase/functions/arthur-hub/index.ts"
for repo in ["eastone.com", "eastone.stock", "eastone.trader", "eastone.saga", "eastone.ecommerce", "eastone.dpf"]:
    cross("arthur", "index.html", r'data-repo="' + re.escape(repo) + '"', repo, "專案磚")
cross("arthur", AD, r"repos/\$\{SAGA_REPO\}/issues", "eastone.saga", "開拍短劇")
cross("arthur", AD, r"stats/manual\.json", "eastone.saga", "回報數據")
cross("arthur", AD, r"contents/queue\.yaml", "eastone.ecommerce/queue.yaml", "發文佇列")
cross("arthur", JL, r"contents/queue\.yaml", "eastone.ecommerce/queue.yaml", "發文佇列")
cross("arthur", AD, r'from\("arthur_dpf_inbox"\)\.insert', "eastone.dpf", "送出商品任務")
cross("arthur", JL, r'from\("arthur_dpf_inbox"\)\.insert', "eastone.dpf", "送出商品任務")
cross("arthur", AD, r"repos/eastonesd/eastone\.com/contents", "eastone.com/.github/workflows/daily-snapshot.yml", "影音日報")
cross("arthur", HUB, r"stats/monetization\.json", "eastone.saga", "營利進度")
cross("arthur", HUB, r"dashboard/data/meta\.json", "eastone.ecommerce", "發文統計")
cross("arthur", "script.js", r"clients\.db", "eastone.com", "匯入保戶")
cross("eastone.dpf", "app/src/arthurInbox.ts", r"action: 'claim'", "arthur/" + HUB, "領取收件匣")
cross("eastone.com", "tools/snapshot.mjs", r"eastone\.com/market/index\.html", "eastone.com/market/index.html", "截圖頁面")

ids = {n["id"] for n in nodes}
assert all(e[0] in ids and e[1] in ids for e in edges), "有關聯找不到節點"
OUT.write_text(("window.ATLAS=" if OUT.name == "atlas-data.js" else "const DATA=") + json.dumps({"repos": repos, "nodes": nodes, "edges": edges}, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")
by = {}
for n in nodes: by.setdefault(repos[n["r"]]["r"], [0, 0]); by[repos[n["r"]]["r"]][0] += n["type"] == "file"; by[repos[n["r"]]["r"]][1] += len(n.get("sy", []))
rel = {}
for e in edges: rel[e[2]] = rel.get(e[2], 0) + 1
print("專案", len(repos), "節點", len(nodes), "關聯", len(edges), "定義", sum(v[1] for v in by.values()))
print(by); print(rel)
