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
  const REVIEW_EVERY = 21, SCORE_WINDOW = 250, MIN_HISTORY = 120, MIN_SCORE = 0.3, HYST = 0.2;
  const RULE_MIN_N = 12, RULE_WINDOW = 400, RULE_MARGIN = 1.0, RF = 6;

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
  };

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
    const s = sma(nb.c, 200), m = {};
    nb.d.forEach((d, i) => { m[d] = { c: nb.c[i], s200: s[i] }; });
    let last = null; const dates = nb.d;
    return (d) => { if (m[d]) return m[d]; // ffill
      let j = dates.length - 1; while (j >= 0 && dates[j] > d) j--; last = j >= 0 ? m[dates[j]] : null; return last; };
  }

  // ------------------------------------------------------------------ trader (algo/engine.py Trader)
  function newTrader(cash, cfg) {
    return { cash, slip: cfg.slippage, stopAtr: cfg.stopAtr, riskPct: cfg.riskPct, qty: 0, stop: null,
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
    t.trades.push({ e: day, ep: p, q, ec: c, stop, f: t.pFeat, s: t.pStrat, bars: 0 });
  }
  function tSell(t, day, px, reason) {
    const p = px * (1 - t.slip / 100), c = cost(t.qty * p, 'SELL');
    t.cash += t.qty * p - c; t.costs += c;
    const tr = t.trades[t.trades.length - 1];
    Object.assign(tr, { x: day, xp: p, xc: c, r: reason });
    tr.pnl = (p - tr.ep) * tr.q - tr.ec - c; tr.ret = tr.pnl / (tr.ep * tr.q) * 100;
    t.qty = 0; t.stop = null;
    return tr;
  }
  function onBar(t, day, o, h, l, c, target, a, allow, feat, strat) {
    let closed = null;
    if (t.pending === 'BUY' && t.qty === 0) tBuy(t, day, o);
    else if (t.pending === 'SELL' && t.qty > 0) closed = tSell(t, day, o, 'signal');
    t.pending = '';
    if (t.qty > 0 && t.stop !== null && l <= t.stop) { closed = tSell(t, day, Math.min(o, t.stop), 'stop'); t.armed = false; }
    if (t.qty > 0) t.trades[t.trades.length - 1].bars++;
    if (target === 0) t.armed = true;
    if (t.qty === 0 && target === 1 && t.armed && allow) {
      t.pending = 'BUY'; t.pAtr = a && !isn(a) ? a : 0; t.pFeat = feat; t.pStrat = strat;
    } else if (t.qty > 0 && target === 0) t.pending = 'SELL';
    t.eq.push(t.cash + t.qty * c);
    if (t.eq.length > SCORE_WINDOW + 5) t.eq.shift();
    return closed;
  }
  const equity = (t, price) => t.cash + t.qty * price;

  function sharpe(eq) {
    if (eq.length < MIN_HISTORY) return NaN;
    const w = eq.slice(-SCORE_WINDOW - 1), r = [];
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

  // ------------------------------------------------------------------ add / remove stocks
  function addTicker(st, sym, today, nowIso) {
    if (st.cfg.tickers.includes(sym)) return false;
    st.cfg.tickers.push(sym);
    st.invested += st.slice;
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
    if (st.tickers[sym]) return st.tickers[sym];
    const alloc = st.slice, sh = {};
    for (const k in STRATEGIES) sh[k] = newTrader(alloc, st.cfg);
    return (st.tickers[sym] = { shadows: sh, sim: newTrader(alloc, st.cfg), live: newTrader(alloc, st.cfg),
      active: null, scores: {}, sinceReview: REVIEW_EVERY, lastClose: null, lt: {}, spark: { d: [], c: [] } });
  }

  function logEvent(st, date, text, kind, at) {
    st.learning.events.push({ date, text, kind, at: at || st._now || new Date().toISOString() });
    if (st.learning.events.length > 300) st.learning.events.shift();
  }

  function review(st, sym, T, date) {
    const scores = {};
    for (const k in T.shadows) scores[k] = sharpe(T.shadows[k].eq);
    T.scores = scores;
    let best = null, bestS = -Infinity;
    for (const k in scores) if (!isn(scores[k]) && scores[k] > bestS) { best = k; bestS = scores[k]; }
    if (best === null) return;
    let cur = T.active; const curS = cur ? scores[cur] : -Infinity;
    if (cur && !(curS >= MIN_SCORE)) cur = null;
    if (bestS >= MIN_SCORE && (cur === null || bestS > curS + HYST)) cur = best;
    if (cur !== T.active) {
      const from = T.active ? STRATEGIES[T.active].label : 'cash', to = cur ? STRATEGIES[cur].label : 'cash';
      const why = cur ? `trailing-year Sharpe ${scores[cur].toFixed(2)}` : `no strategy above ${MIN_SCORE} Sharpe (best ${bestS.toFixed(2)})`;
      logEvent(st, date, `${sym.replace('.NS', '')}: ${from} → ${to} (${why})`, 'switch');
      T.active = cur;
    }
  }

  function updateRules(st, date) {
    const L = st.learning, recent = L.closed.slice(-RULE_WINDOW);
    for (const k in FEATURES) {
      const w = recent.filter((t) => t.f && t.f[k]), wo = recent.filter((t) => t.f && !t.f[k]);
      const mean = (a) => (a.length ? a.reduce((s, t) => s + t.ret, 0) / a.length : NaN);
      const mw = mean(w), mwo = mean(wo), win = (a) => (a.length ? a.filter((t) => t.ret > 0).length / a.length : NaN);
      const r = L.rules[k] || (L.rules[k] = { active: false, since: null });
      Object.assign(r, { nWith: w.length, meanWith: mw, nWithout: wo.length, meanWithout: mwo, winWith: win(w), winWithout: win(wo) });
      const bad = w.length >= RULE_MIN_N && mw < 0 && mw < mwo - RULE_MARGIN;
      const good = !(w.length >= RULE_MIN_N) || mw > 0 || mw > mwo - RULE_MARGIN / 4;
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
    if (!feat) return [];
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
  function run(st, data, nifty, nowMs) {
    migrate(st);
    st._now = new Date(nowMs || Date.now()).toISOString();
    const nl = niftyLookup(nifty.bars);
    const prep = {};
    for (const sym of st.cfg.tickers) {
      if (!data[sym] || !data[sym].bars.d.length) continue;
      const isNew = !st.tickers[sym];
      ensureTicker(st, sym);
      if (!isNew) applySplits(st, sym, data[sym].splits);
      prep[sym] = prepare(data[sym].bars, nl);
      if (isNew && st.lastDate) preRoll(st, sym, prep[sym], data[sym]);
    }
    const dates = [...new Set(Object.values(prep).flatMap((p) => p.raw.d))].sort()
      .filter((d) => st.lastDate === null || d > st.lastDate);
    const before = { trades: liveTradeCount(st), events: st.learning.events.length };

    for (const d of dates) {
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
          if (cl) { st.learning.closed.push({ sym, s: k, e: cl.e, x: cl.x, ret: cl.ret, f: cl.f, r: cl.r, bars: cl.bars });
            if (st.learning.closed.length > 1500) st.learning.closed.shift(); }
        }
        if (++T.sinceReview >= REVIEW_EVERY) { T.sinceReview = 0; review(st, sym, T, d); }
        const pm = d >= st.paperStart ? pauseOn(st, d) : null;
        const tgt = T.removing || pm === 'stop' ? 0 : T.active ? tg[T.active] : 0;
        const blk = blocked(st, feat), allow = blk.length === 0 && !pm && !T.removing;
        if (d >= st.warmStart && d < st.paperStart) onBar(T.sim, d, R.o[i], R.h[i], R.l[i], R.c[i], tgt, a, allow, feat, T.active);
        if (d >= st.paperStart) {
          const had = T.live.pending;
          onBar(T.live, d, R.o[i], R.h[i], R.l[i], R.c[i], tgt, a, allow, feat, T.active);
          if (blk.length && !pm && tgt === 1 && T.live.qty === 0 && T.live.armed && !had)
            T.blockedToday = { d, rules: blk };
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
      const n = nl(d), tot = (k) => Object.values(st.tickers).reduce((s, T) => s + equity(T[k], T.lastClose || 0), 0);
      if (d >= st.warmStart && d < st.paperStart) st.sim.push([d, Math.round(tot('sim')), n ? n.c : null]);
      if (d >= st.paperStart) st.equity.push([d, Math.round(tot('live')), n ? n.c : null, Math.round(st.invested - st.withdrawn)]);
      st.lastDate = d;
    }
    st.lastFetch = nowMs || Date.now();
    delete st._now;
    return { days: dates.length, newTrades: liveTradeCount(st) - before.trades,
      newEvents: st.learning.events.slice(before.events) };
  }

  function liveTradeCount(st) { // entries + exits so far
    return Object.values(st.tickers).reduce((s, T) => s + T.live.trades.length + T.live.trades.filter((t) => t.x).length, 0);
  }

  /** A stock added later: let its shadow strategies and the brain catch up on past data first. */
  function preRoll(st, sym, P, D) {
    const T = st.tickers[sym], R = P.raw;
    for (let i = P.ready; i < R.d.length && R.d[i] <= st.lastDate; i++) {
      const d = R.d[i], feat = P.feats[i], a = P.atr[i], dv = D.divs[d];
      if (dv) Object.values(T.shadows).forEach((t) => { if (t.qty > 0) t.cash += t.qty * dv; });
      for (const k in T.shadows) {
        const tg = resolve(T.lt[k] || 0, P.targets[k], i); T.lt[k] = tg;
        const cl = onBar(T.shadows[k], d, R.o[i], R.h[i], R.l[i], R.c[i], tg, a, true, feat, k);
        if (cl) st.learning.closed.push({ sym, s: k, e: cl.e, x: cl.x, ret: cl.ret, f: cl.f, r: cl.r, bars: cl.bars });
      }
      if (++T.sinceReview >= REVIEW_EVERY) { T.sinceReview = 0; review(st, sym, T, d); }
      T.lastClose = R.c[i];
      T.spark.d.push(d); T.spark.c.push(R.c[i]);
      if (T.spark.d.length > 260) { T.spark.d.shift(); T.spark.c.shift(); }
    }
    review(st, sym, T, st.lastDate); T.sinceReview = 0;
  }

  /** Why a closed losing trade went wrong, in plain words. */
  function diagnose(tr) {
    const tags = [];
    if (tr.f) for (const k in FEATURES) if (tr.f[k]) tags.push(FEATURES[k].lesson);
    if (tr.r === 'stop') tags.push('Stopped out: the move went against the entry by more than the ATR stop');
    if (tr.bars <= 10 && tr.r !== 'stop') tags.push('Whipsaw: the signal reversed within 2 weeks');
    if (!tags.length) tags.push('No obvious mistake – normal losing trade (every strategy has them)');
    return tags;
  }

  function stats(trades) {
    const c = trades.filter((t) => t.x);
    const w = c.filter((t) => t.pnl > 0), l = c.filter((t) => t.pnl <= 0);
    const avg = (a) => (a.length ? a.reduce((s, t) => s + t.ret, 0) / a.length : NaN);
    return { n: c.length, winRate: c.length ? w.length / c.length : NaN, avgWin: avg(w), avgLoss: avg(l),
      pnl: c.reduce((s, t) => s + t.pnl, 0) };
  }

  const api = { cost, sma, ema, rsi, macd, atr, STRATEGIES, FEATURES, parseYahoo, prepare, newState, run,
    diagnose, stats, equity, blocked, sharpe, newTrader, onBar, niftyLookup, resolve, REVIEW_EVERY,
    migrate, pauseOn, isPaused, setPause, addTicker, removeTicker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(this);
