"""Candlestick pattern detection (Part 2).

Rules are simple textbook definitions. Patterns only matter in CONTEXT: a hammer
means little unless it appears after a decline, near support, ideally with volume.
On their own, most candle patterns have weak predictive power: test before trusting.
"""

from __future__ import annotations

import pandas as pd


def candle_patterns(df: pd.DataFrame, trend_lookback: int = 5) -> pd.DataFrame:
    o, h, l, c = df["Open"], df["High"], df["Low"], df["Close"]
    body = c - o
    abs_body = body.abs()
    rng = (h - l).replace(0, float("nan"))
    upper = h - pd.concat([o, c], axis=1).max(axis=1)
    lower = pd.concat([o, c], axis=1).min(axis=1) - l
    avg_body = abs_body.rolling(10).mean()

    downtrend = c.shift(1) < c.shift(1 + trend_lookback)
    uptrend = c.shift(1) > c.shift(1 + trend_lookback)

    p = pd.DataFrame(index=df.index)
    p["doji"] = abs_body <= 0.1 * rng
    small_top = upper <= 0.15 * rng
    p["hammer"] = (lower >= 2 * abs_body) & small_top & (abs_body > 0.03 * rng) & downtrend
    p["hanging_man"] = (lower >= 2 * abs_body) & small_top & (abs_body > 0.03 * rng) & uptrend
    p["shooting_star"] = (upper >= 2 * abs_body) & (lower <= 0.15 * rng) & uptrend

    po, pc = o.shift(1), c.shift(1)
    p["bullish_engulfing"] = (pc < po) & (c > o) & (o <= pc) & (c >= po) & downtrend
    p["bearish_engulfing"] = (pc > po) & (c < o) & (o >= pc) & (c <= po) & uptrend

    # three-candle stars: big candle, small "star", strong reversal candle
    b2, b1 = body.shift(2), body.shift(1)
    big2 = b2.abs() > avg_body.shift(2)
    small1 = b1.abs() < 0.5 * b2.abs()
    mid2 = (o.shift(2) + c.shift(2)) / 2
    p["morning_star"] = (b2 < 0) & big2 & small1 & (body > 0) & (c > mid2)
    p["evening_star"] = (b2 > 0) & big2 & small1 & (body < 0) & (c < mid2)
    return p.fillna(False).astype(bool)


BULLISH = ["hammer", "bullish_engulfing", "morning_star"]
BEARISH = ["hanging_man", "shooting_star", "bearish_engulfing", "evening_star"]
