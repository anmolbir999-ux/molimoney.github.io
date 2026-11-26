# Moli Trader – Android paper-trading app

Runs the trading algorithm on your phone: paper trades Nifty stocks with live prices and learns from its mistakes. No real money, no broker.

**Install:** download [`PaperTrader.apk`](PaperTrader.apk) (installs as "Moli Trader") on the phone → open it → allow "install unknown apps".

## How it works
- **Data:** free daily prices from Yahoo Finance (`query1.finance.yahoo.com`), fetched when you open the app or tap Update. Missed days are caught up one session at a time.
- **Fills:** signal at a session's close → simulated fill at the next session's open, with STT, stamp duty, GST, exchange/SEBI fees, DP charges and 0.05% slippage. Dividends are credited; splits/bonuses adjust positions.
- **Brain** (`web/engine.js`):
  - 7 strategies (buy & hold, SMA/EMA cross, MACD, Donchian breakout, RSI dip-buy, Bollinger reversion) run in hidden "shadow" paper accounts per stock.
  - Every 21 sessions each stock switches to the strategy with the best trailing-year Sharpe (≥ 0.3), or to cash if none qualifies.
  - Every closed trade is tagged with its entry conditions. A condition whose trades lose clearly more than the rest (≥ 12 trades, negative average, ≥ 1 point worse) becomes a rule that blocks new entries. Rules are dropped again if the evidence fades.
  - Before paper trading starts it practises on the previous 2 years (configurable), so it begins with learned state. Practice results are shown separately.
- **Controls:** *Pause new buys* (positions keep their stops and exits), *Stop & sell all* (everything sells at the next open), *Resume*. The Update button turns into **Stop** while downloading, with a progress bar and time estimate.
- **Stocks:** add or remove from a searchable NIFTY 50 + ETF list, or any NSE symbol (checked on Yahoo first). A new stock gets the same paper capital as the others and its strategies warm up on past data; a removed stock is sold at the next open and its cash is withdrawn. Returns are time-weighted, so adding or removing stocks doesn't count as profit or loss.
- **Train on the past** (Train tab): a separate practice account trades any past period from 2008 onward (presets: last 1/3/5/10 years, COVID crash, 2008 crisis, or custom dates) day by day, never seeing the future. Watch the replay at 1×–64× speed with play/pause, skip and stop. Start from a fresh brain or with only the lessons from trades that ended before the period (an honest test). Afterwards, preview which rules would change and optionally **teach the live brain**: the period's trades join its evidence pool (deduplicated). Each run is saved to the history and can be exported.
- **Countdowns:** market open/close timer, time until queued orders fill, sessions until the next strategy review (NSE holidays not included).
- **Download data** (More tab): trades, daily equity, brain log, update history (CSV) and a full JSON backup, saved to `Downloads/Moli/` with the export time in each file name and timestamps inside.
- **Storage:** everything stays on the phone (`files/state.json`).
- **Reminder:** optional weekday 4:15 PM notification.
- **Look:** Moli navy theme (from the Moli page in this repo) with bottom navigation.

The engine mirrors `algo/engine.py`; on the same data it matches the Python backtester's results.

## Build
```bash
app/android/build_apk.sh     # JDK 17+, Android SDK platform 34 + build-tools 34.0.0
```
The signing key lives in `app/android/keystore/` (not committed). Updates must be signed with the same key.

Paper trading only, not investment advice. SEBI found 87.7% of individual F&O traders lost money in FY26.
