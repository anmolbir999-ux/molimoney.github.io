# Part 4: Build Your First Algorithm (Python)

> Educational code only. Not investment advice. SEBI found **87.7% of individual F&O traders lost
> money in FY26**. Never move a strategy to F&O or real money before it passes every step below.

All code is in [`algo/`](../algo). Install with `pip install -r algo/requirements.txt`, then run
commands from inside `algo/`.

---

## 4.1 The strategy: 50/200 SMA crossover

- **BUY** when the 50-day SMA crosses **above** the 200-day SMA ("golden cross").
- **SELL** when it crosses **below** ("death cross").
- Long-only, one position, whole shares.
- **Hypothesis (Part 3 step 1):** trends persist; the cross identifies a long-term uptrend late but reliably, and avoids the worst of long bear markets.

```bash
python backtest.py                                   # RELIANCE.NS, 15 years, ₹1 lakh
python backtest.py HDFCBANK.NS INFY.NS TCS.NS ITC.NS  # several stocks + summary table
python backtest.py RELIANCE.NS --trades               # full trade log
```

## 4.2 How the code is organised

| File | Role |
|---|---|
| `data.py` | Downloads OHLCV from yfinance (adjusted for splits/bonuses/dividends); cleans bad prints |
| `strategies.py` | Each strategy returns a daily **target** (1 = be long, 0 = be flat) using only past data |
| `engine.py` | `Trader.on_bar()`: day-by-day state machine, shared by backtest **and** paper trading |
| `costs.py` | Indian delivery costs |
| `metrics.py` | CAGR, drawdown, Sharpe, Sortino, Calmar, VaR, win rate, profit factor |
| `charts.py` | Price + SMAs + ▲ buy / ▼ sell / ✕ stop markers, equity vs benchmarks, drawdown |

### The engine's order of events (each day)
1. Fill the order decided **yesterday at the close** at **today's open** ± slippage.
2. Check the ATR stop-loss against today's low (gap-downs fill at the open).
3. At today's close, read the target and queue tomorrow's order.

Using the same day's close for both signal and fill is **look-ahead bias**, the most common backtest bug.

### Costs (`costs.py`, approximate; check your broker)
| Charge | Rate |
|---|---|
| Brokerage (delivery, discount broker) | ₹0 |
| STT | 0.1% on buy **and** sell |
| NSE transaction charge | ~0.003% |
| SEBI fee | ₹10 per crore |
| Stamp duty | 0.015% on buy |
| GST | 18% on brokerage + exchange + SEBI fee |
| DP charge | ~₹16 per sell |
| Slippage (default) | 0.05% per fill |

## 4.3 Metrics explained

| Metric | Meaning |
|---|---|
| **CAGR** | Compound annual growth rate: (final ÷ start)^(1/years) − 1 |
| **Max drawdown** | Worst peak-to-trough fall. Ask: could I sit through this? |
| **Win rate** | % of closed trades that made money. **Not** a measure of profitability on its own |
| **Sharpe** | (Return − risk-free 6%) ÷ volatility, annualised. >0.5 decent, >1 good, >2 suspicious |
| **Sortino** | Like Sharpe but only penalises downside volatility |
| **Calmar** | CAGR ÷ max drawdown |
| **VaR 95%** | Daily loss exceeded on ~1 day in 20 |
| **Profit factor** | Gross profits ÷ gross losses |

## 4.4 Results: 15 years (Nov 2011 – Nov 2026), ₹1 lakh

| Stock | Strategy CAGR | Max DD | Sharpe | Win rate | Buy & hold CAGR |
|---|---|---|---|---|---|
| RELIANCE | 5.7% | −45.7% | 0.11 | 64% | 15.5% |
| HDFCBANK | 8.6% | −35.6% | 0.23 | 90% | 15.7% |
| INFY | 0.0% | −47.8% | −0.17 | 31% | 11.8% |
| TCS | 10.6% | −28.4% | 0.32 | 50% | 13.7% |
| ITC | 4.1% | −43.7% | −0.02 | 44% | 9.4% |
| *Nifty 50 buy & hold* | 11.8% | −38.4% | 0.43 | — | — |

**The strategy lost to buy-and-hold on every stock, and to the Nifty on every stock.** Why:
- **Late signals:** it sold Reliance near the March 2020 bottom and bought back higher.
- **Whipsaws** in sideways markets (Infosys: 13 trades, mostly small losses, each paying costs).
- **Idle cash earns nothing** (Reliance was invested only 72% of the time; try `--cash-rate 6`).
- **Win rate misleads:** HDFC Bank won 90% of trades but earned about half of buy-and-hold.
- **Upside:** it sometimes cut drawdowns (TCS −28% vs −53%).

**Not modelled:** capital-gains tax, Nifty dividends (`^NSEI` is a price index, ~1–1.5%/yr understated), survivorship bias (stocks picked with hindsight).

### 🏋️ Exercises
1. Run it on 5 other Nifty stocks. Does it ever beat buy-and-hold?
2. Try `-p fast=20,slow=100`. Trying many settings and keeping the best = **overfitting**; check with `--oos-split 2021-01-01 --optimize "fast=10,20,50,100;slow=100,150,200,250"`.
3. Add `--market-filter` (only buy when the Nifty is above its 200-day). Does it help?
4. Add `--stop-atr 3 --risk-pct 2`. Compare drawdown and CAGR. (Reliance: drawdown −46% → −13%, CAGR → ~0%.)
5. `python backtest.py --list` and test every strategy on one stock.

## 4.5 Charts with buy/sell signals

Every backtest saves `charts/<TICKER>_<strategy>.png`:
1. Price with SMAs and ▲ buy / ▼ sell / ✕ stop-loss markers
2. (Oscillator panel for RSI/MACD strategies)
3. Equity curve vs buy-and-hold of the stock and the Nifty 50
4. Drawdown

## 4.6 Paper trading

Same engine, run forward one day at a time, with **real unadjusted prices** for fills and state saved in `paper_state.json`.

```bash
python paper_trade.py init RELIANCE.NS TCS.NS ICICIBANK.NS --capital 300000 --stop-atr 3
python paper_trade.py run        # every trading day after 3:45 PM IST
python paper_trade.py status     # cash, positions, stops, pending orders
python paper_trade.py trades     # journal + win rate + net P&L
```

Automate it (cron, Mon–Fri 4:15 PM IST):
```
15 16 * * 1-5  cd /path/to/algo && python paper_trade.py run >> paper.log 2>&1
```

**Rules:** paper trade **at least 2–3 months**, ideally through a correction. Compare with what the backtest predicted for the same period. If they differ a lot, find out why before going further.

## 4.7 Live trading with Zerodha Kite Connect

### How Kite Connect works
1. Create an app at developers.kite.trade (paid subscription for market data; check current pricing) → you get an **API key** and **secret**.
2. **Register a static IP** (mandatory since 1 April 2026; see 4.8).
3. **Daily login (OAuth):** open the login URL → log in with Zerodha ID + 2FA → you're redirected with a `request_token` → exchange it (with your secret) for an **access token**, valid until ~6 AM the next day.
4. Use the token for API calls: `holdings()`, `positions()`, `ltp()`, `place_order()`, `place_gtt()`, `orders()`.

```bash
pip install kiteconnect
export KITE_API_KEY=xxxx KITE_API_SECRET=yyyy       # never commit these
python live_kite.py login                           # daily
python live_kite.py status
python live_kite.py run RELIANCE.NS --capital-per-stock 20000                     # DRY RUN (default)
python live_kite.py run RELIANCE.NS --capital-per-stock 20000 --stop-atr 3 --live  # real orders
```

### What `run` does
- Signals from daily data up to **yesterday's close** (same strategy code as the backtest).
- **BUY** if the target turned on within `--lookback` sessions and you hold none; **SELL** if the target is 0 and you hold shares.
- **Marketable LIMIT** orders (LTP ± 0.3%), CNC (delivery) product.
- Optional **GTT stop-loss** at entry − k × ATR.
- Execution algos (Part 3B): `--exec twap | vwap | iceberg`.

### Safety rails
- **Dry-run by default**; `--live` requires typing `YES`.
- `--max-order-value` (₹50,000 default) and `--max-orders` per run.
- A file named `KILL_SWITCH` blocks all trading.
- 0.35 s pause between API calls (far below 10 orders/sec).
- Every order logged to `orders_log.csv`.

## 4.8 SEBI rules for retail algo trading (summary)

Full details: [`algo/SEBI_RULES.md`](../algo/SEBI_RULES.md).

- SEBI circular **4 Feb 2025**, *Safer participation of retail investors in algorithmic trading*.
- **Broker is responsible** for all API orders; third-party algo providers must be exchange-empanelled.
- **Static IP whitelisting:** API orders accepted only from a registered app + whitelisted static IP (**mandatory from 1 April 2026**).
- **Up to 10 orders/second** per exchange/segment without registering your algo; above that it needs exchange registration and an Algo-ID.
- **Authenticated access only** (OAuth/2FA, daily login).
- **White-box vs black-box:** black-box providers must be SEBI-registered Research Analysts.
- Your own algo for yourself and close family is the simplest category. Selling it or running it for others needs registration.

## 4.9 Go-live checklist

- [ ] Beats buy-and-hold **out-of-sample** after costs
- [ ] Not just the best of many parameter combinations
- [ ] 2–3+ months of paper trading matching the backtest
- [ ] Static IP registered; keys in environment variables only
- [ ] Capital you can afford to lose entirely (a few thousand rupees to start)
- [ ] Hard limits set; kill rule written down in advance
- [ ] You check fills and positions daily (automation ≠ unattended)

## ✅ Check your understanding

1. Why does the engine fill at the **next** day's open instead of today's close?
2. HDFC Bank had a 90% win rate but half the buy-and-hold return. Explain how.
3. List three things the backtest does **not** model, and which direction each biases the result.
4. Your strategy's in-sample Sharpe is 0.9 and out-of-sample is 0.1. What do you conclude?
5. Why does the Kite access token expire daily, and what does SEBI require before your API orders are accepted?
6. Your algo places 25 orders in one second. What happens, and what would you need to do to legally run it that way?
