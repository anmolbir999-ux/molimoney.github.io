/* Paper-trading engine with a learning "brain". Pure JS, no dependencies.
 * Mirrors algo/engine.py + algo/strategies.py so phone results match the Python backtester.
 *
 * Learning (all causal – only uses information available at each day's close):
 *  1. Strategy selection: every strategy runs in a hidden "shadow" paper account per stock.
 *     Every REVIEW_EVERY sessions the brain picks the strategy with the best trailing-year
 *     Sharpe (if any is good enough), otherwise it keeps that stock in cash.
 *  2. Mistake rules: every closed shadow trade is tagged with the conditions at entry
 *     (market below 200-DMA, overextended, low volume, high volatility, below own 200-DMA).
 *     When trades with a condition lose clearly more than trades without it, the brain
 *     learns a rule and blocks new entries under that condition (and can unlearn it later).
 */
(function (root) {
  'use strict';
  const TD = 252;
  const REVIEW_EVERY = 21, MIN_HISTORY = 120, HYST = 0.2, EQ_KEEP = 260;
  const RULE_MIN_N = 12, RULE_WINDOW = 400, RF = 6;
  // Brain settings: defaults, overridable per account (st.cfg.brain) – tuned by repeat-training mode.
  const BRAIN_DEFAULTS = { reviewEvery: 21, minScore: 0.3, scoreWindow: 250, useRules: true, ruleMargin: 1.0, strategies: null, quick: false, tpAtr: 0, maxDays: 0, quickEdge: 0.1, useMemory: true, idle: 'cash', join: false, crashGap: 5, beat: false };
  // Quick defaults chosen because they held up in BOTH 2008–11 and 2023–26 (not the best in either):
  // no fixed target – each strategy's own exit takes the profit – a 3× ATR stop and a 10-session limit.
  const QUICK_PRESET = { quick: true, beat: false, idle: 'cash', join: false, stopAtr: 3, tpAtr: 0, maxDays: 10, minScore: 0.3, reviewEvery: 21, quickEdge: 0.3 };
  const NORMAL_PRESET = { quick: false, beat: false, idle: 'cash', join: false, stopAtr: 3, tpAtr: 0, maxDays: 0 };
  // "Beat the Nifty": stay invested in each stock (joining trends already under way). In the honest test with real
  // Nifty 50 membership, holding every member equally beat the Nifty with dividends by ~0.9 pts/yr over 2010–2026
  // with no crash filter, while a 5% crash filter cost ~3–4 pts/yr – so the filter is off by default (still a setting).
  const BEAT_PRESET = { quick: false, beat: true, idle: 'crash', crashGap: 100, join: true, stopAtr: 0, tpAtr: 0, maxDays: 0 };
  const brainParams = (st) => ({ ...BRAIN_DEFAULTS, stopAtr: st.cfg.stopAtr, ...(st.cfg.brain || {}) });
  const allowedStrategies = (B) => (B.strategies ? B.strategies.filter((k) => !!STRATEGIES[k].quick === !!B.quick) : null) || (B.quick ? QUICK : NORMAL);

  // ------------------------------------------------------------------ costs (algo/costs.py)
  function cost(t, side) {
    if (t <= 0) return 0;
    const stt = t * 0.1 / 100, ex = t * 0.00297 / 100, sebi = t * 10 / 1e7;
    const stamp = side === 'BUY' ? t * 0.015 / 100 : 0;
    const gst = (ex + sebi) * 0.18;
    const dp = side === 'SELL' ? 15.93 : 0;
    return stt + ex + sebi + stamp + gst + dp;
  }

  // ------------------------------------------------------------------ indicators
  const nan = (n) => new Array(n).fill(NaN);
  const isn = Number.isNaN;
  function sma(a, n) {
    const o = nan(a.length); let s = 0;
    for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; }
    return o;
  }
  function ewm(a, alpha, minP) { // pandas ewm(adjust=False, min_periods=minP) with leading NaNs
    const o = nan(a.length); let e = NaN, cnt = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (isn(x)) { if (cnt >= minP) o[i] = e; continue; }
      e = cnt === 0 ? x : alpha * x + (1 - alpha) * e; cnt++;
      if (cnt >= minP) o[i] = e;
    }
    return o;
  }
  const ema = (a, n) => ewm(a, 2 / (n + 1), n);
  function rsi(c, n = 14) {
    const L = c.length, up = nan(L), dn = nan(L);
    for (let i = 1; i < L; i++) { const d = c[i] - c[i - 1]; up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0); }
    const au = ewm(up, 1 / n, n), ad = ewm(dn, 1 / n, n);
    return au.map((u, i) => isn(u) ? NaN : ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i]));
  }
  function macd(c, f = 12, s = 26, sig = 9) {
    const ef = ema(c, f), es = ema(c, s), line = ef.map((x, i) => x - es[i]);
    return { line, signal: ewm(line, 2 / (sig + 1), sig) };
  }
  function atr(b, n = 14) {
    const L = b.c.length, tr = nan(L);
    for (let i = 0; i < L; i++) {
      const hl = b.h[i] - b.l[i];
      tr[i] = i === 0 ? hl : Math.max(hl, Math.abs(b.h[i] - b.c[i - 1]), Math.abs(b.l[i] - b.c[i - 1]));
    }
    return ewm(tr, 1 / n, n);
  }
  function rollStd(a, n) {
    const o = nan(a.length);
    for (let i = n - 1; i < a.length; i++) {
      let m = 0; for (let k = i - n + 1; k <= i; k++) m += a[k]; m /= n;
      let v = 0; for (let k = i - n + 1; k <= i; k++) v += (a[k] - m) ** 2;
      o[i] = Math.sqrt(v / n);
    }
    return o;
  }
  function rollPrev(a, n, fn) { // fn over the PREVIOUS n values (shifted by 1)
    const o = nan(a.length);
    for (let i = n; i < a.length; i++) o[i] = fn(a.slice(i - n, i));
    return o;
  }
  /** On-balance volume: running total of volume, added on up days and subtracted on down days. */
  function obv(b) { const o = new Array(b.c.length).fill(0); for (let i = 1; i < b.c.length; i++) o[i] = o[i - 1] + (b.c[i] > b.c[i - 1] ? b.v[i] : b.c[i] < b.c[i - 1] ? -b.v[i] : 0); return o; }
  /**
   * Buy/sell "call" score 0–5, one point each: price above its 50-day average, 50-day above 200-day,
   * MACD above its signal, RSI between 50 and 75 (strong, not stretched), OBV rising over 20 sessions.
   */
  function signalScore(b) {
    const s50 = sma(b.c, 50), s200 = sma(b.c, 200), m = macd(b.c), r = rsi(b.c, 14), o = obv(b);
    return b.c.map((c, i) => (i < 200 || isn(s200[i]) ? 0 : (c > s50[i]) + (s50[i] > s200[i]) + (m.line[i] > m.signal[i]) + (r[i] >= 50 && r[i] <= 75) + (o[i] > o[i - 20])));
  }
  // "Hold until exit" strategies return entry/exit events; the position state lives in the
  // portfolio (T.lt) so it carries over correctly between app updates.
  const latch = (entry, exit) => ({ e: entry.map(Boolean), x: exit.map(Boolean) });
  const resolve = (prev, X, i) => (Array.isArray(X) ? X[i] : prev === 0 ? (X.e[i] ? 1 : 0) : (X.x[i] ? 0 : 1));

  // ------------------------------------------------------------------ strategies (algo/strategies.py)
  const STRATEGIES = {
    hold: { label: 'Buy & hold', fn: (b) => b.c.map(() => 1) },
    sma_cross: { label: 'SMA 50/200 cross', fn: (b) => { const f = sma(b.c, 50), s = sma(b.c, 200); return f.map((x, i) => x > s[i] ? 1 : 0); } },
    ema_cross: { label: 'EMA 20/50 cross', fn: (b) => { const f = ema(b.c, 20), s = ema(b.c, 50); return f.map((x, i) => x > s[i] ? 1 : 0); } },
    macd_trend: { label: 'MACD trend', fn: (b) => { const m = macd(b.c); return m.line.map((x, i) => x > m.signal[i] ? 1 : 0); } },
    donchian: { label: 'Donchian 55/20 breakout', fn: (b) => {
      const up = rollPrev(b.h, 55, (w) => Math.max(...w)), lo = rollPrev(b.l, 20, (w) => Math.min(...w));
      return latch(b.c.map((c, i) => c > up[i]), b.c.map((c, i) => c < lo[i])); } },
    rsi_reversion: { label: 'RSI dip-buy (uptrend)', fn: (b) => {
      const r = rsi(b.c, 14), s = sma(b.c, 200);
      return latch(r.map((x, i) => x < 30 && b.c[i] > s[i]), r.map((x) => x > 55)); } },
    bollinger_reversion: { label: 'Bollinger reversion', fn: (b) => {
      const mid = sma(b.c, 20), sd = rollStd(b.c, 20);
      return latch(b.c.map((c, i) => c < mid[i] - 2 * sd[i]), b.c.map((c, i) => c > mid[i])); } },
    // ---- volume, breakout, combined-score and trend-hold strategies
    obv_trend: { label: 'Volume trend (OBV)', fn: (b) => {
      const o = obv(b), oe = ema(o, 50), s50 = sma(b.c, 50);
      return latch(b.c.map((c, i) => o[i] > oe[i] && c > s50[i] && o[i] >= o[i - 20]), b.c.map((c, i) => o[i] < oe[i] && c < s50[i])); } },
    vol_breakout: { label: '55-day breakout on volume', fn: (b) => {
      const hi = rollPrev(b.h, 55, (w) => Math.max(...w)), va = sma(b.v, 20), s50 = sma(b.c, 50);
      return latch(b.c.map((c, i) => c > hi[i] && va[i] > 0 && b.v[i] > 1.3 * va[i]), b.c.map((c, i) => c < s50[i])); } },
    score: { label: 'Signal score (trend + momentum + volume)', fn: (b) => {
      const sc = signalScore(b);
      return latch(sc.map((x) => x >= 4), sc.map((x) => x <= 2)); } },
    trend_hold: { label: 'Trend hold (above 200-day)', fn: (b) => {
      const s200 = sma(b.c, 200);
      return latch(b.c.map((c, i) => c > s200[i] * 1.01), b.c.map((c, i) => c < s200[i] * 0.97)); } },
    // ---- quick (short-swing) strategies: fast entries; exits mostly via profit target / stop / time limit
    quick_dip: { label: 'Quick dip (RSI-2)', quick: true, fn: (b) => {
      const r = rsi(b.c, 2), s200 = sma(b.c, 200), s5 = sma(b.c, 5);
      return latch(r.map((x, i) => x < 10 && b.c[i] > s200[i]), b.c.map((c, i) => c > s5[i])); } },
    quick_pullback: { label: 'Pullback to EMA 20', quick: true, fn: (b) => {
      const e20 = ema(b.c, 20), e50 = ema(b.c, 50);
      return latch(b.c.map((c, i) => e20[i] > e50[i] && b.l[i] <= e20[i] && c > e20[i] && c > b.o[i]), b.c.map((c, i) => c < e50[i])); } },
    quick_breakout: { label: 'Volume breakout', quick: true, fn: (b) => {
      const hi = rollPrev(b.h, 20, (w) => Math.max(...w)), lo = rollPrev(b.l, 10, (w) => Math.min(...w)), va = sma(b.v, 20);
      return latch(b.c.map((c, i) => c > hi[i] && va[i] > 0 && b.v[i] > 1.5 * va[i]), b.c.map((c, i) => c < lo[i])); } },
  };
  const QUICK = Object.keys(STRATEGIES).filter((k) => STRATEGIES[k].quick);
  const NORMAL = Object.keys(STRATEGIES).filter((k) => !STRATEGIES[k].quick);

  const FEATURES = {
    market_down: { label: 'Nifty below its 200-day average', lesson: 'Buying while the whole market is in a downtrend' },
    extended: { label: 'Price > 3 ATR above its 50-day average', lesson: 'Chasing a stretched price' },
    low_volume: { label: 'Volume < 80% of 20-day average', lesson: 'Signal without volume confirmation' },
    high_vol: { label: 'Volatility 1.5× above normal', lesson: 'Entering in a turbulent, high-volatility phase' },
    below_200: { label: 'Stock below its own 200-day average', lesson: 'Buying a stock in its own long-term downtrend' },
  };

  // ------------------------------------------------------------------ data
  const istDate = (ts) => new Date((ts + 19800) * 1000).toISOString().slice(0, 10);

  /** Parse Yahoo v8 chart JSON → raw (split-adjusted, dividend-unadjusted) bars + adjusted closes. */
  function parseYahoo(json, now) {
    const r = (typeof json === 'string' ? JSON.parse(json) : json).chart.result[0];
    const q = r.indicators.quote[0], ac = (r.indicators.adjclose || [{}])[0].adjclose || q.close;
    const b = { d: [], o: [], h: [], l: [], c: [], v: [], ac: [] };
    (r.timestamp || []).forEach((ts, i) => {
      if ([q.open[i], q.high[i], q.low[i], q.close[i]].some((x) => x == null)) return;
      const d = istDate(ts);
      if (b.d.length && b.d[b.d.length - 1] === d) return;
      b.d.push(d); b.o.push(q.open[i]); b.h.push(q.high[i]); b.l.push(q.low[i]); b.c.push(q.close[i]);
      b.v.push(q.volume[i] || 0); b.ac.push(ac[i] == null ? q.close[i] : ac[i]);
    });
    // drop today's half-formed candle during market hours
    const ist = new Date((now || Date.now()) + 19800 * 1000), today = ist.toISOString().slice(0, 10);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (b.d.length && b.d[b.d.length - 1] === today && mins < 15 * 60 + 45) Object.keys(b).forEach((k) => b[k].pop());
    const ev = r.events || {};
    const divs = {}, splits = [];
    Object.values(ev.dividends || {}).forEach((x) => { divs[istDate(x.date)] = x.amount; });
    Object.values(ev.splits || {}).forEach((x) => splits.push({ ts: x.date, ratio: x.numerator / x.denominator }));
    return { bars: b, divs, splits, symbol: r.meta && r.meta.symbol };
  }

  /** Indicators, strategy targets and entry features for one stock. */
  function prepare(raw, niftyByDate) {
    const f = raw.c.map((c, i) => raw.ac[i] / c);
    const adj = { o: raw.o.map((x, i) => x * f[i]), h: raw.h.map((x, i) => x * f[i]), l: raw.l.map((x, i) => x * f[i]), c: raw.ac.slice(), v: raw.v };
    const targets = {};
    for (const k in STRATEGIES) targets[k] = STRATEGIES[k].fn(adj);
    const a = atr(raw), s50 = sma(adj.c, 50), s200 = sma(adj.c, 200), vAvg = sma(adj.v, 20);
    const atrPct = a.map((x, i) => x / raw.c[i]);
    const atrPctAvg = sma(atrPct.map((x) => (isn(x) ? 0 : x)), 250);
    const feats = raw.d.map((d, i) => {
      const n = niftyByDate(d), aa = a[i];
      return {
        market_down: !!(n && n.c < n.s200),
        market_gap: n && n.s200 ? Math.round((n.c / n.s200 - 1) * 1000) / 10 : 0,
        extended: !isn(s50[i]) && aa > 0 && (adj.c[i] - s50[i]) / (aa * f[i]) > 3,
        low_volume: vAvg[i] > 0 && adj.v[i] / vAvg[i] < 0.8,
        high_vol: !isn(atrPctAvg[i]) && atrPct[i] > 1.5 * atrPctAvg[i],
        below_200: !isn(s200[i]) && adj.c[i] < s200[i],
      };
    });
    const ready = Math.min(raw.d.length - 1, 200);
    return { raw, targets, atr: a, feats, ready, idx: Object.fromEntries(raw.d.map((d, i) => [d, i])) };
  }

  function niftyLookup(nb) {
    // 200-day average; while the index has less history than that (Yahoo's Nifty starts Sept 2007) use the average of what exists (≥ 60 days)
    const s = sma(nb.c, 200), m = {};
    { let acc = 0; for (let i = 0; i < Math.min(199, nb.c.length); i++) { acc += nb.c[i]; if (i >= 59) s[i] = acc / (i + 1); } }
    nb.d.forEach((d, i) => { m[d] = { c: nb.c[i], s200: s[i] }; });
    let last = null; const dates = nb.d;
    return (d) => { if (m[d]) return m[d]; // ffill
      let j = dates.length - 1; while (j >= 0 && dates[j] > d) j--; last = j >= 0 ? m[dates[j]] : null; return last; };
  }

  // ------------------------------------------------------------------ trader (algo/engine.py Trader)
  function newTrader(cash, cfg) {
    const b = cfg.brain || {};
    return { cash, slip: cfg.slippage, stopAtr: cfg.stopAtr, riskPct: cfg.riskPct, tpAtr: b.tpAtr || 0, maxDays: b.maxDays || 0, qty: 0, stop: null,
      pending: '', pAtr: 0, pFeat: null, pStrat: '', armed: false, costs: 0, trades: [], eq: [] };
  }
  function tBuy(t, day, open) {
    const p = open * (1 + t.slip / 100);
    const qc = Math.floor(t.cash / (p * 1.002)); let q = qc, stop = null;
    if (t.stopAtr > 0 && t.pAtr > 0) {
      stop = p - t.stopAtr * t.pAtr;
      if (t.riskPct > 0) q = Math.min(qc, Math.floor(t.cash * t.riskPct / 100 / (t.stopAtr * t.pAtr)));
    }
    while (q > 0 && q * p + cost(q * p, 'BUY') > t.cash) q--;
    if (q <= 0) return;
    const c = cost(q * p, 'BUY');
    t.cash -= q * p + c; t.costs += c; t.qty = q; t.stop = stop;
    t.tp = t.tpAtr > 0 && t.pAtr > 0 ? p + t.tpAtr * t.pAtr : null;
    t.trades.push({ e: day, ep: p, q, ec: c, stop, tp: t.tp, f: t.pFeat, s: t.pStrat, bars: 0 });
  }
  function tSell(t, day, px, reason) {
    const p = px * (1 - t.slip / 100), c = cost(t.qty * p, 'SELL');
    t.cash += t.qty * p - c; t.costs += c;
    const tr = t.trades[t.trades.length - 1];
    Object.assign(tr, { x: day, xp: p, xc: c, r: reason });
    tr.pnl = (p - tr.ep) * tr.q - tr.ec - c; tr.ret = tr.pnl / (tr.ep * tr.q) * 100;
    t.qty = 0; t.stop = null; t.tp = null;
    return tr;
  }
  function onBar(t, day, o, h, l, c, target, a, allow, feat, strat) {
    let closed = null;
    if (t.pending === 'BUY' && t.qty === 0) tBuy(t, day, o);
    else if (t.pending === 'SELL' && t.qty > 0) closed = tSell(t, day, o, t.pReason || 'signal');
    t.pending = ''; t.pReason = '';
    if (t.qty > 0 && t.stop !== null && l <= t.stop) { closed = tSell(t, day, Math.min(o, t.stop), 'stop'); t.armed = false; }
    // profit target: sold as soon as the price trades at the target (at the open if it gaps above it)
    if (t.qty > 0 && t.tp && h >= t.tp) { closed = tSell(t, day, Math.max(o, t.tp), 'target'); t.armed = false; }
    if (t.qty > 0) t.trades[t.trades.length - 1].bars++;
    if (target === 0) t.armed = true;
    // join trends: don't wait for a fresh signal – buy a trend that is already on, and re-enter 10 sessions after a stop/target/time exit
    if (t.join && !t.armed && t.qty === 0 && !closed) { if (t.cool > 0) t.cool--; else t.armed = true; }
    if (closed && closed.r !== 'signal') t.cool = 10;
    if (t.qty === 0 && target === 1 && t.armed && allow) {
      t.pending = 'BUY'; t.pAtr = a && !isn(a) ? a : 0; t.pFeat = feat; t.pStrat = strat;
    } else if (t.qty > 0 && target === 0) t.pending = 'SELL';
    else if (t.qty > 0 && t.maxDays > 0 && t.trades[t.trades.length - 1].bars >= t.maxDays) { t.pending = 'SELL'; t.pReason = 'time'; t.armed = false; }
    t.eq.push(t.cash + t.qty * c);
    if (t.eq.length > EQ_KEEP) t.eq.shift();
    return closed;
  }
  const equity = (t, price) => t.cash + t.qty * price;

  function sharpe(eq, window = 250) {
    if (eq.length < Math.min(MIN_HISTORY, window)) return NaN;
    const w = eq.slice(-window - 1), r = [];
    for (let i = 1; i < w.length; i++) r.push(w[i] / w[i - 1] - 1 - ((1 + RF / 100) ** (1 / TD) - 1));
    const m = r.reduce((s, x) => s + x, 0) / r.length;
    const sd = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1));
    return sd > 0 ? Math.sqrt(TD) * m / sd : 0;
  }

  // ------------------------------------------------------------------ portfolio + brain
  function newState(cfg, today) {
    const paperStart = today;
    const ws = new Date(today + 'T00:00:00Z'); ws.setUTCFullYear(ws.getUTCFullYear() - cfg.warmYears);
    return migrate({ v: 2, cfg, created: today, paperStart, warmStart: ws.toISOString().slice(0, 10), lastDate: null,
      lastFetch: 0, tickers: {}, learning: { closed: [], rules: {}, events: [] }, equity: [], sim: [] });
  }

  /** Bring older saved states up to date (adds fields introduced later). */
  function migrate(st) {
    if (!st) return st;
    if (st.slice == null) st.slice = st.cfg.capital / st.cfg.tickers.length;
    if (st.invested == null) st.invested = st.slice * st.cfg.tickers.length; // total paper money put in
    if (st.withdrawn == null) st.withdrawn = 0;                             // cash taken out by removing stocks
    st.pauses = st.pauses || [];
    st.runs = st.runs || [];
    st.archive = st.archive || [];
    st.trainings = st.trainings || [];
    st.chat = st.chat || [];
    st.learning.trained = st.learning.trained || [];
    st.learning.mistakes = st.learning.mistakes || [];
    st.equity.forEach((r) => { if (r.length < 4) r[3] = st.invested - st.withdrawn; });
    st.v = 2;
    return st;
  }

  // ------------------------------------------------------------------ pause / stop
  /** Pause mode on date d: null, 'pause' (no new buys) or 'stop' (sell everything, no buys). */
  function pauseOn(st, d) {
    for (const p of st.pauses) if (p.from <= d && (!p.to || d < p.to)) return p.mode;
    return null;
  }
  const isPaused = (st) => { const p = st.pauses[st.pauses.length - 1]; return p && !p.to ? p.mode : null; };
  function setPause(st, mode, today, nowIso) {
    const open = st.pauses[st.pauses.length - 1];
    if (open && !open.to) { open.to = today; open.endedAt = nowIso; if (open.from >= open.to) st.pauses.pop(); }
    if (mode) {
      st.pauses.push({ mode, from: today, to: null, at: nowIso });
      // cancel buy orders that were queued for the next open
      Object.values(st.tickers).forEach((T) => { if (T.live.pending === 'BUY') T.live.pending = ''; });
    }
    logEvent(st, today, mode === 'pause' ? 'You paused trading: no new buys (stops and exits still active)'
      : mode === 'stop' ? 'You stopped trading: all positions sell at the next open, no new buys' : 'You resumed trading', 'user', nowIso);
  }

  // ------------------------------------------------------------------ paper money
  const netCapital = (st) => st.invested - st.withdrawn;
  const cashTotal = (st) => Object.values(st.tickers).reduce((s, T) => s + T.live.cash, 0);
  /**
   * Deposit (amount > 0) or withdraw (amount < 0) paper money. Deposits are split equally across
   * stocks; withdrawals come only from uninvested cash, in proportion to each stock's cash.
   * Recorded as capital flows, so returns are not affected. Returns { ok, amount, reason }.
   */
  function adjustCapital(st, amount, today, nowIso) {
    amount = Math.round(amount);
    const T = Object.values(st.tickers), n = T.length || st.cfg.tickers.length;
    if (!amount) return { ok: false, reason: 'Amount is zero' };
    if (amount > 0) {
      if (T.length) T.forEach((t) => { t.live.cash += amount / T.length; });
      st.invested += amount;
    } else {
      const want = -amount, cash = cashTotal(st);
      if (want > cash + 0.5) return { ok: false, reason: `Only ₹${Math.floor(cash).toLocaleString('en-IN')} is in cash – the rest is invested in shares`, cash };
      T.forEach((t) => { t.live.cash -= cash > 0 ? want * (t.live.cash / cash) : 0; t.live.cash = Math.max(0, t.live.cash); });
      st.withdrawn += want;
    }
    st.slice = Math.max(netCapital(st), 0) / n;
    logEvent(st, today, amount > 0 ? `You added ₹${amount.toLocaleString('en-IN')} of paper money` : `You withdrew ₹${(-amount).toLocaleString('en-IN')} of paper money`, 'user', nowIso);
    return { ok: true, amount };
  }

  // ------------------------------------------------------------------ add / remove stocks
  function addTicker(st, sym, today, nowIso) {
    if (st.cfg.tickers.includes(sym)) return false;
    st.cfg.tickers.push(sym);
    st.invested += st.slice;
    if (st.lastDate) ensureTicker(st, sym).fresh = true; // its cash counts immediately; history is studied on the next update
    logEvent(st, today, `You added ${sym.replace('.NS', '')} with ₹${Math.round(st.slice).toLocaleString('en-IN')} paper capital`, 'user', nowIso);
    return true;
  }
  /** Remove now if flat; otherwise sell at the next open and remove once sold. */
  function removeTicker(st, sym, today, nowIso) {
    const T = st.tickers[sym];
    if (!T || (T.live.qty === 0 && T.live.pending !== 'SELL')) return finishRemove(st, sym, today, nowIso);
    T.removing = true;
    if (T.live.pending === 'BUY') T.live.pending = '';
    logEvent(st, today, `You removed ${sym.replace('.NS', '')}: it will be sold at the next open`, 'user', nowIso);
    return false;
  }
  function finishRemove(st, sym, today, nowIso) {
    const T = st.tickers[sym];
    st.cfg.tickers = st.cfg.tickers.filter((t) => t !== sym);
    if (T) {
      st.withdrawn += T.live.cash;
      st.archive.push(...T.live.trades.map((t) => ({ ...t, sym })));
      delete st.tickers[sym];
    } else st.invested -= st.slice;
    logEvent(st, today, `${sym.replace('.NS', '')} removed; its cash was withdrawn from the paper account`, 'user', nowIso);
    return true;
  }

  function ensureTicker(st, sym) {
    if (st.tickers[sym]) {
      const T = st.tickers[sym];
      for (const k in STRATEGIES) if (!T.shadows[k]) T.shadows[k] = newTrader(st.slice, st.cfg);
      return T;
    }
    const alloc = st.slice, sh = {};
    for (const k in STRATEGIES) sh[k] = newTrader(alloc, st.cfg);
    return (st.tickers[sym] = { shadows: sh, sim: newTrader(alloc, st.cfg), live: newTrader(alloc, st.cfg),
      active: null, scores: {}, sinceReview: brainParams(st).reviewEvery, lastClose: null, lt: {}, spark: { d: [], c: [] } });
  }

  function logEvent(st, date, text, kind, at) {
    st.learning.events.push({ date, text, kind, at: at || st._now || new Date().toISOString() });
    if (st.learning.events.length > 300) st.learning.events.shift();
  }

  /** Quick mode: judge each quick strategy by its average net profit per trade over its last 20 trades. */
  function reviewQuick(st, sym, T, date, B, allowed) {
    const scores = {};
    for (const k of allowed) { const tr = T.shadows[k].trades.filter((x) => x.x).slice(-20); scores[k] = tr.length >= 5 ? tr.reduce((s, x) => s + x.ret, 0) / tr.length : NaN; }
    T.scores = scores;
    const set = allowed.filter((k) => scores[k] > B.quickEdge).sort((a, b) => scores[b] - scores[a]);
    const before = (T.quickSet || []).join(), cur = set[0] || null;
    T.quickSet = set;
    if (set.join() !== before) {
      logEvent(st, date, set.length ? `${sym.replace('.NS', '')}: quick trades with ${set.map((k) => `${STRATEGIES[k].label} (avg ${scores[k] >= 0 ? '+' : ''}${scores[k].toFixed(2)}%/trade)`).join(', ')}`
        : `${sym.replace('.NS', '')}: no quick strategy is making money lately – staying in cash`, 'switch');
    }
    T.active = cur;
  }
  function review(st, sym, T, date) {
    const B = brainParams(st), scores = {}, allowed = allowedStrategies(B);
    if (B.quick) return reviewQuick(st, sym, T, date, B, allowed);
    if (B.beat) { if (T.active) { logEvent(st, date, `${sym.replace('.NS', '')}: ${STRATEGIES[T.active].label} → stay invested (Beat the Nifty)`, 'switch'); T.active = null; } T.scores = {}; return; }
    for (const k in T.shadows) if (allowed.includes(k)) scores[k] = sharpe(T.shadows[k].eq, B.scoreWindow);
    T.scores = scores;
    let best = null, bestS = -Infinity;
    for (const k in scores) if (!isn(scores[k]) && scores[k] > bestS) { best = k; bestS = scores[k]; }
    if (best === null) return;
    let cur = T.active; const curS = cur ? scores[cur] : -Infinity;
    if (cur && !(curS >= B.minScore)) cur = null;
    if (bestS >= B.minScore && (cur === null || bestS > curS + HYST)) cur = best;
    if (cur !== T.active) {
      const from = T.active ? STRATEGIES[T.active].label : 'cash', to = cur ? STRATEGIES[cur].label : 'cash';
      const why = cur ? `trailing-year Sharpe ${scores[cur].toFixed(2)}` : `no strategy above ${B.minScore} Sharpe (best ${bestS.toFixed(2)})`;
      logEvent(st, date, `${sym.replace('.NS', '')}: ${from} → ${to} (${why})`, 'switch');
      T.active = cur;
    }
  }

  // ------------------------------------------------------------------ mistake memory: note once, never repeat
  // A mistake = a trade the brain actually made that lost more than 1% while showing warning signs at entry.
  // Its fingerprint (stock + strategy + those warning signs) is blocked from then on. Shadow accounts keep taking
  // such trades, so we can see what avoiding it saved – and forgive it if it would have made money more often.
  const MEM_LOSS = -1;
  const memMatch = (m, sym, s, feat) => !m.forgiven && m.sym === sym && m.s === s && m.keys.every((k) => feat && feat[k]);
  function memBlock(st, sym, s, feat) {
    if (!s || !brainParams(st).useMemory) return null;
    const M = st.learning.mistakes; if (!M || !M.length) return null;
    for (const m of M) if (memMatch(m, sym, s, feat)) return m;
    return null;
  }
  function noteMistake(st, sym, cl, d) {
    if (cl && brainParams(st).beat) return;
    if (!cl || !(cl.ret < MEM_LOSS) || !cl.f || !cl.s || !brainParams(st).useMemory) return;
    const keys = Object.keys(FEATURES).filter((k) => cl.f[k]); if (!keys.length) return;
    const M = st.learning.mistakes = st.learning.mistakes || [], id = `${sym}|${cl.s}|${keys.join('+')}`;
    const when = keys.map((k) => FEATURES[k].label.toLowerCase()).join(' and '), name = `${sym.replace('.NS', '')} ${STRATEGIES[cl.s] ? STRATEGIES[cl.s].label : cl.s}`;
    let m = M.find((x) => x.id === id);
    if (m && !m.forgiven) { m.count++; m.date = d; return; }
    if (m) Object.assign(m, { forgiven: false, forgivenOn: null, date: d, ret: cl.ret, count: m.count + 1, avoided: 0, saved: 0, missed: 0, missedGain: 0 });
    else M.push(m = { id, sym, s: cl.s, keys, date: d, entry: cl.e, ret: Math.round(cl.ret * 100) / 100, pnl: Math.round(cl.pnl || 0), reason: cl.r, count: 1, avoided: 0, saved: 0, missed: 0, missedGain: 0, forgiven: false });
    if (M.length > 300) M.shift();
    logEvent(st, d, `Noted a mistake: ${name} while ${when} lost ${cl.ret.toFixed(1)}%. I won't make that trade again.`, 'mistake');
  }
  function memoryOutcome(st, sym, cl) {
    const M = st.learning.mistakes; if (!M || !M.length || !cl.f) return;
    for (const m of M) {
      if (m.forgiven || m.sym !== sym || m.s !== cl.s || !(cl.e > m.date) || !m.keys.every((k) => cl.f[k])) continue;
      if (cl.ret < 0) { m.avoided++; m.saved += -cl.ret; } else { m.missed++; m.missedGain += cl.ret; }
      if (m.missed >= 2 && m.missed > m.avoided) {
        m.forgiven = true; m.forgivenOn = cl.x;
        logEvent(st, cl.x, `Forgave a mistake: ${sym.replace('.NS', '')} ${STRATEGIES[m.s] ? STRATEGIES[m.s].label : m.s} in those conditions made money ${m.missed}× since (${m.avoided}× it would have lost) – it was probably bad luck`, 'unlearn');
      }
    }
  }
  const mistakesBefore = (st, start) => (st.learning.mistakes || []).filter((m) => !m.forgiven && m.date < start);

  function updateRules(st, date) {
    // evidence = trades the brain lived through recently + anything it was taught in training mode
    const B0 = brainParams(st), pool0 = allowedStrategies(B0);
    const L = st.learning, recent = (L.trained || []).concat(L.closed.slice(-RULE_WINDOW)).filter((t) => pool0.includes(t.s)), M = B0.ruleMargin;
    for (const k in FEATURES) {
      const w = recent.filter((t) => t.f && t.f[k]), wo = recent.filter((t) => t.f && !t.f[k]);
      const mean = (a) => (a.length ? a.reduce((s, t) => s + t.ret, 0) / a.length : NaN);
      const mw = mean(w), mwo = mean(wo), win = (a) => (a.length ? a.filter((t) => t.ret > 0).length / a.length : NaN);
      const r = L.rules[k] || (L.rules[k] = { active: false, since: null });
      Object.assign(r, { nWith: w.length, meanWith: mw, nWithout: wo.length, meanWithout: mwo, winWith: win(w), winWithout: win(wo) });
      const bad = w.length >= RULE_MIN_N && mw < 0 && mw < mwo - M;
      const good = !(w.length >= RULE_MIN_N) || mw > 0 || mw > mwo - M / 4;
      if (!r.active && bad) {
        r.active = true; r.since = date;
        logEvent(st, date, `Learned: avoid entries when ${FEATURES[k].label.toLowerCase()} – ${w.length} trades averaged ${mw.toFixed(1)}% vs ${mwo.toFixed(1)}% otherwise`, 'learn');
      } else if (r.active && good) {
        r.active = false; r.since = date;
        logEvent(st, date, `Unlearned: "${FEATURES[k].label}" no longer hurts (${mw.toFixed(1)}% vs ${mwo.toFixed(1)}%)`, 'unlearn');
      }
    }
  }

  function blocked(st, feat) {
    if (!feat || !brainParams(st).useRules) return [];
    return Object.keys(FEATURES).filter((k) => feat[k] && st.learning.rules[k] && st.learning.rules[k].active);
  }

  /** Apply splits announced since the last update to stored positions (Yahoo re-adjusts history). */
  function applySplits(st, sym, splits) {
    const T = st.tickers[sym]; if (!T || !st.lastFetch) return;
    splits.filter((s) => s.ts * 1000 > st.lastFetch).forEach((s) => {
      const all = [T.live, T.sim, ...Object.values(T.shadows)];
      all.forEach((t) => {
        if (t.qty > 0) {
          const tr = t.trades[t.trades.length - 1], nq = Math.floor(t.qty * s.ratio);
          t.qty = nq; tr.q = nq; tr.ep /= s.ratio; if (t.stop !== null) { t.stop /= s.ratio; tr.stop = t.stop; }
        }
        t.pAtr /= s.ratio; // rupee equity history is unaffected
      });
      if (T.lastClose) T.lastClose /= s.ratio;
      T.spark.c = T.spark.c.map((c, i) => (T.spark.d[i] < istDate(s.ts) ? c / s.ratio : c));
      logEvent(st, istDate(s.ts), `${sym.replace('.NS', '')}: split/bonus ${s.ratio}:1 applied to positions`, 'info');
    });
  }

  /**
   * Process every new trading day for all stocks, date by date.
   * data: { [sym]: parsed }, nifty: parsed. Returns summary of what happened.
   */
  /**
   * Process every new trading day for all stocks, date by date.
   * data: { [sym]: parsed }, nifty: parsed. Returns summary of what happened.
   * begin() + stepDays() + finish() let the UI replay history day by day (training mode).
   */
  function begin(st, data, nifty, nowMs) {
    migrate(st);
    st._now = new Date(nowMs || Date.now()).toISOString();
    const nl = nifty._nl || (nifty._nl = niftyLookup(nifty.bars));
    const prep = {};
    for (const sym of st.cfg.tickers) {
      if (!data[sym] || !data[sym].bars.d.length) continue;
      const isNew = !st.tickers[sym] || st.tickers[sym].fresh;
      ensureTicker(st, sym);
      if (!isNew) applySplits(st, sym, data[sym].splits);
      prep[sym] = data[sym]._prep || (data[sym]._prep = prepare(data[sym].bars, nl));
      if (isNew && st.lastDate) preRoll(st, sym, prep[sym], data[sym]);
      delete st.tickers[sym].fresh;
    }
    const dates = [...new Set(Object.values(prep).flatMap((p) => p.raw.d))].sort()
      .filter((d) => (st.lastDate === null || d > st.lastDate) && (!st.training || d <= st.training.end));
    const before = { trades: liveTradeCount(st), events: st.learning.events.length };
    return { st, data, nl, prep, dates, pos: 0, before, nowMs };
  }

  /** Process up to n more days. Returns how many days are left. */
  function stepDays(ctx, n) {
    const { st, data, nl, prep, dates } = ctx;
    const cap = st.cfg.closedCap || 1500, B = brainParams(st);
    ctx.allowed = allowedStrategies(B);
    for (const sym in prep) { const T = st.tickers[sym]; [T.live, T.sim, ...Object.values(T.shadows)].forEach((t) => { t.join = !!B.join; }); }
    const end = Math.min(dates.length, ctx.pos + n);
    for (; ctx.pos < end; ctx.pos++) {
      const d = dates[ctx.pos];
      for (const sym in prep) {
        const P = prep[sym], i = P.idx[d]; if (i === undefined || i < P.ready) continue;
        const T = st.tickers[sym], R = P.raw, feat = P.feats[i], a = P.atr[i];
        const dv = data[sym].divs[d];
        // dividends: credited on ex-date to whoever held overnight
        if (dv) [T.live, T.sim, ...Object.values(T.shadows)].forEach((t) => { if (t.qty > 0) t.cash += t.qty * dv; });
        const tg = {};
        for (const k in T.shadows) { tg[k] = resolve(T.lt[k] || 0, P.targets[k], i); T.lt[k] = tg[k]; }
        for (const k in T.shadows) {
          const cl = onBar(T.shadows[k], d, R.o[i], R.h[i], R.l[i], R.c[i], tg[k], a, true, feat, k);
          if (cl && ctx.allowed.includes(k)) { st.learning.closed.push({ sym, s: k, e: cl.e, x: cl.x, ret: cl.ret, f: cl.f, r: cl.r, bars: cl.bars });
            if (st.learning.closed.length > cap) st.learning.closed.shift(); }
          if (cl) memoryOutcome(st, sym, cl);
        }
        if (++T.sinceReview >= B.reviewEvery) { T.sinceReview = 0; review(st, sym, T, d); }
        const pm = d >= st.paperStart ? pauseOn(st, d) : null;
        // quick mode: any quick strategy that has been making money on this stock may trigger an entry
        const qfire = B.quick && T.quickSet && T.quickSet.length ? T.quickSet.find((k) => tg[k] === 1) : null;
        // idle money: with no trusted strategy, either sit in cash or ride the stock while it AND the Nifty are in uptrends
        if (B.beat && T.active) T.active = null; // Beat the Nifty: old strategies stop deciding at once, not at their next review
        const idleOn = !B.quick && !T.active && (B.idle === 'trend' ? !feat.market_down && tg.trend_hold === 1
          : B.idle === 'core' ? !(feat.market_down && feat.below_200) : B.idle === 'market' ? !feat.market_down
          : B.idle === 'crash' ? !(T.crashOff = feat.market_gap < -B.crashGap ? true : feat.market_gap > 0 ? false : !!T.crashOff) : false);
        const tgt = T.removing || pm === 'stop' ? 0 : B.quick ? (qfire ? 1 : 0) : T.active ? tg[T.active] : idleOn ? 1 : 0;
        const why = qfire || T.active || (idleOn ? (B.idle === 'trend' ? 'trend_hold' : 'hold') : null);
        const blk = B.beat ? [] : blocked(st, feat), mem = tgt === 1 && !B.beat ? memBlock(st, sym, why, feat) : null;
        const allow = blk.length === 0 && !mem && !pm && !T.removing;
        if (d >= st.warmStart && d < st.paperStart) {
          if (mem && T.sim.qty === 0 && T.sim.armed && !T.sim.pending) mem.blocked = (mem.blocked || 0) + 1;
          noteMistake(st, sym, onBar(T.sim, d, R.o[i], R.h[i], R.l[i], R.c[i], tgt, a, allow, feat, why), d);
        }
        if (d >= st.paperStart) {
          const had = T.live.pending, ready = T.live.qty === 0 && T.live.armed && !had;
          if (mem && ready) mem.blocked = (mem.blocked || 0) + 1;
          noteMistake(st, sym, onBar(T.live, d, R.o[i], R.h[i], R.l[i], R.c[i], tgt, a, allow, feat, why), d);
          if ((blk.length || mem) && !pm && tgt === 1 && ready)
            T.blockedToday = { d, rules: blk, mem: mem ? mem.id : null };
        }
        T.lastClose = R.c[i]; T.lastDate = d;
        T.spark.d.push(d); T.spark.c.push(R.c[i]);
        if (T.spark.d.length > 260) { T.spark.d.shift(); T.spark.c.shift(); }
      }
      updateRules(st, d);
      for (const sym in st.tickers) {
        const T = st.tickers[sym];
        if (T.removing && T.live.qty === 0 && !T.live.pending) { finishRemove(st, sym, d); delete prep[sym]; }
      }
      const nn = nl(d), tot = (k) => Object.values(st.tickers).reduce((s, T) => s + equity(T[k], T.lastClose || 0), 0);
      if (d >= st.warmStart && d < st.paperStart) st.sim.push([d, Math.round(tot('sim')), nn ? nn.c : null]);
      if (d >= st.paperStart) st.equity.push([d, Math.round(tot('live')), nn ? nn.c : null, Math.round(st.invested - st.withdrawn)]);
      st.lastDate = d;
    }
    return dates.length - ctx.pos;
  }

  /** Run instantly up to (not including) `date` – used to skip the warm-up before a training period. */
  function skipTo(ctx, date) {
    let n = 0; while (ctx.pos + n < ctx.dates.length && ctx.dates[ctx.pos + n] < date) n++;
    stepDays(ctx, n);
  }
  const daysLeft = (ctx) => ctx.dates.length - ctx.pos;

  function finish(ctx) {
    const st = ctx.st;
    st.lastFetch = ctx.nowMs || Date.now();
    delete st._now;
    return { days: ctx.pos, newTrades: liveTradeCount(st) - ctx.before.trades,
      newEvents: st.learning.events.slice(ctx.before.events) };
  }

  function run(st, data, nifty, nowMs) {
    // a brand-new account: the latest completed session (e.g. yesterday's close) is paper day 1, so its first orders
    // are placed at that close and fill at the next open – instead of waiting for today's close to exist first
    if (!st.training && st.lastDate === null && !st.equity.length && nifty && nifty.bars.d.length) {
      const lastD = nifty.bars.d[nifty.bars.d.length - 1];
      if (lastD < st.paperStart && lastD > st.warmStart) st.paperStart = lastD;
    }
    const ctx = begin(st, data, nifty, nowMs);
    stepDays(ctx, Infinity);
    return finish(ctx);
  }

  // ------------------------------------------------------------------ training on the past
  const tradeKey = (t) => `${t.sym}|${t.s}|${t.e}|${t.x}`;
  /**
   * A throw-away account that paper trades a past period [start, end].
   * lessons: earlier closed trades to start with (only ones that ended before `start`, so no peeking ahead).
   */
  function newTraining(cfg, start, end, lessons, mistakes) {
    const st = newState({ ...cfg, warmYears: 0, closedCap: 8000 }, start);
    st.training = { start, end };
    st.learning.trained = (lessons || []).filter((t) => t.x && t.x < start);
    st.learning.mistakes = (mistakes || []).filter((m) => !m.forgiven && m.date < start)
      .map((m) => ({ ...m, keys: m.keys.slice(), avoided: 0, saved: 0, missed: 0, missedGain: 0, blocked: 0, inherited: true }));
    return st;
  }
  /** Copy a training run's noted mistakes into the live brain (they are all in the past, so no peeking). */
  function mergeMistakes(st, list, today, label) {
    const M = st.learning.mistakes = st.learning.mistakes || [], ids = new Set(M.map((m) => m.id));
    let added = 0;
    for (const m of list || []) if (!m.forgiven && !ids.has(m.id)) { M.push({ ...m, keys: m.keys.slice(), avoided: 0, saved: 0, missed: 0, missedGain: 0, blocked: 0, from: label }); ids.add(m.id); added++; }
    if (M.length > 300) M.splice(0, M.length - 300);
    return added;
  }
  /** Lessons a training run could start with: everything known that ended before `start`. */
  function lessonsBefore(st, start) {
    return [...(st.learning.trained || []), ...st.learning.closed].filter((t) => t.x && t.x < start);
  }
  /** Copy what a training run experienced into the live brain's evidence pool and re-check the rules. */
  /** What teaching would change, without changing anything. */
  function previewTeach(st, tr, today) {
    const copy = migrate(JSON.parse(JSON.stringify(st)));
    return teach(copy, tr, today, 'preview');
  }
  /** Add past trades to the brain's evidence pool (deduplicated) and re-check the rules. */
  function addEvidence(st, trades, today, text, src) {
    migrate(st);
    const pool = st.learning.trained = st.learning.trained || [];
    const seen = new Set(pool.map(tradeKey)), before = Object.keys(FEATURES).filter((k) => st.learning.rules[k]?.active);
    let added = 0;
    for (const t of trades) { const k = tradeKey(t); if (!seen.has(k)) { pool.push({ ...t, src }); seen.add(k); added++; } }
    pool.sort((x, y) => x.x.localeCompare(y.x));
    if (pool.length > 6000) pool.splice(0, pool.length - 6000);
    if (text) logEvent(st, today, text.replace('{n}', added), 'learn');
    updateRules(st, today);
    const after = Object.keys(FEATURES).filter((k) => st.learning.rules[k]?.active);
    return { added, newRules: after.filter((k) => !before.includes(k)), dropped: before.filter((k) => !after.includes(k)) };
  }
  function teach(st, tr, today, label) {
    const r = addEvidence(st, tr.learning.closed, today, `Training ${label}: added {n} past trades to the brain's evidence`, 'train');
    r.mistakes = mergeMistakes(st, tr.learning.mistakes, today, 'training');
    if (r.mistakes) logEvent(st, today, `Training ${label}: remembered ${r.mistakes} mistake${r.mistakes > 1 ? 's' : ''} not to repeat`, 'mistake');
    return r;
  }

  // ------------------------------------------------------------------ import a downloaded brain
  /** Keep only well-formed evidence trades from an imported file (never trust file contents blindly). */
  function cleanTrades(list) {
    if (!Array.isArray(list)) return [];
    const d = /^\d{4}-\d{2}-\d{2}$/;
    return list.filter((t) => t && typeof t === 'object' && d.test(t.e) && d.test(t.x) && Number.isFinite(+t.ret) && STRATEGIES[t.s])
      .slice(-8000).map((t) => ({ sym: String(t.sym || '').slice(0, 30), s: t.s, e: t.e, x: t.x, ret: +t.ret, r: ['signal', 'stop', 'target', 'time'].includes(t.r) ? t.r : 'signal',
        bars: Number.isFinite(+t.bars) ? +t.bars : 0, f: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, !!(t.f && t.f[k])])) }));
  }
  /** Read a brain file (from "Brain data" download). Returns what it contains, or { error }. */
  function readBrain(obj) {
    if (!obj || typeof obj !== 'object') return { error: 'Not a JSON file from Moli' };
    if (obj.state && obj.state.cfg && obj.state.tickers) return { kind: 'backup', exported: obj.exported_at, state: obj.state };
    if (!obj.evidence && !obj.settings) return { error: 'This file has no brain data in it' };
    const ev = [...cleanTrades(obj.evidence && obj.evidence.lived), ...cleanTrades(obj.evidence && obj.evidence.from_training)];
    let settings = null;
    if (obj.settings && typeof obj.settings === 'object') {
      const S = obj.settings, n = {};
      for (const k in SPACE) if (SPACE[k].includes(S[k])) n[k] = S[k];
      if (Number.isFinite(+S.stopAtr) && +S.stopAtr >= 0 && +S.stopAtr <= 10) n.stopAtr = +S.stopAtr;
      if (Array.isArray(S.strategies)) n.strategies = S.strategies.filter((k) => STRATEGIES[k]);
      settings = normParams(n);
    }
    const trainings = Array.isArray(obj.trainings) ? obj.trainings.filter((x) => x && x.id && x.start && x.end).slice(-30) : [];
    const d = /^\d{4}-\d{2}-\d{2}$/;
    const mistakes = Array.isArray(obj.mistakes) ? obj.mistakes.filter((m) => m && typeof m.sym === 'string' && STRATEGIES[m.s] && Array.isArray(m.keys) && m.keys.length && m.keys.every((k) => FEATURES[k]) && d.test(m.date))
      .slice(-300).map((m) => ({ id: `${m.sym}|${m.s}|${m.keys.join('+')}`, sym: m.sym.slice(0, 30), s: m.s, keys: m.keys.slice(), date: m.date, entry: d.test(m.entry) ? m.entry : m.date, ret: +m.ret || 0, pnl: +m.pnl || 0, reason: String(m.reason || ''), count: +m.count || 1, avoided: 0, saved: 0, missed: 0, missedGain: 0, forgiven: !!m.forgiven })) : [];
    return { kind: 'brain', exported: obj.exported_at, settings, evidence: ev, trainings, mistakes,
      rules: obj.rules && typeof obj.rules === 'object' ? Object.keys(FEATURES).filter((k) => obj.rules[k] && obj.rules[k].active) : [] };
  }
  /** Apply an imported brain: its settings and/or its evidence. */
  function importBrain(st, b, { settings = true, evidence = true } = {}, today, nowIso) {
    const out = { changes: [], added: 0, newRules: [], dropped: [] };
    if (settings && b.settings) out.changes = applyParams(st, b.settings, today, nowIso);
    if (evidence && b.evidence.length) Object.assign(out, addEvidence(st, b.evidence, today, `Imported brain: added {n} trades to the evidence`, 'import'));
    if (evidence && b.mistakes && b.mistakes.length) out.mistakes = mergeMistakes(st, b.mistakes, today, 'import');
    if (b.trainings.length) { const ids = new Set(st.trainings.map((x) => x.id)); b.trainings.forEach((x) => { if (!ids.has(x.id)) st.trainings.push({ ...x, imported: true }); }); st.trainings.sort((x, y) => String(x.at).localeCompare(String(y.at))); st.trainings.splice(0, Math.max(0, st.trainings.length - 30)); }
    logEvent(st, today, `You imported brain data${b.exported ? ` exported ${b.exported}` : ''}`, 'user', nowIso);
    return out;
  }
  function previewImport(st, b, opts, today) {
    const copy = migrate(JSON.parse(JSON.stringify(st)));
    return importBrain(copy, b, opts, today, 'preview');
  }

  function liveTradeCount(st) { // entries + exits so far
    return Object.values(st.tickers).reduce((s, T) => s + T.live.trades.length + T.live.trades.filter((t) => t.x).length, 0);
  }

  /** A stock added later: let its shadow strategies and the brain catch up on past data first. */
  function preRoll(st, sym, P, D) {
    const T = st.tickers[sym], R = P.raw, B = brainParams(st);
    for (let i = P.ready; i < R.d.length && R.d[i] <= st.lastDate; i++) {
      const d = R.d[i], feat = P.feats[i], a = P.atr[i], dv = D.divs[d];
      if (dv) Object.values(T.shadows).forEach((t) => { if (t.qty > 0) t.cash += t.qty * dv; });
      for (const k in T.shadows) {
        const tg = resolve(T.lt[k] || 0, P.targets[k], i); T.lt[k] = tg;
        const cl = onBar(T.shadows[k], d, R.o[i], R.h[i], R.l[i], R.c[i], tg, a, true, feat, k);
        if (cl && allowedStrategies(B).includes(k)) st.learning.closed.push({ sym, s: k, e: cl.e, x: cl.x, ret: cl.ret, f: cl.f, r: cl.r, bars: cl.bars });
      }
      if (++T.sinceReview >= B.reviewEvery) { T.sinceReview = 0; review(st, sym, T, d); }
      T.lastClose = R.c[i];
      T.spark.d.push(d); T.spark.c.push(R.c[i]);
      if (T.spark.d.length > 260) { T.spark.d.shift(); T.spark.c.shift(); }
    }
    review(st, sym, T, st.lastDate); T.sinceReview = 0;
  }

  // ------------------------------------------------------------------ repeat training (parameter search)
  const ALL = Object.keys(STRATEGIES);
  const SPACE = {
    stopAtr: [0, 2, 3, 4, 5],
    minScore: [0, 0.2, 0.3, 0.5, 0.8],
    reviewEvery: [10, 21, 42, 63],
    scoreWindow: [126, 250],
    useRules: [true, false],
    ruleMargin: [0.5, 1, 2],
    quick: [false, true],
    tpAtr: [0, 1, 1.5, 2, 3],
    maxDays: [0, 5, 10, 20],
    quickEdge: [0, 0.1, 0.3, 0.6],
    useMemory: [true, false],
    idle: ['cash', 'trend', 'core'],
    crashGap: [5, 8, 12, 100],
    join: [false, true],
  };
  const PARAM_LABELS = {
    stopAtr: (v) => (v ? `stop-loss ${v}× ATR` : 'no stop-loss'),
    minScore: (v) => `trust a strategy at Sharpe ≥ ${v}`,
    reviewEvery: (v) => `review strategies every ${v} sessions`,
    scoreWindow: (v) => `judge strategies on the last ${v === 250 ? 'year' : '6 months'}`,
    useRules: (v) => (v ? 'use learned rules' : 'ignore learned rules'),
    ruleMargin: (v) => `rule strictness ${v === 0.5 ? 'high' : v === 1 ? 'normal' : 'low'}`,
    quick: (v) => (v ? 'quick trading (short swings)' : 'normal trading (ride trends)'),
    tpAtr: (v) => (v ? `take profit at +${v}× ATR` : 'no profit target'),
    maxDays: (v) => (v ? `sell after ${v} sessions at most` : 'no time limit'),
    quickEdge: (v) => `quick: use strategies averaging > +${v}% a trade`,
    useMemory: (v) => (v ? 'never repeat a noted mistake' : 'no mistake memory'),
    idle: (v) => (v === 'trend' ? 'idle money rides uptrends' : v === 'core' ? 'idle money stays invested unless the stock and the market both turn down' : v === 'market' ? 'idle money stays invested while the Nifty is above its 200-day average' : 'idle money stays in cash'),
    join: (v) => (v ? 'join trends already under way' : 'wait for a fresh signal'),
    crashGap: (v) => (v >= 100 ? 'never sell for a market fall' : `step aside when the Nifty is ${v}% below its 200-day average`),
    beat: (v) => (v ? 'Beat the Nifty: stay invested' : 'pick strategies per stock'),
    strategies: (v) => {
      if (!v) return 'use all strategies of that style';
      const pool = STRATEGIES[v[0]].quick ? QUICK : NORMAL;
      if (v.length >= pool.length) return 'use all strategies of that style';
      const off = pool.filter((k) => !v.includes(k));
      return off.length <= v.length ? `don't use ${off.map((k) => STRATEGIES[k].label).join(', ')}` : `only use ${v.map((k) => STRATEGIES[k].label).join(', ')}`;
    },
  };
  const normParams = (p) => {
    const n = { ...BRAIN_DEFAULTS, stopAtr: 3, ...p };
    n.quick = !!n.quick;
    const pool = n.quick ? QUICK : NORMAL;
    n.strategies = n.strategies ? pool.filter((k) => n.strategies.includes(k)) : null;
    if (n.strategies && (n.strategies.length < 1 || n.strategies.length >= pool.length)) n.strategies = null;
    return n;
  };
  const paramKey = (p) => JSON.stringify(normParams(p));
  function describeParams(p, base) {
    const n = normParams(p), b = base ? normParams(base) : null;
    return Object.keys(PARAM_LABELS).filter((k) => !b || JSON.stringify(n[k]) !== JSON.stringify(b[k])).map((k) => PARAM_LABELS[k](n[k]));
  }
  function neighbours(p) {
    const n = normParams(p), out = [];
    for (const k in SPACE) for (const v of SPACE[k]) if (v !== n[k]) out.push({ ...n, [k]: v });
    const pool = n.quick ? QUICK : NORMAL, on = (n.strategies || pool).filter((k) => pool.includes(k));
    for (const k of pool) {
      const next = on.includes(k) ? on.filter((x) => x !== k) : [...on, k];
      if (next.length >= 2) out.push({ ...n, strategies: next.length === pool.length ? null : next });
    }
    return out.map(normParams);
  }
  /** Hill-climbing search: change one setting at a time from the best so far; stop when nothing helps. */
  function makeOptimizer(start, { maxRounds = 30, patience = 10, seed = 7 } = {}) {
    let r = seed >>> 0;
    const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    const o = { best: normParams(start), bestScore: -Infinity, tried: new Map(), rounds: 0, stale: 0, done: false, history: [], maxRounds };
    o.next = () => {
      if (o.done || o.rounds >= maxRounds || o.stale >= patience) { o.done = true; return null; }
      if (!o.tried.has(paramKey(o.best))) return o.best;
      const cand = neighbours(o.best).filter((p) => !o.tried.has(paramKey(p)));
      if (!cand.length) { o.done = true; o.local = true; return null; }
      return cand[Math.floor(rand() * cand.length)];
    };
    o.report = (p, score, extra) => {
      o.rounds++; o.tried.set(paramKey(p), score);
      const better = score > o.bestScore + 1e-9;
      if (better) { o.best = normParams(p); o.bestScore = score; o.stale = 0; } else o.stale++;
      o.history.push({ round: o.rounds, params: normParams(p), score, better, ...(extra || {}) });
      return better;
    };
    return o;
  }
  // Evolution: a population of very different settings; the fittest survive, mix and mutate.
  const lcg = (seed) => { let r = seed >>> 0; return () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const pickOf = (arr, rand) => arr[Math.floor(rand() * arr.length)];
  function randomParams(rand) {
    const p = {};
    for (const k in SPACE) p[k] = pickOf(SPACE[k], rand);
    const pool = p.quick ? QUICK : NORMAL;
    let on = pool.filter(() => rand() < 0.7);
    while (on.length < 2) on = [...new Set([...on, pickOf(pool, rand)])];
    p.strategies = on;
    return normParams(p);
  }
  function crossover(a, b, rand) {
    const A = normParams(a), B = normParams(b), c = {};
    for (const k in SPACE) c[k] = rand() < 0.5 ? A[k] : B[k];
    const pool = c.quick ? QUICK : NORMAL, sa = A.strategies || pool, sb = B.strategies || pool;
    let on = pool.filter((k) => (rand() < 0.5 ? sa : sb).includes(k));
    while (on.length < 2) on = [...new Set([...on, pickOf(pool, rand)])];
    c.strategies = on;
    return normParams(c);
  }
  function makeEvolver(start, { maxRounds = 32, popSize = 8, seed = 11 } = {}) {
    const rand = lcg(seed), generations = Math.max(2, Math.round(maxRounds / popSize));
    const o = { best: normParams(start), bestScore: -Infinity, tried: new Map(), rounds: 0, stale: 0, done: false, history: [],
      maxRounds: generations * popSize, gen: 1, generations, queue: [] };
    const seen = new Set();
    const push = (p) => { const k = paramKey(p); if (!seen.has(k) && !o.tried.has(k)) { seen.add(k); o.queue.push(p); } };
    push(o.best);
    for (let i = 0; o.queue.length < popSize && i < 200; i++) push(randomParams(rand));
    o.next = () => {
      if (o.done) return null;
      if (!o.queue.length) {
        if (o.gen >= generations) { o.done = true; return null; }
        o.gen++;
        const ranked = [...o.tried.entries()].sort((x, y) => y[1] - x[1]).slice(0, Math.max(3, popSize / 2)).map(([k]) => JSON.parse(k));
        for (let i = 0; o.queue.length < popSize && i < 400; i++) {
          let child = crossover(pickOf(ranked, rand), pickOf(ranked, rand), rand);
          if (rand() < 0.6) child = pickOf(neighbours(child), rand);
          push(child);
        }
        if (!o.queue.length) { o.done = true; return null; }
      }
      return o.queue.shift();
    };
    o.report = (p, score, extra) => {
      o.rounds++; o.tried.set(paramKey(p), score);
      const better = score > o.bestScore + 1e-9;
      if (better) { o.best = normParams(p); o.bestScore = score; o.stale = 0; } else o.stale++;
      o.history.push({ round: o.rounds, gen: o.gen, params: normParams(p), score, better, ...(extra || {}) });
      return better;
    };
    return o;
  }

  /** Run one training account with given settings over [start, end]; price data and indicators are reused. */
  function evaluate(cfg, params, data, nifty, start, end, lessons, mistakes) {
    const n = normParams(params);
    const st = newTraining({ ...cfg, stopAtr: n.stopAtr, brain: { ...n } }, start, end, lessons, mistakes);
    const ctx = begin(st, data, nifty, 0); stepDays(ctx, Infinity); finish(ctx);
    return st;
  }
  /** Return % and worst drop % of a training account between two dates (no cash flows in training). */
  function periodStats(st, from, to) {
    const rows = st.equity.filter((r) => r[0] >= from && (!to || r[0] <= to));
    if (rows.length < 2) return { ret: 0, dd: 0, days: rows.length, nifty: null };
    let pk = -Infinity, dd = 0; rows.forEach((r) => { pk = Math.max(pk, r[1]); dd = Math.min(dd, r[1] / pk - 1); });
    const nf = rows.filter((r) => r[2]);
    return { ret: (rows[rows.length - 1][1] / rows[0][1] - 1) * 100, dd: dd * 100, days: rows.length,
      nifty: nf.length > 1 ? (nf[nf.length - 1][2] / nf[0][2] - 1) * 100 : null };
  }
  /** Apply tuned settings to the live account (new entries use the new stop-loss; open stops stay as they are). */
  function applyParams(st, params, today, nowIso) {
    const n = normParams(params), before = brainParams(st);
    st.cfg.brain = { reviewEvery: n.reviewEvery, minScore: n.minScore, scoreWindow: n.scoreWindow, useRules: n.useRules, ruleMargin: n.ruleMargin, strategies: n.strategies,
      quick: n.quick, tpAtr: n.tpAtr, maxDays: n.maxDays, quickEdge: n.quickEdge, useMemory: n.useMemory, idle: n.idle, join: n.join, crashGap: n.crashGap, beat: n.beat };
    st.cfg.stopAtr = n.stopAtr;
    Object.values(st.tickers).forEach((T) => { [T.live, T.sim, ...Object.values(T.shadows)].forEach((t) => { t.stopAtr = n.stopAtr; t.tpAtr = n.tpAtr; t.maxDays = n.maxDays; }); });
    // switching style: the brain must pick a strategy of the new style at the next review
    if (before.quick !== n.quick) Object.values(st.tickers).forEach((T) => { T.active = null; T.quickSet = []; T.sinceReview = n.reviewEvery; });
    const ch = describeParams(n, before);
    logEvent(st, today, ch.length ? `New brain settings: ${ch.join('; ')}` : 'Brain settings unchanged', 'learn', nowIso);
    return ch;
  }

  // ------------------------------------------------------------------ momentum rotation (portfolio level)
  // Every month: rank a wide universe by 12-month return (skipping the last month), hold the top N,
  // weight them by inverse volatility, scale exposure with the Nifty's trend (100% / 50% / 0%), and
  // keep holdings that are still near the top (less churn). Indian costs, dividends, splits and
  // capital-gains tax (STCG 20%, LTCG 12.5% above ₹1.25 lakh a year) are all applied.
  const NIFTY50 = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'ITC', 'LT', 'SBIN', 'BHARTIARTL', 'KOTAKBANK', 'AXISBANK', 'HINDUNILVR', 'BAJFINANCE', 'MARUTI', 'SUNPHARMA', 'M&M',
    'HCLTECH', 'NTPC', 'TITAN', 'ULTRACEMCO', 'ASIANPAINT', 'POWERGRID', 'ONGC', 'ADANIENT', 'ADANIPORTS', 'NESTLEIND', 'JSWSTEEL', 'TATASTEEL', 'BAJAJFINSV', 'WIPRO', 'COALINDIA', 'GRASIM',
    'TECHM', 'HINDALCO', 'CIPLA', 'DRREDDY', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO', 'BRITANNIA', 'APOLLOHOSP', 'SBILIFE', 'HDFCLIFE', 'TATACONSUM', 'INDUSINDBK', 'SHRIRAMFIN', 'BEL', 'TRENT'].map((x) => x + '.NS');
  // for training on the past: today's Nifty 50 plus former members, including ones that later collapsed – the
  // liquidity filter (top 50 by traded value at each rebalance) then stands in for "was in the Nifty back then"
  const ROT_UNIVERSE = [...NIFTY50, ...['BPCL', 'UPL', 'DIVISLAB', 'YESBANK', 'ZEEL', 'VEDL', 'IOC', 'GAIL', 'BHEL', 'IDEA', 'DLF', 'ACC', 'AMBUJACEM', 'PNB', 'BANKBARODA', 'LUPIN', 'AUROPHARMA', 'SAIL',
    'TATAPOWER', 'RCOM', 'RELINFRA', 'SIEMENS', 'IDFCFIRSTB', 'SUZLON', 'UNITECH', 'SAMMAANCAP', 'RPOWER', 'ABB', 'NMDC', 'CANBK', 'HINDPETRO', 'TATACOMM',
    'BOSCHLTD', 'GLAXO', 'JINDALSTEL', 'NATIONALUM', 'SHREECEM', 'INDUSTOWER', 'UNITDSPR', 'ETERNAL', 'JIOFIN', 'TMPV'].map((x) => x + '.NS')];
  // Nifty 50 membership month by month, Jan 2008 – Aug 2025: [from, until) per stock. Reconstructed from NSE
  // press releases by github.com/vishalvx/nifty-indices-datasets (MIT); approximate – some dates are a month off.
  // After Aug 2025 the current list is used. Lets backtests pick only from stocks that were in the index at the time.
  const NIFTY50_HIST = {"ABB.NS":[["2008-01-31","2010-10-01"]],"ACC.NS":[["2008-01-31","2017-10-03"]],"ADANIENT.NS":[["2022-09-30",null]],"ADANIPORTS.NS":[["2015-09-28",null]],"AMBUJACEM.NS":[["2008-01-31","2018-04-01"]],"APOLLOHOSP.NS":[["2022-03-31",null]],"ASIANPAINT.NS":[["2012-04-01",null]],"AUROPHARMA.NS":[["2016-04-01","2018-04-01"]],"AXISBANK.NS":[["2009-04-01",null]],"BAJAJ-AUTO.NS":[["2008-01-31","2008-04-01"],["2010-10-01",null]],"BAJAJFINSV.NS":[["2018-04-01",null]],"BAJFINANCE.NS":[["2017-10-03",null]],"BANKBARODA.NS":[["2012-04-01","2017-10-03"]],"BEL.NS":[["2024-10-01",null]],"BHARTIARTL.NS":[["2008-01-31",null]],"BHEL.NS":[["2008-01-31","2017-04-01"]],"BOSCHLTD.NS":[["2015-05-29","2018-04-01"]],"BPCL.NS":[["2008-01-31","2025-04-01"]],"BRITANNIA.NS":[["2019-04-01","2025-04-01"]],"CAIRN.NS":[["2008-01-31","2016-04-01"]],"CIPLA.NS":[["2008-01-31",null]],"COALINDIA.NS":[["2011-10-01",null]],"DIVISLAB.NS":[["2020-09-25","2024-10-01"]],"DLF.NS":[["2008-04-01","2015-03-27"]],"DRREDDY.NS":[["2008-01-31","2008-10-01"],["2010-10-01",null]],"EICHERMOT.NS":[["2016-04-01",null]],"ETERNAL.NS":[["2025-04-01",null]],"GAIL.NS":[["2008-01-31","2021-03-31"]],"GLAXO.NS":[["2008-01-31","2008-04-01"]],"GRASIM.NS":[["2008-01-31","2010-04-01"],["2011-03-28","2017-05-29"],["2018-04-01",null]],"HCLTECH.NS":[["2008-01-31",null]],"HDFC.NS":[["2008-01-31","2023-07-01"]],"HDFCBANK.NS":[["2008-01-31",null]],"HDFCLIFE.NS":[["2020-07-31",null]],"HEROMOTOCO.NS":[["2008-01-31",null]],"HINDALCO.NS":[["2008-01-31",null]],"HINDPETRO.NS":[["2017-10-03","2019-04-01"]],"HINDUNILVR.NS":[["2008-01-31",null]],"SAMMAANCAP.NS":[["2017-04-01","2019-08-27"]],"ICICIBANK.NS":[["2008-01-31",null]],"IDEA.NS":[["2008-01-31","2010-10-01"],["2015-03-27","2017-04-01"]],"IDFC.NS":[["2009-10-01","2015-05-29"]],"INDUSINDBK.NS":[["2013-04-01",null]],"INDUSTOWER.NS":[["2016-04-01","2020-09-25"]],"INFY.NS":[["2008-01-31",null]],"IOC.NS":[["2017-04-01","2022-03-31"]],"ITC.NS":[["2008-01-31",null]],"JINDALSTEL.NS":[["2009-06-17","2015-03-27"]],"JIOFIN.NS":[["2025-04-01",null]],"JPASSOCIAT.NS":[["2009-10-01","2014-03-28"]],"JSWSTEEL.NS":[["2018-10-01",null]],"KOTAKBANK.NS":[["2010-04-01",null]],"LT.NS":[["2008-01-31",null]],"LTIM.NS":[["2023-07-01","2024-10-01"]],"LUPIN.NS":[["2012-10-01","2018-10-01"]],"M&M.NS":[["2008-01-31",null]],"MARUTI.NS":[["2008-01-31",null]],"UNITDSPR.NS":[["2014-03-28","2014-09-26"]],"NATIONALUM.NS":[["2008-01-31","2009-10-01"]],"NESTLEIND.NS":[["2019-08-27",null]],"NMDC.NS":[["2013-04-01","2015-09-28"]],"NTPC.NS":[["2008-01-31",null]],"ONGC.NS":[["2008-01-31",null]],"PNB.NS":[["2008-01-31","2016-04-01"]],"POWERGRID.NS":[["2008-04-01",null]],"RANBAXY.NS":[["2008-01-31","2014-03-28"]],"RCOM.NS":[["2008-01-31","2012-04-01"]],"RELCAPITAL.NS":[["2009-01-12","2011-10-01"]],"RELIANCE.NS":[["2008-01-31",null]],"RELINFRA.NS":[["2008-01-31","2013-10-04"]],"RPL.NS":[["2008-01-31","2009-06-17"]],"RPOWER.NS":[["2008-10-01","2012-04-01"]],"SAIL.NS":[["2008-01-31","2012-10-01"]],"SATYAMCOMP.NS":[["2008-01-31","2009-01-12"]],"SBILIFE.NS":[["2020-09-25",null]],"SBIN.NS":[["2008-01-31",null]],"VEDL.NS":[["2010-10-01","2013-10-04"],["2013-10-04","2016-04-01"],["2017-05-29","2020-07-31"]],"SHREECEM.NS":[["2020-03-19","2022-09-30"]],"SHRIRAMFIN.NS":[["2024-03-28",null]],"SIEMENS.NS":[["2008-01-31","2013-04-01"]],"STER.NS":[["2008-01-31","2012-10-01"]],"SUNPHARMA.NS":[["2008-01-31",null]],"SUZLON.NS":[["2008-01-31","2011-03-28"]],"TATACOMM.NS":[["2008-01-31","2008-04-01"],["2008-04-01","2009-10-01"]],"TATACONSUM.NS":[["2021-03-31",null]],"TMPV.NS":[["2008-01-31",null]],"TATAPOWER.NS":[["2008-01-31","2017-10-03"]],"TATASTEEL.NS":[["2008-01-31",null]],"TCS.NS":[["2008-01-31",null]],"TECHM.NS":[["2014-03-28",null]],"TITAN.NS":[["2018-04-01",null]],"TRENT.NS":[["2024-10-01",null]],"ULTRACEMCO.NS":[["2012-10-01",null]],"UNITECH.NS":[["2008-01-31","2010-10-01"]],"UPL.NS":[["2017-10-03","2024-03-28"]],"WIPRO.NS":[["2008-01-31","2013-04-01"],["2013-10-04",null]],"YESBANK.NS":[["2015-03-27","2020-03-19"]],"ZEEL.NS":[["2008-01-31","2009-04-01"],["2014-09-26","2020-09-25"]]};
  const NIFTY50_HIST_END = '2025-08-31';
  function inNifty50(sym, d) {
    if (d > NIFTY50_HIST_END) return NIFTY50.includes(sym);
    const R = NIFTY50_HIST[sym]; if (!R) return false;
    return R.some(([a, b]) => (d >= a || a === '2008-01-31') && (b === null || d < b));
  }
  // Monthly returns 2010–2026 from the honest backtests (real Nifty 50 membership, costs, tax): momentum top 10,
  // every member held equally (≈ Beat the Nifty), and NIFTYBEES (the Nifty with dividends).
  const MC_SERIES = {"from":"2010-02","to":"2026-10","momentum":[0.0339,0.0569,-0.0109,-0.0573,0.0021,0.0472,0.0169,0.1165,0.0381,0.0101,0.0399,-0.0702,-0.0518,0.0234,0.0194,-0.0361,0,0,0,0,0,0,0,0,0.0252,0.023,0.0006,-0.0448,0.0324,-0.0019,0.0295,0.0655,-0.0104,0.0401,0.0008,-0.0047,-0.0112,0.0297,0.0546,0.0355,-0.0214,0.0209,-0.0426,-0.006,0.0667,-0.0257,0.0334,0.0152,0.0689,-0.0605,0.0095,-0.0156,0.0872,-0.0055,0.0491,-0.0073,0.0409,0.0354,-0.0237,0.0628,-0.0262,-0.0209,-0.0564,0.0427,-0.0016,0.0384,-0.0726,0,0,0,0,0,0,0,-0.0316,0.0334,0.0207,0.0464,0.0402,-0.0215,-0.0059,-0.0527,-0.0308,0.1143,0.0142,0.023,0.0434,0.0081,-0.0254,0.0986,0.0466,-0.0061,0.0275,-0.03,0.0522,0.0252,-0.0401,-0.0368,0.0731,-0.0172,-0.0015,0.0934,0.0212,-0.08,-0.057,0.0048,-0.0151,0.0261,0.0122,0.0477,0.0356,0.0178,-0.0044,-0.0593,0.0012,0.0344,0.0122,-0.0055,0.0221,-0.0097,-0.0121,-0.0304,-0.0067,0,0,0.02,-0.0147,0.0401,0.0018,0.033,0.0937,-0.0475,0.0006,0.054,0.0534,0.0534,0.0238,0.051,0.0374,0.025,0.0428,-0.0577,0.0371,-0.0204,-0.0108,-0.0316,-0.0876,-0.0525,0,0,0.0582,-0.0251,0.0693,0.0041,-0.0342,-0.0116,-0.0367,0.0021,0.0461,0.0499,0.0626,0.0248,-0.003,0.045,-0.0251,0.0774,0.1067,0.0348,0.0102,0.04,-0.0048,0.0062,0.0489,0.0784,0.0218,0.0242,-0.1286,-0.0567,-0.0496,-0.0173,-0.0765,0,-0.0183,0.0346,0.0567,-0.0502,0.0014,0.0383,0.0258,0.0084,0.0059,-0.0353,0.0311,-0.0443,-0.0092,0,0,0,0,0,0],"equal":[0.0087,0.0595,0.0043,-0.0417,0.0509,0.0113,0.0111,0.1117,-0.0029,-0.027,0.0441,-0.0919,-0.0552,0.1005,-0.0061,-0.0535,0.0272,-0.0128,-0.0807,-0.0121,0.0816,-0.0885,-0.0488,0.1504,0.0534,-0.0225,-0.0108,-0.0618,0.0739,-0.016,-0.007,0.0967,-0.0264,0.0441,0.0203,0.0141,-0.0668,-0.0166,0.0541,-0.0029,-0.034,-0.0278,-0.0356,0.0701,0.0945,-0.0115,0.0324,-0.0484,0.0243,0.1093,-0.0101,0.1201,0.0699,-0.0017,0.0288,-0.0005,0.0456,0.026,-0.0312,0.0549,0.0007,-0.0365,-0.0305,0.0323,-0.0175,0.0198,-0.0734,-0.0128,0.0207,-0.0107,0.0017,-0.067,-0.0724,0.1272,0.0298,0.0232,0.0336,0.0499,0.0245,-0.018,0.0068,-0.0341,-0.0195,0.0635,0.0307,0.0231,0.0151,0.0146,-0.0143,0.0582,-0.0012,-0.0044,0.0609,-0.0263,0.0318,0.0179,-0.0425,-0.039,0.0542,-0.0123,-0.0143,0.0451,0.035,-0.0719,-0.0497,0.0222,0.0136,-0.0279,0.0221,0.0665,0.0092,0.0009,-0.0195,-0.0739,-0.0234,0.0451,0.0529,0.0063,0.0003,-0.0233,-0.0781,-0.239,0.1578,0.0122,0.0623,0.0654,0.0554,-0.0222,0.0238,0.1419,0.0798,-0.0022,0.087,0.0212,0.023,0.0675,0.0155,0.0161,0.0649,0.0389,-0.0001,-0.0379,0.0277,0.0053,-0.0256,0.0324,-0.0008,-0.0353,-0.0582,0.1095,0.0405,-0.028,0.0414,0.032,-0.03,-0.0189,-0.0382,0.0082,0.0539,0.0414,0.0445,0.0314,-0.0163,0.0376,-0.0232,0.0778,0.0772,0.0194,0.0235,0.0175,0.0094,0.0052,0.0605,0.0524,0.0167,0.0297,-0.0776,-0.0243,-0.0195,0.0028,-0.0629,0.0639,0.0243,0.0234,0.0383,-0.0308,0.0037,0.0184,0.0432,0.0132,0.0089,-0.0173,0.0107,-0.101,0.0809,-0.0005,-0.0059,0.0386,-0.0097,-0.0615,0.0123],"index":[-0.0079,0.067,-0.0038,-0.0339,0.0522,0.0172,0.0049,0.1046,0.0108,-0.0196,0.0382,-0.1036,-0.0236,0.0789,-0.0082,-0.029,0.0129,-0.011,-0.097,-0.0169,0.0769,-0.0894,-0.042,0.1188,0.0486,-0.0329,-0.0154,-0.0503,0.0707,-0.0113,0.0003,0.0845,-0.0053,0.0467,0.0043,0.0217,-0.0565,-0.0137,0.0431,0.0138,-0.0207,-0.0143,-0.0524,0.0571,0.0922,-0.0184,0.0214,-0.0318,0.0278,0.0561,0.0042,0.0757,0.0565,0.0202,0.0333,0.0013,0.0421,0.0335,-0.0351,0.0668,-0.0031,-0.0463,-0.0329,0.0288,-0.0032,0.0243,-0.0644,-0.0082,0.0207,-0.0187,-0.0004,-0.0507,-0.0707,0.117,0.0049,0.0396,0.0196,0.0454,0.0171,-0.0196,0.0037,-0.0483,-0.0051,0.0448,0.0394,0.0349,0.0124,0.034,-0.0064,0.0597,-0.0123,-0.0113,0.0546,-0.0072,0.0256,0.047,-0.0429,-0.0345,0.0595,0.0007,-0.0006,0.0635,0.0309,-0.0637,-0.0496,0.0464,0.0015,-0.0018,-0.001,0.0672,0.0201,0.0149,-0.0076,-0.054,-0.0082,0.0425,0.0323,0.0161,0.0128,-0.0153,-0.062,-0.2293,0.1331,-0.0269,0.0803,0.0776,0.0255,-0.0091,0.0387,0.1109,0.0773,-0.0199,0.0688,0.0065,-0.001,0.0624,0.014,0.0033,0.0876,0.0301,0.0055,-0.039,0.0223,-0.0009,-0.0309,0.0387,-0.0182,-0.03,-0.046,0.0871,0.0396,-0.0366,0.0505,0.043,-0.0325,-0.0232,-0.0193,0.0008,0.0391,0.0323,0.0341,0.0331,-0.0221,0.0187,-0.0266,0.0528,0.0789,0.0025,0.0124,0.0153,0.0126,0.0044,0.065,0.0384,0.012,0.026,-0.0615,-0.0028,-0.02,-0.0056,-0.0553,0.0594,0.0334,0.022,0.0307,-0.0253,-0.0115,0.0053,0.0489,0.0186,-0.004,-0.0291,-0.005,-0.1116,0.0733,-0.0156,0.0151,0.0206,-0.0092,-0.0596,0.017]};
  /**
   * Block bootstrap: stitch random 12-month stretches of history into `years`-long futures, the SAME stretches for
   * the strategy and the index, and report the 10th/50th/90th percentile of ₹1 → ₹x and how often it beat the index.
   */
  function monteCarlo(key, years = 5, n = 2000, seed = 7) {
    const A = MC_SERIES[key], B = MC_SERIES.index, L = A.length, block = 12, need = years * 12; let r = seed;
    const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
    const fa = [], fb = []; let wins = 0;
    for (let k = 0; k < n; k++) {
      let va = 1, vb = 1, m = 0;
      while (m < need) { const st = Math.floor(rnd() * (L - block)); for (let j = 0; j < block && m < need; j++, m++) { va *= 1 + A[st + j]; vb *= 1 + B[st + j]; } }
      fa.push(va); fb.push(vb); if (va > vb) wins++;
    }
    const pc = (a, q) => a.slice().sort((x, y) => x - y)[Math.floor(q * (a.length - 1))];
    return { years, n, p10: pc(fa, 0.1), p50: pc(fa, 0.5), p90: pc(fa, 0.9), i10: pc(fb, 0.1), i50: pc(fb, 0.5), i90: pc(fb, 0.9), beat: wins / n, from: MC_SERIES.from, to: MC_SERIES.to };
  }
  const ROT_DEFAULTS = { topN: 10, lookback: 252, skip: 21, weight: 'invvol', gradual: false, crashGap: 5, buffer: 2, taxAware: true, riskAdj: false, minHist: 300, liquid: 50, members: true, volTarget: 0 };
  function newRot(capital, cfg = {}) {
    return { cfg: { ...ROT_DEFAULTS, ...cfg }, capital, cash: capital, pos: {}, lastDate: null, start: null, equity: [], trades: [], log: [], pending: null,
      expo: 1, lastMonth: null, tax: { paid: 0, fy: null, st: 0, lt: 0 }, costs: 0, splitsDone: {}, divs: 0, invested: capital };
  }
  const rotFY = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 4 ? y : y - 1; };
  function rotPrep(data, sym) {
    const D = data[sym]; if (D._rot) return D._rot;
    const b = D.bars, n = b.d.length, lr = b.ac.map((x, i) => (i ? Math.log(x / b.ac[i - 1]) : 0)), vol = rollStd(lr, 63), s200 = sma(b.ac, 200);
    const tv = sma(b.c.map((c, i) => c * (b.v[i] || 0)), 126); // average traded value – a point-in-time stand-in for "big enough to be in the Nifty"
    return (D._rot = { b, idx: Object.fromEntries(b.d.map((d, i) => [d, i])), vol, s200, tv, n });
  }
  /**
   * Indian equity capital-gains tax as it was on the sale date: STCG 15% (20% from 23 Jul 2024);
   * LTCG 0% before Apr 2018, then 10% above ₹1 lakh a year (12.5% above ₹1.25 lakh from 23 Jul 2024).
   */
  const taxRates = (d) => (d >= '2024-07-23' ? { st: 0.20, lt: 0.125, ex: 125000 } : d >= '2018-04-01' ? { st: 0.15, lt: 0.10, ex: 100000 } : { st: 0.15, lt: 0, ex: 0 });
  function rotTaxYearEnd(R, d) {
    const T = R.tax, rt = taxRates(T.lastSale || d), stG = Math.max(0, T.st), ltNet = T.lt + Math.min(0, T.st) /* ST losses offset LT gains */, ltG = Math.max(0, ltNet - rt.ex);
    const stRate = T.st > 0 && T.stTax != null ? Math.min(0.2, Math.max(0.15, T.stTax / T.st)) : rt.st; // blended if the rate changed mid-year
    const due = Math.round(stG * stRate + ltG * rt.lt);
    T.stTax = null; T.lastSale = null;
    if (due > 0) { R.cash -= due; T.paid += due; R.log.push({ d, t: `Paid ₹${due.toLocaleString('en-IN')} capital-gains tax for FY ${T.fy}-${String((T.fy + 1) % 100).padStart(2, '0')}` }); }
    T.st = 0; T.lt = 0;
  }
  /** Slippage by how much the stock trades: ₹500 cr+/day 0.05%, ₹100 cr+ 0.1%, ₹20 cr+ 0.2%, less 0.4%. */
  const rotSlip = (R, data, sym, d) => { const P = rotPrep(data, sym), i = P.idx[d], tv = i !== undefined ? P.tv[i] || 0 : 0; return tv >= 5e9 ? 0.05 : tv >= 1e9 ? 0.1 : tv >= 2e8 ? 0.2 : 0.4; };
  function rotSell(R, sym, q, px, d, reason, slip = 0.05) {
    const P = R.pos[sym]; if (!P || q <= 0) return;
    q = Math.min(q, P.q); const p = px * (1 - slip / 100), c = cost(q * p, 'SELL');
    R.cash += q * p - c; R.costs += c;
    let left = q, gain = 0, basis = 0;
    while (left > 0 && P.lots.length) { // FIFO lots → short or long term
      const L = P.lots[0], k = Math.min(left, L.q), g = k * (p - L.p) - c * (k / q);
      const days = (Date.parse(d) - Date.parse(L.d)) / 864e5;
      if (days > 365) R.tax.lt += g; else { R.tax.st += g; R.tax.stTax = (R.tax.stTax || 0) + g * taxRates(d).st; }
      R.tax.lastSale = d;
      gain += g; basis += k * L.p; L.q -= k; left -= k; if (L.q <= 0) P.lots.shift();
    }
    P.q -= q;
    R.trades.push({ sym, side: 'SELL', d, q, p, pnl: gain, ret: basis ? (gain / basis) * 100 : 0, r: reason });
    if (P.q <= 0) delete R.pos[sym];
  }
  function rotBuy(R, sym, q, px, d, reason, slip = 0.05) {
    const p = px * (1 + slip / 100);
    while (q > 0 && q * p + cost(q * p, 'BUY') > R.cash) q--;
    if (q <= 0) return;
    const c = cost(q * p, 'BUY'); R.cash -= q * p + c; R.costs += c;
    const P = R.pos[sym] || (R.pos[sym] = { q: 0, lots: [], since: d });
    P.q += q; P.lots.push({ q, p, d });
    R.trades.push({ sym, side: 'BUY', d, q, p, r: reason });
  }
  /** Rank the universe at the close of day d (only data up to d). */
  function rotRank(R, data, d) {
    const C = R.cfg, rows = [];
    for (const sym in data) {
      if (!data[sym] || !data[sym].bars || !data[sym].bars.d.length) continue;
      const P = rotPrep(data, sym); let i = P.idx[d];
      if (i === undefined) { let j = P.b.d.length - 1; while (j >= 0 && P.b.d[j] > d) j--; if (j >= 0 && (Date.parse(d) - Date.parse(P.b.d[j])) / 864e5 <= 7) i = j; } // a day or two stale is fine
      if (i === undefined || i < Math.max(C.minHist, C.lookback + 1)) continue;
      const b = P.b, m = b.ac[i - C.skip] / b.ac[i - C.lookback] - 1, v = P.vol[i];
      if (!Number.isFinite(m) || !(v > 0) || b.c[i] <= 0) continue;
      rows.push({ sym, mom: m, vol: v, score: C.riskAdj ? m / (v * Math.sqrt(252)) : m, px: b.c[i], tv: P.tv[i] || 0 });
    }
    // who may be picked: stocks in the Nifty 50 on that date (membership history), or else the 50 most-traded
    const inMap = (m, sym) => (m[sym] || []).some(([a, b]) => (d >= a || a === m._first) && (b === null || d < b));
    if (C.memberMap) { const k = rows.filter((r) => inMap(C.memberMap, r.sym)); rows.length = 0; rows.push(...k); } // other indices (tests)
    else if (C.members) { const k = rows.filter((r) => inNifty50(r.sym, d)); rows.length = 0; rows.push(...k); }
    else if (C.liquid && rows.length > C.liquid) { rows.sort((a, b) => b.tv - a.tv); rows.length = C.liquid; }
    rows.sort((a, b) => b.score - a.score); rows.forEach((r, k) => { r.rank = k + 1; });
    return rows;
  }
  function rotTargets(R, data, d, niftyGap) {
    const C = R.cfg, rows = rotRank(R, data, d), by = Object.fromEntries(rows.map((r) => [r.sym, r]));
    // exposure from the Nifty's trend: above its 200-day avg → 100%; a little below → 50%; crash → 0 (until back above)
    let ex = niftyGap > 0 ? 1 : niftyGap <= -C.crashGap ? 0 : R.expo === 0 ? 0 : C.gradual ? 0.5 : 1;
    // keep holdings still ranked within topN × buffer; fill the rest from the top
    const keep = Object.keys(R.pos).filter((s) => by[s] && by[s].rank <= C.topN * C.buffer && (by[s].mom > 0 || C.anyMom));
    const pick = [...keep]; for (const r of rows) { if (pick.length >= C.topN) break; if (!pick.includes(r.sym) && (r.mom > 0 || C.anyMom)) pick.push(r.sym); }
    const sel = pick.slice(0, Math.max(C.topN, keep.length));
    const raw = sel.map((s) => (C.weight === 'invvol' ? 1 / by[s].vol : 1)), tot = raw.reduce((a, b) => a + b, 0) || 1;
    const w = {}; sel.forEach((s, k) => { w[s] = Math.min(raw[k] / tot, 2 / C.topN); });
    if (C.volTarget && R.equity.length > 64) { // volatility targeting: cut exposure when the account's own swings get big
      const e = R.equity.slice(-64).map((r) => r[1]), lr = e.slice(1).map((v, i) => Math.log(v / e[i])), m = lr.reduce((a, b) => a + b, 0) / lr.length;
      const vol = Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / (lr.length - 1)) * Math.sqrt(252) * 100;
      if (vol > C.volTarget) ex *= Math.max(0.3, C.volTarget / vol);
    }
    const ws = Object.values(w).reduce((a, b) => a + b, 0) || 1; for (const s in w) w[s] = (w[s] / ws) * ex;
    return { w, ex, rows: rows.slice(0, 25).map((r) => ({ sym: r.sym, mom: Math.round(r.mom * 1000) / 10, rank: r.rank })) };
  }
  function rotValue(R, data, d) {
    let v = R.cash;
    for (const s in R.pos) { const P = rotPrep(data, s), i = P.idx[d]; let px = i !== undefined ? P.b.c[i] : null;
      if (px == null) { let j = P.b.d.length - 1; while (j > 0 && P.b.d[j] > d) j--; px = P.b.c[j]; }
      v += R.pos[s].q * px; }
    return v;
  }
  /** Carry out the pending plan at prices given by px(sym) (the day's open, or a live price). */
  function rotExecute(R, data, d, px, note = '') {
    const plan = R.pending; if (!plan) return 0; R.pending = null;
    let val = R.cash; for (const s in R.pos) { const p = px(s); val += R.pos[s].q * (p != null ? p : rotPrep(data, s).b.c[rotPrep(data, s).b.c.length - 1]); }
    const want = {}, n0 = R.trades.length;
    for (const s in plan.w) { const p = px(s); if (p) want[s] = Math.floor((val * plan.w[s] * 0.995) / p); }
    const sl = (s) => { const P = rotPrep(data, s), j = P.b.d.length - 1; const tv = P.tv[P.idx[d] !== undefined ? P.idx[d] : j] || 0; return tv >= 5e9 ? 0.05 : tv >= 1e9 ? 0.1 : tv >= 2e8 ? 0.2 : 0.4; };
    for (const s of Object.keys(R.pos)) { const p = px(s); if (p == null) continue;
      const tq = want[s] || 0, cur = R.pos[s].q;
      // tax-aware: don't sell a winner that turns long-term within 45 days if it is still ranked well
      if (tq < cur && R.cfg.taxAware && plan.near && plan.near[s] && plan.ex > 0) continue;
      if (tq === 0) rotSell(R, s, cur, p, d, (plan.why[s] || 'dropped out') + note, sl(s));
      else if (cur - tq > cur * 0.2) rotSell(R, s, cur - tq, p, d, 'rebalance' + note, sl(s)); }
    for (const s in want) { const p = px(s), cur = R.pos[s] ? R.pos[s].q : 0, tq = want[s];
      if (tq > cur && (cur === 0 || tq - cur > cur * 0.2)) rotBuy(R, s, tq - cur, p, d, (cur ? 'rebalance' : 'joined the top ' + R.cfg.topN) + note, sl(s)); }
    return R.trades.length - n0;
  }
  /**
   * Live fill during market hours: queued orders of the paper account and the momentum account are filled now at the
   * live price (plus slippage and costs) instead of waiting for the next open. `live` = { 'TCS.NS': price, ... }.
   */
  function fillNow(st, live, today, rot, rotData) {
    const done = [];
    for (const [sym, T] of Object.entries(st.tickers)) {
      const t = T.live, p = live[sym]; if (!p || !t.pending) continue;
      if (t.pending === 'BUY' && t.qty === 0) { tBuy(t, today, p); if (t.qty > 0) { t.trades[t.trades.length - 1].live = 1; done.push({ sym, side: 'BUY', q: t.qty, p: t.trades[t.trades.length - 1].ep }); } }
      else if (t.pending === 'SELL' && t.qty > 0) { const q = t.qty, cl = tSell(t, today, p, t.pReason || 'signal'); if (cl) { cl.live = 1; done.push({ sym, side: 'SELL', q, p: cl.xp }); } }
      t.pending = ''; t.pReason = '';
    }
    let rn = 0;
    if (rot && rot.pending && rotData) rn = rotExecute(rot, rotData, today, (s) => live[s] || null, ' (live price)');
    return { done, rot: rn };
  }
  /**
   * Advance a rotation account through every trading day after R.lastDate up to `upto`.
   * Signals at a close, trades at the next open. Works incrementally (live) or in one go (backtest).
   */
  function rotRun(R, data, nifty, upto, from) {
    const nb = nifty.bars, nl = nifty._nl || (nifty._nl = niftyLookup(nb));
    if (!R.start) R.start = from || nb.d[0];
    // splits since a lot was bought: Yahoo's prices are already adjusted, so adjust our quantities to match
    for (const s in R.pos) for (const sp of (data[s] && data[s].splits) || []) {
      const sd = istDate(sp.ts), key = `${s}|${sd}`;
      if (R.splitsDone[key] || sd <= R.pos[s].since) continue;
      R.splitsDone[key] = 1; const P = R.pos[s], pp = rotPrep(data, s);
      // only adjust lots whose recorded price still looks pre-split against today's (already adjusted) price history
      P.lots.forEach((L) => { if (sd <= L.d) return; const i = pp.idx[L.d]; if (i === undefined || !(L.p / pp.b.o[i] > Math.sqrt(sp.ratio))) return; L.q = Math.round(L.q * sp.ratio); L.p /= sp.ratio; });
      P.q = P.lots.reduce((a, L) => a + L.q, 0);
    }
    const dates = nb.d.filter((d) => d >= R.start && (!R.lastDate || d > R.lastDate) && d <= upto);
    for (const d of dates) {
      const fy = rotFY(d); if (R.tax.fy == null) R.tax.fy = fy; if (fy !== R.tax.fy) { rotTaxYearEnd(R, d); R.tax.fy = fy; }
      // dividends to holders on the ex-date
      for (const s in R.pos) { const dv = data[s] && data[s].divs && data[s].divs[d]; if (dv) { R.cash += R.pos[s].q * dv; R.divs += R.pos[s].q * dv; } }
      // execute yesterday's plan at today's open
      if (R.pending) rotExecute(R, data, d, (s) => { const P = rotPrep(data, s), i = P.idx[d]; return i === undefined ? null : P.b.o[i]; });
      const n = nl(d), gap = n && n.s200 ? n.c / n.s200 - 1 : 0, gapPct = gap * 100;
      // decide at the close: monthly rebalance, or immediately when the market's exposure level changes
      const mo = d.slice(0, 7), C = R.cfg;
      const exNow = gapPct > 0 ? 1 : gapPct <= -C.crashGap ? 0 : R.expo === 0 ? 0 : C.gradual ? 0.5 : 1;
      if (mo !== R.lastMonth || exNow !== R.expo) {
        const T = rotTargets(R, data, d, gapPct), why = {}, near = {};
        for (const s in R.pos) {
          if (!T.w[s]) why[s] = T.ex === 0 ? 'market crash filter' : 'dropped out of the top';
          const P = R.pos[s], r = T.rows.find((x) => x.sym === s);
          const lot = P.lots[0], age = lot ? (Date.parse(d) - Date.parse(lot.d)) / 864e5 : 0, pi = rotPrep(data, s).idx[d];
          if (lot && age > 320 && age <= 365 && pi !== undefined && rotPrep(data, s).b.c[pi] > lot.p && r && r.rank <= C.topN * 3) near[s] = 1;
        }
        if (exNow !== R.expo) R.log.push({ d, t: exNow === 0 ? `Nifty ${gapPct.toFixed(1)}% below its 200-day average – moving to cash` : exNow === 0.5 ? 'Nifty dipped below its 200-day average – holding 50%' : 'Nifty back above its 200-day average – fully invested' });
        R.pending = { w: T.w, ex: T.ex, why, near }; R.expo = exNow; R.lastMonth = mo; R.top = T.rows;
      }
      R.equity.push([d, Math.round(rotValue(R, data, d)), n ? n.c : null, R.invested]);
      R.lastDate = d;
    }
    if (R.equity.length > 6000) R.equity.splice(0, R.equity.length - 6000);
    if (R.trades.length > 3000) R.trades.splice(0, R.trades.length - 3000);
    if (R.log.length > 200) R.log.splice(0, R.log.length - 200);
    return R;
  }

  // ------------------------------------------------------------------ predictions: candles, chart patterns, trend
  // Every signal is scored against the stock's OWN history: how often was the price higher
  // H sessions later when this signal appeared, compared with any normal day? No edge → we say so.
  const SIGNALS = {
    // candlestick patterns
    doji: { label: 'Doji', kind: 'candle', dir: 'neutral', what: 'Open ≈ close: buyers and sellers tied – indecision' },
    hammer: { label: 'Hammer', kind: 'candle', dir: 'bull', what: 'Long lower shadow after a fall: sellers pushed down, buyers pushed back' },
    hanging_man: { label: 'Hanging man', kind: 'candle', dir: 'bear', what: 'Hammer shape after a rise: selling showed up in an uptrend' },
    shooting_star: { label: 'Shooting star', kind: 'candle', dir: 'bear', what: 'Long upper shadow after a rise: buyers pushed up and were rejected' },
    bull_engulfing: { label: 'Bullish engulfing', kind: 'candle', dir: 'bull', what: 'A green body swallowed the previous red one after a fall' },
    bear_engulfing: { label: 'Bearish engulfing', kind: 'candle', dir: 'bear', what: 'A red body swallowed the previous green one after a rise' },
    morning_star: { label: 'Morning star', kind: 'candle', dir: 'bull', what: 'Big red → small pause → strong green: a three-day bottom' },
    evening_star: { label: 'Evening star', kind: 'candle', dir: 'bear', what: 'Big green → small pause → strong red: a three-day top' },
    // chart patterns
    breakout: { label: 'Breakout above 20-day high', kind: 'chart', dir: 'bull', what: 'Closed above the highest price of the last 20 sessions' },
    breakdown: { label: 'Breakdown below 20-day low', kind: 'chart', dir: 'bear', what: 'Closed below the lowest price of the last 20 sessions' },
    near_support: { label: 'Sitting on support', kind: 'chart', dir: 'bull', what: 'Within 2% of a level where falls stopped before' },
    near_resistance: { label: 'Under resistance', kind: 'chart', dir: 'bear', what: 'Within 2% of a level where rallies stopped before' },
    double_bottom: { label: 'Double bottom', kind: 'chart', dir: 'bull', what: 'Two similar lows with a bounce between, now rising past the bounce' },
    double_top: { label: 'Double top', kind: 'chart', dir: 'bear', what: 'Two similar highs with a dip between, now falling past the dip' },
    squeeze: { label: 'Squeeze (narrowing range)', kind: 'chart', dir: 'neutral', what: 'Bollinger bands at their tightest in 6 months – a big move often follows, direction unknown' },
    golden_cross: { label: 'Golden cross', kind: 'chart', dir: 'bull', what: '50-day average crossed above the 200-day in the last week' },
    death_cross: { label: 'Death cross', kind: 'chart', dir: 'bear', what: '50-day average crossed below the 200-day in the last week' },
    // trend & momentum
    uptrend: { label: 'Strong uptrend', kind: 'trend', dir: 'bull', what: 'Price > 20-day > 50-day > 200-day average' },
    downtrend: { label: 'Strong downtrend', kind: 'trend', dir: 'bear', what: 'Price < 20-day < 50-day < 200-day average' },
    rsi_oversold: { label: 'RSI oversold (< 30)', kind: 'trend', dir: 'bull', what: 'Fell fast – often bounces, but can keep falling in a downtrend' },
    rsi_overbought: { label: 'RSI overbought (> 70)', kind: 'trend', dir: 'bear', what: 'Rose fast – often pauses, but can stay high in a strong trend' },
    macd_up: { label: 'MACD turned up', kind: 'trend', dir: 'bull', what: 'MACD crossed above its signal line today' },
    macd_down: { label: 'MACD turned down', kind: 'trend', dir: 'bear', what: 'MACD crossed below its signal line today' },
  };

  /** Signal flags for every bar of an adjusted OHLCV series. */
  function signalMatrix(b) {
    const n = b.c.length, F = {};
    for (const k in SIGNALS) F[k] = new Array(n).fill(false);
    const s20 = sma(b.c, 20), s50 = sma(b.c, 50), s200 = sma(b.c, 200), r = rsi(b.c, 14), m = macd(b.c);
    const mid = s20, sd = rollStd(b.c, 20), bw = mid.map((x, i) => (x ? (4 * sd[i]) / x : NaN));
    const hi20 = rollPrev(b.h, 20, (w) => Math.max(...w)), lo20 = rollPrev(b.l, 20, (w) => Math.min(...w));
    const body = b.c.map((c, i) => c - b.o[i]), ab = body.map(Math.abs);
    const avgB = sma(ab, 10);
    for (let i = 1; i < n; i++) {
      const o = b.o[i], h = b.h[i], l = b.l[i], c = b.c[i], rng = h - l || 1e-9;
      const up = h - Math.max(o, c), lo = Math.min(o, c) - l;
      const down5 = i >= 6 && b.c[i - 1] < b.c[i - 6], up5 = i >= 6 && b.c[i - 1] > b.c[i - 6];
      F.doji[i] = ab[i] <= 0.1 * rng;
      const hammerShape = lo >= 2 * ab[i] && up <= 0.15 * rng && ab[i] > 0.03 * rng;
      F.hammer[i] = hammerShape && down5; F.hanging_man[i] = hammerShape && up5;
      F.shooting_star[i] = up >= 2 * ab[i] && lo <= 0.15 * rng && up5;
      const po = b.o[i - 1], pc = b.c[i - 1];
      F.bull_engulfing[i] = pc < po && c > o && o <= pc && c >= po && down5;
      F.bear_engulfing[i] = pc > po && c < o && o >= pc && c <= po && up5;
      if (i >= 2) {
        const b2 = body[i - 2], b1 = body[i - 1], big2 = Math.abs(b2) > (avgB[i - 2] || Infinity), small1 = Math.abs(b1) < 0.5 * Math.abs(b2), mid2 = (b.o[i - 2] + b.c[i - 2]) / 2;
        F.morning_star[i] = b2 < 0 && big2 && small1 && body[i] > 0 && c > mid2;
        F.evening_star[i] = b2 > 0 && big2 && small1 && body[i] < 0 && c < mid2;
      }
      F.breakout[i] = c > hi20[i]; F.breakdown[i] = c < lo20[i];
      if (i >= 60) {
        const wl = b.l.slice(i - 60, i - 3), wh = b.h.slice(i - 60, i - 3), sup = Math.min(...wl), res = Math.max(...wh);
        F.near_support[i] = c >= sup && (c - sup) / c < 0.02;
        F.near_resistance[i] = c <= res && (res - c) / c < 0.02;
      }
      if (i >= 40) { // two similar lows/highs in the last 40 sessions, separated by a bounce/dip, price now past it
        const a = i - 40, L1 = Math.min(...b.l.slice(a, a + 20)), L2 = Math.min(...b.l.slice(a + 20, i - 1));
        const H1 = Math.max(...b.h.slice(a, a + 20)), H2 = Math.max(...b.h.slice(a + 20, i - 1));
        const midHi = Math.max(...b.h.slice(a + 10, i - 10)), midLo = Math.min(...b.l.slice(a + 10, i - 10));
        F.double_bottom[i] = Math.abs(L1 - L2) / L1 < 0.02 && midHi > L1 * 1.04 && c > midHi && b.c[i - 1] <= midHi;
        F.double_top[i] = Math.abs(H1 - H2) / H1 < 0.02 && midLo < H1 * 0.96 && c < midLo && b.c[i - 1] >= midLo;
      }
      if (i >= 126 && !isn(bw[i])) { let mn = Infinity; for (let k = i - 125; k < i; k++) if (!isn(bw[k])) mn = Math.min(mn, bw[k]); F.squeeze[i] = bw[i] <= mn; }
      if (i >= 5 && !isn(s200[i])) for (let k = i - 4; k <= i; k++) { if (s50[k] > s200[k] && s50[k - 1] <= s200[k - 1]) F.golden_cross[i] = true; if (s50[k] < s200[k] && s50[k - 1] >= s200[k - 1]) F.death_cross[i] = true; }
      F.uptrend[i] = c > s20[i] && s20[i] > s50[i] && s50[i] > s200[i];
      F.downtrend[i] = c < s20[i] && s20[i] < s50[i] && s50[i] < s200[i];
      F.rsi_oversold[i] = r[i] < 30; F.rsi_overbought[i] = r[i] > 70;
      F.macd_up[i] = m.line[i] > m.signal[i] && m.line[i - 1] <= m.signal[i - 1];
      F.macd_down[i] = m.line[i] < m.signal[i] && m.line[i - 1] >= m.signal[i - 1];
    }
    return { F, s20, s50, s200 };
  }

  function fwdStats(c, mask, H) {
    let n = 0, up = 0, sum = 0;
    for (let i = 200; i + H < c.length; i++) if (!mask || mask[i]) { const r = c[i + H] / c[i] - 1; n++; sum += r; if (r > 0) up++; }
    return { n, up: n ? up / n : NaN, avg: n ? (sum / n) * 100 : NaN };
  }

  /** Horizontal support/resistance: cluster swing highs/lows that price touched repeatedly. */
  function srLevels(b, look = 250, win = 8, tol = 0.015) {
    const n = b.c.length, a = Math.max(win, n - look), pts = [];
    for (let i = a; i < n - win; i++) {
      let isH = true, isL = true;
      for (let k = i - win; k <= i + win; k++) { if (b.h[k] > b.h[i]) isH = false; if (b.l[k] < b.l[i]) isL = false; }
      if (isH) pts.push(b.h[i]); if (isL) pts.push(b.l[i]);
    }
    pts.sort((x, y) => x - y);
    const cl = [];
    for (const p of pts) { const last = cl[cl.length - 1]; if (last && Math.abs(p - last.v / last.n) / p <= tol) { last.v += p; last.n++; } else cl.push({ v: p, n: 1 }); }
    const price = b.c[n - 1];
    const lv = cl.filter((x) => x.n >= 2).map((x) => ({ level: x.v / x.n, touches: x.n }));
    const sup = lv.filter((x) => x.level < price).sort((x, y) => y.level - x.level).slice(0, 2);
    const res = lv.filter((x) => x.level > price).sort((x, y) => x.level - y.level).slice(0, 2);
    return { sup, res };
  }

  /**
   * Trend projection: least-squares slope of log prices over the last `look` sessions, started from
   * today's price; the range widens with time using the stock's recent daily volatility (90% band).
   */
  function projection(c, look = 60, ahead = 10) {
    const y = c.slice(-look).map(Math.log), n = y.length, xm = (n - 1) / 2, ym = y.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0; y.forEach((v, i) => { sxy += (i - xm) * (v - ym); sxx += (i - xm) ** 2; });
    const slope = sxy / sxx, icp = ym - slope * xm;
    const res = y.map((v, i) => v - (icp + slope * i)), sst = y.reduce((s, v) => s + (v - ym) ** 2, 0);
    const r2 = sst ? 1 - res.reduce((s, v) => s + v * v, 0) / sst : 0;
    const dr = y.slice(1).map((v, i) => v - y[i]), dm = dr.reduce((s, v) => s + v, 0) / dr.length;
    const sdD = Math.sqrt(dr.reduce((s, v) => s + (v - dm) ** 2, 0) / (dr.length - 1));
    const p0 = c[c.length - 1];
    const path = [], lo = [], hi = [];
    for (let k = 0; k <= ahead; k++) { const m = p0 * Math.exp(slope * k), w = 1.64 * sdD * Math.sqrt(k); path.push(m); lo.push(m * Math.exp(-w)); hi.push(m * Math.exp(w)); }
    return { slopePct: (Math.exp(slope) - 1) * 100, r2, end: path[ahead], lo: lo[ahead], hi: hi[ahead], path, loPath: lo, hiPath: hi, look, ahead, volPct: sdD * 100 };
  }

  // ------------------------------------------------------------------ trend forecast (up / down / sideways)
  // Trend today: the 50-day average's direction over the last 20 sessions + where the price sits.
  // Forecast: a small logistic model of "higher in 20 sessions?" trained on the stock's own past,
  // scored on later stretches it never saw (walk-forward) and compared with "always guess up".
  const TF_H = 20;
  const TF_FEATS = ['5-day move', '20-day move', '60-day move', 'vs 20-day avg', 'vs 50-day avg', 'vs 200-day avg', '50-day avg slope', 'RSI', 'MACD', 'volatility', 'Nifty vs 200-day', 'Nifty 20-day move'];
  function trendStates(c, s50, s200) {
    const n = c.length, st = new Array(n).fill(null);
    for (let i = 70; i < n; i++) {
      if (isn(s50[i]) || isn(s50[i - 20])) continue;
      const sl = s50[i] / s50[i - 20] - 1;
      st[i] = sl > 0.01 && c[i] > s50[i] ? 'up' : sl < -0.01 && c[i] < s50[i] ? 'down' : 'side';
    }
    return st;
  }
  function tfFeatures(b, nifty) {
    const c = b.c, n = c.length, s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), r = rsi(c, 14), m = macd(c);
    const lr = c.map((x, i) => (i ? Math.log(x / c[i - 1]) : 0)), vol = rollStd(lr, 20);
    let nf = null;
    if (nifty && nifty.d && nifty.d.length > 260) {
      const nc = nifty.ac || nifty.c, ns = sma(nc, 200), idx = new Map(nifty.d.map((d, i) => [d, i]));
      nf = b.d.map((d) => { let j = idx.get(d); return j == null || isn(ns[j]) || j < 20 ? null : [nc[j] / ns[j] - 1, nc[j] / nc[j - 20] - 1]; });
    }
    const X = new Array(n).fill(null);
    for (let i = 200; i < n; i++) {
      if ([s200[i], s50[i - 20], r[i], m.signal[i], vol[i]].some(isn)) continue;
      const x = [c[i] / c[i - 5] - 1, c[i] / c[i - 20] - 1, c[i] / c[i - 60] - 1, c[i] / s20[i] - 1, c[i] / s50[i] - 1, c[i] / s200[i] - 1, s50[i] / s50[i - 20] - 1, (r[i] - 50) / 50, (m.line[i] - m.signal[i]) / c[i], vol[i]];
      if (nf) { if (!nf[i]) continue; x.push(nf[i][0], nf[i][1]); }
      X[i] = x;
    }
    return { X, s50, s200, useNifty: !!nf };
  }
  function logitFit(X, y, iters = 250, lr = 0.3, l2 = 1) {
    const k = X[0].length, mu = new Array(k).fill(0), sd = new Array(k).fill(0);
    X.forEach((x) => x.forEach((v, j) => { mu[j] += v / X.length; }));
    X.forEach((x) => x.forEach((v, j) => { sd[j] += (v - mu[j]) ** 2 / X.length; }));
    for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    const Z = X.map((x) => x.map((v, j) => Math.max(-4, Math.min(4, (v - mu[j]) / sd[j]))));
    const w = new Array(k).fill(0); let b0 = 0;
    for (let t = 0; t < iters; t++) {
      const g = new Array(k).fill(0); let gb = 0;
      for (let i = 0; i < Z.length; i++) { let z = b0; for (let j = 0; j < k; j++) z += w[j] * Z[i][j]; const e = 1 / (1 + Math.exp(-z)) - y[i]; gb += e; for (let j = 0; j < k; j++) g[j] += e * Z[i][j]; }
      b0 -= (lr * gb) / Z.length; for (let j = 0; j < k; j++) w[j] -= lr * (g[j] / Z.length + l2 * w[j]);
    }
    const p = (x) => { let z = b0; for (let j = 0; j < k; j++) z += w[j] * Math.max(-4, Math.min(4, (x[j] - mu[j]) / sd[j])); return 1 / (1 + Math.exp(-z)); };
    return { p, w, b0 };
  }
  /** Trend now + forecast for the next 20 sessions, with an honest out-of-sample score. */
  function trendForecast(b, nifty) {
    const c = b.c, n = c.length, { X, s50, s200, useNifty } = tfFeatures(b, nifty), states = trendStates(c, s50, s200);
    const rows = []; for (let i = 0; i + TF_H < n; i++) if (X[i]) rows.push(i);
    if (rows.length < 400 || !X[n - 1] || !states[n - 1]) return null;
    const y = (i) => (c[i + TF_H] > c[i] ? 1 : 0);
    // walk-forward: 4 test blocks over the last 40%; each model trains only on bars ending ≥20 sessions before the block
    const start = Math.floor(rows.length * 0.6), blk = Math.ceil((rows.length - start) / 4);
    let hit = 0, tot = 0, base = 0, conf = 0, confHit = 0, brier = 0;
    for (let a = start; a < rows.length; a += blk) {
      const tr = rows.slice(0, Math.max(0, a - TF_H)), te = rows.slice(a, a + blk);
      if (tr.length < 250) continue;
      const M = logitFit(tr.map((i) => X[i]), tr.map(y)), upRate = tr.reduce((s, i) => s + y(i), 0) / tr.length;
      te.forEach((i) => { const p = M.p(X[i]), yy = y(i); tot++; if ((p >= 0.5) === (yy === 1)) hit++; if ((upRate >= 0.5) === (yy === 1)) base++; brier += (p - yy) ** 2; if (Math.abs(p - 0.5) >= 0.08) { conf++; if ((p >= 0.5) === (yy === 1)) confHit++; } });
    }
    const M = logitFit(rows.map((i) => X[i]), rows.map(y)), pUp = M.p(X[n - 1]);
    // how trends have behaved on this stock: still the same 20 sessions later?
    const now = states[n - 1]; let age = 0; for (let i = n - 1; i >= 0 && states[i] === now; i--) age++;
    const tr = { up: { up: 0, side: 0, down: 0, n: 0 }, side: { up: 0, side: 0, down: 0, n: 0 }, down: { up: 0, side: 0, down: 0, n: 0 } };
    for (let i = 70; i + TF_H < n; i++) if (states[i] && states[i + TF_H]) { tr[states[i]][states[i + TF_H]]++; tr[states[i]].n++; }
    const T = tr[now], cont = T.n ? T[now] / T.n : NaN;
    const acc = tot ? hit / tot : NaN, baseAcc = tot ? base / tot : NaN, skill = acc - baseAcc;
    const call = pUp >= 0.58 ? 'up' : pUp <= 0.42 ? 'down' : 'unclear';
    const trust = !tot ? 'untested' : skill >= 0.04 && acc >= 0.55 ? 'some' : skill > 0 ? 'little' : 'none';
    const drivers = M.w.map((w, j) => ({ f: TF_FEATS[j], w })).sort((a, b2) => Math.abs(b2.w) - Math.abs(a.w)).slice(0, 3).map((d) => ({ f: d.f, dir: d.w > 0 ? 'up' : 'down' }));
    const sl50 = (s50[n - 1] / s50[n - 21] - 1) * 100;
    return {
      now, age, sl50, h: TF_H, pUp, call, useNifty,
      next: { up: T.n ? T.up / T.n : NaN, side: T.n ? T.side / T.n : NaN, down: T.n ? T.down / T.n : NaN, n: T.n }, cont,
      test: { n: tot, acc, baseAcc, skill, conf, confAcc: conf ? confHit / conf : NaN, brier: tot ? brier / tot : NaN }, trust, drivers,
      hist: states.slice(-80),
    };
  }

  /** Split/dividend-adjusted OHLC from raw Yahoo bars. */
  const adjBars = (raw) => { const f = raw.c.map((c, i) => raw.ac[i] / c); return { o: raw.o.map((x, i) => x * f[i]), h: raw.h.map((x, i) => x * f[i]), l: raw.l.map((x, i) => x * f[i]), c: raw.ac.slice(), v: raw.v, d: raw.d }; };
  /**
   * Trend calls made during a past period, the way they would have been made then: every `every`
   * sessions the model is refitted on rows whose 20-session outcome was already known that day,
   * and calls the next 20 sessions. Each call carries its outcome date so a replay can reveal it
   * only once the replay reaches that date.
   */
  function trendCalls(raw, nifty, start, end, every = TF_H) {
    const b = adjBars(raw), c = b.c, n = c.length, { X, s50, s200 } = tfFeatures(b, nifty), states = trendStates(c, s50, s200), out = [];
    const y = (i) => (c[i + TF_H] > c[i] ? 1 : 0);
    let i0 = b.d.findIndex((d) => d >= start); if (i0 < 0) return out;
    for (let i = i0; i < n && b.d[i] <= end; i += every) {
      if (!X[i] || !states[i]) continue;
      const tr = []; for (let k = Math.max(0, i - TF_H - 1260); k + TF_H <= i; k++) if (X[k]) tr.push(k);
      if (tr.length < 250) continue;
      const M = logitFit(tr.map((k) => X[k]), tr.map(y), 150), pUp = M.p(X[i]), upRate = tr.reduce((s2, k) => s2 + y(k), 0) / tr.length;
      let age = 0; for (let k = i; k >= 0 && states[k] === states[i]; k--) age++;
      const j = i + TF_H < n ? i + TF_H : null;
      out.push({ d: b.d[i], now: states[i], age, pUp, call: pUp >= 0.58 ? 'up' : pUp <= 0.42 ? 'down' : 'unclear', guess: upRate >= 0.5 ? 'up' : 'down',
        due: j == null ? null : b.d[j], ret: j == null ? null : (c[j] / c[i] - 1) * 100, after: j == null ? null : states[j] });
    }
    return out;
  }
  /** Score trend calls whose outcome is known by `asOf` (all if omitted). */
  function scoreCalls(calls, asOf) {
    const k = calls.filter((x) => x.due && (!asOf || x.due <= asOf));
    const right = (x, dir) => (dir === 'up' ? x.ret > 0 : x.ret <= 0);
    const leaned = k.filter((x) => x.call !== 'unclear');
    const r = { n: k.length, hit: k.filter((x) => right(x, x.pUp >= 0.5 ? 'up' : 'down')).length, base: k.filter((x) => right(x, x.guess)).length,
      leaned: leaned.length, leanHit: leaned.filter((x) => right(x, x.call)).length,
      up: k.filter((x) => x.call === 'up'), down: k.filter((x) => x.call === 'down'),
      stay: k.filter((x) => x.after === x.now).length };
    r.upHit = r.up.filter((x) => x.ret > 0).length; r.downHit = r.down.filter((x) => x.ret <= 0).length; r.up = r.up.length; r.down = r.down.length;
    return r;
  }

  /**
   * Predictions for one stock from its raw (split-adjusted) bars. Returns a compact object
   * stored with the account: today's signals with their historical odds, an overall lean,
   * S/R levels, a trend projection and the last 80 candles for drawing.
   */
  function predict(raw, opts = {}) {
    const f = raw.c.map((c, i) => raw.ac[i] / c);
    const b = { o: raw.o.map((x, i) => x * f[i]), h: raw.h.map((x, i) => x * f[i]), l: raw.l.map((x, i) => x * f[i]), c: raw.ac.slice(), v: raw.v, d: raw.d };
    const n = b.c.length; if (n < 260) return null;
    const { F, s20, s50 } = signalMatrix(b);
    let trend = null; try { trend = trendForecast(b, opts.nifty); } catch (e) { trend = null; }
    const base5 = fwdStats(b.c, null, 5), base20 = fwdStats(b.c, null, 20);
    const last = n - 1, active = [], recent = [];
    for (const k in SIGNALS) {
      const s5 = fwdStats(b.c, F[k], 5), s20s = fwdStats(b.c, F[k], 20), meta = SIGNALS[k];
      const row = { key: k, label: meta.label, kind: meta.kind, dir: meta.dir, what: meta.what, h5: s5, h20: s20s };
      if (F[k][last]) active.push(row);
      else if (meta.kind === 'candle') { for (let j = last - 1; j >= last - 9; j--) if (F[k][j]) { recent.push({ ...row, date: b.d[j], ago: last - j, after: (b.c[last] / b.c[j] - 1) * 100 }); break; } }
    }
    // overall lean: odds of being higher in 5 sessions, from signals with enough history (weighted by sample size)
    const usable = active.filter((s) => s.h5.n >= 8);
    let p = base5.up, wsum = 0, acc = 0;
    usable.forEach((s) => { const w = Math.sqrt(s.h5.n); acc += w * (s.h5.up - base5.up); wsum += w; });
    if (wsum) p = base5.up + acc / wsum;
    const edge = (p - base5.up) * 100, nTot = usable.reduce((s, x) => s + x.h5.n, 0);
    const lean = !usable.length || Math.abs(edge) < 3 || nTot < 20 ? 'none' : edge > 0 ? 'up' : 'down';
    const strength = lean === 'none' ? 'no clear edge' : Math.abs(edge) >= 8 && nTot >= 60 ? 'moderate' : 'slight';
    // the "call": signal score 0–5 with its components and how each call did on this stock (next 20 sessions)
    const sc = signalScore(b), r14 = rsi(b.c, 14), mm = macd(b.c), s200 = sma(b.c, 200), ob = obv(b), va = sma(b.v, 20);
    const callOf = (x) => (x >= 4 ? 'buy' : x <= 1 ? 'sell' : 'hold');
    const rec = {}; for (const k of ['buy', 'hold', 'sell']) rec[k] = fwdStats(b.c, sc.map((x) => callOf(x) === k), 20);
    const call = { score: sc[last], call: callOf(sc[last]), rec, base: base20,
      parts: [['Price above 50-day average', b.c[last] > s50[last]], ['50-day above 200-day average', s50[last] > s200[last]], ['MACD above its signal', mm.line[last] > mm.signal[last]],
        ['RSI strong but not stretched (50–75)', r14[last] >= 50 && r14[last] <= 75], ['Volume flow (OBV) rising over 20 sessions', ob[last] > ob[last - 20]]],
      volRatio: va[last] > 0 ? b.v[last] / va[last] : null, rsi: r14[last], hist: sc.slice(-80) };
    const K = Math.min(80, n), sl = (a) => a.slice(n - K).map((x) => (x == null || isn(x) ? null : Math.round(x * 100) / 100));
    const marks = [];
    for (let j = n - K; j < n; j++) for (const k in SIGNALS) if (SIGNALS[k].kind === 'candle' && SIGNALS[k].dir !== 'neutral' && F[k][j]) marks.push({ i: j - (n - K), dir: SIGNALS[k].dir, key: k });
    return {
      asOf: b.d[last], price: b.c[last], change: (b.c[last] / b.c[last - 1] - 1) * 100, years: Math.round((n / 252) * 10) / 10,
      base: { h5: base5, h20: base20 }, active, recent: recent.sort((x, y) => x.ago - y.ago).slice(0, 4),
      outlook: { p5: p, edge, lean, strength, n: nTot },
      levels: srLevels(b), proj: projection(b.c, 60, 10), trend,
      chart: { d: b.d.slice(n - K), o: sl(b.o), h: sl(b.h), l: sl(b.l), c: sl(b.c), s20: sl(s20), s50: sl(s50), v: b.v.slice(n - K), obv: ob.slice(n - K), marks }, call,
    };
  }

  /** Bars up to and including `date` (no look-ahead). */
  function barsUpTo(raw, date) {
    let k = raw.d.length; while (k > 0 && raw.d[k - 1] > date) k--;
    const o = {}; for (const key of ['d', 'o', 'h', 'l', 'c', 'v', 'ac']) if (raw[key]) o[key] = raw[key].slice(0, k);
    return o;
  }
  /** Predictions exactly as they would have looked at the close of `date`. */
  function predictAt(raw, nifty, date) {
    const b = barsUpTo(raw, date); if (b.d.length < 260) return null;
    return predict(b, { nifty: nifty ? barsUpTo(nifty, date) : null });
  }
  /** Adjusted closes after `from`, up to `upTo`, at most `max` of them – what really happened next. */
  function closesAfter(raw, from, upTo, max = 10) {
    const out = []; for (let i = 0; i < raw.d.length && out.length < max; i++) if (raw.d[i] > from && raw.d[i] <= upTo) out.push({ d: raw.d[i], c: raw.ac[i] });
    return out;
  }

  /** Why a closed losing trade went wrong, in plain words. */
  function diagnose(tr) {
    const tags = [];
    if (tr.f) for (const k in FEATURES) if (tr.f[k]) tags.push(FEATURES[k].lesson);
    if (tr.r === 'stop') tags.push('Stopped out: the move went against the entry by more than the ATR stop');
    if (tr.r === 'time') tags.push('Time ran out: the move did not happen within the time limit');
    if (tr.bars <= 10 && tr.r === 'signal') tags.push('Whipsaw: the signal reversed within 2 weeks');
    if (!tags.length) tags.push('No obvious mistake – normal losing trade (every strategy has them)');
    return tags;
  }

  function stats(trades) {
    const c = trades.filter((t) => t.x);
    const w = c.filter((t) => t.pnl > 0), l = c.filter((t) => t.pnl <= 0);
    const avg = (a) => (a.length ? a.reduce((s, t) => s + t.ret, 0) / a.length : NaN);
    return { n: c.length, winRate: c.length ? w.length / c.length : NaN, avgWin: avg(w), avgLoss: avg(l),
      pnl: c.reduce((s, t) => s + t.pnl, 0), avgDays: c.length ? c.reduce((s, t) => s + (t.bars || 0), 0) / c.length : NaN,
      targets: c.filter((t) => t.r === 'target').length };
  }

  const api = { cost, sma, ema, rsi, macd, atr, STRATEGIES, FEATURES, parseYahoo, prepare, newState, run,
    diagnose, stats, equity, blocked, sharpe, newTrader, onBar, niftyLookup, resolve, REVIEW_EVERY,
    BRAIN_DEFAULTS, brainParams, SPACE, describeParams, neighbours, makeOptimizer, makeEvolver, randomParams, evaluate, periodStats, applyParams, paramKey, normParams,
    predict, SIGNALS, signalMatrix, fillNow, NIFTY50, ROT_UNIVERSE, ROT_DEFAULTS, monteCarlo, taxRates, inNifty50, NIFTY50_HIST_END, newRot, rotRun, rotRank, trendForecast, trendStates, trendCalls, scoreCalls, predictAt, closesAfter, barsUpTo, _tf: { tfFeatures: (...a) => tfFeatures(...a), logitFit: (...a) => logitFit(...a) },
    migrate, pauseOn, isPaused, setPause, addTicker, removeTicker, QUICK, NORMAL, QUICK_PRESET, NORMAL_PRESET, BEAT_PRESET, allowedStrategies,
    begin, stepDays, skipTo, daysLeft, finish, newTraining, lessonsBefore, mistakesBefore, mergeMistakes, memBlock, teach, previewTeach, readBrain, importBrain, previewImport,
    adjustCapital, netCapital, cashTotal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(this);
