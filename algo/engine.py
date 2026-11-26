"""Single-stock trading engine shared by the backtester and the paper trader.

The same `Trader.on_bar()` logic runs in both, so paper results are directly
comparable with backtest results.

Order of events on each bar (day):
  1. fill the order decided at yesterday's close, at today's OPEN (+/- slippage)
  2. check the ATR stop-loss against today's LOW (gap-downs fill at the open)
  3. at today's CLOSE, read the strategy target and queue tomorrow's order

Risk management (Part 3 / 3B):
  stop_atr  : exit if price falls stop_atr × ATR below the entry price (0 = off)
  risk_pct  : size the position so hitting the stop loses only risk_pct% of capital
              (needs stop_atr > 0). 0 = invest all available cash.
After a stop-out the strategy must go flat (target 0) before it may re-enter.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

import pandas as pd

from costs import CostModel

TRADING_DAYS = 252


@dataclass
class TradeRecord:
    ticker: str
    entry_date: str
    entry_price: float
    qty: int
    entry_cost: float
    stop: float | None = None
    exit_date: str | None = None
    exit_price: float | None = None
    exit_cost: float = 0.0
    exit_reason: str = ""

    @property
    def closed(self) -> bool:
        return self.exit_price is not None

    @property
    def pnl(self) -> float:
        if not self.closed:
            return float("nan")
        return (self.exit_price - self.entry_price) * self.qty - self.entry_cost - self.exit_cost

    @property
    def return_pct(self) -> float:
        return self.pnl / (self.entry_price * self.qty) * 100 if self.closed else float("nan")


@dataclass
class Trader:
    ticker: str
    cash: float
    costs: CostModel = field(default_factory=CostModel)
    slippage_pct: float = 0.05
    stop_atr: float = 0.0
    risk_pct: float = 0.0
    cash_rate_pct: float = 0.0
    wait_for_fresh: bool = True
    # --- state ---
    qty: int = 0
    stop: float | None = None
    pending: str = ""            # "BUY", "SELL" or ""
    pending_atr: float = 0.0
    armed: bool = False
    total_costs: float = 0.0
    trades: list[TradeRecord] = field(default_factory=list)

    def __post_init__(self):
        if not self.wait_for_fresh and not self.trades:
            self.armed = True

    # ------------------------------------------------------------ helpers
    def _buy(self, day: str, open_px: float) -> None:
        price = open_px * (1 + self.slippage_pct / 100)
        q_cash = int(self.cash // (price * 1.002))
        q = q_cash
        stop = None
        if self.stop_atr > 0 and self.pending_atr > 0:
            stop = price - self.stop_atr * self.pending_atr
            if self.risk_pct > 0:
                q = min(q_cash, int(self.cash * self.risk_pct / 100 / (self.stop_atr * self.pending_atr)))
        while q > 0 and q * price + self.costs.cost(q * price, "BUY") > self.cash:
            q -= 1
        if q <= 0:
            return
        c = self.costs.cost(q * price, "BUY")
        self.cash -= q * price + c
        self.total_costs += c
        self.qty, self.stop = q, stop
        self.trades.append(TradeRecord(self.ticker, day, round(price, 4), q, round(c, 2), stop))

    def _sell(self, day: str, px: float, reason: str) -> None:
        price = px * (1 - self.slippage_pct / 100)
        c = self.costs.cost(self.qty * price, "SELL")
        self.cash += self.qty * price - c
        self.total_costs += c
        t = self.trades[-1]
        t.exit_date, t.exit_price, t.exit_cost, t.exit_reason = day, round(price, 4), round(c, 2), reason
        self.qty, self.stop = 0, None

    # ------------------------------------------------------------ main step
    def on_bar(self, day: str, o: float, h: float, l: float, c: float,
               target: int, atr: float = 0.0, allow_entry: bool = True) -> float:
        """Process one daily bar. Returns end-of-day equity."""
        # 1. fill yesterday's decision at today's open
        if self.pending == "BUY" and self.qty == 0:
            self._buy(day, o)
        elif self.pending == "SELL" and self.qty > 0:
            self._sell(day, o, "signal")
        self.pending = ""

        # 2. stop-loss
        if self.qty > 0 and self.stop is not None and l <= self.stop:
            self._sell(day, min(o, self.stop), "stop")
            self.armed = False

        # idle cash optionally earns interest (e.g. liquid fund)
        if self.cash_rate_pct:
            self.cash *= (1 + self.cash_rate_pct / 100) ** (1 / TRADING_DAYS)

        # 3. decide at the close
        if target == 0:
            self.armed = True
        if self.qty == 0 and target == 1 and self.armed and allow_entry:
            self.pending, self.pending_atr = "BUY", (atr if atr and not math.isnan(atr) else 0.0)
        elif self.qty > 0 and target == 0:
            self.pending = "SELL"
        return self.cash + self.qty * c

    def equity(self, price: float) -> float:
        return self.cash + self.qty * price

    # ------------------------------------------------------------ persistence (paper trading)
    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Trader":
        d = dict(d)
        d["costs"] = CostModel(**d["costs"])
        trades = [TradeRecord(**t) for t in d.pop("trades")]
        armed = d.pop("armed")
        t = cls(**d)
        t.trades, t.armed = trades, armed
        return t


@dataclass
class BacktestResult:
    equity: pd.Series
    exposure: pd.Series
    trader: Trader

    @property
    def trades(self) -> list[TradeRecord]:
        return self.trader.trades


def run_backtest(df: pd.DataFrame, target: pd.Series, capital: float, *, ticker: str = "",
                 costs: CostModel | None = None, slippage_pct: float = 0.05, stop_atr: float = 0.0,
                 risk_pct: float = 0.0, cash_rate_pct: float = 0.0, atr_period: int = 14,
                 allow_entry: pd.Series | None = None, wait_for_fresh: bool = True) -> BacktestResult:
    from indicators import atr as atr_fn
    a = atr_fn(df, atr_period).reindex(df.index)
    target = target.reindex(df.index).fillna(0).astype(int)
    allow = allow_entry.reindex(df.index).fillna(False) if allow_entry is not None else None
    tr = Trader(ticker, capital, costs or CostModel(), slippage_pct, stop_atr, risk_pct,
                cash_rate_pct, wait_for_fresh)
    eq, expo = [], []
    for i, (ts, row) in enumerate(df.iterrows()):
        eq.append(tr.on_bar(str(ts.date()), row["Open"], row["High"], row["Low"], row["Close"],
                            int(target.iloc[i]), float(a.iloc[i]),
                            True if allow is None else bool(allow.iloc[i])))
        expo.append(tr.qty > 0)
    return BacktestResult(pd.Series(eq, index=df.index, name="Strategy"),
                          pd.Series(expo, index=df.index), tr)


def buy_and_hold(df: pd.DataFrame, capital: float, costs: CostModel | None = None,
                 slippage_pct: float = 0.0) -> pd.Series:
    """Buy on the first day's open and hold. costs=None for an index (no fees)."""
    first_open = df["Open"].iloc[0]
    if costs is None:
        return df["Close"] / first_open * capital
    price = first_open * (1 + slippage_pct / 100)
    q = int(capital // (price * 1.002))
    cash = capital - q * price - costs.cost(q * price, "BUY")
    return cash + q * df["Close"]
