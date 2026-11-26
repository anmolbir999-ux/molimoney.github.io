# Part 3: How Professional Firms Build Algorithms

> Professionals with PhDs, huge data and microsecond execution still have losing years, and many
> quant funds close. SEBI found **87.7% of individual F&O traders lost money in FY26**. This part
> is for understanding the game, not a promise you can win it.

---

## 3.0 The core idea: an "edge"

Every strategy bets that some **repeatable pattern exists, survives costs, and isn't fully exploited**. Professionals ask:

1. **Why should this make money?** Who is on the other side, and why are they willing to lose?
   - **Risk premium:** paid for bearing a risk others avoid.
   - **Behavioural bias:** people overreact or underreact.
   - **Structural constraint:** someone is *forced* to trade (e.g. index funds at rebalancing).
   - **Service:** paid for providing liquidity.
2. **Is it statistically real**, or luck/overfitting?
3. **Does it survive costs and capacity** (STT, slippage, impact, at your size)?

If you can't answer question 1, a good backtest is usually luck.

---

## 3.1 Trend following / momentum

**Idea:** rising prices tend to keep rising for a while; falling ones keep falling.

- **Why:** investors **underreact** to news at first; then **herding/FOMO** extends moves; institutions build positions over weeks.
- **Two flavours:**
  - **Time-series momentum (trend following):** is *this* asset above its own past? (SMA crossover, Donchian breakout; CTA/managed-futures funds across 50–100 markets.)
  - **Cross-sectional momentum:** buy the strongest *relative* performers (`factor_portfolio.py --factor momentum`).
- **Return profile:** **many small losses, a few huge wins**, win rate 30–45%. Best in long crises (2008, 2022 bonds); suffers in choppy markets. **Momentum crashes** in sharp reversals (e.g. after March 2020).
- **Why pros diversify it:** one stock's trend signal is mostly noise; a portfolio of 50+ uncorrelated markets smooths it.

## 3.2 Mean reversion

**Idea:** prices that move too far, too fast tend to snap back.

- **Why:** short-term **overreaction**; **liquidity provision** (buying from a forced seller gets you paid).
- **Examples:** RSI(2) dip-buying, Bollinger reversion, buying the biggest one-week losers in the Nifty 100.
- **Return profile:** **high win rate (60–75%), small wins, occasional large losses** ("picking up coins in front of a steamroller": Yes Bank 2019–20, Adani stocks Jan 2023).
- **Horizon matters:** days → mean reversion; 3–12 months → momentum; 3–5 years → mean reversion again.
- **Risk control:** trend filter (only buy dips above the 200-day, as `rsi_reversion` does) plus a hard or time stop.

## 3.3 Statistical arbitrage and pairs trading

**Idea:** find **economically linked** assets and bet that temporary gaps close.

- **Classic pair:** HDFC Bank vs ICICI Bank, TCS vs Infosys. At spread z-score ±2, buy the cheap one, short the expensive one. **Market-neutral**: you only care whether the gap closes.
- **Professional stat-arb:** hundreds of stocks; model returns with factors (market, sector, size, momentum); trade stretched **residuals**; thousands of small, short-lived positions.
- **Key concepts:**
  - **Correlation ≠ cointegration.** Correlated returns can drift apart forever; cointegrated prices have a spread pulled back to a mean (HDFC–ICICI test p = 0.047, borderline).
  - **Regime breaks:** the HDFC–HDFC Bank merger (July 2023) broke old pair models.
- **Indian retail problem:** no overnight shorts in the cash market → you need **stock futures** (big lots, margin, rollover, F&O risk). `pairs.py` returned ~0% over 10 years after costs.

## 3.4 Market making and HFT

**Idea:** continuously quote both sides (bid ₹1,610.00 / ask ₹1,610.10) and **earn the spread** millions of times, keeping inventory near zero.

- **Money from:** bid-ask spread, exchange rebates (some markets), short-term order-book prediction.
- **Main risk: adverse selection** (getting filled by someone who knows more).
- **Requires:** **co-location** in the NSE data centre, microsecond latency, FPGA hardware, direct feeds, huge message rates, exchange membership, crores a year in infrastructure.
- **Why retail can't compete:**
  - Home → broker → exchange takes **milliseconds to hundreds of ms**; HFTs react in **microseconds** (1,000× faster).
  - SEBI caps unregistered retail algos at **10 orders/second**; HFTs send thousands.
  - In a speed race, retail is always the slowest, the one that gets "picked off."
- **India:** prop/HFT firms are a large share of equity-derivatives volume. The Jane Street case (SEBI interim order, July 2025) shows regulators watch index-options behaviour closely (see Part 3B).

## 3.5 Factor investing

**Idea:** stocks with certain **characteristics** have historically earned extra returns. Hold **diversified baskets**.

| Factor | Definition | Why it might earn a premium |
|---|---|---|
| **Value** | Cheap on P/E, P/B, EV/EBITDA | Risk compensation + over-extrapolating bad news |
| **Quality** | High ROE, low debt, stable earnings | Investors underpay for "boring" reliability |
| **Momentum** | Strong 12-month return, skipping the last month | Underreaction and herding |
| **Low volatility** | Least volatile stocks | Leverage-constrained investors chase "lottery" stocks |
| **Size** | Small caps | Illiquidity/risk premium (weak recently) |

- **India:** NSE has Nifty200 Momentum 30, Nifty Alpha Low-Volatility 30, Nifty200 Quality 30, Nifty200 Value 30, etc., with ETFs/index funds.
- **Reality:** **long droughts** (value lagged globally ~2010–2020; momentum crashes). You must hold through 3–5 bad years.
- **The most realistic "quant" idea for a small investor:** low turnover, low cost, diversified, available as an ETF.

## 3.6 Event-driven strategies

**Idea:** trade predictable effects around **known events**.

- **Earnings:** **post-earnings announcement drift (PEAD)**: big positive surprises tend to keep drifting up for weeks. (Options traders also trade the IV crush after results: F&O, risky.)
- **Index rebalancing:** Nifty 50 changes are announced weeks ahead (March/September reviews). Index funds **must** buy additions and sell deletions on the effective date. **The edge has shrunk**: everyone knows, and moves often happen before the announcement.
- **Others:** buybacks, demergers (e.g. Tata Motors 2025), block deals, merger arbitrage, MSCI/FTSE inclusions (big FII flows).
- **Retail angle:** relatively feasible (research and calendars, not speed), but edges are small and crowd quickly.

## 3.7 Machine learning and its pitfalls

**What firms do:** gradient boosting, neural nets, NLP on news/earnings calls, transformers on order books, combining **hundreds of weak signals**.

| Problem | What it means |
|---|---|
| **Low signal-to-noise** | Daily returns are ~99% noise. 52% accuracy can be excellent; 70% is almost certainly broken. |
| **Overfitting** | Even with 2 parameters: in-sample Sharpe 0.57 → out-of-sample −0.16 (Reliance SMA optimisation). |
| **Non-stationarity** | Markets change (regulation, participants, rates, COVID). |
| **Look-ahead bias** | Using data not available at the time (revised GDP, results dated by period-end). |
| **Data snooping** | Test 1,000 random strategies → ~50 look "significant" at 5% by chance. |
| **Survivorship bias** | Testing today's stocks ignores the dead ones (equal-weight of today's 40 large caps: 20% a year). |

**Defences:** strict out-of-sample and **walk-forward** testing; purged cross-validation; adjusting for the number of trials (deflated Sharpe); simple models with an economic rationale; ensembles of individually sensible signals.

**For you:** if a simple idea doesn't work, a neural network on the same data almost certainly won't either; it will just overfit more convincingly.

---

## 3.8 The research process

```
 1. HYPOTHESIS ─► 2. DATA ─► 3. BACKTEST ─► 4. OUT-OF-SAMPLE ─► 5. RISK MGMT ─► 6. PAPER ─► 7. LIVE (small)
      │                                          │                                    │            │
      └──────────── most ideas die here ◄────────┴──── and here ◄─────────────────────┴── and here ┘
```

| Step | Professionals | Your toolkit |
|---|---|---|
| **1. Hypothesis** | Write *why* it works and who loses, **before** looking at results | A notebook |
| **2. Data** | Clean, point-in-time data; corporate actions; delisted stocks | `data.py` (yfinance; survivorship caveat) |
| **3. Backtest** | No look-ahead, realistic costs, slippage, capacity | `backtest.py` |
| **4. Out-of-sample** | Hold back data you **never** touch; walk-forward; many markets | `--oos-split`, `--optimize`, multi-ticker |
| **5. Risk management** | Sizing, stops, diversification, drawdown limits | `--stop-atr`, `--risk-pct`, `--market-filter`, VaR |
| **6. Paper trading** | Months live without money; compare with backtest | `paper_trade.py` |
| **7. Live, small** | 5–10% of intended size; scale only if live matches; **kill rule** set in advance | `live_kite.py`, `--max-order-value`, `KILL_SWITCH` |

**Mindset:**
- Most ideas die at steps 3–4. **Killing bad ideas fast is a skill.**
- **Be suspicious of great results.** Sharpe > 2 on daily data from a simple strategy almost always means a bug, look-ahead or overfitting.
- **Live is usually worse than the backtest** (alpha decay + implementation shortfall). Plan for it.

### 🏋️ Exercises
1. Overfitting:
   ```bash
   python backtest.py TCS.NS --oos-split 2021-01-01 --optimize "fast=10,20,30,50,75,100;slow=100,150,200,250,300" --no-plot
   ```
   Does the in-sample winner stay near the top out-of-sample? Is there a robust *region*?
2. Robustness: run your best SMA settings across 10 Nifty stocks in one command.
3. Factors: `python factor_portfolio.py --factor momentum --years 10` vs `--factor lowvol`. Compare drawdown and Sharpe; explain each with the "why" column.
4. Write a hypothesis (no code) for Nifty 50 index additions: why prices move, who loses, data needed, how to avoid look-ahead.

## ✅ Check your understanding

1. Trend following wins ~40% of trades. How can it still be profitable?
2. Why does mean reversion work over days but momentum over months? Give a behavioural reason for each.
3. HDFC Bank and ICICI Bank have a return correlation of 0.51. Why isn't that enough for a pairs trade?
4. Two specific reasons a Kite Connect retail trader can't compete in market making.
5. Value underperformed for ~a decade. Does that prove it's dead? What would you need to see?
6. A friend's ML model is 75% accurate on Nifty's daily direction. Three questions you'd ask.
7. Why is paper trading still needed if the backtest already used out-of-sample data?
