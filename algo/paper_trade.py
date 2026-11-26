"""Paper trading (forward testing) – Part 4, step 6 of the research process.

Runs the SAME engine as backtest.py, but forward in time, one day at a time, with
no hindsight: signals at today's close, simulated fills at the next session's open
(real, unadjusted prices + slippage + Indian costs). State lives in a JSON file.

  python paper_trade.py init RELIANCE.NS HDFCBANK.NS INFY.NS --capital 300000
  python paper_trade.py init TCS.NS -s rsi_reversion --stop-atr 3 --risk-pct 2
  python paper_trade.py run        # once a day, AFTER 3:45 PM IST
  python paper_trade.py status     # portfolio, open positions, pending orders
  python paper_trade.py trades     # trade journal

Automate the daily run (Linux/macOS cron, Mon–Fri 4:15 PM IST):
  15 16 * * 1-5  cd /path/to/algo && python paper_trade.py run >> paper.log 2>&1
(Windows: Task Scheduler. Or a GitHub Actions cron that commits paper_state.json.)

Paper trade for at least 2–3 months – ideally through a market correction – and
compare with what the backtest predicted for the same period before risking money.
"""

from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

import indicators as ind
import strategies
from costs import CostModel
from data import adjust, download, drop_incomplete_today
from engine import Trader

STATE = Path("paper_state.json")


def load() -> dict:
    if not STATE.exists():
        raise SystemExit("No paper account. Start one with: python paper_trade.py init TICKER ...")
    s = json.loads(STATE.read_text())
    s["traders"] = {k: Trader.from_dict(v) for k, v in s["traders"].items()}
    return s


def save(s: dict) -> None:
    out = dict(s)
    out["traders"] = {k: v.to_dict() for k, v in s["traders"].items()}
    STATE.write_text(json.dumps(out, indent=2, default=str))


def fetch(ticker: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    raw = drop_incomplete_today(download(ticker, start=date.today() - timedelta(days=700), adjusted=False))
    return raw, adjust(raw)


def cmd_init(a) -> None:
    if STATE.exists() and not a.force:
        raise SystemExit(f"{STATE} exists. Use --force to start over (this erases the journal).")
    params = strategies.parse_params(a.params)
    per = a.capital / len(a.tickers)
    traders, last = {}, {}
    for t in a.tickers:
        raw, adj = fetch(t)
        strategies.get(a.strategy, adj, params)  # validate strategy/params now
        traders[t] = Trader(t, per, CostModel(), a.slippage, a.stop_atr, a.risk_pct, 0.0, True)
        last[t] = str(raw.index[-1].date())    # start AFTER the latest completed bar: no backfill
    save({"created": str(date.today()), "strategy": a.strategy, "params": params,
          "capital": a.capital, "traders": traders, "last_bar": last, "equity_log": []})
    print(f"Paper account created: ₹{a.capital:,.0f} split over {len(a.tickers)} stocks "
          f"(₹{per:,.0f} each), strategy {a.strategy} {params or ''}.\n"
          f"Run `python paper_trade.py run` after each session closes.")


def cmd_run(a) -> None:
    s = load()
    total = 0.0
    for t, tr in s["traders"].items():
        raw, adj = fetch(t)
        out = strategies.get(s["strategy"], adj, s["params"])
        atr = ind.atr(raw)
        new = raw.loc[raw.index > pd.Timestamp(s["last_bar"][t])]
        for ts, row in new.iterrows():
            tr.on_bar(str(ts.date()), row["Open"], row["High"], row["Low"], row["Close"],
                      int(out.target.loc[ts]), float(atr.loc[ts]))
        if len(new):
            s["last_bar"][t] = str(new.index[-1].date())
        last_close = float(raw["Close"].iloc[-1])
        total += tr.equity(last_close)
        days = {str(d.date()) for d in new.index}
        events = []
        for trd in tr.trades:
            if trd.entry_date in days:
                events.append(f"{trd.entry_date} BOUGHT {trd.qty} @ ₹{trd.entry_price:,.2f}")
            if trd.exit_date in days:
                events.append(f"{trd.exit_date} SOLD @ ₹{trd.exit_price:,.2f} ({trd.exit_reason}) "
                              f"P&L ₹{trd.pnl:,.0f}")
        if tr.pending:
            events.append(f"ORDER QUEUED for next open: {tr.pending}")
        print(f"{t:<14} {len(new)} new bar(s), last close ₹{last_close:,.2f}, "
              f"position {tr.qty}  " + ("; ".join(events) if events else "no action"))
    s["equity_log"].append([str(date.today()), round(total, 2)])
    save(s)
    pnl = total - s["capital"]
    print(f"\nPaper equity ₹{total:,.0f}  ({pnl:+,.0f}, {pnl / s['capital']:+.2%} since {s['created']})")


def cmd_status(a) -> None:
    s = load()
    print(f"Strategy {s['strategy']} {s['params'] or ''}  started {s['created']}  capital ₹{s['capital']:,.0f}\n")
    total = 0.0
    for t, tr in s["traders"].items():
        raw, _ = fetch(t)
        px = float(raw["Close"].iloc[-1])
        total += tr.equity(px)
        pos = ""
        if tr.qty:
            e = tr.trades[-1]
            pos = (f"{tr.qty} @ ₹{e.entry_price:,.2f} → ₹{px:,.2f} "
                   f"({(px / e.entry_price - 1):+.1%})" + (f", stop ₹{tr.stop:,.2f}" if tr.stop else ""))
        print(f"  {t:<14} cash ₹{tr.cash:>11,.0f}  {pos or 'flat'}"
              f"{'  [pending ' + tr.pending + ']' if tr.pending else ''}")
    print(f"\n  Equity ₹{total:,.0f}   costs paid ₹{sum(tr.total_costs for tr in s['traders'].values()):,.0f}")


def cmd_trades(a) -> None:
    s = load()
    rows = [t for tr in s["traders"].values() for t in tr.trades]
    if not rows:
        print("No trades yet.")
        return
    for t in sorted(rows, key=lambda r: r.entry_date):
        ex = f"→ {t.exit_date} @ {t.exit_price:,.2f} ({t.exit_reason}) P&L ₹{t.pnl:,.0f}" if t.closed else "(open)"
        print(f"  {t.ticker:<14} {t.entry_date} BUY {t.qty} @ {t.entry_price:,.2f} {ex}")
    closed = [t for t in rows if t.closed]
    if closed:
        print(f"\n  Closed {len(closed)}, win rate {sum(t.pnl > 0 for t in closed) / len(closed):.0%}, "
              f"net P&L ₹{sum(t.pnl for t in closed):,.0f}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init")
    i.add_argument("tickers", nargs="+")
    i.add_argument("-s", "--strategy", default="sma_cross")
    i.add_argument("-p", "--params", default="")
    i.add_argument("--capital", type=float, default=100_000)
    i.add_argument("--slippage", type=float, default=0.05)
    i.add_argument("--stop-atr", type=float, default=0.0)
    i.add_argument("--risk-pct", type=float, default=0.0)
    i.add_argument("--force", action="store_true")
    for name in ("run", "status", "trades"):
        sub.add_parser(name)
    a = ap.parse_args()
    {"init": cmd_init, "run": cmd_run, "status": cmd_status, "trades": cmd_trades}[a.cmd](a)


if __name__ == "__main__":
    main()
