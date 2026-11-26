# SEBI rules for retail algo trading (India) – what you need to know

> Summary for learning, not legal advice. Rules change: always check the latest SEBI/NSE
> circulars and your broker's notices before trading. Last reviewed: November 2026.

## 1. The framework

SEBI's circular **"Safer participation of retail investors in Algorithmic trading" (4 Feb 2025)**,
implemented through NSE/BSE circulars, brought retail API trading under a formal framework.
After several extensions, **static-IP order placement became mandatory from 1 April 2026**.

| Rule | What it means for you |
|---|---|
| **Broker is the principal** | Every API order goes through your broker, who is responsible for it. Algos run by third-party "algo providers" must be empanelled with the exchange through a broker. |
| **Static IP whitelisting** | Orders via API are accepted only from a registered app mapped to a **whitelisted static IP**. A home Wi-Fi IP that keeps changing won't work. You need a static IP from your ISP or a cloud VM with a fixed IP. Orders from other IPs are rejected. |
| **Order-rate threshold** | Your own algo may place up to **10 orders per second** (per exchange/segment) without registering it. Above that, the algo must be **registered with the exchange** and gets a unique Algo-ID. Kite Connect already rejects >10 orders/sec with HTTP 429. |
| **No open APIs** | Brokers must authenticate API access (OAuth / 2FA, daily login). This is why Kite's access token expires every morning. |
| **White-box vs black-box** | Algos whose logic is disclosed ("white box", like your own code) vs. hidden logic ("black box"). Black-box providers must be SEBI-registered Research Analysts and keep records. |
| **Family use** | You may use your own algo for yourself and close family (spouse, dependent children/parents) under the same rules. Selling it to others makes you an algo provider (registration needed). |
| **Kill switch / limits** | Brokers and exchanges can stop any algo that misbehaves. Brokers may set stricter limits than SEBI. |

## 2. What this means for the code in this repo

* `live_kite.py` places at most a handful of orders per run, pauses 0.35 s between API calls
  (≈3 calls/sec), so it stays well under the 10 orders/sec threshold. **No registration is needed
  for this level of activity, but you DO need a static IP registered in the Kite developer console.**
* It uses **LIMIT** orders with a small price buffer, not market orders. That is safer, and
  brokers increasingly restrict API market orders.
* Your own white-box code for your own account = the simplest category. Don't sell signals or
  run it for friends' accounts; that needs SEBI registration (Research Analyst / Investment
  Adviser / algo provider).

## 3. F&O-specific rules (important if you ever move beyond delivery trades)

SEBI tightened index derivatives from **Nov 2024 onward**: bigger minimum contract size
(~₹15 lakh), only **one weekly expiry per exchange**, upfront collection of option premium,
extra margin on expiry day, removal of calendar-spread benefit on expiry day, and intraday
monitoring of position limits.

**SEBI's own studies on individual equity F&O traders:**

| Year | Traders who lost money | Aggregate net loss |
|---|---|---|
| FY22 | ~89% | – |
| FY24 | ~91% | ₹74,812 crore |
| FY25 | ~91% | ~₹1.06–1.12 lakh crore |
| FY26 | **87.7%** | ~₹91,685 crore |

Even after the curbs, roughly **9 out of 10 individual F&O traders lose money**, and the
losses are much larger than transaction costs alone. Algos don't change this math; they just
lose faster if the strategy has no edge.

## 4. Tax & compliance basics (delivery equity)

* STT 0.1% on buy & sell (modelled in `costs.py`).
* **STCG** (held < 12 months): 20%. **LTCG** (> 12 months): 12.5% above ₹1.25 lakh/year
  (Budget 2024 rates). Not modelled in the backtests, but it reduces active strategies' returns.
* Frequent intraday/F&O trading = business income (ITR-3), and may need a tax audit.
* Keep your `orders_log.csv`, contract notes and P&L statements.

## 5. Checklist before going live

- [ ] Strategy beats buy-and-hold **out-of-sample** after costs (`backtest.py --oos-split`)
- [ ] Not just the best of many parameter combinations (`--optimize` shows the decay)
- [ ] 2–3+ months of paper trading (`paper_trade.py`) that matches the backtest
- [ ] Static IP registered with Zerodha; API key/secret stored in environment variables only
- [ ] Start with capital you can lose entirely: a few thousand rupees, not your savings
- [ ] Hard limits set: `--max-order-value`, `--max-orders`, `KILL_SWITCH` file
- [ ] You check fills and positions every day; automation ≠ unattended

## Sources

* SEBI circular, 4 Feb 2025: *Safer participation of retail investors in Algorithmic trading* (sebi.gov.in)
* Zerodha Z-Connect: [Explaining the latest SEBI algo trading regulations](https://zerodha.com/z-connect/business-updates/explaining-the-latest-sebi-algo-trading-regulations), [NSE's retail algo framework overview](https://zerodha.com/z-connect/general/a-comprehensive-overview-of-nses-circular-on-the-new-retail-algo-trading-framework)
* Fyers: [New SEBI rules for retail algo trading from April 01, 2026](https://support.fyers.in/portal/en/kb/articles/what-are-the-new-sebi-rules-for-retail-algo-trading-from-april-01-2026)
* Kotak Neo: [NSE's new retail algo trading rules](https://www.kotakneo.com/investing-guide/articles/retail-algo-trading-rules-nse-circular/)
* Business Standard: [Net losses of individual traders in F&O widened in FY25: SEBI study](https://www.business-standard.com/markets/news/net-losses-of-traders-in-fo-widens-in-fy25-sebi-study-125070701221_1.html)
* Business Today: [87.7% of F&O traders lost money in FY26](https://www.businesstoday.in/personal-finance/story/87-7-of-fo-traders-lost-money-in-fy26-despite-sebi-curbs-why-retail-investors-keep-losing-567419-2026-11-14)
