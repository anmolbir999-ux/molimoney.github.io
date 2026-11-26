"""Performance and risk metrics."""

from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252

PCT_KEYS = {"CAGR", "Volatility", "Max drawdown", "Win rate", "Time in market", "VaR 95% (1-day)",
            "Avg win", "Avg loss", "B&H CAGR", "OOS CAGR", "IS CAGR"}


def performance(equity: pd.Series, rf_pct: float = 6.0, trades=None, exposure=None,
                total_costs: float | None = None) -> dict:
    equity = equity.dropna()
    years = max((equity.index[-1] - equity.index[0]).days / 365.25, 1e-9)
    rets = equity.pct_change().dropna()
    rf_d = (1 + rf_pct / 100) ** (1 / TRADING_DAYS) - 1
    ex = rets - rf_d
    downside = ex[ex < 0].std()
    dd = equity / equity.cummax() - 1
    cagr = (equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1
    out = {
        "Final value (₹)": equity.iloc[-1],
        "CAGR": cagr,
        "Volatility": rets.std() * np.sqrt(TRADING_DAYS),
        "Max drawdown": dd.min(),
        "Sharpe": np.sqrt(TRADING_DAYS) * ex.mean() / ex.std() if ex.std() > 0 else np.nan,
        "Sortino": np.sqrt(TRADING_DAYS) * ex.mean() / downside if downside and downside > 0 else np.nan,
        "Calmar": cagr / abs(dd.min()) if dd.min() < 0 else np.nan,
        # historical Value-at-Risk: on 95% of days you lose less than this
        "VaR 95% (1-day)": -np.percentile(rets, 5) if len(rets) else np.nan,
    }
    if trades is not None:
        closed = [t for t in trades if t.closed]
        wins = [t.return_pct / 100 for t in closed if t.pnl > 0]
        losses = [t.return_pct / 100 for t in closed if t.pnl <= 0]
        gross_win = sum(t.pnl for t in closed if t.pnl > 0)
        gross_loss = -sum(t.pnl for t in closed if t.pnl <= 0)
        out.update({
            "Trades (closed)": len(closed),
            "Win rate": len(wins) / len(closed) if closed else np.nan,
            "Avg win": np.mean(wins) if wins else np.nan,
            "Avg loss": np.mean(losses) if losses else np.nan,
            "Profit factor": gross_win / gross_loss if gross_loss > 0 else np.nan,
            "Stops hit": sum(t.exit_reason == "stop" for t in closed),
        })
    if exposure is not None:
        out["Time in market"] = float(exposure.mean())
    if total_costs is not None:
        out["Total costs (₹)"] = total_costs
    return out


def fmt(key: str, v) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "n/a"
    if key in PCT_KEYS or "CAGR" in key:
        return f"{v:.2%}"
    if key in ("Trades (closed)", "Stops hit"):
        return f"{int(v)}"
    if "₹" in key:
        return f"{v:,.0f}"
    if isinstance(v, (int, float, np.floating)):
        return f"{v:.2f}"
    return str(v)


def table(cols: dict[str, dict]) -> str:
    df = pd.DataFrame(cols)
    return df.apply(lambda col: [fmt(k, v) for k, v in col.items()]).to_string()
