"""
50/200-day SMA crossover ("Golden Cross / Death Cross") backtest for NSE stocks.

Rules
-----
  BUY  when the 50-day SMA crosses ABOVE the 200-day SMA (golden cross)
  SELL when the 50-day SMA crosses BELOW the 200-day SMA (death cross)
  Long-only, one position at a time, whole shares only.

Realism choices (so the backtest doesn't lie to you)
----------------------------------------------------
  * No look-ahead: the signal is computed on day t's CLOSE and the order is
    filled at day t+1's OPEN.
  * Slippage is applied on every fill (you buy a bit higher, sell a bit lower).
  * Indian delivery-trade costs are charged: brokerage, STT, exchange charges,
    SEBI fee, stamp duty, GST and DP charges (see CostModel below).
  * The first trade waits for a fresh crossover; it does not jump in on day 1.

Metrics reported: CAGR, max drawdown, win rate, Sharpe ratio, number of trades,
time in market, total costs, vs. buy-and-hold of the stock and of the Nifty 50.

Usage
-----
  pip install -r requirements.txt
  python ma_crossover.py                              # RELIANCE.NS, 15 years
  python ma_crossover.py HDFCBANK.NS INFY.NS TCS.NS   # several stocks
  python ma_crossover.py RELIANCE.NS --years 10 --capital 200000 --slippage 0.1

EDUCATIONAL CODE ONLY. Not investment advice. Past performance does not
predict future returns.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # render to files; works without a display
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import yfinance as yf

TRADING_DAYS = 252
NIFTY_TICKER = "^NSEI"


# --------------------------------------------------------------------------
# 1. Costs
# --------------------------------------------------------------------------
@dataclass
class CostModel:
    """Approximate costs of an equity DELIVERY trade on NSE.

    Rates change; check your broker's charges page before relying on them.
    Defaults roughly follow a discount broker such as Zerodha (₹0 delivery
    brokerage). Set brokerage_pct / brokerage_cap for a full-service broker.
    """

    brokerage_pct: float = 0.0        # % of turnover (0 for free delivery)
    brokerage_cap: float = 20.0       # ₹ max per order, if brokerage_pct > 0
    stt_pct: float = 0.1              # Securities Transaction Tax, buy AND sell
    exchange_pct: float = 0.00297     # NSE transaction charge
    sebi_per_crore: float = 10.0      # SEBI turnover fee, ₹10 per ₹1 crore
    stamp_pct_buy: float = 0.015      # stamp duty, buy side only
    gst_pct: float = 18.0             # on brokerage + exchange + SEBI fee
    dp_charge_sell: float = 15.93     # depository charge per sell (per scrip/day)

    def cost(self, turnover: float, side: str) -> float:
        brokerage = min(turnover * self.brokerage_pct / 100, self.brokerage_cap)
        stt = turnover * self.stt_pct / 100
        exchange = turnover * self.exchange_pct / 100
        sebi = turnover * self.sebi_per_crore / 1e7
        stamp = turnover * self.stamp_pct_buy / 100 if side == "BUY" else 0.0
        gst = (brokerage + exchange + sebi) * self.gst_pct / 100
        dp = self.dp_charge_sell if side == "SELL" else 0.0
        return brokerage + stt + exchange + sebi + stamp + gst + dp


# --------------------------------------------------------------------------
# 2. Data
# --------------------------------------------------------------------------
def download(ticker: str, start: date, end: date) -> pd.DataFrame:
    """Daily OHLCV, adjusted for splits/bonuses/dividends."""
    df = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
    if df.empty:
        raise SystemExit(f"No data for {ticker}. Check the symbol (NSE stocks end in .NS).")
    if isinstance(df.columns, pd.MultiIndex):  # newer yfinance returns (field, ticker)
        df.columns = df.columns.get_level_values(0)
    return df[["Open", "High", "Low", "Close", "Volume"]].dropna()


# --------------------------------------------------------------------------
# 3. Signals
# --------------------------------------------------------------------------
def add_signals(df: pd.DataFrame, fast: int, slow: int) -> pd.DataFrame:
    df = df.copy()
    df["SMA_fast"] = df["Close"].rolling(fast).mean()
    df["SMA_slow"] = df["Close"].rolling(slow).mean()
    above = df["SMA_fast"] > df["SMA_slow"]
    prev_above = above.shift(1, fill_value=False)
    valid = df["SMA_slow"].notna() & df["SMA_slow"].shift(1).notna()
    # +1 = golden cross today, -1 = death cross today, 0 = nothing
    df["cross"] = 0
    df.loc[valid & above & ~prev_above, "cross"] = 1
    df.loc[valid & ~above & prev_above, "cross"] = -1
    return df


# --------------------------------------------------------------------------
# 4. Backtest engine (simple event loop: easy to read and to extend)
# --------------------------------------------------------------------------
@dataclass
class Trade:
    entry_date: pd.Timestamp
    entry_price: float
    qty: int
    entry_cost: float
    exit_date: pd.Timestamp | None = None
    exit_price: float | None = None
    exit_cost: float = 0.0

    @property
    def pnl(self) -> float:
        if self.exit_price is None:
            return float("nan")
        gross = (self.exit_price - self.entry_price) * self.qty
        return gross - self.entry_cost - self.exit_cost


@dataclass
class Result:
    equity: pd.Series
    trades: list[Trade] = field(default_factory=list)
    total_costs: float = 0.0
    in_market: pd.Series | None = None


def backtest(
    df: pd.DataFrame,
    capital: float,
    costs: CostModel,
    slippage_pct: float,
    cash_rate_pct: float,
) -> Result:
    cash = capital
    qty = 0
    trades: list[Trade] = []
    total_costs = 0.0
    equity, in_mkt = [], []
    daily_cash_rate = (1 + cash_rate_pct / 100) ** (1 / TRADING_DAYS) - 1
    pending = 0  # order decided at yesterday's close, filled at today's open

    for ts, row in df.iterrows():
        # --- fill yesterday's order at today's open ---
        if pending == 1 and qty == 0:
            price = row["Open"] * (1 + slippage_pct / 100)
            # largest whole-share qty whose cost + charges fits in cash
            q = int(cash // (price * 1.002))
            while q > 0 and q * price + costs.cost(q * price, "BUY") > cash:
                q -= 1
            if q > 0:
                c = costs.cost(q * price, "BUY")
                cash -= q * price + c
                total_costs += c
                qty = q
                trades.append(Trade(ts, price, q, c))
        elif pending == -1 and qty > 0:
            price = row["Open"] * (1 - slippage_pct / 100)
            c = costs.cost(qty * price, "SELL")
            cash += qty * price - c
            total_costs += c
            t = trades[-1]
            t.exit_date, t.exit_price, t.exit_cost = ts, price, c
            qty = 0
        pending = 0

        # idle cash optionally earns interest (e.g. a liquid fund)
        cash *= 1 + daily_cash_rate

        # --- mark to market at close, then read today's signal ---
        equity.append(cash + qty * row["Close"])
        in_mkt.append(qty > 0)
        pending = int(row["cross"])

    return Result(
        equity=pd.Series(equity, index=df.index, name="Strategy"),
        trades=trades,
        total_costs=total_costs,
        in_market=pd.Series(in_mkt, index=df.index),
    )


def buy_and_hold(df: pd.DataFrame, capital: float, costs: CostModel | None, slippage_pct: float) -> pd.Series:
    """Buy on the first day's open and hold. costs=None for an index (no fees)."""
    price = df["Open"].iloc[0] * (1 + slippage_pct / 100)
    if costs is None:
        return df["Close"] / df["Open"].iloc[0] * capital
    q = int(capital // (price * 1.002))
    cash = capital - q * price - costs.cost(q * price, "BUY")
    return cash + q * df["Close"]


# --------------------------------------------------------------------------
# 5. Metrics
# --------------------------------------------------------------------------
def metrics(equity: pd.Series, rf_pct: float, trades: list[Trade] | None = None) -> dict:
    years = (equity.index[-1] - equity.index[0]).days / 365.25
    cagr = (equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1
    drawdown = equity / equity.cummax() - 1
    rets = equity.pct_change().dropna()
    excess = rets - ((1 + rf_pct / 100) ** (1 / TRADING_DAYS) - 1)
    sharpe = np.sqrt(TRADING_DAYS) * excess.mean() / excess.std() if excess.std() > 0 else float("nan")
    out = {
        "Final value (₹)": equity.iloc[-1],
        "CAGR": cagr,
        "Max drawdown": drawdown.min(),
        "Sharpe": sharpe,
    }
    if trades is not None:
        closed = [t for t in trades if t.exit_price is not None]
        wins = [t for t in closed if t.pnl > 0]
        out["Trades (closed)"] = len(closed)
        out["Win rate"] = len(wins) / len(closed) if closed else float("nan")
    return out


def fmt(k: str, v) -> str:
    if isinstance(v, float) and np.isnan(v):
        return "n/a"
    if "CAGR" in k or k in ("Max drawdown", "Win rate", "Time in market"):
        return f"{v:7.2%}"
    if k.startswith("Trades"):
        return f"{int(v)}"
    if k == "Sharpe":
        return f"{v:7.2f}"
    if "₹" in k:
        return f"{v:,.0f}"
    return str(v)


# --------------------------------------------------------------------------
# 6. Plots
# --------------------------------------------------------------------------
def plot(ticker: str, df: pd.DataFrame, res: Result, bh: pd.Series, nifty: pd.Series, out: Path) -> None:
    fig, (ax1, ax2, ax3) = plt.subplots(
        3, 1, figsize=(14, 11), sharex=True, gridspec_kw={"height_ratios": [3, 2, 1]}
    )

    ax1.plot(df.index, df["Close"], lw=1, color="#555", label="Close")
    ax1.plot(df.index, df["SMA_fast"], lw=1.3, color="#1f77b4", label="SMA 50")
    ax1.plot(df.index, df["SMA_slow"], lw=1.3, color="#ff7f0e", label="SMA 200")
    buys = [(t.entry_date, t.entry_price) for t in res.trades]
    sells = [(t.exit_date, t.exit_price) for t in res.trades if t.exit_date is not None]
    if buys:
        ax1.scatter(*zip(*buys), marker="^", s=110, color="green", zorder=5, label="Buy")
    if sells:
        ax1.scatter(*zip(*sells), marker="v", s=110, color="red", zorder=5, label="Sell")
    ax1.set_title(f"{ticker}: 50/200 SMA crossover")
    ax1.set_ylabel("Price (₹, adjusted)")
    ax1.legend(loc="upper left")
    ax1.grid(alpha=0.3)

    ax2.plot(res.equity.index, res.equity, lw=1.4, label="Strategy")
    ax2.plot(bh.index, bh, lw=1.1, label=f"Buy & hold {ticker}")
    ax2.plot(nifty.index, nifty, lw=1.1, label="Buy & hold Nifty 50")
    ax2.set_ylabel("Portfolio value (₹)")
    ax2.legend(loc="upper left")
    ax2.grid(alpha=0.3)

    dd = res.equity / res.equity.cummax() - 1
    ax3.fill_between(dd.index, dd * 100, 0, color="red", alpha=0.35)
    ax3.set_ylabel("Drawdown (%)")
    ax3.grid(alpha=0.3)

    fig.tight_layout()
    fig.savefig(out, dpi=120)
    plt.close(fig)


# --------------------------------------------------------------------------
# 7. Main
# --------------------------------------------------------------------------
def run(ticker: str, args, costs: CostModel, nifty_raw: pd.DataFrame, bt_start: pd.Timestamp, end: date) -> dict:
    raw = download(ticker, bt_start - pd.Timedelta(days=450), end)  # extra history warms up SMA 200
    df = add_signals(raw, args.fast, args.slow).loc[bt_start:]
    res = backtest(df, args.capital, costs, args.slippage, args.cash_rate)
    bh = buy_and_hold(df, args.capital, costs, args.slippage)
    nifty = buy_and_hold(nifty_raw.loc[df.index[0]:], args.capital, None, 0.0)

    strat_m = metrics(res.equity, args.rf, res.trades)
    strat_m["Time in market"] = res.in_market.mean()
    strat_m["Total costs (₹)"] = res.total_costs
    table = pd.DataFrame(
        {
            "Strategy": strat_m,
            f"B&H {ticker}": metrics(bh, args.rf),
            "B&H Nifty 50": metrics(nifty, args.rf),
        }
    )

    print(f"\n{'=' * 72}\n{ticker}  {df.index[0].date()} → {df.index[-1].date()}  "
          f"capital ₹{args.capital:,.0f}\n{'=' * 72}")
    print(table.apply(lambda col: [fmt(k, v) for k, v in col.items()]).fillna("").to_string())

    print("\nTrade log:")
    for t in res.trades:
        exit_s = f"{t.exit_date.date()} @ {t.exit_price:9.2f}" if t.exit_date is not None else "  (still open)        "
        pnl_s = f"P&L ₹{t.pnl:>12,.0f}" if t.exit_date is not None else ""
        print(f"  BUY {t.entry_date.date()} @ {t.entry_price:9.2f} x{t.qty:<6} SELL {exit_s}  {pnl_s}")

    out = Path(args.outdir) / f"{ticker.replace('^', '').replace('.', '_')}_crossover.png"
    plot(ticker, df, res, bh, nifty, out)
    print(f"\nChart saved: {out}")
    return {"Ticker": ticker, **{k: strat_m[k] for k in ("CAGR", "Max drawdown", "Sharpe", "Win rate")},
            "B&H CAGR": table.loc["CAGR", f"B&H {ticker}"]}


def main() -> None:
    p = argparse.ArgumentParser(description="50/200 SMA crossover backtest for NSE stocks")
    p.add_argument("tickers", nargs="*", default=["RELIANCE.NS"])
    p.add_argument("--years", type=int, default=15)
    p.add_argument("--capital", type=float, default=100_000)
    p.add_argument("--fast", type=int, default=50)
    p.add_argument("--slow", type=int, default=200)
    p.add_argument("--slippage", type=float, default=0.05, help="%% per fill")
    p.add_argument("--rf", type=float, default=6.0, help="risk-free rate %% p.a. for Sharpe")
    p.add_argument("--cash-rate", type=float, default=0.0,
                   help="%% p.a. earned on idle cash (e.g. 6 for a liquid fund)")
    p.add_argument("--outdir", default="charts")
    args = p.parse_args()

    Path(args.outdir).mkdir(parents=True, exist_ok=True)
    end = date.today() + timedelta(days=1)
    bt_start = pd.Timestamp(date.today().replace(year=date.today().year - args.years))
    costs = CostModel()
    nifty_raw = download(NIFTY_TICKER, bt_start - timedelta(days=10), end)

    summary = [run(t, args, costs, nifty_raw, bt_start, end) for t in args.tickers]

    if len(summary) > 1:
        s = pd.DataFrame(summary).set_index("Ticker")
        print(f"\n{'=' * 72}\nSUMMARY\n{'=' * 72}")
        print(s.apply(lambda col: [fmt(col.name, v) for v in col]).to_string())

    print("\nNotes: ^NSEI is a price index (excludes ~1-1.5%/yr dividends), so the Nifty "
          "benchmark is slightly understated.\nEducational backtest only. Not investment advice.")


if __name__ == "__main__":
    main()
