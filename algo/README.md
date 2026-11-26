# Algo trading toolkit for NSE stocks (learning project)

A complete, beginner-readable pipeline, from reading the market to placing (carefully
guarded) live orders. Built alongside a step-by-step course on the Nifty 50, charts,
quant strategies and algorithmic trading.

> **Educational code only. Not investment advice.** SEBI's studies show about
> **9 in 10 individual F&O traders lose money** (87.7% in FY26). Read [SEBI_RULES.md](SEBI_RULES.md).

## Install

```bash
pip install -r requirements.txt          # core
pip install statsmodels kiteconnect      # optional: cointegration test, live trading
```

## What's inside: mapped to the course

| Course part | File | What it does |
|---|---|---|
| **1 – How the Nifty moves** | `checklist.py` | Daily pre-market checklist (GIFT Nifty, US markets, crude, USD/INR, FII/DII, VIX, 50-DMA), scored and logged; `--evaluate` measures your real hit rate |
| **2 – Charts** | `chart.py`, `charts.py` | Line, OHLC bar, candlestick & Heikin-Ashi charts; SMA/EMA, Bollinger, VWAP, Donchian, volume, RSI, MACD, ATR; candle-pattern markers; auto support/resistance; `--scan` text summary |
| **2 – Indicators & patterns** | `indicators.py`, `patterns.py` | All indicators (with "where it fails" notes); doji, hammer, hanging man, shooting star, engulfing, morning/evening star |
| **3 – Strategy families** | `strategies.py` | Trend following (SMA/EMA cross, MACD, Donchian breakout, Heikin-Ashi trend), mean reversion (RSI, Bollinger), pattern-based |
| **3 – Stat-arb / pairs** | `pairs.py` | Rolling-hedge-ratio z-score pairs trade + cointegration test |
| **3 / 3B – Factor investing** | `factor_portfolio.py` | Monthly momentum / low-volatility / combo portfolio vs Nifty |
| **3 – Research process** | `backtest.py` | Backtest → out-of-sample split → parameter optimisation that shows overfitting |
| **3B – Risk management** | `engine.py`, `metrics.py` | ATR stop-loss, risk-per-trade position sizing, market-regime filter; Sharpe, Sortino, Calmar, VaR, drawdown, profit factor |
| **3B – Execution algos** | `live_kite.py` | TWAP, VWAP (volume-curve) and iceberg order slicing |
| **4 – First algorithm** | `backtest.py` (default) | 50/200 SMA crossover, 15 years, with brokerage/STT/stamp/GST/DP costs & slippage, vs buy-and-hold & Nifty, with buy/sell chart |
| **4 – Paper trading** | `paper_trade.py` | Forward test with the same engine, JSON state, daily cron |
| **4 – Live (Kite Connect)** | `live_kite.py` | Login flow, status, signal-driven CNC orders, GTT stop-loss; **dry-run by default** |
| **4 – SEBI rules** | `SEBI_RULES.md` | Retail algo framework, static IP, 10 orders/sec, F&O curbs, tax, go-live checklist |

## Quick start

```bash
# Part 4: the first algorithm (50/200 SMA crossover, RELIANCE, 15 years)
python backtest.py
python backtest.py HDFCBANK.NS INFY.NS TCS.NS ITC.NS          # summary table across stocks
python backtest.py --list                                     # all strategies + parameters
python backtest.py SBIN.NS -s rsi_reversion --trades
python backtest.py RELIANCE.NS --stop-atr 3 --risk-pct 2 --market-filter
python backtest.py RELIANCE.NS --oos-split 2021-01-01 \
       --optimize "fast=10,20,50,100;slow=100,150,200,250"    # watch overfitting happen

# Part 2: charts
python chart.py ICICIBANK.NS --patterns --levels -i sma20,sma50,bb,volume,rsi,macd --scan
python chart.py TCS.NS --kind heikin -i ema20
python chart.py RELIANCE.NS --interval 15m --period 5d --kind line -i vwap,volume

# Part 3: other strategy families
python pairs.py HDFCBANK.NS ICICIBANK.NS
python factor_portfolio.py --factor momentum --top 10

# Part 1: every morning before 9:15
python checklist.py --gift 0.4 --event "RBI policy"
python checklist.py --evaluate

# Part 4: paper → live
python paper_trade.py init RELIANCE.NS TCS.NS --capital 200000 --stop-atr 3
python paper_trade.py run            # daily after 3:45 PM IST
python paper_trade.py status
python live_kite.py run RELIANCE.NS --capital-per-stock 20000 --exec twap --slices 4   # DRY RUN
```

Charts are written to `charts/`.

## How the backtest avoids lying to you

* **No look-ahead:** signal on day t's close, fill at day t+1's open.
* **Real costs:** STT, exchange, SEBI, stamp duty, GST, DP charges (`costs.py`) + slippage.
* **Whole shares**, cash-constrained sizing; first trade waits for a fresh signal.
* **Out-of-sample testing** and an optimiser that shows the in-sample → out-of-sample decay.

Still not modelled: capital-gains tax, dividends on the Nifty benchmark (`^NSEI` is a price
index), survivorship bias (today's large caps were picked with hindsight), corporate-action
quirks in free data. Results on 15 years of data: the 50/200 crossover **underperformed
buy-and-hold** on every large-cap tested. That is the lesson.

## Files you should never commit

`.kite_token.json`, API keys, `.env`: covered by `.gitignore`. Keep `KITE_API_KEY` /
`KITE_API_SECRET` in environment variables.
