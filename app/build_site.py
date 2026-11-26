"""Build the minimalist offline site that the Android app displays.

  pip install markdown pygments
  python app/build_site.py            # writes app/www/
  python app/build_site.py --charts   # also regenerates sample charts (needs internet + algo deps)

Sources: lessons/*.md, algo/*.py, algo/*.md, and charts in app/www/charts/.
"""

from __future__ import annotations

import argparse
import html
import re
import shutil
import subprocess
import sys
from pathlib import Path

import markdown
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import PythonLexer

ROOT = Path(__file__).resolve().parent.parent
LESSONS, ALGO = ROOT / "lessons", ROOT / "algo"
OUT = ROOT / "app" / "www"

PAGES = [  # (slug, source, short title, subtitle)
    ("part-1", "part-1-nifty.md", "How the Nifty moves", "Weightage, drivers, daily checklist"),
    ("part-2", "part-2-charts.md", "Reading charts", "Chart types, patterns, indicators"),
    ("part-3", "part-3-quant-strategies.md", "Quant strategies", "Strategy families, research process"),
    ("part-3b", "part-3b-giant-firms.md", "The giant firms", "BlackRock to Jane Street, risk, execution"),
    ("part-4", "part-4-first-algorithm.md", "Your first algorithm", "Backtest, paper trade, Kite, SEBI"),
    ("part-5", "part-5-books.md", "Books", "Eight books + Zerodha Varsity"),
]
DOCS = [("toolkit", ALGO / "README.md", "Toolkit guide"), ("sebi", ALGO / "SEBI_RULES.md", "SEBI rules")]
CHARTS = [
    ("RELIANCE_NS_sma_cross.png", "50/200 SMA crossover backtest – Reliance, 15 years"),
    ("ICICIBANK_NS_candle_6mo_1d.png", "Candlesticks with patterns, S/R, RSI, MACD – ICICI Bank"),
    ("TCS_NS_heikin_6mo_1d.png", "Heikin-Ashi – TCS"),
    ("INFY_NS_bar_3mo_1d.png", "OHLC bars with ATR – Infosys"),
    ("RELIANCE_NS_line_5d_15m.png", "Intraday line chart with VWAP – Reliance"),
    ("pairs_HDFCBANK_ICICIBANK.png", "Pairs trade – HDFC Bank vs ICICI Bank"),
    ("factor_momentum_top10.png", "Momentum factor portfolio vs Nifty"),
    ("portfolio_risk.png", "Allocation methods on Indian ETFs"),
]
CHART_CMDS = [  # run from algo/ with --outdir <charts>
    ["backtest.py", "RELIANCE.NS"],
    ["chart.py", "ICICIBANK.NS", "--patterns", "--levels", "-i", "sma20,sma50,bb,volume,rsi,macd"],
    ["chart.py", "TCS.NS", "--kind", "heikin", "-i", "ema20"],
    ["chart.py", "INFY.NS", "--kind", "bar", "-i", "atr", "--period", "3mo"],
    ["chart.py", "RELIANCE.NS", "--interval", "15m", "--period", "5d", "--kind", "line", "-i", "vwap,volume"],
    ["pairs.py"], ["factor_portfolio.py"], ["portfolio_risk.py"],
]

CSS = """
:root{--bg:#fff;--fg:#111;--mut:#6b6b6b;--line:#e8e8e8;--soft:#f6f6f6;--acc:#111}
@media (prefers-color-scheme:dark){:root{--bg:#0e0e0e;--fg:#ececec;--mut:#9a9a9a;--line:#262626;--soft:#181818;--acc:#fff}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,system-ui,Roboto,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:20px 18px 64px}
a{color:var(--fg)}
header{display:flex;align-items:center;gap:12px;margin:4px 0 20px}
header a.back{text-decoration:none;font-size:22px;line-height:1;padding:4px 8px 4px 0}
header .t{font-size:13px;color:var(--mut);letter-spacing:.04em;text-transform:uppercase}
h1{font-size:28px;line-height:1.2;margin:8px 0 6px;letter-spacing:-.01em}
h2{font-size:20px;margin:36px 0 10px;padding-top:16px;border-top:1px solid var(--line)}
h3{font-size:17px;margin:26px 0 8px}
p,li{color:var(--fg)}
.sub{color:var(--mut);margin:0 0 28px}
ul.list{list-style:none;padding:0;margin:0}
ul.list li{border-top:1px solid var(--line)}
ul.list li:last-child{border-bottom:1px solid var(--line)}
ul.list a{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 2px;text-decoration:none}
ul.list .n{font-size:12px;color:var(--mut);min-width:30px}
ul.list .x{flex:1}
ul.list .x b{display:block;font-weight:600}
ul.list .x span{font-size:14px;color:var(--mut)}
ul.list .a{color:var(--mut)}
.sec{font-size:12px;color:var(--mut);letter-spacing:.06em;text-transform:uppercase;margin:34px 0 8px}
table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto;margin:14px 0}
th,td{border-bottom:1px solid var(--line);padding:8px 10px 8px 0;text-align:left;vertical-align:top}
th{font-weight:600;white-space:nowrap}
code{font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--soft);padding:1px 5px;border-radius:4px}
pre{background:var(--soft);padding:14px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.5}
pre code{background:none;padding:0}
blockquote{margin:16px 0;padding:2px 0 2px 14px;border-left:3px solid var(--fg);color:var(--mut)}
img{max-width:100%;height:auto;border-radius:6px;border:1px solid var(--line);background:#fff}
figure{margin:0 0 30px}
figcaption{font-size:14px;color:var(--mut);margin-top:8px}
hr{display:none}
.hl,.hl pre{background:var(--soft)!important}
.note{font-size:13px;color:var(--mut);margin-top:40px;border-top:1px solid var(--line);padding-top:14px}
.nav{display:flex;justify-content:space-between;gap:12px;margin-top:40px;font-size:14px}
.nav a{text-decoration:none;color:var(--mut)}
"""

DISCLAIMER = ("Educational only, not investment advice. SEBI found 87.7% of individual "
              "F&O traders lost money in FY26.")


def page(title: str, body: str, back: str | None = "index.html", label: str = "") -> str:
    head = (f'<header><a class="back" href="{back}" aria-label="Back">←</a>'
            f'<span class="t">{html.escape(label)}</span></header>') if back else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{html.escape(title)}</title><link rel="stylesheet" href="style.css"></head>
<body><main>{head}{body}<p class="note">{DISCLAIMER}</p></main></body></html>"""


def fix_links(md: str) -> str:
    """Point markdown links at the app's own pages."""
    mapping = {src: f"{slug}.html" for slug, src, *_ in PAGES}
    mapping.update({"../algo/SEBI_RULES.md": "sebi.html", "SEBI_RULES.md": "sebi.html",
                    "../algo": "code.html", "../algo/": "code.html", "README.md": "index.html"})

    def sub(m):
        text, url = m.group(1), m.group(2)
        if url in mapping:
            return f"[{text}]({mapping[url]})"
        if url.startswith("http"):
            return m.group(0)
        if url.endswith(".py"):
            return f"[{text}](code-{Path(url).stem}.html)"
        return text
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", sub, md)


def render_md(text: str) -> str:
    text = fix_links(text)
    text = text.replace("- [ ] ", "- ☐ ")
    return markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])


def build(regen_charts: bool) -> None:
    charts_dir = OUT / "charts"
    keep = charts_dir.exists()
    if keep:
        tmp = ROOT / "app" / ".charts_tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.copytree(charts_dir, tmp)
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    if keep:
        shutil.move(str(tmp), charts_dir)
    charts_dir.mkdir(exist_ok=True)

    if regen_charts:
        for cmd in CHART_CMDS:
            print("chart:", " ".join(cmd))
            subprocess.run([sys.executable, *cmd, "--outdir", str(charts_dir)], cwd=ALGO, check=False,
                           stdout=subprocess.DEVNULL)
        for p in charts_dir.glob("*.png"):
            if p.name not in {c for c, _ in CHARTS}:
                p.unlink()

    light = HtmlFormatter(style="friendly").get_style_defs(".hl")
    dark = HtmlFormatter(style="monokai").get_style_defs(".hl")
    (OUT / "style.css").write_text(CSS + light + "\n@media (prefers-color-scheme:dark){" + dark + "}\n"
                                   + ".hl,.hl pre{background:var(--soft)!important}")

    # lessons
    for i, (slug, src, title, sub) in enumerate(PAGES):
        body = render_md((LESSONS / src).read_text())
        prev_ = f'<a href="{PAGES[i - 1][0]}.html">← {PAGES[i - 1][2]}</a>' if i else "<span></span>"
        next_ = f'<a href="{PAGES[i + 1][0]}.html">{PAGES[i + 1][2]} →</a>' if i + 1 < len(PAGES) else "<span></span>"
        label = f"Part {slug.split('-')[1].upper()}"
        (OUT / f"{slug}.html").write_text(page(title, body + f'<div class="nav">{prev_}{next_}</div>', label=label))

    for slug, src, title in DOCS:
        (OUT / f"{slug}.html").write_text(page(title, render_md(src.read_text()), label="Toolkit"))

    # code
    files = sorted(ALGO.glob("*.py"))
    items = []
    for f in files:
        src = f.read_text()
        doc = re.match(r'\s*"""(.*?)(\n|""")', src, re.S)
        first = doc.group(1).strip() if doc else ""
        items.append(f'<li><a href="code-{f.stem}.html"><span class="x"><b>{f.name}</b>'
                     f'<span>{html.escape(first)}</span></span><span class="a">›</span></a></li>')
        code = highlight(src, PythonLexer(), HtmlFormatter(cssclass="hl", nowrap=False))
        (OUT / f"code-{f.stem}.html").write_text(
            page(f.name, f"<h1>{f.name}</h1><p class='sub'>{len(src.splitlines())} lines · "
                         f"algo/{f.name}</p>{code}", back="code.html", label="Code"))
    (OUT / "code.html").write_text(page("Code", "<h1>Code</h1><p class='sub'>The Python toolkit in "
                                        "<code>algo/</code>. Runs on a computer, not on the phone.</p>"
                                        f'<ul class="list">{"".join(items)}</ul>', label="Toolkit"))

    # charts
    figs = "".join(f'<figure><img src="charts/{n}" alt="{html.escape(c)}" loading="lazy">'
                   f"<figcaption>{html.escape(c)}</figcaption></figure>"
                   for n, c in CHARTS if (charts_dir / n).exists())
    (OUT / "charts.html").write_text(page("Charts", "<h1>Charts</h1><p class='sub'>Sample outputs from the "
                                          "toolkit on real NSE data.</p>" + figs, label="Toolkit"))

    # home
    lessons = "".join(f'<li><a href="{s}.html"><span class="n">{s.split("-")[1].upper()}</span>'
                      f'<span class="x"><b>{t}</b><span>{st}</span></span><span class="a">›</span></a></li>'
                      for s, _, t, st in PAGES)
    tools = "".join(f'<li><a href="{h}"><span class="x"><b>{t}</b><span>{st}</span></span>'
                    f'<span class="a">›</span></a></li>' for h, t, st in [
                        ("toolkit.html", "Toolkit guide", "What each script does and how to run it"),
                        ("code.html", "Code", f"{len(files)} Python files"),
                        ("charts.html", "Charts", "Backtests, patterns, pairs, factors"),
                        ("sebi.html", "SEBI rules", "Retail algo framework, F&O, tax"),
                    ])
    home = ('<h1>Markets &amp; Algos</h1><p class="sub">Nifty, charts, quant strategies and your first '
            'trading algorithm.</p>'
            f'<div class="sec">Lessons</div><ul class="list">{lessons}</ul>'
            f'<div class="sec">Toolkit</div><ul class="list">{tools}</ul>')
    (OUT / "index.html").write_text(page("Markets & Algos", home, back=None))
    print(f"Site built: {OUT} ({len(list(OUT.rglob('*')))} files)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--charts", action="store_true", help="regenerate sample charts first")
    build(ap.parse_args().charts)
