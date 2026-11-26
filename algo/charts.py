"""Plotting: backtest charts with buy/sell markers, and line / bar / candlestick /
Heikin-Ashi price charts with indicators and candle patterns (Parts 2 & 4)."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

import indicators as ind
from patterns import BEARISH, BULLISH, candle_patterns

UP, DOWN = "#26a69a", "#ef5350"


# ------------------------------------------------------------------ backtest chart
def plot_backtest(ticker: str, df: pd.DataFrame, strat, res, benchmarks: dict[str, pd.Series],
                  out: Path, title: str = "") -> None:
    has_lower = bool(strat.lower_panel)
    ratios = [3, 1.3, 2, 1] if has_lower else [3, 2, 1]
    fig, axes = plt.subplots(len(ratios), 1, figsize=(14, 3.2 * len(ratios) + 1), sharex=True,
                             gridspec_kw={"height_ratios": ratios})
    ax_p = axes[0]
    ax_p.plot(df.index, df["Close"], lw=1, color="#555", label="Close")
    for name, s in strat.price_lines.items():
        ax_p.plot(s.index, s, lw=1.2, label=name)
    buys = [(pd.Timestamp(t.entry_date), t.entry_price) for t in res.trades]
    sig_sells = [(pd.Timestamp(t.exit_date), t.exit_price) for t in res.trades if t.closed and t.exit_reason != "stop"]
    stop_sells = [(pd.Timestamp(t.exit_date), t.exit_price) for t in res.trades if t.exit_reason == "stop"]
    if buys:
        ax_p.scatter(*zip(*buys), marker="^", s=110, color="green", zorder=5, label="Buy")
    if sig_sells:
        ax_p.scatter(*zip(*sig_sells), marker="v", s=110, color="red", zorder=5, label="Sell")
    if stop_sells:
        ax_p.scatter(*zip(*stop_sells), marker="x", s=110, color="black", zorder=5, label="Stop-loss")
    ax_p.set_title(title or ticker)
    ax_p.set_ylabel("Price (₹, adjusted)")
    ax_p.legend(loc="upper left", fontsize=8)
    ax_p.grid(alpha=0.3)

    i = 1
    if has_lower:
        ax_o = axes[1]
        for name, s in strat.lower_panel.items():
            ax_o.plot(s.index, s, lw=1, label=name)
        for lvl in strat.lower_levels:
            ax_o.axhline(lvl, color="grey", ls="--", lw=0.8)
        ax_o.legend(loc="upper left", fontsize=8)
        ax_o.grid(alpha=0.3)
        i = 2

    ax_e = axes[i]
    ax_e.plot(res.equity.index, res.equity, lw=1.5, label="Strategy")
    for name, s in benchmarks.items():
        ax_e.plot(s.index, s, lw=1.1, label=name)
    ax_e.set_ylabel("Portfolio value (₹)")
    ax_e.legend(loc="upper left", fontsize=8)
    ax_e.grid(alpha=0.3)

    dd = res.equity / res.equity.cummax() - 1
    axes[i + 1].fill_between(dd.index, dd * 100, 0, color="red", alpha=0.35)
    axes[i + 1].set_ylabel("Drawdown (%)")
    axes[i + 1].grid(alpha=0.3)

    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)


def plot_equity(curves: dict[str, pd.Series], out: Path, title: str, extra=None) -> None:
    n = 3 if extra is not None else 2
    fig, axes = plt.subplots(n, 1, figsize=(14, 4 * n), sharex=True,
                             gridspec_kw={"height_ratios": [2, 1, 1.5][:n] if n == 3 else [3, 1]})
    for name, s in curves.items():
        axes[0].plot(s.index, s, lw=1.3, label=name)
    axes[0].set_title(title)
    axes[0].set_ylabel("Portfolio value (₹)")
    axes[0].legend(loc="upper left")
    axes[0].grid(alpha=0.3)
    first = next(iter(curves.values()))
    dd = first / first.cummax() - 1
    axes[1].fill_between(dd.index, dd * 100, 0, color="red", alpha=0.35)
    axes[1].set_ylabel("Drawdown (%)")
    axes[1].grid(alpha=0.3)
    if extra is not None:
        extra(axes[2])
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)


# ------------------------------------------------------------------ price charts
def _draw_ohlc(ax, x, df, kind):
    o, h, l, c = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close"))
    colors = np.where(c >= o, UP, DOWN)
    if kind == "bar":  # OHLC bars: left tick = open, right tick = close
        ax.vlines(x, l, h, colors=colors, lw=1)
        ax.hlines(o, x - 0.3, x, colors=colors, lw=1)
        ax.hlines(c, x, x + 0.3, colors=colors, lw=1)
    else:              # candlesticks (also used for Heikin-Ashi)
        ax.vlines(x, l, h, colors=colors, lw=0.8)
        bottom = np.minimum(o, c)
        height = np.maximum(np.abs(c - o), (h - l).mean() * 0.003)
        ax.bar(x, height, bottom=bottom, width=0.65, color=colors, edgecolor=colors)


def plot_price(ticker: str, df: pd.DataFrame, out: Path, kind: str = "candle",
               indicators: list[str] | None = None, show_patterns: bool = False,
               show_levels: bool = False) -> None:
    """kind: line | bar | candle | heikin.
    indicators: sma20, sma50, sma200, ema20, bb, vwap20, donchian20, volume, rsi, macd, atr."""
    indicators = indicators or []
    lower = [k for k in indicators if k in ("rsi", "macd", "atr")]
    show_vol = "volume" in indicators
    ratios = [4] + ([1] if show_vol else []) + [1.3] * len(lower)
    fig, axes = plt.subplots(len(ratios), 1, figsize=(15, 3 * len(ratios) + 2), sharex=True,
                             gridspec_kw={"height_ratios": ratios}, squeeze=False)
    axes = axes[:, 0]
    x = np.arange(len(df))
    ax = axes[0]
    plot_df = ind.heikin_ashi(df) if kind == "heikin" else df

    if kind == "line":
        ax.plot(x, df["Close"], lw=1.3, color="#1f77b4", label="Close")
    else:
        _draw_ohlc(ax, x, plot_df, "bar" if kind == "bar" else "candle")

    close = df["Close"]
    for k in indicators:
        if k.startswith("sma") and k[3:].isdigit():
            ax.plot(x, ind.sma(close, int(k[3:])), lw=1.1, label=k.upper())
        elif k.startswith("ema") and k[3:].isdigit():
            ax.plot(x, ind.ema(close, int(k[3:])), lw=1.1, label=k.upper())
        elif k == "bb":
            b = ind.bollinger(close)
            ax.plot(x, b["upper"], lw=0.8, color="grey")
            ax.plot(x, b["lower"], lw=0.8, color="grey")
            ax.fill_between(x, b["lower"], b["upper"], color="grey", alpha=0.08, label="Bollinger 20,2")
        elif k.startswith("vwap"):
            w = int(k[4:]) if k[4:].isdigit() else None
            ax.plot(x, ind.vwap(df, w), lw=1.1, ls="--", label=f"VWAP{'' if not w else ' ' + str(w)}")
        elif k.startswith("donchian"):
            d = ind.donchian(df, int(k[8:] or 20))
            ax.plot(x, d["upper"], lw=0.9, ls=":", color="purple", label=f"Donchian {k[8:] or 20}")
            ax.plot(x, d["lower"], lw=0.9, ls=":", color="purple")

    if show_levels:
        for lvl in ind.support_resistance(df):
            ax.axhline(lvl, color="orange", lw=0.9, ls="--", alpha=0.8)
            ax.text(x[-1] + 1, lvl, f"{lvl:,.0f}", va="center", fontsize=8, color="orange")

    if show_patterns:
        p = candle_patterns(df)
        span = (df["High"].max() - df["Low"].min()) * 0.025
        marks = {"doji": ("o", "grey"), "hammer": ("^", "green"), "bullish_engulfing": ("^", "blue"),
                 "morning_star": ("*", "green"), "hanging_man": ("v", "orange"),
                 "shooting_star": ("v", "purple"), "bearish_engulfing": ("v", "red"),
                 "evening_star": ("*", "red")}
        for name, (m, col) in marks.items():
            hit = p[name].to_numpy()
            if not hit.any():
                continue
            y = (df["Low"] - span) if name in BULLISH or name == "doji" else (df["High"] + span)
            ax.scatter(x[hit], y.to_numpy()[hit], marker=m, s=40, color=col, zorder=5,
                       label=name.replace("_", " "))

    ax.set_title(f"{ticker} – {dict(line='Line', bar='OHLC bar', candle='Candlestick', heikin='Heikin-Ashi')[kind]} chart")
    if ax.get_legend_handles_labels()[0]:
        ax.legend(loc="upper left", fontsize=8, ncol=3)
    ax.grid(alpha=0.3)

    i = 1
    if show_vol:
        colors = np.where(df["Close"] >= df["Open"], UP, DOWN)
        axes[i].bar(x, df["Volume"], color=colors, width=0.7)
        axes[i].plot(x, df["Volume"].rolling(20).mean(), color="black", lw=0.8, label="20d avg")
        axes[i].set_ylabel("Volume")
        axes[i].legend(loc="upper left", fontsize=8)
        i += 1
    for k in lower:
        a = axes[i]
        if k == "rsi":
            a.plot(x, ind.rsi(close), color="purple", lw=1)
            a.axhline(70, color="red", ls="--", lw=0.8)
            a.axhline(30, color="green", ls="--", lw=0.8)
            a.set_ylabel("RSI 14")
        elif k == "macd":
            m = ind.macd(close)
            a.plot(x, m["macd"], lw=1, label="MACD")
            a.plot(x, m["signal"], lw=1, label="Signal")
            a.bar(x, m["hist"], color=np.where(m["hist"] >= 0, UP, DOWN), width=0.7)
            a.legend(loc="upper left", fontsize=8)
            a.set_ylabel("MACD")
        elif k == "atr":
            a.plot(x, ind.atr(df), color="brown", lw=1)
            a.set_ylabel("ATR 14 (₹)")
        a.grid(alpha=0.3)
        i += 1

    step = max(len(df) // 10, 1)
    axes[-1].set_xticks(x[::step])
    fmt = "%d %b %H:%M" if (df.index[-1] - df.index[0]).days < 10 else "%d %b %y"
    axes[-1].set_xticklabels([d.strftime(fmt) for d in df.index[::step]], rotation=30)
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)
