"""Pairs trading / statistical arbitrage (Part 3).

Idea: two related stocks (e.g. HDFCBANK & ICICIBANK) tend to move together. When the
spread between them stretches unusually far (z-score beyond ±entry), bet that it
snaps back: buy the cheap one, short the expensive one. Exit when it normalises.

  spread_t = log(Y) - beta_t × log(X)      beta from a rolling regression (past data only)
  z_t      = (spread_t - mean) / std       over the same rolling window

Reality check for Indian retail traders:
  * You CANNOT hold an overnight short in the cash market. A real pairs trade needs
    stock futures (big lot sizes, margin, monthly rollover costs) – that is F&O,
    where SEBI found ~9 in 10 individual traders lose money.
  * Correlation ≠ cointegration. Pairs that "always" moved together can split for
    years (mergers, regulation, one bank's bad loans). Use the stop-z exit.
  * Costs here are a flat assumption per leg; futures also have rollover & margin costs.

  python pairs.py HDFCBANK.NS ICICIBANK.NS
  python pairs.py TCS.NS INFY.NS --lookback 90 --entry-z 2 --exit-z 0.5 --stop-z 4
"""

from __future__ import annotations

import argparse
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from charts import plot_equity
from data import closes
from metrics import performance, table


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("y", nargs="?", default="HDFCBANK.NS")
    ap.add_argument("x", nargs="?", default="ICICIBANK.NS")
    ap.add_argument("--years", type=int, default=10)
    ap.add_argument("--lookback", type=int, default=60)
    ap.add_argument("--entry-z", type=float, default=2.0)
    ap.add_argument("--exit-z", type=float, default=0.5)
    ap.add_argument("--stop-z", type=float, default=4.0)
    ap.add_argument("--cost-bps", type=float, default=10, help="cost per leg per side, basis points")
    ap.add_argument("--capital", type=float, default=100_000)
    ap.add_argument("--rf", type=float, default=6.0)
    ap.add_argument("--outdir", default="charts")
    a = ap.parse_args()

    start = date.today() - timedelta(days=365 * a.years + 200)
    px = closes([a.y, a.x], start).dropna()
    ly, lx = np.log(px[a.y]), np.log(px[a.x])

    # rolling hedge ratio, lagged one day so today's trade uses yesterday's estimate
    beta = (ly.rolling(a.lookback).cov(lx) / lx.rolling(a.lookback).var()).shift(1)
    spread = ly - beta * lx
    z = (spread - spread.rolling(a.lookback).mean()) / spread.rolling(a.lookback).std()

    # position in the spread: +1 = long Y / short X, -1 = short Y / long X
    pos, cur = [], 0
    for zz in z:
        if np.isnan(zz):
            cur = 0
        elif cur == 0:
            if zz < -a.entry_z and zz > -a.stop_z:
                cur = 1
            elif zz > a.entry_z and zz < a.stop_z:
                cur = -1
        elif abs(zz) < a.exit_z or abs(zz) > a.stop_z:
            cur = 0
        pos.append(cur)
    pos = pd.Series(pos, index=z.index)

    ry, rx = px[a.y].pct_change(), px[a.x].pct_change()
    held = pos.shift(1).fillna(0)                 # decided at close t, earns returns of t+1
    b = beta.shift(1).fillna(1).clip(0.2, 5)
    gross = held * (ry - b * rx) / (1 + b)        # dollar-neutral-ish, gross exposure = 1
    turnover = held.diff().abs().fillna(0)
    costs = turnover * 2 * a.cost_bps / 1e4
    strat = (gross - costs).loc[px.index[a.lookback * 2]:]
    equity = a.capital * (1 + strat.fillna(0)).cumprod()
    hold_y = a.capital * px[a.y].loc[equity.index] / px[a.y].loc[equity.index[0]]

    print(f"\nPairs trade {a.y} vs {a.x}   {equity.index[0].date()} → {equity.index[-1].date()}")
    print(f"Correlation of daily returns: {ry.corr(rx):.2f}")
    try:
        from statsmodels.tsa.stattools import coint
        pval = coint(ly.loc[equity.index], lx.loc[equity.index])[1]
        print(f"Engle-Granger cointegration p-value: {pval:.3f} "
              f"({'cointegrated at 5%' if pval < 0.05 else 'NOT cointegrated at 5% – spread may not mean-revert'})")
    except ImportError:
        print("(pip install statsmodels for a cointegration test)")
    n_trades = int((held.diff() != 0).sum() // 2)
    print(f"Round trips: ~{n_trades}   Time in market: {(held != 0).mean():.1%}\n")
    print(table({"Pairs strategy": performance(equity, a.rf), f"B&H {a.y}": performance(hold_y, a.rf)}))

    Path(a.outdir).mkdir(parents=True, exist_ok=True)
    out = Path(a.outdir) / f"pairs_{a.y.split('.')[0]}_{a.x.split('.')[0]}.png"

    def zpanel(ax):
        zz = z.loc[equity.index]
        ax.plot(zz.index, zz, lw=0.8, color="#555")
        for lvl, col in ((a.entry_z, "red"), (-a.entry_z, "green"), (a.exit_z, "grey"),
                         (-a.exit_z, "grey"), (a.stop_z, "black"), (-a.stop_z, "black")):
            ax.axhline(lvl, color=col, ls="--", lw=0.8)
        p = pos.loc[equity.index]
        ax.fill_between(zz.index, -a.stop_z, a.stop_z, where=p != 0, color="orange", alpha=0.15,
                        label="in a trade")
        ax.set_ylabel("Spread z-score")
        ax.legend(loc="upper left", fontsize=8)

    plot_equity({"Pairs strategy": equity, f"Buy & hold {a.y}": hold_y}, out,
                f"Pairs trade: {a.y} vs {a.x}", extra=zpanel)
    print(f"\nChart saved: {out}\nEducational only. Shorting overnight requires F&O in India.")


if __name__ == "__main__":
    main()
