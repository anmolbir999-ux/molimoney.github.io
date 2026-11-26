"""Market data helpers (yfinance). NSE stocks end in .NS, the Nifty 50 is ^NSEI."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pandas as pd
import yfinance as yf

NIFTY = "^NSEI"
IST = timezone(timedelta(hours=5, minutes=30))


def _flatten(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):  # newer yfinance returns (field, ticker)
        df = df.copy()
        df.columns = df.columns.get_level_values(0)
    return df


def download(
    ticker: str,
    start: date | str | None = None,
    end: date | str | None = None,
    period: str | None = None,
    interval: str = "1d",
    adjusted: bool = True,
) -> pd.DataFrame:
    """Daily (or intraday) OHLCV.

    adjusted=True  -> prices adjusted for splits, bonuses and dividends (use for backtests).
    adjusted=False -> raw traded prices plus an 'Adj Close' column (use for paper/live fills).
    """
    kw = dict(interval=interval, auto_adjust=adjusted, progress=False)
    if period:
        kw["period"] = period
    else:
        kw["start"] = start
        kw["end"] = end or (date.today() + timedelta(days=1))
    df = _flatten(yf.download(ticker, **kw))
    if df.empty:
        raise SystemExit(f"No data for {ticker}. Check the symbol (NSE stocks end in .NS).")
    cols = ["Open", "High", "Low", "Close", "Volume"] + ([] if adjusted else ["Adj Close"])
    df = df[[c for c in cols if c in df.columns]].dropna(subset=["Open", "High", "Low", "Close"])
    if df.index.tz is not None and interval == "1d":
        df.index = df.index.tz_localize(None)
    return df


def adjust(raw: pd.DataFrame) -> pd.DataFrame:
    """Turn a raw frame (with 'Adj Close') into an adjusted OHLC frame for indicators."""
    f = raw["Adj Close"] / raw["Close"]
    out = raw[["Open", "High", "Low", "Close"]].mul(f, axis=0)
    out["Volume"] = raw["Volume"]
    return out


def drop_incomplete_today(df: pd.DataFrame) -> pd.DataFrame:
    """During market hours yfinance returns today's half-formed candle. Drop it."""
    now = datetime.now(IST)
    if len(df) and df.index[-1].date() == now.date() and (now.hour, now.minute) < (15, 45):
        return df.iloc[:-1]
    return df


def closes(tickers: list[str], start, end=None) -> pd.DataFrame:
    """Adjusted closes for many tickers in one call (columns = tickers)."""
    df = yf.download(tickers, start=start, end=end or (date.today() + timedelta(days=1)),
                     auto_adjust=True, progress=False)
    c = df["Close"] if isinstance(df.columns, pd.MultiIndex) else df[["Close"]]
    if not isinstance(df.columns, pd.MultiIndex):
        c.columns = tickers[:1]
    return c.dropna(how="all", axis=1).dropna(how="all")
