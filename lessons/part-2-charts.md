# Part 2: Reading Every Kind of Chart

> Chart reading is a **probability tool**, not a crystal ball. Most signals fail often. The goal
> is to tilt the odds slightly and keep losses small when wrong. SEBI found **87.7% of
> individual F&O traders lost money in FY26**, and most of them were reading charts too.

Practise every section with `algo/chart.py` (run from the `algo/` folder).

---

## 2.1 Chart types

All are drawn from the same four numbers per period: **Open, High, Low, Close (OHLC)**.

### Line chart
- Joins **closing prices** only.
- **Good for:** the big trend, comparing stocks, multi-year views.
- **Hides:** intraday action. A day that crashed 5% and recovered looks quiet.

### Bar chart (OHLC bar)
```
   |      ← high
  -|      ← open (left tick)
   |-     ← close (right tick)
   |      ← low
```
All four prices, compact, but harder to read at a glance.

### Candlestick chart
```
    │   ← upper shadow (wick): went up here, got pushed back
  ┌─┴─┐
  │   │ ← real body: open to close
  └─┬─┘    green/hollow = close > open,  red/filled = close < open
    │   ← lower shadow: went down here, buyers pushed back
```
- **Body size** = conviction. A big green body means buyers controlled the whole session.
- **Shadows** = rejection. A long lower shadow means sellers tried and failed.

### Heikin-Ashi ("average bar")
```
HA Close = (O + H + L + C) / 4
HA Open  = (previous HA Open + previous HA Close) / 2
HA High  = max(H, HA Open, HA Close)     HA Low = min(L, HA Open, HA Close)
```
- **Good for:** seeing trends (runs of green candles with no lower shadows).
- **Danger:** **HA prices are not real prices.** Never set stops or limit orders from an HA chart.
- It lags: the `heikin_trend` backtest lost money on HDFC Bank with 230 whipsaw trades.

### Two settings that matter
- **Timeframe:** decide direction on the higher timeframe (weekly), time entries on the lower one (daily).
- **Log vs linear scale:** use **log** over long periods. ₹100 → ₹200 (+100%) should look bigger than ₹1,400 → ₹1,500 (+7%).

### 🏋️ Exercise 2.1
```bash
python chart.py RELIANCE.NS --kind line   --period 1y -i none
python chart.py RELIANCE.NS --kind bar    --period 3mo -i none
python chart.py RELIANCE.NS --kind candle --period 3mo -i none
python chart.py RELIANCE.NS --kind heikin --period 3mo -i none
```
1. Find a day with a long shadow on the candle chart. Is it visible on the line chart?
2. Count the longest run of green Heikin-Ashi candles. Were the real candles all green?

---

## 2.2 Candlestick patterns

**Golden rule: a pattern means nothing without context.** Ask:
1. **Where is it?** After a clear trend? At support/resistance?
2. **Is there volume?** 2× average is stronger than 0.8×.
3. **Is it confirmed?** Wait for the next candle to move in the expected direction.

| Pattern | Looks like | Meaning | Needs |
|---|---|---|---|
| **Doji** | Open ≈ close, tiny body | **Indecision** | Context; after a long rally, buyers are tiring |
| **Hammer** | Small body at top, lower shadow ≥ 2× body | Sellers pushed down, buyers pushed all the way back | A **prior downtrend**, ideally at support |
| **Hanging man** | Same shape as a hammer | Selling appeared in an uptrend | **After an uptrend**; needs a red confirmation candle |
| **Shooting star** | Small body at bottom, long upper shadow | Buyers pushed up and were rejected | After an uptrend, at resistance |
| **Bullish engulfing** | Red candle, then a bigger green body covering it | Buyers took over | After a decline; stronger with volume |
| **Bearish engulfing** | Green candle, then a bigger red body covering it | Sellers took over | After a rally |
| **Morning star** | Big red → small star → big green closing above the red's midpoint | Three-day bottom | After a decline |
| **Evening star** | Big green → small star → big red closing below the green's midpoint | Three-day top | After a rally |

### Real example: ICICI Bank, 26 Nov 2026
- **Bearish engulfing** at ₹1,611 after a rally from ~₹1,390 in one month.
- Price **13% above its 50-day SMA** (stretched); RSI fell from **above 80** to 65.
- Volume **0.87× average**: weak confirmation.

**Read:** real warning signs, but low volume plus a strong uptrend means it may only be a pause.
**Wait for the next candle:** a close below the engulfing low confirms it; a close above its high cancels it.

### What the evidence says
Large studies find most candle patterns have **weak predictive power on their own**, often gone after costs. The `candle_reversal` backtest lost money on HDFC Bank (−2.2% CAGR, 116 trades). Use patterns for **timing** inside a bigger picture (trend + S/R), never as a strategy alone.

### 🏋️ Exercise 2.2
```bash
python chart.py HDFCBANK.NS --patterns --levels -i sma50,volume --period 6mo --scan
python chart.py TATASTEEL.NS --patterns --levels -i sma50,volume --period 6mo --scan
```
For three marked patterns, note: (1) context, (2) volume vs average, (3) what happened over the next 5 candles. Count how many "worked."

---

## 2.3 Chart patterns

### Support and resistance (S/R)
- **Support:** a zone where buying repeatedly stopped declines. **Resistance:** where selling repeatedly stopped rallies.
- **Why they work:** memory and regret. Buyers stuck at ₹1,460 sell when price returns there "to get out even."
- **Zones, not exact lines** (₹1,450–1,470, not ₹1,461.00).
- **Role reversal:** broken resistance often becomes support, and vice versa.
- **Round numbers** (24,000 / 25,000 / 26,000 on the Nifty) act as S/R; option writers cluster at these strikes.

### Trendlines
- **Uptrend line:** join two or more rising lows. **Downtrend line:** join falling highs.
- More touches = more valid. Lines that are too steep always break.
- A break is a **warning**, not an automatic reversal; price often just goes sideways.

### Head and shoulders (top reversal)
```
          Head
   LS     /\     RS
   /\    /  \    /\
  /  \  /    \  /  \
 /    \/      \/    \  ← neckline (join the two troughs)
                     \
                      \  breakdown → target ≈ head-to-neckline height, measured down from the neckline
```
- Confirmed **only on a close below the neckline**, ideally on rising volume.
- **Inverse H&S** = bottom reversal. Many "H&S" never break the neckline; don't trade early.

### Double top / double bottom
- **Double top (M):** two failures at about the same high; confirmed when the middle trough breaks.
- **Double bottom (W):** mirror image. A second low on **lower volume** is a good sign (selling drying up).

### Triangles
| Type | Shape | Usual bias |
|---|---|---|
| **Ascending** | Flat top, rising lows | Bullish |
| **Descending** | Flat bottom, falling highs | Bearish |
| **Symmetrical** | Converging lines | Neutral; often breaks in the prior trend's direction |

### Flags and pennants (continuation)
- Sharp move (**flagpole**) → small, tight, slightly counter-trend consolidation (**flag**) → continuation.
- **Target** ≈ flagpole length, added from the breakout. Volume should shrink in the flag and expand on the breakout.

### Breakouts and false breakouts
Filters:
1. Use the **close**, not intraday spikes.
2. **Volume** ≥ 1.5× average.
3. **Follow-through** the next day, or a successful **retest** of the broken level.
4. **Market context:** breakouts work better when the Nifty is in an uptrend (`--market-filter` in the backtester).

> Many breakouts fail. Donchian breakout on HDFC Bank: 4.4% CAGR vs 15.7% buy-and-hold.
> Breakout systems typically win only 35–45% of trades. They profit only if winners are much
> bigger than losers, so **the stop-loss is the strategy**.

### 🏋️ Exercise 2.3
```bash
python chart.py ICICIBANK.NS --kind candle --period 1y --levels -i volume
python chart.py ^NSEI --kind line --period 2y --levels -i sma200
python chart.py INFY.NS --kind candle --period 1y --levels -i volume
```
1. Mark the round numbers the Nifty reacted to.
2. On Infosys, find one pattern; write entry, stop and target **before** looking at what happened next.
3. Find one failed breakout. What warning signs were there?

---

## 2.4 Indicators: what each is for and where each fails

Indicators are **calculations on price and volume**, not new information. Two momentum indicators (RSI + Stochastic) tell you the same thing twice. Use **one from each family**: trend, momentum, volatility, volume.

### Moving averages (SMA / EMA): trend
- **SMA(n)** = plain average of the last n closes. **EMA(n)** weights recent days more and reacts faster.
- **Uses:** trend filter (above the 200-day = long-term uptrend), dynamic support (20/50-day in strong trends), crossovers.
- **Fails:** **lags** (the 50/200 cross sold Reliance near the March 2020 bottom); whipsaws in ranges (Infosys: 13 trades, mostly small losses).

### RSI (0–100): momentum
```
RSI = 100 − 100 / (1 + average gain / average loss)   over 14 periods (Wilder smoothing)
```
- **Uses:** >70 overbought, <30 oversold; **divergence** (price higher high, RSI lower high = fading momentum); in uptrends RSI holds 40–80, dips to 40 are buy zones.
- **Fails:** stays above 70 for weeks in strong trends (ICICI was above 80 most of November 2026 while rising).

### MACD: trend + momentum
```
MACD line = EMA12 − EMA26     Signal = EMA9 of MACD     Histogram = MACD − Signal
```
- **Uses:** MACD above signal = bullish momentum; above zero = short-term trend above long-term; a **shrinking histogram** warns of fading momentum.
- **Fails:** lags; many false crosses in ranges (`macd_trend` on HDFC Bank: 153 trades, 2.6% a year).

### Bollinger Bands: volatility envelope
```
Middle = SMA20     Upper/Lower = Middle ± 2 × standard deviation
```
- **Uses:** mean reversion in **ranges**; **squeeze** (narrow bands → big move coming, direction unknown); %B (0 = lower band, 1 = upper).
- **Fails:** in **trends**, price "walks the band." Selling every upper-band touch in a trend is a classic beginner loss.

### Volume: confirmation
- **Uses:** confirms breakouts and reversals; shrinking volume in a pullback is healthy.
- **Fails:** expiry days, index rebalancing, block deals and results days create spikes with no directional meaning. NSE **delivery %** is often more informative than raw volume.

### ATR: volatility in rupees
```
True Range = max(High − Low, |High − prev Close|, |Low − prev Close|)    ATR = 14-day average
```
- **Uses:** **risk management**, not direction. ICICI ATR ₹36 (2.2%) → a 2–3× ATR stop (₹72–108) sits outside normal noise. Position size can come from it (`--stop-atr`, `--risk-pct`).
- **Fails:** says nothing about direction; jumps after gaps, so stops widen right after shocks.

### VWAP: the institutional benchmark
```
VWAP = Σ(typical price × volume) / Σ volume, reset every morning   (typical price = (H+L+C)/3)
```
- **Uses:** intraday, price above VWAP = buyers in control; institutions judge execution against it (`live_kite.py --exec vwap`).
- **Fails:** meaningful **intraday only** (on daily charts it's a rolling approximation); barely moves late in the day.

### Confluence example: ICICI Bank, 26 Nov 2026
| Question | Tool | Reading |
|---|---|---|
| Trend? | Price vs SMA 50/200 | Up (13% above SMA50) |
| Momentum? | RSI, MACD histogram | Strong but cooling (RSI 80 → 65, histogram shrinking) |
| Location? | S/R | Far above nearest support (~₹1,461); extended |
| Trigger? | Candle | Bearish engulfing, unconfirmed |
| Volume? | Volume ratio | 0.87×, weak |
| Risk? | ATR | ₹36/day → a 2.5× ATR stop is ~₹90 away |

**Conclusion:** uptrend intact but extended and losing momentum. Not a place to start a new buy; if holding, consider tightening the stop. A **context assessment, not a prediction**.

### 🏋️ Exercise 2.4
```bash
python chart.py SBIN.NS --period 1y -i sma50,sma200,bb,volume,rsi,macd,atr --scan
python backtest.py SBIN.NS -s rsi_reversion --trades
python backtest.py SBIN.NS -s bollinger_reversion --trades
python backtest.py SBIN.NS -s macd_trend
```
1. Fill in the confluence table for SBI today.
2. Find a time RSI said "overbought" but price kept rising. What did trend indicators say?
3. Which family (trend or mean reversion) suited SBI better, and why?
4. **Bonus (code):** add OBV (On-Balance Volume: +volume on up-closes, −volume on down-closes, running total) to `indicators.py` and `chart.py`.

---

## ✅ Check your understanding

1. A candle: open ₹500, high ₹502, low ₹480, close ₹501. Draw it. What is it, and what would you need before acting?
2. Why never place a stop using a Heikin-Ashi chart?
3. Nifty breaks above 25,000 on 0.7× average volume, then closes at 24,900 the next day. What happened, and what would a convincing breakout have looked like?
4. RSI above 70 for three weeks and the stock keeps rising. Sell? Which indicator would you check alongside it?
5. ATR is ₹40. You want to risk ₹2,000 with a 2 × ATR stop. How many shares?
6. Why is RSI + Stochastic less useful than RSI + 200-day SMA?
7. H&S top: head ₹1,200, neckline ₹1,100, close at ₹1,095 on high volume. Measured target? What would invalidate it?
