"""Draw any chart type with indicators and candle patterns (Part 2 practice tool).

Examples
--------
  python chart.py RELIANCE.NS                                   # 6-month candlestick
  python chart.py HDFCBANK.NS --kind line --period 5y -i sma50,sma200
  python chart.py INFY.NS --kind bar -i bb,volume,rsi
  python chart.py TCS.NS --kind heikin -i ema20,macd
  python chart.py ICICIBANK.NS --patterns --levels -i volume       # candle patterns + S/R levels
  python chart.py RELIANCE.NS --interval 5m --period 5d -i vwap,volume   # intraday VWAP
  python chart.py SBIN.NS --scan                                # list recent patterns as text

Indicators: sma<N>, ema<N>, bb, vwap, vwap<N>, donchian<N>, volume, rsi, macd, atr
"""

from __future__ import annotations

import argparse
from pathlib import Path

import indicators as ind
from charts import plot_price
from data import download
from patterns import candle_patterns


def scan(ticker: str, df) -> None:
    """Text summary: latest indicator readings and patterns from the last 10 sessions."""
    c = df["Close"]
    last = df.index[-1].date()
    r, m, b, a = ind.rsi(c).iloc[-1], ind.macd(c).iloc[-1], ind.bollinger(c).iloc[-1], ind.atr(df).iloc[-1]
    print(f"\n{ticker} on {last}: close ₹{c.iloc[-1]:,.2f}")
    for n in (20, 50, 200):
        s = ind.sma(c, n).iloc[-1]
        if s == s:
            print(f"  SMA{n:<4} ₹{s:,.2f}  price is {'ABOVE' if c.iloc[-1] > s else 'below'} ({(c.iloc[-1] / s - 1):+.1%})")
    print(f"  RSI14   {r:.1f}  ({'overbought >70' if r > 70 else 'oversold <30' if r < 30 else 'neutral'})")
    print(f"  MACD    {m['macd']:.2f} vs signal {m['signal']:.2f}  ({'bullish' if m['hist'] > 0 else 'bearish'})")
    print(f"  Boll %B {b['pct_b']:.2f}  (0 = lower band, 1 = upper band)")
    print(f"  ATR14   ₹{a:,.2f}  ({a / c.iloc[-1]:.1%} of price, a typical day's range)")
    print(f"  Volume  {ind.volume_ratio(df).iloc[-1]:.2f}× its 20-day average")
    print(f"  S/R     {', '.join(f'₹{x:,.0f}' for x in ind.support_resistance(df))}")
    p = candle_patterns(df).iloc[-10:]
    hits = [(d.date(), col) for d, row in p.iterrows() for col, v in row.items() if v]
    print("  Patterns (last 10 sessions): " + (", ".join(f"{d} {n}" for d, n in hits) if hits else "none"))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ticker", nargs="?", default="RELIANCE.NS")
    ap.add_argument("--kind", choices=["line", "bar", "candle", "heikin"], default="candle")
    ap.add_argument("--period", default="6mo", help="1mo 3mo 6mo 1y 2y 5y 10y max (intraday: 1d-60d)")
    ap.add_argument("--interval", default="1d", help="1d, 1wk, or intraday 5m/15m/1h")
    ap.add_argument("-i", "--indicators", default="sma20,sma50,volume")
    ap.add_argument("--patterns", action="store_true", help="mark candlestick patterns")
    ap.add_argument("--levels", action="store_true", help="draw support/resistance levels")
    ap.add_argument("--scan", action="store_true", help="also print a text summary")
    ap.add_argument("--outdir", default="charts")
    a = ap.parse_args()

    df = download(a.ticker, period=a.period, interval=a.interval)
    Path(a.outdir).mkdir(parents=True, exist_ok=True)
    out = Path(a.outdir) / f"{a.ticker.replace('^', '').replace('.', '_')}_{a.kind}_{a.period}_{a.interval}.png"
    inds = [x.strip().lower() for x in a.indicators.split(",") if x.strip()]
    plot_price(a.ticker, df, out, a.kind, inds, a.patterns, a.levels)
    print(f"Chart saved: {out}")
    if a.scan:
        scan(a.ticker, df)


if __name__ == "__main__":
    main()
