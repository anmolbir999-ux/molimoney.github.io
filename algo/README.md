# 50/200 SMA crossover backtest (NSE)

Educational backtest of a golden-cross / death-cross strategy on NSE stocks using `yfinance`.
Not investment advice.

```bash
pip install -r requirements.txt
python ma_crossover.py                              # RELIANCE.NS, last 15 years
python ma_crossover.py HDFCBANK.NS INFY.NS TCS.NS   # several stocks + summary table
python ma_crossover.py RELIANCE.NS --cash-rate 6    # idle cash earns 6%/yr (liquid fund)
```

- Signal on day t close, fill at day t+1 open (no look-ahead), with slippage.
- Indian delivery costs: STT, exchange, SEBI, stamp duty, GST, DP charges (`CostModel`).
- Reports CAGR, max drawdown, win rate, Sharpe vs. buy-and-hold of the stock and Nifty 50.
- Saves price + signals, equity curve and drawdown charts to `charts/`.
