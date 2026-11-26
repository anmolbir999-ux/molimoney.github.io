"""Technical indicators (Part 2). Every function uses only past and current data.

What each is for, and where it fails:
  SMA / EMA   trend direction & dynamic support. Lags; whipsaws in sideways markets.
  RSI         momentum / overbought-oversold. Stays "overbought" for months in strong trends.
  MACD        trend + momentum shifts. Lags, gives many false crosses in ranges.
  Bollinger   volatility envelope; mean reversion in ranges. Price "walks the band" in trends.
  Volume      confirms breakouts. Spikes on news/expiry/block deals can mislead.
  ATR         volatility in ₹, used for stop-losses and position sizing. Says nothing about direction.
  VWAP        average price weighted by volume; institutions' intraday benchmark.
              Meaningful intraday; on daily data only a rolling approximation.
  Heikin-Ashi smoothed candles that make trends easier to see. Prices are NOT real traded prices.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    """Wilder's RSI, 0-100."""
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(100.0).where(up.notna())


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return pd.DataFrame({"macd": line, "signal": sig, "hist": line - sig})


def bollinger(close: pd.Series, n: int = 20, k: float = 2.0) -> pd.DataFrame:
    mid = sma(close, n)
    sd = close.rolling(n).std(ddof=0)
    upper, lower = mid + k * sd, mid - k * sd
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower,
                         "pct_b": (close - lower) / (upper - lower),
                         "bandwidth": (upper - lower) / mid})


def true_range(df: pd.DataFrame) -> pd.Series:
    pc = df["Close"].shift(1)
    return pd.concat([df["High"] - df["Low"], (df["High"] - pc).abs(), (df["Low"] - pc).abs()],
                     axis=1).max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return true_range(df).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def vwap(df: pd.DataFrame, window: int | None = None) -> pd.Series:
    """Intraday data: VWAP that resets every session.
    Daily data: rolling `window`-day VWAP (or cumulative if window is None)."""
    tp = (df["High"] + df["Low"] + df["Close"]) / 3
    pv, v = tp * df["Volume"], df["Volume"]
    idx = pd.DatetimeIndex(df.index)
    intraday = len(idx) > 1 and (idx.normalize() == idx.normalize()[0]).sum() > 1
    if intraday:
        day = idx.normalize()
        return pv.groupby(day).cumsum() / v.groupby(day).cumsum()
    if window:
        return pv.rolling(window).sum() / v.rolling(window).sum()
    return pv.cumsum() / v.cumsum()


def volume_ratio(df: pd.DataFrame, n: int = 20) -> pd.Series:
    """Today's volume ÷ average volume. >1.5 on a breakout = confirmation."""
    return df["Volume"] / df["Volume"].rolling(n).mean()


def donchian(df: pd.DataFrame, n: int) -> pd.DataFrame:
    """Highest high / lowest low of the PREVIOUS n bars (so today can break it)."""
    return pd.DataFrame({"upper": df["High"].rolling(n).max().shift(1),
                         "lower": df["Low"].rolling(n).min().shift(1)})


def heikin_ashi(df: pd.DataFrame) -> pd.DataFrame:
    o, h, l, c = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close"))
    ha_c = (o + h + l + c) / 4
    ha_o = np.empty_like(ha_c)
    ha_o[0] = (o[0] + c[0]) / 2
    for i in range(1, len(ha_c)):
        ha_o[i] = (ha_o[i - 1] + ha_c[i - 1]) / 2
    out = pd.DataFrame({"Open": ha_o, "Close": ha_c}, index=df.index)
    out["High"] = np.maximum.reduce([h, ha_o, ha_c])
    out["Low"] = np.minimum.reduce([l, ha_o, ha_c])
    out["Volume"] = df["Volume"].to_numpy() if "Volume" in df else 0
    return out[["Open", "High", "Low", "Close", "Volume"]]


def support_resistance(df: pd.DataFrame, window: int = 10, tolerance_pct: float = 1.5,
                       max_levels: int = 6) -> list[float]:
    """Rough horizontal S/R levels: cluster swing highs/lows that price touched repeatedly."""
    h, l = df["High"], df["Low"]
    w = 2 * window + 1
    swing_hi = h[h == h.rolling(w, center=True).max()]
    swing_lo = l[l == l.rolling(w, center=True).min()]
    pts = sorted(pd.concat([swing_hi, swing_lo]).to_numpy())
    clusters: list[list[float]] = []
    for p in pts:
        if clusters and abs(p - np.mean(clusters[-1])) / p * 100 <= tolerance_pct:
            clusters[-1].append(p)
        else:
            clusters.append([p])
    clusters.sort(key=len, reverse=True)
    return sorted(float(np.mean(c)) for c in clusters[:max_levels])
