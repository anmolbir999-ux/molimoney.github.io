"""Daily pre-market Nifty checklist (Part 1), with an honest hit-rate tracker.

Run it before 9:15 AM IST. It scores 7 factors +1 / 0 / -1 and logs the result.
Later, `--evaluate` compares your logged scores with what the Nifty actually did,
so you can measure whether the checklist has ANY predictive value for you.

  python checklist.py --gift 0.4                          # GIFT Nifty is +0.4% vs Nifty's close
  python checklist.py --gift -0.6 --fii -3200 --dii 2800 --event "RBI policy"
  python checklist.py --evaluate                          # hit rate of past logs

Data: yfinance for S&P 500, Nasdaq, Brent, USD/INR, India VIX, Nifty.
GIFT Nifty and FII/DII figures are not on yfinance – type them in from NSE / your
broker app (NSE publishes provisional FII/DII cash data every evening). The script
tries to fetch FII/DII from NSE automatically, but NSE often blocks scripts.

Honest caveat: most of this information is already priced in by the open. Expect a
hit rate near 50% for anything beyond the opening gap. Use it for CONTEXT and risk
sizing ("VIX spiking → trade smaller"), not as a prediction machine.
"""

from __future__ import annotations

import argparse
import csv
from datetime import date
from pathlib import Path

import pandas as pd
import yfinance as yf

import indicators as ind

LOG = Path("checklist_log.csv")
SYMBOLS = {"S&P 500": "^GSPC", "Nasdaq": "^IXIC", "Brent crude": "BZ=F", "USD/INR": "INR=X",
           "India VIX": "^INDIAVIX", "Nifty 50": "^NSEI"}


def last_change(sym: str) -> tuple[float, float, pd.Timestamp]:
    df = yf.download(sym, period="1y", auto_adjust=True, progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    c = df["Close"].dropna()
    return float(c.iloc[-1]), float(c.iloc[-1] / c.iloc[-2] - 1) * 100, c.index[-1]


def fetch_fii_dii() -> tuple[float | None, float | None]:
    """Best effort: NSE's public JSON (needs browser-like headers + cookies; may be blocked)."""
    try:
        import requests
        s = requests.Session()
        h = {"User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://www.nseindia.com/"}
        s.get("https://www.nseindia.com", headers=h, timeout=8)
        rows = s.get("https://www.nseindia.com/api/fiidiiTradeReact", headers=h, timeout=8).json()
        vals = {r["category"].split("/")[0].strip().upper(): float(r["netValue"]) for r in rows}
        return vals.get("FII"), vals.get("DII")
    except Exception:
        return None, None


def score(cond_pos: bool, cond_neg: bool) -> int:
    return 1 if cond_pos else -1 if cond_neg else 0


def run(a) -> None:
    rows = []
    if a.gift is not None:
        rows.append(("GIFT Nifty vs prev close", f"{a.gift:+.2f}%", score(a.gift > 0.3, a.gift < -0.3)))
    else:
        rows.append(("GIFT Nifty vs prev close", "not given (--gift)", 0))

    _, spx, _ = last_change(SYMBOLS["S&P 500"])
    _, ndx, _ = last_change(SYMBOLS["Nasdaq"])
    us = (spx + ndx) / 2
    rows.append(("US markets overnight", f"S&P {spx:+.2f}%, Nasdaq {ndx:+.2f}%", score(us > 0.3, us < -0.3)))

    brent, b_chg, _ = last_change(SYMBOLS["Brent crude"])
    rows.append(("Brent crude", f"${brent:.1f} ({b_chg:+.2f}%)", score(b_chg < -1, b_chg > 2)))

    inr, i_chg, _ = last_change(SYMBOLS["USD/INR"])
    rows.append(("USD/INR", f"₹{inr:.2f} ({i_chg:+.2f}%)", score(i_chg < -0.2, i_chg > 0.3)))

    fii, dii = a.fii, a.dii
    if fii is None and dii is None and not a.no_fetch:
        fii, dii = fetch_fii_dii()
    if fii is not None or dii is not None:
        net = (fii or 0) + (dii or 0)
        rows.append(("FII + DII net (₹ cr)", f"FII {fii or 0:+,.0f}, DII {dii or 0:+,.0f}",
                     score(net > 500, net < -500)))
    else:
        rows.append(("FII + DII net (₹ cr)", "not available (--fii/--dii)", 0))

    vix, v_chg, _ = last_change(SYMBOLS["India VIX"])
    rows.append(("India VIX", f"{vix:.2f} ({v_chg:+.1f}%)", score(v_chg < -3, v_chg > 5)))

    n = yf.download("^NSEI", period="1y", auto_adjust=True, progress=False)
    if isinstance(n.columns, pd.MultiIndex):
        n.columns = n.columns.get_level_values(0)
    close, s50 = float(n["Close"].iloc[-1]), float(ind.sma(n["Close"], 50).iloc[-1])
    rows.append(("Nifty vs 50-DMA", f"{close:,.0f} vs {s50:,.0f}", score(close > s50, close < s50)))

    total = sum(r[2] for r in rows)
    print(f"\nPRE-MARKET CHECKLIST – {date.today()}\n" + "-" * 70)
    for name, val, sc in rows:
        print(f"  {name:<26} {val:<32} {sc:+d}")
    print("-" * 70)
    tilt = "POSITIVE tilt" if total >= 4 else "NEGATIVE tilt" if total <= -4 else "NO clear signal"
    print(f"  TOTAL {total:+d}  →  {tilt}")
    if a.event:
        print(f"  ⚠ Event today: {a.event} – HIGH uncertainty, consider smaller size / no trade.")
    exp_move = vix / (252 ** 0.5)
    print(f"  India VIX implies a typical daily move of about ±{exp_move:.2f}% "
          f"(±{close * exp_move / 100:,.0f} Nifty points, 1 std dev).")
    print("\n  This is context, not a forecast. Most F&O traders lose money (SEBI).")

    new = not LOG.exists()
    with LOG.open("a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["date", "total"] + [r[0] for r in rows] + ["event"])
        w.writerow([date.today().isoformat(), total] + [r[2] for r in rows] + [a.event or ""])
    print(f"\n  Logged to {LOG}. Run with --evaluate after a few weeks.")


def evaluate() -> None:
    if not LOG.exists():
        raise SystemExit("No log yet – run the checklist on some mornings first.")
    log = pd.read_csv(LOG, parse_dates=["date"]).drop_duplicates("date", keep="last").set_index("date")
    n = yf.download("^NSEI", start=log.index.min() - pd.Timedelta(days=7), auto_adjust=True, progress=False)
    if isinstance(n.columns, pd.MultiIndex):
        n.columns = n.columns.get_level_values(0)
    day_ret = n["Close"].pct_change() * 100           # close-to-close return of that session
    gap = (n["Open"] / n["Close"].shift(1) - 1) * 100  # opening gap
    oc = (n["Close"] / n["Open"] - 1) * 100            # intraday move after the open
    df = log.join(pd.DataFrame({"day": day_ret, "gap": gap, "intraday": oc}), how="inner")
    sig = df[df["total"].abs() >= 2]
    if sig.empty:
        raise SystemExit("Not enough logged days with |score| >= 2 yet.")
    print(f"\nChecklist evaluation: {len(df)} logged sessions, {len(sig)} with |score| ≥ 2\n")
    for col, label in (("day", "Full day (close→close)"), ("gap", "Opening gap"),
                       ("intraday", "After the open (open→close)")):
        hit = ((sig["total"] > 0) == (sig[col] > 0)).mean()
        print(f"  {label:<30} hit rate {hit:.0%}")
    print("\n  ~50% = coin toss. Expect the opening gap to be predictable (GIFT Nifty already "
          "shows it)\n  and the move after the open to be close to random.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gift", type=float, help="GIFT Nifty %% change vs Nifty's previous close")
    ap.add_argument("--fii", type=float, help="FII/FPI net cash buy(+)/sell(-) yesterday, ₹ crore")
    ap.add_argument("--dii", type=float, help="DII net, ₹ crore")
    ap.add_argument("--event", default="", help="e.g. 'RBI policy', 'CPI', 'Fed', 'Budget'")
    ap.add_argument("--no-fetch", action="store_true", help="don't try to fetch FII/DII from NSE")
    ap.add_argument("--evaluate", action="store_true")
    a = ap.parse_args()
    evaluate() if a.evaluate else run(a)


if __name__ == "__main__":
    main()
