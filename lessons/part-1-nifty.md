# Part 1: How the Nifty 50 Moves

> Not investment advice. SEBI found **87.7% of individual F&O traders lost money in FY26**
> (about 9 in 10 in FY22–FY25 too). Learn first; risk money last.

---

## 1.1 What the Nifty 50 is

- An index of **50 large, liquid NSE companies** across ~13 sectors, run by NSE Indices Ltd.
- Base: 1995 = 1000. Reviewed **twice a year** (March and September), when stocks can be added or dropped.
- You can't buy "the Nifty" directly. You buy an **index fund/ETF** holding the same 50 stocks, or trade **Nifty futures/options** (F&O, high risk).

## 1.2 How the weightage works: free-float market cap

```
Free-float market cap = Share price × Total shares × Investable Weight Factor (IWF)
Weight of stock i      = FF mcap of i / Sum of FF mcap of all 50
```

- **IWF** = the share of a company's stock the public can actually trade. Promoter and government holdings are excluded.
  - Reliance: promoters own ~50%, so only ~50% of it counts.
  - LIC: the government owns ~96%, so it has a huge total market cap but a tiny free float, and isn't in the Nifty.
  - HDFC Bank: almost no promoter holding, so nearly 100% counts. That's a big reason it's the largest weight.

**Heavyweights** (approximate; check the current NSE factsheet, weights shift monthly):

| Stock | Approx. weight |
|---|---|
| HDFC Bank | ~12–13% |
| ICICI Bank | ~8–9% |
| Reliance | ~8–9% |
| Infosys, Bharti Airtel, L&T, ITC, TCS | ~3–6% each |

The top 10 ≈ 55–60% of the index; **financials ≈ one-third**.

**Quick maths:**
- HDFC Bank (13%) rises 2% → Nifty moves about 0.13 × 2% = **0.26%** → ≈ **+65 points** at Nifty 25,000.
- A 0.5%-weight stock rising 2% → about 0.01% → 2–3 points.

So "the market is up" often means "banks and Reliance are up." **Learning to read Bank Nifty is half of reading the Nifty.**

## 1.3 What drives it and how to track each driver

Think of it as **Price = Earnings × P/E multiple**:
- Earnings are driven by the economy and companies' results.
- The P/E multiple is driven by interest rates, money flows and sentiment.

### A. Macro (India)
| Factor | Mechanism | Where to track |
|---|---|---|
| **RBI repo rate** | Cuts → cheaper loans, higher valuations, good for banks/autos/real estate. Hikes → the opposite. The *surprise* matters more than the decision. | RBI MPC meetings, ~6 a year (rbi.org.in) |
| **CPI inflation** | High CPI → the RBI can't cut. Target 4% ±2%. | MoSPI, ~12th of each month |
| **GDP growth** | Drives long-run earnings, but is usually priced in early. | MoSPI quarterly |
| **Union Budget / fiscal deficit** | Capex helps L&T, cement, PSUs. Tax changes (STT, capital gains) hit sentiment directly. High deficit → more borrowing → higher bond yields → pressure on valuations. | Feb 1 budget, CGA monthly data, **10-yr G-Sec yield** |

### B. Global
| Factor | Mechanism | Where to track |
|---|---|---|
| **US Fed rates** | Higher US yields pull money out of emerging markets and weaken the rupee. | FOMC meetings, US 10-yr yield |
| **US markets** | The overnight S&P 500/Nasdaq move sets the opening mood. Nasdaq matters for Indian IT. | S&P futures, **GIFT Nifty** |
| **Crude oil** | India imports ~85% of its oil. Expensive crude hurts the current account, rupee, inflation, OMCs, paints, aviation. Helps ONGC. | Brent crude |
| **USD/INR** | A weak rupee hurts FII returns (they sell), helps IT/pharma exporters, hurts importers. | RBI reference rate |
| **Risk events** | Wars, bank failures, trade wars → risk-off selling. | News, US VIX, dollar index (DXY) |

### C. Money flows (very important for the Nifty)
- **FII/FPI** (foreign funds): often the short-term swing factor. Heavy selling can drag the market for months.
- **DII** (domestic MFs, LIC, insurers): in recent years they have often absorbed FII selling.
- **SIP inflows:** steady monthly mutual-fund money (recently well above ₹25,000 crore a month), a structural "floor" that didn't exist 10 years ago.
- **Track:** NSE provisional FII/DII cash data every evening; NSDL (FPI); AMFI (monthly SIP); NSE participant-wise open interest (FII positions in index futures).

### D. Corporate
- **Quarterly results** (Apr, Jul, Oct, Jan seasons). What matters is results **vs expectations**: a stock can fall on good results that were "less good than expected."
- **Guidance and management commentary** often move a stock more than the numbers.
- **Sector news:** RBI rules for banks, monthly auto sales, US tech spending for IT.

### E. Sentiment
- **India VIX** ("fear index", from Nifty option prices) = expected volatility over 30 days.
  - Roughly: 11–14 calm, 20+ fearful, 30+ panic (e.g. COVID 2020).
  - VIX ÷ √12 ≈ expected 1-month move. VIX 16 → about ±4.6% in a month (1 standard deviation).
  - VIX ÷ √252 ≈ expected 1-day move. VIX 16 → about ±1%.
- **Elections:** results day, 4 June 2024, saw a Nifty fall of nearly 6% intraday, then a recovery.
- **Geopolitics/news:** short-term shocks, usually priced in quickly.

## 1.4 Daily pre-market checklist (~10 minutes)

| # | Check | Bullish (+1) | Bearish (−1) |
|---|---|---|---|
| 1 | GIFT Nifty vs previous close | > +0.3% | < −0.3% |
| 2 | US markets overnight | Up | Down |
| 3 | Brent crude | Falling | Rising sharply |
| 4 | USD/INR | Rupee strengthening | Rupee weakening |
| 5 | FII + DII net (yesterday) | Net buying | Heavy net selling |
| 6 | India VIX | Falling | Spiking |
| 7 | Nifty vs 50-day average | Above | Below |
| 8 | Event today? (RBI/CPI/Fed/results) | — | Mark "high uncertainty" |

Score: +4 or more = positive tilt, −4 or less = negative tilt, in between = no signal.

**Automated:** `python algo/checklist.py --gift 0.4` scores items 2–7 from live data (FII/DII fetched from NSE when available), logs them, and `--evaluate` later measures your real hit rate.

**Honest caveat:**
- The checklist mostly tells you the **opening mood**, which GIFT Nifty already shows.
- Over the day and the week, direction is close to a coin toss. Public information (FII data, US close, crude) is largely **already priced in** (efficient-markets idea).
- Use it for **context and risk control** ("VIX is high → trade smaller"), not prediction.
- Anyone claiming to reliably call the Nifty's daily direction is selling something.

---

## ✅ Check your understanding

1. Company X: total market cap ₹10 lakh crore, 50% promoter holding. Company Y: ₹6 lakh crore, 0% promoter holding. Which has more Nifty weight, and why?
2. HDFC Bank (12% weight) falls 3%; everything else is flat. Roughly how many points does the Nifty (at 25,000) fall?
3. The RBI cuts the repo rate by 25 bps but the Nifty falls that day. Give two possible reasons.
4. Crude jumps 10% overnight. Name one sector likely hurt, one likely helped, and explain the path through the rupee.
5. India VIX is 22. What's the approximate expected 1-month Nifty move, and what does that mean for position size?
6. FIIs sold ₹4,000 crore yesterday but the Nifty closed up. How is that possible?
