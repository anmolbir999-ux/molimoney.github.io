"""Portfolio construction & risk management (Part 3B).

Compares the allocation methods used by big asset managers on Indian ETFs:
  equal      : same rupees in every asset
  60/40      : 60% equity / 40% bonds (the classic balanced fund)
  inv_vol    : weight ∝ 1/volatility (naive risk parity)
  risk_parity: equal RISK contribution from each asset (Bridgewater "All Weather" idea, unlevered)
  min_var    : minimum-variance weights (long-only)
Rebalanced monthly using the trailing 1-year covariance (no look-ahead).

Also reports: correlation matrix, each asset's risk contribution, historical VaR / CVaR
in rupees, the portfolio's beta to the Nifty, and the Nifty-futures hedge that would
neutralise that beta.

  python portfolio_risk.py
  python portfolio_risk.py --capital 500000 --assets NIFTYBEES.NS GOLDBEES.NS LTGILTBEES.NS
  python portfolio_risk.py --lot-size 65          # check NSE for the current Nifty lot size

Educational only. Futures hedging is F&O: SEBI found ~9 in 10 individual F&O traders lose money.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from charts import plot_equity
from data import NIFTY, closes
from metrics import performance, table

DEFAULT = {"NIFTYBEES.NS": "Nifty 50", "JUNIORBEES.NS": "Nifty Next 50", "MON100.NS": "Nasdaq 100",
           "GOLDBEES.NS": "Gold", "LTGILTBEES.NS": "Long govt bonds"}
EQUITY_HINT = ("NIFTY", "JUNIOR", "MON100", "BANKBEES", "MIDCAP")


def risk_contrib(w: np.ndarray, cov: np.ndarray) -> np.ndarray:
    port_var = w @ cov @ w
    return w * (cov @ w) / port_var


def erc_weights(cov: np.ndarray, iters: int = 500) -> np.ndarray:
    """Equal-risk-contribution weights via simple fixed-point iteration."""
    n = len(cov)
    w = np.ones(n) / n
    for _ in range(iters):
        mrc = cov @ w
        w_new = 1 / np.maximum(mrc, 1e-12)
        w_new /= w_new.sum()
        w = 0.5 * w + 0.5 * w_new
    return w / w.sum()


def min_var_weights(cov: np.ndarray, iters: int = 2000, lr: float = 0.5) -> np.ndarray:
    """Long-only minimum variance via projected gradient descent."""
    n = len(cov)
    w = np.ones(n) / n
    scale = np.trace(cov) / n
    for _ in range(iters):
        w = w - lr * (cov @ w) / scale
        w = np.maximum(w, 0)
        w = w / w.sum() if w.sum() > 0 else np.ones(n) / n
    return w


def weights_for(method: str, cov: np.ndarray, cols: list[str]) -> np.ndarray:
    n = len(cols)
    if method == "equal":
        return np.ones(n) / n
    if method == "60/40":
        eq = np.array([any(h in c for h in EQUITY_HINT) for c in cols], float)
        bd = np.array(["GILT" in c or "BOND" in c for c in cols], float)
        if eq.sum() == 0 or bd.sum() == 0:
            return np.ones(n) / n
        return 0.6 * eq / eq.sum() + 0.4 * bd / bd.sum()
    vol = np.sqrt(np.diag(cov))
    if method == "inv_vol":
        w = 1 / vol
        return w / w.sum()
    if method == "risk_parity":
        return erc_weights(cov)
    if method == "min_var":
        return min_var_weights(cov)
    raise ValueError(method)


def backtest(px: pd.DataFrame, method: str, capital: float, cost_pct: float) -> tuple[pd.Series, np.ndarray]:
    rets = px.pct_change().fillna(0)
    days = px.index[252:]
    month_start = set(pd.Series(days, index=days).groupby([days.year, days.month]).first())
    w = np.zeros(px.shape[1])
    value, eq = capital, []
    for d in days:
        r = rets.loc[d].to_numpy()
        pr = float(w @ r)
        value *= 1 + pr
        if w.sum() > 0:
            w = w * (1 + r) / (1 + pr)
        if d in month_start:
            hist = rets.loc[:d].iloc[-252:]
            new_w = weights_for(method, hist.cov().to_numpy() * 252, list(px.columns))
            value *= 1 - np.abs(new_w - w).sum() * cost_pct / 100
            w = new_w
        eq.append(value)
    return pd.Series(eq, index=days), w


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--assets", nargs="+", default=list(DEFAULT))
    ap.add_argument("--capital", type=float, default=100_000)
    ap.add_argument("--cost", type=float, default=0.15, help="%% cost per unit of turnover")
    ap.add_argument("--rf", type=float, default=6.0)
    ap.add_argument("--lot-size", type=int, default=65, help="Nifty futures lot size (verify on NSE)")
    ap.add_argument("--outdir", default="charts")
    a = ap.parse_args()

    px = closes(a.assets + [NIFTY], "2000-01-01").dropna()
    nifty = px.pop(NIFTY)
    px = px[[c for c in a.assets if c in px.columns]]
    print(f"\nData {px.index[0].date()} → {px.index[-1].date()} (limited by the youngest ETF); "
          f"backtest starts after a 1-year warm-up.\n")

    rets = px.pct_change().dropna()
    names = {c: DEFAULT.get(c, c) for c in px.columns}
    print("Correlation of daily returns (low/negative = real diversification):")
    print(rets.rename(columns=names).corr().round(2).to_string(), "\n")

    methods = ["equal", "60/40", "inv_vol", "risk_parity", "min_var"]
    curves, final_w, cols = {}, {}, {}
    for m in methods:
        eq, w = backtest(px, m, a.capital, a.cost)
        curves[m], final_w[m] = eq, w
        cols[m] = performance(eq, a.rf)
    bench = a.capital * nifty.loc[curves["equal"].index] / nifty.loc[curves["equal"].index[0]]
    cols["Nifty 50 only"] = performance(bench, a.rf)
    print(table(cols))

    cov = rets.iloc[-252:].cov().to_numpy() * 252
    print("\nCurrent weights → share of total RISK each asset contributes:")
    rows = []
    for m in methods:
        w = final_w[m]
        rc = risk_contrib(w, cov)
        rows.append({"method": m, **{f"{names[c]}": f"{w[i]:.0%} → {rc[i]:.0%}" for i, c in enumerate(px.columns)}})
    print(pd.DataFrame(rows).set_index("method").to_string())
    print("  (An 'equal-rupee' portfolio is NOT equal-risk: equity usually dominates the risk.)")

    # Value-at-Risk for the risk-parity portfolio and the Nifty
    print(f"\nOne-day risk on ₹{a.capital:,.0f} (historical, last 3 years):")
    for label, series in (("risk_parity", curves["risk_parity"]), ("Nifty 50 only", bench)):
        r = series.pct_change().dropna().iloc[-756:]
        var95 = -np.percentile(r, 5)
        cvar95 = -r[r <= -var95].mean()
        var99 = -np.percentile(r, 1)
        print(f"  {label:<14} VaR95 ₹{var95 * a.capital:>8,.0f}   CVaR95 ₹{cvar95 * a.capital:>8,.0f}   "
              f"VaR99 ₹{var99 * a.capital:>8,.0f}")
    print("  VaR95 = loss exceeded on ~1 day in 20. CVaR = average loss on those bad days. "
          "Real crashes can be far worse.")

    # Beta hedge
    pr = curves["equal"].pct_change().dropna().iloc[-252:]
    nr = nifty.pct_change().reindex(pr.index)
    beta = pr.cov(nr) / nr.var()
    notional = beta * a.capital
    lot_value = float(nifty.iloc[-1]) * a.lot_size
    print(f"\nHedging: equal-weight portfolio beta to Nifty ≈ {beta:.2f}. To neutralise it you'd short "
          f"₹{notional:,.0f} of Nifty futures = {notional / lot_value:.2f} lots (1 lot ≈ ₹{lot_value:,.0f}).")
    print("  At small capital you can't hedge precisely (lots are indivisible), one reason hedging is "
          "an institutional tool.")

    Path(a.outdir).mkdir(parents=True, exist_ok=True)
    out = Path(a.outdir) / "portfolio_risk.png"
    plot_equity({**{m: curves[m] for m in methods}, "Nifty 50 only": bench}, out,
                "Allocation methods on Indian ETFs (monthly rebalance)")
    print(f"\nChart saved: {out}\nEducational only. Not investment advice.")


if __name__ == "__main__":
    main()
