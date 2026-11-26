"""Live trading with Zerodha Kite Connect (Part 4, final step) – DRY-RUN BY DEFAULT.

Only go live after: a backtest that survives out-of-sample testing, 2–3+ months of
paper trading that matches the backtest, and with capital you can afford to lose.
Read SEBI_RULES.md first.

Setup
-----
  1. Create an app at https://developers.kite.trade (Kite Connect is a paid
     subscription; the free "Personal" plan has no market data). Set the redirect URL.
  2. Register your static IP with Zerodha (SEBI's retail-algo framework requires
     order APIs to come from a whitelisted static IP).
  3. pip install kiteconnect
  4. export KITE_API_KEY=xxxx  KITE_API_SECRET=yyyy    (never commit these!)
  5. python live_kite.py login       # once per day – the access token expires every morning

Commands
--------
  python live_kite.py status                                  # funds, holdings, today's orders
  python live_kite.py run RELIANCE.NS TCS.NS --capital-per-stock 20000           # DRY RUN
  python live_kite.py run RELIANCE.NS --capital-per-stock 20000 --stop-atr 3 --live
  python live_kite.py run INFY.NS --capital-per-stock 50000 --exec twap --slices 5 --minutes 20 --live
  python live_kite.py run INFY.NS --capital-per-stock 50000 --exec iceberg --slices 4 --live

How `run` works (daily strategy → run once, e.g. 9:20 AM IST):
  * signals from yfinance daily data up to YESTERDAY's close (same code as backtest/paper)
  * BUY  if the target switched to 1 within the last --lookback sessions and you hold none
  * SELL if the target is 0 and you hold shares (CNC/delivery)
  * orders are marketable LIMIT orders (LTP ± buffer), not market orders
  * optional GTT stop-loss placed at entry − k×ATR after a buy
Execution algorithms (Part 3B – how institutions place large orders):
  * simple  : one order
  * twap    : split into equal slices spread evenly over --minutes
  * vwap    : slices sized by the stock's typical intraday volume curve
  * iceberg : Kite's ICEBERG variety – exchange shows only one leg at a time
Safety: dry-run default, typed confirmation for --live, max order value, max orders
per run, kill-switch file, rate limiting, and a CSV log of every order.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import time
from datetime import datetime
from pathlib import Path

import pandas as pd

import indicators as ind
import strategies
from data import IST, download, drop_incomplete_today

TOKEN_FILE = Path(".kite_token.json")
ORDER_LOG = Path("orders_log.csv")
KILL_SWITCH = Path("KILL_SWITCH")
TICK_CACHE = Path(".tick_sizes.json")
API_PAUSE = 0.35  # seconds between API calls – far below SEBI's 10 orders/sec threshold


# ---------------------------------------------------------------- broker connections
def connect():
    try:
        from kiteconnect import KiteConnect
    except ImportError:
        raise SystemExit("pip install kiteconnect")
    key = os.environ.get("KITE_API_KEY")
    if not key:
        raise SystemExit("Set KITE_API_KEY (and KITE_API_SECRET for login).")
    kite = KiteConnect(api_key=key)
    if TOKEN_FILE.exists():
        tok = json.loads(TOKEN_FILE.read_text())
        if tok.get("date") == datetime.now(IST).date().isoformat():
            kite.set_access_token(tok["access_token"])
            return kite
    raise SystemExit("No valid access token for today. Run: python live_kite.py login")


class PaperKite:
    """Stand-in for KiteConnect in dry-run mode: reads prices from yfinance, places nothing."""
    VARIETY_REGULAR, VARIETY_ICEBERG = "regular", "iceberg"
    EXCHANGE_NSE, PRODUCT_CNC = "NSE", "CNC"
    ORDER_TYPE_LIMIT, VALIDITY_DAY = "LIMIT", "DAY"
    TRANSACTION_TYPE_BUY, TRANSACTION_TYPE_SELL = "BUY", "SELL"
    GTT_TYPE_SINGLE = "single"

    def __init__(self, holdings: dict[str, int] | None = None):
        self._h = holdings or {}
        self._n = 0

    def holdings(self):
        return [{"tradingsymbol": s, "exchange": "NSE", "quantity": q, "t1_quantity": 0} for s, q in self._h.items()]

    def positions(self):
        return {"net": [], "day": []}

    def margins(self, segment=None):
        return {"available": {"cash": float("nan")}, "net": float("nan")}

    def orders(self):
        return []

    def ltp(self, keys):
        out = {}
        for k in keys:
            df = download(k.split(":")[1] + ".NS", period="5d")
            out[k] = {"last_price": float(df["Close"].iloc[-1])}
        return out

    def place_order(self, **kw):
        self._n += 1
        return f"DRYRUN-{self._n}"

    def place_gtt(self, **kw):
        return {"trigger_id": f"DRYRUN-GTT-{self._n}"}


# ---------------------------------------------------------------- helpers
def tick_size(kite, symbol: str, price: float, live: bool) -> float:
    if live:
        if not TICK_CACHE.exists() or TICK_CACHE.stat().st_mtime < time.time() - 86400:
            TICK_CACHE.write_text(json.dumps({i["tradingsymbol"]: i["tick_size"]
                                              for i in kite.instruments("NSE")}))
        ts = json.loads(TICK_CACHE.read_text()).get(symbol)
        if ts:
            return float(ts)
    # fallback: approximate NSE price-band tick sizes – always verify with the instruments dump
    for limit, t in ((250, 0.01), (1000, 0.05), (5000, 0.10), (10000, 0.50), (20000, 1.0)):
        if price < limit:
            return t
    return 5.0


def round_tick(price: float, tick: float, up: bool) -> float:
    n = price / tick
    return round((math.ceil(n) if up else math.floor(n)) * tick, 2)


def held_qty(kite, symbol: str) -> int:
    q = sum(h["quantity"] + h.get("t1_quantity", 0) for h in kite.holdings()
            if h["tradingsymbol"] == symbol and h["exchange"] == "NSE")
    q += sum(p["quantity"] for p in kite.positions()["net"]
             if p["tradingsymbol"] == symbol and p.get("product") == "CNC")
    return int(q)


def log_order(row: dict) -> None:
    new = not ORDER_LOG.exists()
    with ORDER_LOG.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(row))
        if new:
            w.writeheader()
        w.writerow(row)


def vwap_weights(ticker: str, slices: int) -> list[float]:
    """Typical intraday volume curve (last ~20 sessions of 15-min bars) split into `slices` buckets."""
    try:
        df = download(ticker, period="30d", interval="15m")
        prof = df["Volume"].groupby(df.index.time).mean()
        chunks = [c.sum() for _, c in pd.Series(prof.values).groupby(
            pd.cut(range(len(prof)), slices, labels=False))]
        tot = sum(chunks)
        return [c / tot for c in chunks]
    except Exception:
        return [1 / slices] * slices


# ---------------------------------------------------------------- order placement
def place(kite, a, symbol: str, side: str, qty: int, ticker: str, live: bool) -> list[str]:
    """Send `qty` shares using the chosen execution algorithm. Returns order ids."""
    buy = side == "BUY"
    tt = kite.TRANSACTION_TYPE_BUY if buy else kite.TRANSACTION_TYPE_SELL

    def one(q: int, variety=None, **extra) -> str:
        ltp = kite.ltp([f"NSE:{symbol}"])[f"NSE:{symbol}"]["last_price"]
        time.sleep(API_PAUSE)
        px = ltp * (1 + a.buffer / 100) if buy else ltp * (1 - a.buffer / 100)
        px = round_tick(px, tick_size(kite, symbol, ltp, live), up=buy)
        if q * px > a.max_order_value and side == "BUY":
            raise SystemExit(f"Order value ₹{q * px:,.0f} exceeds --max-order-value. Aborting.")
        oid = kite.place_order(variety=variety or kite.VARIETY_REGULAR, exchange=kite.EXCHANGE_NSE,
                               tradingsymbol=symbol, transaction_type=tt, quantity=q,
                               product=kite.PRODUCT_CNC, order_type=kite.ORDER_TYPE_LIMIT,
                               price=px, validity=kite.VALIDITY_DAY, tag="algo101", **extra)
        time.sleep(API_PAUSE)
        log_order({"time": datetime.now(IST).isoformat(timespec="seconds"), "mode": "LIVE" if live else "DRY",
                   "symbol": symbol, "side": side, "qty": q, "limit": px, "ltp": ltp,
                   "algo": a.exec, "order_id": oid})
        print(f"    {'LIVE' if live else 'DRY '} {side} {q} {symbol} LIMIT ₹{px:,.2f} (LTP ₹{ltp:,.2f}) → {oid}")
        return oid

    if a.exec == "simple" or qty < a.slices:
        return [one(qty)]
    if a.exec == "iceberg":
        legs = max(2, min(a.slices, 10))
        return [one(qty, variety=kite.VARIETY_ICEBERG, iceberg_legs=legs,
                    iceberg_quantity=math.ceil(qty / legs))]
    # TWAP / VWAP: child orders spread across --minutes
    weights = [1 / a.slices] * a.slices if a.exec == "twap" else vwap_weights(ticker, a.slices)
    sizes = [int(qty * w) for w in weights]
    sizes[-1] += qty - sum(sizes)
    gap = a.minutes * 60 / max(a.slices - 1, 1)
    ids = []
    for k, q in enumerate(sizes):
        if KILL_SWITCH.exists():
            print("    KILL_SWITCH found – stopping remaining slices.")
            break
        if q > 0:
            ids.append(one(q))
        if k < len(sizes) - 1:
            print(f"    waiting {gap:.0f}s for next slice ({k + 2}/{len(sizes)})" + ("" if live else " [skipped in dry-run]"))
            if live:
                time.sleep(gap)
    return ids


# ---------------------------------------------------------------- commands
def cmd_login(a) -> None:
    from kiteconnect import KiteConnect
    key, secret = os.environ.get("KITE_API_KEY"), os.environ.get("KITE_API_SECRET")
    if not key or not secret:
        raise SystemExit("Set KITE_API_KEY and KITE_API_SECRET environment variables.")
    kite = KiteConnect(api_key=key)
    print("1. Open this URL, log in with your Zerodha ID + 2FA:\n   " + kite.login_url())
    print("2. You'll be redirected to your redirect URL with ?request_token=XXXX&action=login...")
    req = input("3. Paste the request_token here: ").strip()
    sess = kite.generate_session(req, api_secret=secret)
    TOKEN_FILE.write_text(json.dumps({"access_token": sess["access_token"],
                                      "date": datetime.now(IST).date().isoformat()}))
    os.chmod(TOKEN_FILE, 0o600)
    print(f"Logged in as {sess.get('user_name', '')}. Token saved to {TOKEN_FILE} (valid until ~6 AM tomorrow).")


def cmd_status(a) -> None:
    kite = connect()
    m = kite.margins("equity")
    print(f"Available cash: ₹{m['available']['cash']:,.2f}   Net: ₹{m['net']:,.2f}\n\nHoldings:")
    for h in kite.holdings():
        print(f"  {h['tradingsymbol']:<14} {h['quantity'] + h.get('t1_quantity', 0):>6} @ ₹{h['average_price']:,.2f}"
              f"  LTP ₹{h['last_price']:,.2f}  P&L ₹{h['pnl']:,.0f}")
    print("\nToday's orders:")
    for o in kite.orders():
        print(f"  {o['order_timestamp']} {o['transaction_type']} {o['quantity']} {o['tradingsymbol']} "
              f"{o['order_type']} {o.get('price')} → {o['status']} {o.get('status_message') or ''}")


def cmd_run(a) -> None:
    if KILL_SWITCH.exists():
        raise SystemExit(f"{KILL_SWITCH} file present – trading disabled. Delete it to resume.")
    live = a.live
    if live:
        print("⚠  LIVE MODE: real orders with real money. Most retail traders lose money.")
        if input("Type YES to continue: ").strip() != "YES":
            raise SystemExit("Aborted.")
        kite = connect()
    else:
        print("DRY RUN – no orders will be sent. Add --live to trade for real.\n")
        kite = PaperKite({t.replace(".NS", ""): q for t, q in
                          (x.split("=") for x in a.assume_holding)} if a.assume_holding else None)
        kite._h = {k: int(v) for k, v in kite._h.items()}

    params = strategies.parse_params(a.params)
    sent = 0
    for ticker in a.tickers:
        symbol = ticker.replace(".NS", "")
        df = drop_incomplete_today(download(ticker, period="2y"))
        target = strategies.get(a.strategy, df, params).target
        recent = target.iloc[-(a.lookback + 1):]
        fresh_buy = recent.iloc[-1] == 1 and (recent.iloc[:-1] == 0).any()
        qty_held = held_qty(kite, symbol)
        time.sleep(API_PAUSE)
        print(f"{ticker}: signal date {df.index[-1].date()}, target {int(target.iloc[-1])}, holding {qty_held}")

        if sent >= a.max_orders:
            print("  max orders per run reached – skipping")
            continue
        if fresh_buy and qty_held == 0:
            ltp = kite.ltp([f"NSE:{symbol}"])[f"NSE:{symbol}"]["last_price"]
            budget = min(a.capital_per_stock, a.max_order_value)
            qty = int(budget // (ltp * (1 + a.buffer / 100) * 1.002))
            if qty <= 0:
                print("  budget too small for 1 share")
                continue
            print(f"  → BUY {qty} ({a.exec})")
            place(kite, a, symbol, "BUY", qty, ticker, live)
            sent += 1
            if a.stop_atr > 0:
                stop = ltp - a.stop_atr * float(ind.atr(df).iloc[-1])
                trig = round_tick(stop, tick_size(kite, symbol, ltp, live), up=False)
                limit = round_tick(stop * 0.99, tick_size(kite, symbol, ltp, live), up=False)
                gtt = kite.place_gtt(trigger_type=kite.GTT_TYPE_SINGLE, tradingsymbol=symbol,
                                     exchange=kite.EXCHANGE_NSE, trigger_values=[trig], last_price=ltp,
                                     orders=[{"transaction_type": kite.TRANSACTION_TYPE_SELL, "quantity": qty,
                                              "order_type": kite.ORDER_TYPE_LIMIT,
                                              "product": kite.PRODUCT_CNC, "price": limit}])
                print(f"    GTT stop-loss: trigger ₹{trig:,.2f}, limit ₹{limit:,.2f} → {gtt}"
                      "  (shares bought today are T1 – GTT sells may fail until settlement)")
        elif target.iloc[-1] == 0 and qty_held > 0:
            print(f"  → SELL {qty_held} ({a.exec})")
            place(kite, a, symbol, "SELL", qty_held, ticker, live)
            sent += 1
        else:
            print("  no action")
    print(f"\nOrders logged to {ORDER_LOG}. Check fills with `python live_kite.py status` "
          "or in Kite. Cancel stale GTTs manually after a signal exit.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login")
    sub.add_parser("status")
    r = sub.add_parser("run")
    r.add_argument("tickers", nargs="+")
    r.add_argument("-s", "--strategy", default="sma_cross")
    r.add_argument("-p", "--params", default="")
    r.add_argument("--capital-per-stock", type=float, required=True)
    r.add_argument("--max-order-value", type=float, default=50_000, help="hard cap per order, ₹")
    r.add_argument("--max-orders", type=int, default=10, help="max orders per run")
    r.add_argument("--lookback", type=int, default=1, help="sessions within which a BUY signal counts as fresh")
    r.add_argument("--buffer", type=float, default=0.3, help="limit price buffer vs LTP, %%")
    r.add_argument("--stop-atr", type=float, default=0.0, help="place a GTT stop at entry − k×ATR")
    r.add_argument("--exec", choices=["simple", "twap", "vwap", "iceberg"], default="simple")
    r.add_argument("--slices", type=int, default=4)
    r.add_argument("--minutes", type=float, default=15, help="TWAP/VWAP duration")
    r.add_argument("--assume-holding", nargs="*", help="dry-run only, e.g. RELIANCE=10")
    r.add_argument("--live", action="store_true", help="send REAL orders")
    a = ap.parse_args()
    {"login": cmd_login, "status": cmd_status, "run": cmd_run}[a.cmd](a)


if __name__ == "__main__":
    main()
