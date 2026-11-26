# Part 3B: How the Giant Firms Use Their Strategies

> Figures are approximate and change every quarter. Check each firm's latest reports.
> Not investment advice. SEBI: **87.7% of individual F&O traders lost money in FY26.**

---

## 1. Active vs passive: the foundation

| | Passive | Active |
|---|---|---|
| Goal | **Match** an index | **Beat** an index |
| How | Hold every stock in index weight | Pick stocks / time the market |
| Cost (India) | Index fund/ETF: ~0.05–0.3% a year | Active fund: ~0.5–1% (direct) to ~1.5–2% (regular) |
| Turnover | Very low | Higher (more costs, more tax) |

**Why most active funds fail to beat the index:**
1. **Arithmetic (William Sharpe):** before costs, all investors together *are* the market. So the average active rupee earns the market return. **After costs, the average active rupee must lose to passive.**
2. **Costs compound:** 1.5% a year over 20 years eats about 25% of your final wealth.
3. **Competition:** in large caps you are trading against FIIs, quant funds and analysts who all see the same information.
4. **Persistence is weak:** last 5 years' top funds are rarely next 5 years' top funds.
5. **Closet indexing:** many "active" large-cap funds hug the index but charge active fees.

**Evidence:** S&P's SPIVA India scorecards repeatedly show **most Indian large-cap active funds
underperform their benchmark over 5–10 years** (often 70–90%, varying by year). Mid/small-cap
funds have done better at times: less efficient markets leave more room for skill.

**Takeaway:** for core long-term money, a low-cost Nifty 50 / Nifty 500 index fund is very hard to beat.

---

## 2. The firms

### BlackRock: the world's largest asset manager (~$13+ trillion)
- **Core business:** **iShares ETFs** (passive index tracking), index mutual funds, active funds, plus **factor ETFs** (momentum, quality, value, min-volatility).
- **How it makes money:** **fees on assets** (basis points × trillions) + **Aladdin** technology licensing. It doesn't need to beat the market. It needs assets to grow.
- **Aladdin:** a risk & portfolio platform used by BlackRock and many other institutions (by many estimates, tens of trillions of dollars run through it). It models how portfolios react to rates, oil, currencies and crises: *stress tests*, *factor exposures*, *VaR*, trade processing.
- **Data/tech:** index data, risk models, massive operations scale.
- **Retail lesson:** ✅ cheap diversified index investing; ✅ think in **risk exposures**, not just stocks (`portfolio_risk.py` does a mini version: risk contributions, VaR). ❌ You can't get its fee economics or scale.

### Vanguard: low-cost index funds (~$10+ trillion)
- **Core strategy:** passive index funds, pioneered by John Bogle (first retail index fund, 1976).
- **How it makes money:** it is **owned by its own funds** (and so by its investors), so profits go back as **lower fees**. That's why its fees are among the lowest.
- **The case for passive (Bogle):** costs matter most, the average active manager can't win after costs, so own the whole market cheaply and hold forever.
- **Retail lesson:** ✅ fully copyable. In India: Nifty 50/Nifty Next 50/Nifty 500 index funds, monthly SIP, rebalance yearly. The hard part is **behaviour** (not selling in crashes), not access.

### Renaissance Technologies: Medallion Fund
- **Core strategy:** purely quantitative. Thousands of small, **short-term statistical patterns** across futures, currencies and stocks, mostly held for hours to days. Founded by mathematician Jim Simons; staff are mathematicians, physicists and computer scientists, not finance MBAs.
- **Record:** reportedly about **66% a year gross / ~39% net** of its very high fees, 1988–2018 (Zuckerman, *The Man Who Solved the Market*). Closed to outsiders: only employees invest.
- **How:** huge, cleaned historical datasets; a single unified model; **win only ~50.75% of trades**, but across millions of trades, with leverage and tight cost control.
- **Key insight:** **capacity**. Medallion is kept small (~$10bn) because its edge disappears if it gets too big. Its public funds (RIEF etc.) performed far more ordinarily.
- **Retail lesson:** ✅ small edges × many trades × strict risk control; ✅ data cleaning matters (you just saw yfinance glitches). ❌ Can't copy: decades of proprietary data, hundreds of PhDs, execution infrastructure, financing.

### Citadel (hedge fund) and Citadel Securities (market maker)
- **Two separate firms:**
  - **Citadel LLC:** **multi-strategy** hedge fund. Many independent "pods" (equities long/short, fixed income, commodities, credit, quant). Each pod has **strict drawdown limits**; break them and you're cut.
  - **Citadel Securities:** one of the world's largest **market makers**. It handles a large share of US retail stock orders (via payment for order flow) and quotes ETFs, options and treasuries.
- **How they make money:** the fund makes **diversified, uncorrelated returns** from many strategies. The market maker earns **bid-ask spreads on enormous volume** while managing inventory risk.
- **Data/tech:** real-time risk across all pods, low-latency infrastructure, huge order-flow data.
- **Retail lesson:** ✅ **pod discipline**: set a max drawdown per strategy and *actually stop* (your `KILL_SWITCH`). ✅ Diversify across uncorrelated strategies. ❌ Can't compete in market making (Part 3.4).

### Two Sigma and D. E. Shaw: data science & ML-driven
- **Two Sigma:** treats investing as a **data science problem**: ML on vast structured & alternative data, large-scale computing, scientific research culture.
- **D. E. Shaw:** one of the earliest computational quant firms (1988). Mixes quant strategies with discretionary/fundamental ones. Historically strong in stat-arb.
- **How they make money:** combining many weak predictive signals into diversified, often market-neutral portfolios; strict research process (Part 3.8).
- **Retail lesson:** ✅ the **research discipline**: hypothesis first, out-of-sample testing, kill bad ideas. ✅ Python/pandas/ML skills (you're building them). ❌ Their data budgets and compute.

### Bridgewater Associates: global macro & risk parity
- **Core strategies:**
  - **Pure Alpha:** discretionary/systematic **global macro**. Bets on rates, currencies, commodities, equities based on economic "machine" models (growth, inflation, debt cycles).
  - **All Weather** (1996): **risk parity**. The economy has four "seasons" (growth ↑/↓, inflation ↑/↓). Hold assets that do well in each, sized so that **each contributes equal risk**. Bonds are less volatile, so they get more capital (and in Bridgewater's version, leverage).
- **Retail lesson:** ✅ **diversify by risk, not by rupees.** Run `python portfolio_risk.py`: an equal-rupee portfolio of Nifty, Nifty Next 50, Nasdaq 100, gold and gilts gets ~75% of its risk from equity-like assets, while risk parity spreads it evenly. In the 2019–2026 test, risk parity had the **lowest drawdown (−7% vs −17% for the Nifty)** but a lower return (13% vs 17%), because it is unlevered. ❌ Leveraging bonds like Bridgewater needs institutional financing. ⚠️ Risk parity suffered in 2022 when **stocks and bonds fell together**: correlations aren't constant.

### Jane Street: ETF & options market making, arbitrage
- **Core strategy:** quantitative **liquidity provision & arbitrage**: quoting ETFs (keeping ETF price ≈ its holdings' value), options, bonds. Famous for OCaml-based tech and probabilistic-thinking culture.
- **How:** tiny spreads on huge volume + **ETF creation/redemption arbitrage** + options pricing/hedging.
- **India:** a very large player in **index options**. In **July 2025 SEBI issued an interim order** alleging Jane Street manipulated Bank Nifty/Nifty around expiry days (buying index stocks/futures in the morning while holding much bigger options positions that benefited, then reversing). SEBI impounded about ₹4,844 crore. Jane Street disputed the allegations. Check the case's current status.
- **Retail lesson:** ✅ understand **who is on the other side** of your options trade: often a firm like this with better models, speed and capital. ✅ This is a big part of *why* ~9 in 10 retail F&O traders lose. ❌ Can't copy.

### Indian context: who actually moves the Nifty

| Player | How they trade | Influence |
|---|---|---|
| **FIIs/FPIs** (global funds, sovereign funds, hedge funds) | Large-cap, liquid stocks; flows driven by **USD/INR, US rates, EM allocation, MSCI weights**; also big in index futures | Short/medium-term swing factor. Heavy FII selling (e.g. Oct 2024–early 2025) drags the Nifty for months |
| **Domestic mutual funds** (SBI MF, HDFC MF, ICICI Pru, etc.) | Deploy **SIP inflows** steadily; active stock-picking + growing passive/ETF assets (SBI MF manages very large Nifty ETFs, incl. EPFO money) | A structural "floor": DIIs repeatedly absorbed FII selling. DII ownership of NSE-listed companies overtook FII ownership in 2025 |
| **Insurers, LIC, EPFO** | Long-term; LIC is a large contrarian buyer in falls; EPFO invests via ETFs | Stabilising |
| **Prop desks / HFTs** (domestic & foreign) | Market making, arbitrage (cash-futures, ETF), index options, algo strategies | Dominate **derivatives volume**; drive intraday and expiry-day moves |
| **Index funds/ETFs** | Mechanical buying/selling at **index rebalancing** | Big one-day flows into additions/deletions |

**How they influence the Nifty:** concentrated **flows into heavyweights** (HDFC Bank, ICICI, Reliance = ~30% of the index), **derivatives positioning** (option writers defend round-number strikes near expiry), and **execution algorithms** spreading big orders over the day.

---

## 3. Alternative data

Data that isn't price, volume or financial statements:

| Type | Example | What it predicts |
|---|---|---|
| **Satellite images** | Cars in mall parking lots, oil tank shadows, crop health, factory activity | Retail sales, oil inventories, harvests, before official data |
| **Card/transaction data** | Anonymised credit/UPI spending panels | Company revenue before results |
| **Web traffic & app downloads** | Visits to Zomato/Nykaa, app rankings | User growth |
| **Sentiment / NLP** | News, earnings-call transcripts, social media tone | Short-term moves, surprises |
| **Shipping & supply chain** | Vessel tracking (AIS), port data, e-way bills | Trade, commodities |
| **Job postings** | Hiring trends | Growth plans, distress |

**Reality:** expensive (lakhs to crores per dataset), messy, legally sensitive (privacy, insider-information rules), and edges **decay quickly** once many funds buy the same data.
**Free retail versions:** Google Trends, monthly auto sales, GST collections, NSE delivery %, FII/DII data (your `checklist.py`), company websites, earnings-call transcripts.

---

## 4. Portfolio construction & risk management

| Tool | What institutions do | Retail version (your toolkit) |
|---|---|---|
| **Diversification** | Across assets, regions, strategies, factors; by **risk** not rupees | `portfolio_risk.py`: correlations, risk contributions, risk parity |
| **Position sizing** | Volatility targeting; risk budget per position/pod | `backtest.py --stop-atr 3 --risk-pct 1` (risk 1% of capital per trade) |
| **Stop/drawdown limits** | Pod drawdown limits (e.g. −5% → cut size, −10% → shut down) | ATR stops, `KILL_SWITCH`, written rules before going live |
| **Hedging** | Index futures/options to remove market beta; currency hedges | `portfolio_risk.py` shows beta and the futures hedge, and why small accounts can't hedge precisely (one Nifty lot ≈ ₹15+ lakh) |
| **Value-at-Risk** | Daily VaR/CVaR + **stress tests** (2008, 2020, rate shocks) | VaR/CVaR in ₹ in `metrics.py` & `portfolio_risk.py` |

**VaR's weakness:** it says "95% of days you lose less than X," but says **nothing about how bad the other 5% are**. It assumes the past represents the future. In March 2020 the Nifty fell 13% in one day, far beyond normal VaR. Always look at **CVaR** and **stress scenarios** too.

---

## 5. Execution algorithms

When a fund must buy ₹500 crore of HDFC Bank, placing one order would push the price up (**market impact**) and alert everyone. So it slices the order:

| Algo | How | Used when | In your code |
|---|---|---|---|
| **TWAP** | Equal slices at equal time intervals | Steady, simple execution | `live_kite.py --exec twap --slices 5 --minutes 20` |
| **VWAP** | Slices sized by the stock's typical **intraday volume curve** (heavier at open & close) to match the day's VWAP | Benchmark-driven funds | `--exec vwap` (U-shaped NSE profile: ~32% / 21% / 18% / 29%) |
| **Iceberg** | Show only a small "tip" in the order book; refill as it fills | Hide size from other traders | `--exec iceberg` (Kite's ICEBERG variety) |
| **POV** (% of volume) | Trade e.g. 10% of market volume as it happens | Adaptive | (not implemented) |
| **Implementation shortfall** | Balance impact cost vs risk of price drifting away | Urgent orders | (not implemented) |

**Retail reality:** your orders are too small to move the market, so a simple limit order is usually fine. These algos matter once a single order is a meaningful fraction of a stock's volume.

---

## 6. Why their edge is hard to copy, and what still works

| Their edge | Can you copy it? |
|---|---|
| **Speed** (co-location, microseconds) | ❌ Never. Avoid strategies where speed matters (scalping, HFT, expiry-day options) |
| **Data** (alt data, decades of tick data) | ❌ Mostly no. Free data is noisier (you saw yfinance glitches) |
| **Capital & leverage** (cheap financing, risk parity leverage) | ❌ No |
| **Cheap execution** (near-zero fees, rebates) | ⚠️ Partly: free delivery brokerage, but STT/stamp/slippage still hurt high-turnover strategies |
| **Talent & research infrastructure** | ⚠️ Partly: you can learn the methods |

**Your advantages as a small investor:**
1. **Patience / long horizon:** no quarterly reports, no client redemptions. You can hold through 3-year droughts funds can't survive.
2. **Small size:** you can buy small/mid caps that big funds can't (capacity).
3. **No benchmark pressure:** you don't have to own HDFC Bank just because it's 12% of the index.
4. **Low cost:** index funds + delivery trades with no fund fees.

**Ideas that still work for a small investor:**
- ✅ **Low-cost index investing** (Vanguard/BlackRock iShares idea): SIP into Nifty 50/500 index funds.
- ✅ **Factor ETFs** (momentum, quality, low-vol, value) as a satellite to the core index holding.
- ✅ **Diversify by risk** (Bridgewater idea): equity + gold + debt; rebalance yearly.
- ✅ **Simple, slow, rules-based strategies** with low turnover, tested properly (Parts 3.8 & 4).
- ✅ **Risk discipline** (Citadel pod idea): position sizing, max drawdown rules, a kill switch.
- ❌ Avoid competing on speed, F&O expiry games, or anything where the other side is Jane Street.

---

## 🏋️ Exercises

```bash
python portfolio_risk.py
python portfolio_risk.py --assets NIFTYBEES.NS GOLDBEES.NS LTGILTBEES.NS
python factor_portfolio.py --factor lowvol --years 10
```
1. In `portfolio_risk.py`, which asset dominates the risk of the equal-rupee portfolio? Why?
2. Why did `min_var` put 100% in bonds, and why did it then do badly? (Hint: low volatility ≠ good return.)
3. Pick one Indian large-cap active fund. Compare its 5- and 10-year returns (direct plan) with a Nifty 50 index fund. Did it beat the index after fees?
4. Find NSE's FII/DII data for the last month. On days FIIs sold more than ₹3,000 crore, did DIIs buy? What happened to the Nifty?

## ✅ Check your understanding

1. Explain in two sentences why the average active fund *must* underperform the average passive fund after costs.
2. BlackRock and Renaissance are both "quant" in some sense. How do they make money differently?
3. Why does Medallion stay small? What does that tell you about any strategy that "works"?
4. A ₹1 lakh portfolio is 50% Nifty ETF, 50% gilt ETF. Is it 50/50 in risk? Explain.
5. Your VaR95 is ₹1,400 on ₹1 lakh. What does that mean, and what does it NOT tell you?
6. Why would a fund buying ₹500 crore of a stock use VWAP instead of a single market order?
7. List two edges you cannot copy and two advantages you have that big funds don't.
