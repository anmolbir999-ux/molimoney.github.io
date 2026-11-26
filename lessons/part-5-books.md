# Part 5: Books to Read Alongside

Read in this order. Each summary gives the key lessons, how it connects to this course
and your code, and one thing to *do* after reading it.

> Not investment advice. Reading makes you informed, not profitable. SEBI found **87.7% of
> individual F&O traders lost money in FY26**; most of them had read some of these books too.

---

## 1. *Technical Analysis of the Financial Markets*: John J. Murphy
**The textbook of technical analysis. Start here.**

Key lessons:
1. **Three premises:** price discounts everything, prices move in trends, history tends to repeat (because human behaviour does).
2. **Dow Theory:** primary, secondary and minor trends; trends need **confirmation** (by volume and related indices); a trend is in force until clearly reversed.
3. **Trend basics:** higher highs/higher lows; support and resistance, and their **role reversal**; trendlines and channels; the importance of round numbers.
4. **Volume (and open interest)** confirm price: rising price on rising volume is healthy.
5. **Patterns:** reversal (head & shoulders, double tops/bottoms) vs continuation (triangles, flags), with **measured targets**.
6. **Moving averages and oscillators:** MAs for trending markets, oscillators (RSI, stochastics, MACD) for ranges; **divergences** as warnings.
7. **Use multiple timeframes:** weekly/monthly charts for direction, daily for timing.
8. **Intermarket analysis:** bonds, commodities, currencies and stocks influence each other (Part 1's crude/USD-INR/Fed links).
9. **His "ten laws":** map the trend, trade with it, find support/resistance, know how far to expect a pullback, draw trendlines, follow MAs, learn the turns, know the warning signs, trend is confirmed by volume.

**Connects to:** Part 2 entirely. `chart.py`, `indicators.py`, `patterns.py`.
**Do after:** pick 5 Nifty stocks and label trend, S/R and one pattern on weekly *and* daily charts.

---

## 2. *Technical Analysis Explained*: Martin J. Pring
**Deeper on trends, cycles and momentum.**

Key lessons:
1. **Weight of the evidence:** never act on one indicator; look for several independent signals agreeing.
2. **The market cycle model:** markets move through primary trends tied to the **business cycle**. Pring's six "stages" describe how **bonds turn first, then stocks, then commodities**, as the economy moves from recession to recovery to overheating.
3. **Momentum principles:** momentum usually **peaks before price**. Divergences, overbought/oversold readings and momentum trendline breaks give early warnings.
4. **Relative strength** (stock vs index, sector vs market) to find leaders: the basis of momentum investing.
5. **Pring's KST ("Know Sure Thing")**: a smoothed, multi-timeframe momentum indicator combining several rates of change.
6. **Sentiment and breadth:** advance/decline lines, new highs/lows, and how crowds behave at extremes.
7. **Long-term perspective:** understanding where you are in the bigger cycle beats short-term signal hunting.

**Connects to:** Part 1 (macro → markets), Part 2 (momentum indicators), Part 3 (momentum factor).
**Do after:** add a relative-strength line (stock ÷ Nifty) to `chart.py`. Which Nifty sectors are leading right now?

---

## 3. *Technical Analysis of the Indian Stock Markets*: Shriram Nerlekar
**Applying the same tools to Indian stocks.**

> ⚠️ I'm less certain of this book's exact contents than of the others. These are the lessons
> it's generally used for. Check them against the copy you read.

Key lessons:
1. The standard toolkit (trends, patterns, indicators) **illustrated on Indian stocks and indices** (Sensex/Nifty), so you see the methods on charts you recognise.
2. **Indian market specifics** that affect charts: trading sessions, circuit limits, corporate actions (bonus/split adjustments), liquidity differences between large and small caps.
3. **Practical discipline:** combine indicators, use stop-losses, avoid illiquid stocks where patterns are unreliable.

**Connects to:** Part 2 applied to NSE stocks.
**Do after:** find two examples in the book, then pull the same stocks today with `chart.py` and see how those setups look now.

---

## 4. *How to Make Money Trading with Charts*: Ashwani Gujral
**A practical trading book by an Indian trader, focused on setups and risk.**

Key lessons:
1. **Keep it simple:** a few setups you know deeply beat dozens of indicators.
2. **Trade with the trend:** identify the trend first, then look for **pullback entries** (e.g. near a rising moving average or support) rather than chasing breakouts.
3. **Breakouts need confirmation:** volume and the broader market's direction.
4. **The stop-loss is decided before entry**, at a level that proves the trade wrong, and **position size comes from the stop** (exactly your `--risk-pct`).
5. **Risk-reward:** take trades only where the potential reward is a multiple of the risk.
6. **Psychology:** most losses come from breaking your own rules: averaging down, moving stops, overtrading after a loss.
7. **Indian market context:** applies all this to NSE stocks and index charts.

**Connects to:** Parts 2 & 4; `engine.py` stop/position sizing.
**Do after:** write your own one-page trading plan: setup, entry, stop, target, max risk per trade (≤1%), max trades per week.

---

## 5. *Options as a Strategic Investment*: Lawrence G. McMillan
**The options reference book. Read it to understand risk, not to start trading F&O.**

Key lessons:
1. **What options are:** the right (not obligation) to buy/sell; intrinsic vs time value; why **most options expire worthless** and time decay works against buyers.
2. **Pricing & the Greeks:** the Black-Scholes model; delta, gamma, theta, vega; **implied volatility (IV)** is the key variable. Buying options when IV is high is expensive.
3. **Strategies by objective:** covered calls, protective puts, spreads (bull/bear, calendar), straddles/strangles, ratio spreads. Each has a defined **payoff diagram** and risk profile.
4. **Selling options** earns small, frequent profits but carries **large tail risk** (selling naked options can lose many times the premium in one move).
5. **Volatility trading:** strategies that bet on volatility rather than direction.
6. **Follow-up action:** plan in advance what you'll do if the stock moves against you.
7. **Options as hedges:** protective puts are insurance for a portfolio.

**India-specific warning:** most retail F&O activity is buying cheap weekly index options near expiry, which fights theta, high IV and professional sellers (Part 3B: Jane Street). SEBI's studies show ~9 in 10 individual F&O traders lose money.
**Connects to:** Part 3B (who is on the other side); `SEBI_RULES.md`.
**Do after:** paper-trade only. Draw payoff diagrams for a covered call and a protective put on a Nifty stock. **No real F&O money** until you've studied this book fully and can explain each Greek.

---

## 6. *Quantitative Trading*: Ernest P. Chan
**How an individual can run a quant trading business. The book closest to your code.**

Key lessons:
1. **Retail can do quant**, if they pick strategies big funds ignore (small capacity, niche markets) and stay disciplined.
2. **Finding ideas:** academic papers, blogs, books. Then judge them **before** backtesting: does it make economic sense? Is the Sharpe realistic? Can it survive costs?
3. **Backtesting pitfalls:** look-ahead bias, **survivorship bias**, data-snooping / overfitting, ignoring transaction costs, using bad data. (You met all of these in Parts 3–4.)
4. **Sharpe ratio thinking:** aim for strategies with a consistently positive, realistic Sharpe, and be suspicious of very high ones.
5. **Mean reversion and pairs trading**, with cointegration tests (your `pairs.py`).
6. **Position sizing with the Kelly criterion:** optimal leverage ≈ mean excess return ÷ variance. In practice use **half-Kelly or less**, because estimates are noisy.
7. **Regime change:** strategies stop working. Monitor live performance and have rules for turning a strategy off.
8. **Execution systems:** automate carefully, paper trade first, reconcile live results with the backtest.

**Connects to:** Parts 3 & 4; `backtest.py`, `pairs.py`, `paper_trade.py`, `live_kite.py`.
**Do after:** add a Kelly-fraction calculator to `metrics.py` (mean daily excess return ÷ variance) and compare it with the position sizes you've been using.

---

## 7. *The Psychology of Money*: Morgan Housel
**Why behaviour matters more than intelligence. The most important book on this list.**

Key lessons:
1. **No one's crazy:** people's money decisions come from their own experiences (someone who lived through 2008 or COVID invests differently).
2. **Luck and risk** are siblings. Don't copy outcomes; judge decisions.
3. **"Enough":** the hardest skill is stopping the goalposts from moving. Never risk what you have and need for what you don't have and don't need.
4. **Compounding:** most of Warren Buffett's wealth came after age 65. **Time in the market** is the superpower. At 19, you have it.
5. **Getting wealthy vs staying wealthy:** staying wealthy requires survival: frugality, paranoia, avoiding ruin.
6. **Tails drive everything:** a few big winners produce most of the returns (in stocks, companies and careers).
7. **Freedom:** the highest dividend money pays is control over your time.
8. **Wealth is what you don't see:** it's money not spent.
9. **Save**, even without a specific goal: savings create room for error.
10. **Reasonable > rational:** a strategy you'll actually stick with beats a "perfect" one you'll abandon.
11. **Volatility is the fee, not a fine:** the price you pay for equity returns.
12. **You're playing your own game:** don't take cues from people with different time horizons (day traders vs long-term investors).
13. **Leave room for error** and expect surprises.

**Connects to:** everything. The checklist, the kill switch, "most F&O traders lose".
**Do after:** write down your personal "enough" and your rules for what money you will **never** trade with.

---

## 8. *One Up on Wall Street*: Peter Lynch
**Fundamental stock picking by one of the most successful fund managers ever (Fidelity Magellan, 1977–1990).**

Key lessons:
1. **Invest in what you know:** everyday observations (products you use, shops that are always busy) can lead to ideas before Wall Street notices. That's **only a starting point; then do the research.**
2. **Six stock categories**, each with different expectations:
   - **Slow growers** (mature, dividends)
   - **Stalwarts** (large, steady ~10–12% growth, e.g. HUL, ITC types)
   - **Fast growers** (small, aggressive, where tenbaggers come from)
   - **Cyclicals** (autos, metals: timing matters; low P/E can mean a peak)
   - **Turnarounds** (recovering from trouble)
   - **Asset plays** (hidden value in land, cash or subsidiaries)
3. **The two-minute drill:** be able to explain why you own a stock, and what must happen for it to succeed, in two minutes.
4. **Key numbers:** earnings growth, **P/E vs growth (PEG)**, debt, cash, inventories, dividends, insider buying, buybacks.
5. **Perfect-stock traits:** boring name or business, out of favour, spinoffs, niche, low institutional ownership, people need to keep buying it.
6. **Avoid:** the hottest stock in the hottest industry, "the next X", diversification into unrelated businesses ("diworsification"), and stocks driven only by whispers.
7. **Don't try to time the market or predict the economy.** Focus on companies; stay invested; expect declines.
8. **Tenbaggers** (10× stocks) need time and patience. Most of the gain comes from holding winners.

**Connects to:** Part 1 (corporate earnings), Part 3 (value/quality factors), the "small investor advantages" in Part 3B.
**Do after:** pick one company you use daily (e.g. a listed retailer, bank or consumer brand). Classify it into one of the six categories and do the two-minute drill using its latest annual report.

---

## Free companion: Zerodha Varsity
**varsity.zerodha.com** (also an app). Free, India-specific, beginner-friendly modules with quizzes.
Module names may change; map them roughly like this:

| Varsity module | Pair with |
|---|---|
| Introduction to Stock Markets | Part 1 |
| Technical Analysis | Murphy, Pring, Nerlekar, Gujral (Part 2) |
| Fundamental Analysis | Lynch |
| Futures Trading, Options Theory, Option Strategies | McMillan (understand before risking money) |
| Markets and Taxation | `SEBI_RULES.md` tax section |
| Risk Management & Trading Psychology | Gujral, Housel |
| Trading Systems | Chan, your `algo/` toolkit (Parts 3–4) |
| Personal Finance | Housel |

---

## Suggested reading plan (alongside college)

| Months | Read | Practise with |
|---|---|---|
| 1–2 | Murphy + Varsity Technical Analysis | `chart.py` exercises (Part 2) |
| 3 | Pring | Relative-strength line, sector leaders |
| 4 | Nerlekar + Gujral | Write your trading plan; `paper_trade.py` |
| 5–6 | Housel (start anytime) + Lynch + Varsity Fundamental Analysis | Two-minute drill on 5 companies |
| 7–8 | Chan + Varsity Trading Systems | `backtest.py`, out-of-sample tests, Kelly calculator |
| 9–10 | McMillan + Varsity Options | Payoff diagrams, **paper only** |

## ✅ Check your understanding
1. What do Murphy's Dow Theory and Pring's "weight of the evidence" have in common?
2. In Pring's cycle model, which usually turns first: bonds, stocks or commodities? Why?
3. Using Gujral's rules: entry ₹500, stop ₹480, capital ₹2 lakh, risk 1%. How many shares?
4. McMillan: why do most bought options expire worthless? Why is selling options not "free money"?
5. Chan: name three backtesting biases and which file in your toolkit guards against each.
6. Housel: what does "volatility is the fee, not a fine" mean for a SIP investor in a crash?
7. Lynch: classify Reliance, TCS, Tata Steel and a loss-making startup into his six categories.
