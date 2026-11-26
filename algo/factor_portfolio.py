"""Factor investing portfolio (Parts 3 & 3B: what BlackRock's factor ETFs / quant funds do).

Each month: rank a universe of large NSE stocks on a factor, hold the top N equally
weighted, rebalance next month. Costs are charged on turnover.

Factors available from price data alone:
  momentum  : 12-month return skipping the last month ("12-1"), the classic definition
  lowvol    : lowest 1-year daily volatility (defensive / low-volatility factor)
  combo     : average rank of momentum and low volatility
Value and quality need fundamentals (P/E, ROE, debt) that yfinance history doesn't
provide. Look at NSE's Nifty200 Value 30 / Quality 30 indices and their ETFs.

  python factor_portfolio.py                       # momentum, top 10, 15 years
  python factor_portfolio.py --factor lowvol --top 15
  python factor_portfolio.py --factor combo --years 10

WARNING – survivorship bias: the universe is TODAY's large caps. Companies that
shrank or went bust over the period are missing, which flatters the results.
Real research uses point-in-time index membership.
"""

from __future__ import annotations

import argparse
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from charts import plot_equity
from costs import CostModel
from data import NIFTY, closes, download
from metrics import performance, table

UNIVERSE = [
    "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "ITC", "LT", "KOTAKBANK", "AXISBANK",
    "SBIN", "BHARTIARTL", "HINDUNILVR", "BAJFINANCE", "ASIANPAINT", "MARUTI", "SUNPHARMA",
    "TITAN", "ULTRACEMCO", "NESTLEIND", "WIPRO", "HCLTECH", "TECHM", "POWERGRID", "NTPC",
    "ONGC", "M&M", "TATASTEEL", "JSWSTEEL", "HINDALCO", "ADANIPORTS", "CIPLA", "DRREDDY",
    "GRASIM", "BAJAJ-AUTO", "HEROMOTOCO", "EICHERMOT", "BRITANNIA", "COALINDIA", "INDUSINDBK",
    "BAJAJFINSV",
]


def scores(px: pd.DataFrame, day: pd.Timestamp, factor: str) -> pd.Series:
    hist = px.loc[:day]
    if len(hist) < 260:
        return pd.Series(dtype=float)
    mom = hist.iloc[-21] / hist.iloc[-252] - 1                        # 12-1 momentum
    vol = hist.iloc[-252:].pct_change().std()
    ok = hist.iloc[-252:].notna().all()                                # needs a full year of data
    mom, vol = mom[ok].dropna(), vol[ok].dropna()
    if factor == "momentum":
        return mom
    if factor == "lowvol":
        return -vol
    return (mom.rank() + (-vol).rank()) / 2


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--factor", choices=["momentum", "lowvol", "combo"], default="momentum")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--years", type=int, default=15)
    ap.add_argument("--capital", type=float, default=100_000)
    ap.add_argument("--slippage", type=float, default=0.1, help="%% per side")
    ap.add_argument("--rf", type=float, default=6.0)
    ap.add_argument("--outdir", default="charts")
    a = ap.parse_args()

    start = date.today().replace(year=date.today().year - a.years)
    px = closes([t + ".NS" for t in UNIVERSE], start - timedelta(days=420))
    nifty = download(NIFTY, start, None)["Close"]
    rets = px.pct_change().fillna(0)
    days = px.loc[pd.Timestamp(start):].index
    month_starts = set(pd.Series(days, index=days).groupby([days.year, days.month]).first())

    cm = CostModel()
    side_cost = {s: (cm.approx_pct(s) + a.slippage) / 100 for s in ("BUY", "SELL")}

    w = pd.Series(0.0, index=px.columns)
    value, eq, holdings_log, total_cost = a.capital, [], [], 0.0
    for d in days:
        r = rets.loc[d]
        # drift: the portfolio earns today's returns on yesterday's weights
        port_r = float((w * r).sum())
        value *= 1 + port_r
        if w.sum() > 0:
            w = w * (1 + r) / (1 + port_r)
        if d in month_starts:  # rebalance at today's close using data up to today
            s = scores(px, d, a.factor)
            if len(s) >= a.top:
                picks = s.nlargest(a.top).index
                new_w = pd.Series(0.0, index=px.columns)
                new_w[picks] = 1 / a.top
                delta = new_w - w
                c = delta.clip(lower=0).sum() * side_cost["BUY"] + (-delta).clip(lower=0).sum() * side_cost["SELL"]
                value *= 1 - c
                total_cost += c * value
                w = new_w
                holdings_log.append((d.date(), [p.replace(".NS", "") for p in picks]))
        eq.append(value)

    equity = pd.Series(eq, index=days)
    bench = a.capital * nifty.reindex(days).ffill() / nifty.reindex(days).ffill().iloc[0]
    ew = a.capital * (1 + rets.loc[days].mean(axis=1)).cumprod()  # equal-weight universe, daily rebal

    print(f"\nFactor portfolio: {a.factor}, top {a.top} of {px.shape[1]} stocks, monthly rebalance")
    print(f"{days[0].date()} → {days[-1].date()}   costs ≈ ₹{total_cost:,.0f}\n")
    print(table({f"{a.factor} top {a.top}": performance(equity, a.rf),
                 "Equal-weight universe": performance(ew, a.rf),
                 "Nifty 50 (price index)": performance(bench, a.rf)}))
    print("\nLatest holdings:")
    for d, picks in holdings_log[-3:]:
        print(f"  {d}: {', '.join(picks)}")

    Path(a.outdir).mkdir(parents=True, exist_ok=True)
    out = Path(a.outdir) / f"factor_{a.factor}_top{a.top}.png"
    plot_equity({f"{a.factor} top {a.top}": equity, "Equal-weight universe": ew, "Nifty 50": bench},
                out, f"Factor portfolio – {a.factor}")
    print(f"\nChart saved: {out}\nSurvivorship bias applies (today's large caps). Educational only.")


if __name__ == "__main__":
    main()
