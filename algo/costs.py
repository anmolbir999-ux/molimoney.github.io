"""Indian equity delivery-trade costs (Part 4).

Rates change. Check your broker's charges page before relying on these.
Defaults roughly follow a discount broker such as Zerodha (₹0 delivery brokerage).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CostModel:
    brokerage_pct: float = 0.0        # % of turnover (0 for free delivery)
    brokerage_cap: float = 20.0       # ₹ max per order, if brokerage_pct > 0
    stt_pct: float = 0.1              # Securities Transaction Tax, buy AND sell (delivery)
    exchange_pct: float = 0.00297     # NSE transaction charge
    sebi_per_crore: float = 10.0      # SEBI turnover fee, ₹10 per ₹1 crore
    stamp_pct_buy: float = 0.015      # stamp duty, buy side only
    gst_pct: float = 18.0             # on brokerage + exchange + SEBI fee
    dp_charge_sell: float = 15.93     # depository charge per sell (per scrip per day)

    def cost(self, turnover: float, side: str) -> float:
        """Total ₹ charges for one order of `turnover` rupees. side = 'BUY' or 'SELL'."""
        if turnover <= 0:
            return 0.0
        brokerage = min(turnover * self.brokerage_pct / 100, self.brokerage_cap)
        stt = turnover * self.stt_pct / 100
        exchange = turnover * self.exchange_pct / 100
        sebi = turnover * self.sebi_per_crore / 1e7
        stamp = turnover * self.stamp_pct_buy / 100 if side == "BUY" else 0.0
        gst = (brokerage + exchange + sebi) * self.gst_pct / 100
        dp = self.dp_charge_sell if side == "SELL" else 0.0
        return brokerage + stt + exchange + sebi + stamp + gst + dp

    def approx_pct(self, side: str) -> float:
        """Approximate % cost per side (ignores the fixed DP charge). Used by portfolio backtests."""
        return self.cost(1e7, side) / 1e7 * 100
