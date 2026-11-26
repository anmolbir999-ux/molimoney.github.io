"""Backtest any strategy on NSE stocks (Part 4, plus the research process from Part 3).

Examples
--------
  python backtest.py                                    # 50/200 SMA crossover on RELIANCE.NS, 15 yrs
  python backtest.py HDFCBANK.NS INFY.NS TCS.NS         # several stocks + summary table
  python backtest.py --list                             # show all strategies and parameters
  python backtest.py SBIN.NS -s rsi_reversion -p period=14,buy_below=30
  python backtest.py RELIANCE.NS --stop-atr 3 --risk-pct 2       # ATR stop + risk-based sizing
  python backtest.py RELIANCE.NS --market-filter                  # only buy when Nifty > its 200-DMA
  python backtest.py RELIANCE.NS --oos-split 2021-01-01           # in-sample vs out-of-sample
  python backtest.py RELIANCE.NS --optimize "fast=20,50,100;slow=100,150,200" --oos-split 2021-01-01

Research process (Part 3): hypothesis -> data -> backtest -> OUT-OF-SAMPLE test ->
risk management -> paper trading (paper_trade.py) -> live with small capital (live_kite.py).

EDUCATIONAL CODE ONLY. Not investment advice. Past performance does not predict future returns.
"""

from __future__ import annotations

import argparse
import itertools
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

import indicators as ind
import strategies
from charts import plot_backtest
from costs import CostModel
from data import NIFTY, download
from engine import buy_and_hold, run_backtest
from metrics import fmt, performance, table

WARMUP_DAYS = 450  # calendar days of extra history so 200-day indicators are ready on day 1


def parse_grid(s: str) -> dict[str, list]:
    """'fast=20,50;slow=100,200' -> {'fast': [20, 50], 'slow': [100, 200]}"""
    grid = {}
    for part in filter(None, s.split(";")):
        k, vals = part.split("=")
        grid[k.strip()] = [strategies.parse_params(f"x={v}")["x"] for v in vals.split(",")]
    return grid


def market_filter(nifty_raw: pd.DataFrame, index: pd.DatetimeIndex, n: int = 200) -> pd.Series:
    ok = nifty_raw["Close"] > ind.sma(nifty_raw["Close"], n)
    return ok.reindex(index, method="ffill").fillna(False)


def bt(df_full, bt_start, bt_end, args, params, nifty_raw, ticker):
    """Run one backtest on [bt_start, bt_end] using indicators computed on full history."""
    strat = strategies.get(args.strategy, df_full, params)
    df = df_full.loc[bt_start:bt_end]
    allow = market_filter(nifty_raw, df_full.index).loc[df.index] if args.market_filter else None
    res = run_backtest(df, strat.target.loc[df.index], args.capital, ticker=ticker,
                       costs=CostModel(), slippage_pct=args.slippage, stop_atr=args.stop_atr,
                       risk_pct=args.risk_pct, cash_rate_pct=args.cash_rate, allow_entry=allow)
    return df, strat, res


def run_ticker(ticker, args, nifty_raw, bt_start, end):
    raw = download(ticker, bt_start - pd.Timedelta(days=WARMUP_DAYS), end)
    params = strategies.parse_params(args.params)
    df, strat, res = bt(raw, bt_start, None, args, params, nifty_raw, ticker)

    bh = buy_and_hold(df, args.capital, CostModel(), args.slippage)
    nifty = buy_and_hold(nifty_raw.loc[df.index[0]:], args.capital)
    m = performance(res.equity, args.rf, res.trades, res.exposure, res.trader.total_costs)
    cols = {"Strategy": m, f"B&H {ticker}": performance(bh, args.rf), "B&H Nifty 50": performance(nifty, args.rf)}

    label = f"{args.strategy}({args.params or 'defaults'})"
    extras = [f"stop {args.stop_atr}×ATR" if args.stop_atr else "",
              f"risk {args.risk_pct}%/trade" if args.risk_pct else "",
              "Nifty>200DMA filter" if args.market_filter else ""]
    extras = ", ".join(e for e in extras if e)
    print(f"\n{'=' * 78}\n{ticker}  {label}{'  [' + extras + ']' if extras else ''}\n"
          f"{df.index[0].date()} → {df.index[-1].date()}   capital ₹{args.capital:,.0f}\n{'=' * 78}")
    print(table(cols))

    if args.oos_split:
        split = pd.Timestamp(args.oos_split)
        is_eq, oos_eq = res.equity.loc[:split], res.equity.loc[split:]
        bh_oos = bh.loc[split:]
        print(f"\nIn-sample vs out-of-sample (split {split.date()}, same continuous run):")
        print(table({"In-sample": performance(is_eq, args.rf),
                     "Out-of-sample": performance(oos_eq, args.rf),
                     "B&H out-of-sample": performance(bh_oos, args.rf)}))

    if args.trades:
        print("\nTrade log:")
        for t in res.trades:
            ex = f"{t.exit_date} @ {t.exit_price:9.2f} ({t.exit_reason})" if t.closed else "(still open)"
            pnl = f"P&L ₹{t.pnl:>11,.0f} ({t.return_pct:+.1f}%)" if t.closed else ""
            print(f"  BUY {t.entry_date} @ {t.entry_price:9.2f} x{t.qty:<6} SELL {ex:<34} {pnl}")

    if args.optimize:
        optimize(raw, ticker, args, nifty_raw, bt_start, params)

    if not args.no_plot:
        out = Path(args.outdir) / f"{ticker.replace('^', '').replace('.', '_')}_{args.strategy}.png"
        plot_backtest(ticker, df, strat, res, {f"Buy & hold {ticker}": bh, "Buy & hold Nifty 50": nifty},
                      out, f"{ticker}: {label}")
        print(f"\nChart saved: {out}")

    return {"Ticker": ticker, "CAGR": m["CAGR"], "Max drawdown": m["Max drawdown"],
            "Sharpe": m["Sharpe"], "Win rate": m["Win rate"], "Trades": m["Trades (closed)"],
            "B&H CAGR": cols[f"B&H {ticker}"]["CAGR"]}


def optimize(raw, ticker, args, nifty_raw, bt_start, base_params):
    """Grid-search on IN-SAMPLE data only, then check the winner out-of-sample.
    The drop from in-sample to out-of-sample Sharpe is what overfitting looks like."""
    grid = parse_grid(args.optimize)
    split = pd.Timestamp(args.oos_split) if args.oos_split else \
        raw.loc[bt_start:].index[int(len(raw.loc[bt_start:]) * 0.7)]
    rows = []
    for combo in itertools.product(*grid.values()):
        p = {**base_params, **dict(zip(grid, combo))}
        if "fast" in p and "slow" in p and p["fast"] >= p["slow"]:
            continue
        _, _, r_is = bt(raw, bt_start, split - pd.Timedelta(days=1), args, p, nifty_raw, ticker)
        _, _, r_oos = bt(raw, split, None, args, p, nifty_raw, ticker)
        m_is, m_oos = performance(r_is.equity, args.rf), performance(r_oos.equity, args.rf)
        rows.append({"params": ",".join(f"{k}={v}" for k, v in p.items()) or "defaults",
                     "IS Sharpe": m_is["Sharpe"], "IS CAGR": m_is["CAGR"],
                     "OOS Sharpe": m_oos["Sharpe"], "OOS CAGR": m_oos["CAGR"]})
    res = pd.DataFrame(rows).sort_values("IS Sharpe", ascending=False)
    print(f"\nParameter optimisation – ranked on IN-SAMPLE Sharpe (before {split.date()}), "
          f"{len(res)} combinations:")
    show = res.copy()
    for c in show.columns[1:]:
        show[c] = [fmt(c, v) for v in show[c]]
    print(show.head(10).to_string(index=False))
    best = res.iloc[0]
    rank_oos = res["OOS Sharpe"].rank(ascending=False)[res.index[0]]
    print(f"\nBest in-sample: {best['params']}  IS Sharpe {best['IS Sharpe']:.2f} → "
          f"OOS Sharpe {best['OOS Sharpe']:.2f} (ranked #{int(rank_oos)} of {len(res)} out-of-sample).")
    print("If the OOS number is much worse, the 'best' parameters were fitted to noise. "
          "Trust robust regions, not the single best combo.")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("tickers", nargs="*", default=["RELIANCE.NS"])
    p.add_argument("-s", "--strategy", default="sma_cross")
    p.add_argument("-p", "--params", default="", help="e.g. fast=50,slow=200")
    p.add_argument("--list", action="store_true", help="list strategies and exit")
    p.add_argument("--years", type=int, default=15)
    p.add_argument("--capital", type=float, default=100_000)
    p.add_argument("--slippage", type=float, default=0.05, help="%% per fill")
    p.add_argument("--rf", type=float, default=6.0, help="risk-free rate %% p.a. for Sharpe")
    p.add_argument("--cash-rate", type=float, default=0.0, help="%% p.a. earned on idle cash")
    p.add_argument("--stop-atr", type=float, default=0.0, help="ATR stop-loss multiple (0=off)")
    p.add_argument("--risk-pct", type=float, default=0.0, help="%% of capital risked per trade (needs --stop-atr)")
    p.add_argument("--market-filter", action="store_true", help="only enter when Nifty > 200-DMA")
    p.add_argument("--oos-split", default="", help="YYYY-MM-DD: report in-sample vs out-of-sample")
    p.add_argument("--optimize", default="", help='grid, e.g. "fast=20,50,100;slow=100,150,200"')
    p.add_argument("--trades", action="store_true", help="print the trade log")
    p.add_argument("--no-plot", action="store_true")
    p.add_argument("--outdir", default="charts")
    args = p.parse_args()

    if args.list:
        print("Strategies (use -s NAME -p key=value,...):\n" + strategies.describe())
        return
    if args.risk_pct and not args.stop_atr:
        p.error("--risk-pct needs --stop-atr (position size comes from the stop distance)")

    Path(args.outdir).mkdir(parents=True, exist_ok=True)
    end = date.today() + timedelta(days=1)
    today = date.today()
    bt_start = pd.Timestamp(today.replace(year=today.year - args.years))
    nifty_raw = download(NIFTY, bt_start - timedelta(days=WARMUP_DAYS), end)

    summary = [run_ticker(t, args, nifty_raw, bt_start, end) for t in args.tickers]

    if len(summary) > 1:
        s = pd.DataFrame(summary).set_index("Ticker")
        print(f"\n{'=' * 78}\nSUMMARY – {args.strategy}\n{'=' * 78}")
        print(s.apply(lambda col: [fmt(col.name, v) for v in col]).to_string())

    print("\nNotes: ^NSEI is a price index (excludes ~1-1.5%/yr dividends). Today's Nifty stocks "
          "were picked with hindsight (survivorship bias).\nCapital-gains tax is not modelled. "
          "Educational backtest only, not investment advice.")


if __name__ == "__main__":
    main()
