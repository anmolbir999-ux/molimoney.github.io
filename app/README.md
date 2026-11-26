# Paper Trader – Android app

Runs the trading algorithm on your phone: paper trades Nifty stocks with live prices and learns from its mistakes. No real money, no broker.

**Install:** download [`PaperTrader.apk`](PaperTrader.apk) on the phone → open it → allow "install unknown apps".

## How it works
- **Data:** free daily prices from Yahoo Finance (`query1.finance.yahoo.com`), fetched when you open the app or tap Update. Missed days are caught up one session at a time.
- **Fills:** signal at a session's close → simulated fill at the next session's open, with STT, stamp duty, GST, exchange/SEBI fees, DP charges and 0.05% slippage. Dividends are credited; splits/bonuses adjust positions.
- **Brain** (`web/engine.js`):
  - 7 strategies (buy & hold, SMA/EMA cross, MACD, Donchian breakout, RSI dip-buy, Bollinger reversion) run in hidden "shadow" paper accounts per stock.
  - Every 21 sessions each stock switches to the strategy with the best trailing-year Sharpe (≥ 0.3), or to cash if none qualifies.
  - Every closed trade is tagged with its entry conditions. A condition whose trades lose clearly more than the rest (≥ 12 trades, negative average, ≥ 1 point worse) becomes a rule that blocks new entries. Rules are dropped again if the evidence fades.
  - Before paper trading starts it practises on the previous 2 years (configurable), so it begins with learned state. Practice results are shown separately.
- **Storage:** everything stays on the phone (`files/state.json`).
- **Reminder:** optional weekday 4:15 PM notification.

The engine mirrors `algo/engine.py`; on the same data it matches the Python backtester's results.

## Build
```bash
app/android/build_apk.sh     # JDK 17+, Android SDK platform 34 + build-tools 34.0.0
```
The signing key lives in `app/android/keystore/` (not committed). Updates must be signed with the same key.

Paper trading only, not investment advice. SEBI found 87.7% of individual F&O traders lost money in FY26.
