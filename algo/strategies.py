"""Strategy library (Parts 3 & 4).

Every strategy takes an adjusted OHLCV DataFrame plus parameters and returns a
StrategyOutput whose `target` is 1 (be long) or 0 (be flat) for each day, using
only information available at that day's close. The engine fills the order at
the NEXT day's open, so there is no look-ahead.

Families covered:
  trend following / momentum : sma_cross, ema_cross, macd_trend, donchian_breakout, heikin_trend
  mean reversion             : rsi_reversion, bollinger_reversion
  pattern-based              : candle_reversal
(Pairs trading / stat-arb lives in pairs.py; factor investing in factor_portfolio.py.)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd

import indicators as ind
from patterns import BEARISH, BULLISH, candle_patterns


@dataclass
class StrategyOutput:
    target: pd.Series                                              # 0/1 per day
    price_lines: dict[str, pd.Series] = field(default_factory=dict)  # plotted on price chart
    lower_panel: dict[str, pd.Series] = field(default_factory=dict)  # oscillator panel
    lower_levels: list[float] = field(default_factory=list)          # e.g. RSI 30/70


def _latch(entry: pd.Series, exit_: pd.Series) -> pd.Series:
    """Turn entry/exit event series into a held position (stateful)."""
    pos, out = 0, []
    for e, x in zip(entry.fillna(False), exit_.fillna(False)):
        if pos == 0 and e:
            pos = 1
        elif pos == 1 and x:
            pos = 0
        out.append(pos)
    return pd.Series(out, index=entry.index, dtype=int)


# ---------------------------------------------------------------- trend following
def sma_cross(df, fast=50, slow=200):
    """Golden cross / death cross: long while SMA(fast) > SMA(slow)."""
    f, s = ind.sma(df["Close"], fast), ind.sma(df["Close"], slow)
    return StrategyOutput((f > s).astype(int), {f"SMA {fast}": f, f"SMA {slow}": s})


def ema_cross(df, fast=20, slow=50):
    """Faster-reacting crossover using EMAs."""
    f, s = ind.ema(df["Close"], fast), ind.ema(df["Close"], slow)
    return StrategyOutput((f > s).astype(int), {f"EMA {fast}": f, f"EMA {slow}": s})


def macd_trend(df, fast=12, slow=26, signal=9, above_zero=0):
    """Long while MACD > signal line (optionally only when MACD > 0)."""
    m = ind.macd(df["Close"], fast, slow, signal)
    t = m["macd"] > m["signal"]
    if above_zero:
        t &= m["macd"] > 0
    return StrategyOutput(t.astype(int), {}, {"MACD": m["macd"], "Signal": m["signal"]}, [0.0])


def donchian_breakout(df, entry=55, exit=20):
    """Turtle-style breakout: buy a close above the 55-day high, exit below the 20-day low."""
    up = ind.donchian(df, entry)["upper"]
    lo = ind.donchian(df, exit)["lower"]
    t = _latch(df["Close"] > up, df["Close"] < lo)
    return StrategyOutput(t, {f"{entry}d high": up, f"{exit}d low": lo})


def heikin_trend(df, confirm=3, trend=100):
    """Enter after `confirm` green Heikin-Ashi candles above SMA(trend); exit on first red one."""
    ha = ind.heikin_ashi(df)
    green = ha["Close"] > ha["Open"]
    s = ind.sma(df["Close"], trend)
    entry = green.rolling(confirm).sum().eq(confirm) & (df["Close"] > s)
    return StrategyOutput(_latch(entry, ~green), {f"SMA {trend}": s})


# ---------------------------------------------------------------- mean reversion
def rsi_reversion(df, period=14, buy_below=30, sell_above=55, trend=200):
    """Buy oversold dips (RSI < buy_below) in an uptrend (close > SMA(trend)); exit on recovery."""
    r = ind.rsi(df["Close"], period)
    entry = r < buy_below
    lines = {}
    if trend:
        s = ind.sma(df["Close"], trend)
        entry &= df["Close"] > s
        lines[f"SMA {trend}"] = s
    return StrategyOutput(_latch(entry, r > sell_above), lines, {f"RSI {period}": r},
                          [buy_below, sell_above])


def bollinger_reversion(df, n=20, k=2.0, trend=0):
    """Buy a close below the lower band, exit when price returns to the middle band."""
    b = ind.bollinger(df["Close"], n, k)
    entry = df["Close"] < b["lower"]
    if trend:
        entry &= df["Close"] > ind.sma(df["Close"], trend)
    t = _latch(entry, df["Close"] > b["mid"])
    return StrategyOutput(t, {"BB upper": b["upper"], "BB mid": b["mid"], "BB lower": b["lower"]})


# ---------------------------------------------------------------- patterns
def candle_reversal(df, hold=10, trend=200):
    """Buy a bullish reversal candle (hammer/engulfing/morning star) above SMA(trend);
    exit on a bearish pattern or after `hold` days."""
    p = candle_patterns(df)
    s = ind.sma(df["Close"], trend)
    bull = p[BULLISH].any(axis=1) & (df["Close"] > s)
    bear = p[BEARISH].any(axis=1)
    pos, held, out = 0, 0, []
    for b, x in zip(bull, bear):
        if pos == 0 and b:
            pos, held = 1, 0
        elif pos == 1:
            held += 1
            if x or held >= hold:
                pos = 0
        out.append(pos)
    return StrategyOutput(pd.Series(out, index=df.index), {f"SMA {trend}": s})


STRATEGIES: dict[str, Callable[..., StrategyOutput]] = {
    "sma_cross": sma_cross,
    "ema_cross": ema_cross,
    "macd_trend": macd_trend,
    "donchian_breakout": donchian_breakout,
    "heikin_trend": heikin_trend,
    "rsi_reversion": rsi_reversion,
    "bollinger_reversion": bollinger_reversion,
    "candle_reversal": candle_reversal,
}


def parse_params(s: str | None) -> dict:
    """'fast=20,slow=100' -> {'fast': 20, 'slow': 100}"""
    out = {}
    for part in filter(None, (s or "").split(",")):
        k, v = part.split("=")
        v = v.strip()
        out[k.strip()] = int(v) if v.lstrip("-").isdigit() else float(v)
    return out


def get(name: str, df: pd.DataFrame, params: dict | None = None) -> StrategyOutput:
    if name not in STRATEGIES:
        raise SystemExit(f"Unknown strategy '{name}'. Choose from: {', '.join(STRATEGIES)}")
    return STRATEGIES[name](df, **(params or {}))


def describe() -> str:
    import inspect
    lines = []
    for name, fn in STRATEGIES.items():
        sig = ", ".join(f"{p.name}={p.default}" for p in list(inspect.signature(fn).parameters.values())[1:])
        lines.append(f"  {name:<20} {sig}\n      {" ".join(fn.__doc__.split())}")
    return "\n".join(lines)
