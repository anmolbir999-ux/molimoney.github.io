/* Moli Paper Trader UI. Prices from Yahoo Finance; everything is stored on the phone. */
(function () {
  'use strict';
  const E = window.Engine;
  const NIFTY = '^NSEI';
  const MAX_STOCKS = 25;
  const DEFAULTS = {
    tickers: ['RELIANCE.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'INFY.NS', 'TCS.NS', 'ITC.NS', 'LT.NS', 'SBIN.NS'],
    capital: 500000, stopAtr: 3, riskPct: 0, slippage: 0.05, warmYears: 2,
  };
  // Pick-list (all checked against Yahoo Finance, Nov 2026)
  const CATALOG = {
    'Banks & finance': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'INDUSINDBK', 'BAJFINANCE', 'BAJAJFINSV', 'SHRIRAMFIN', 'JIOFIN', 'HDFCLIFE', 'SBILIFE'],
    'IT': ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM'],
    'Energy & utilities': ['RELIANCE', 'ONGC', 'BPCL', 'NTPC', 'POWERGRID', 'COALINDIA', 'ADANIENT', 'ADANIPORTS'],
    'Consumer': ['ITC', 'HINDUNILVR', 'NESTLEIND', 'TATACONSUM', 'TITAN', 'ASIANPAINT', 'TRENT', 'ETERNAL'],
    'Auto': ['MARUTI', 'M&M', 'TMPV', 'BAJAJ-AUTO', 'HEROMOTOCO', 'EICHERMOT'],
    'Metals & materials': ['TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'ULTRACEMCO', 'GRASIM'],
    'Pharma & health': ['SUNPHARMA', 'CIPLA', 'DRREDDY', 'APOLLOHOSP', 'MAXHEALTH'],
    'Industrials & telecom': ['LT', 'BEL', 'BHARTIARTL', 'INDIGO'],
    'ETFs': ['NIFTYBEES', 'JUNIORBEES', 'BANKBEES', 'ITBEES', 'GOLDBEES'],
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inr = (x) => (x == null || Number.isNaN(x) ? '–' : (x < 0 ? '−₹' : '₹') + Math.abs(Math.round(x)).toLocaleString('en-IN'));
  const px = (x) => (x == null || Number.isNaN(x) ? '–' : '₹' + x.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }));
  const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d) + '%');
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const sym = (s) => s.replace('.NS', '');
  const fdate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '–');
  const IST = 19800000;
  const ist = () => new Date(Date.now() + IST);
  const todayIST = () => ist().toISOString().slice(0, 10);
  const nowIso = () => new Date().toISOString();
  const istStamp = (ms) => new Date((ms || Date.now()) + IST).toISOString().replace('T', ' ').slice(0, 19) + ' IST';

  // ---------------------------------------------------------------- native bridge
  const N = window.Android;
  const waiting = {}; let seq = 0;
  window.__resolve = (id, ok, body) => { const w = waiting[id]; if (!w) return; delete waiting[id]; ok ? w.res(body) : w.rej(new Error(body)); };
  function httpGet(url) {
    if (N) return new Promise((res, rej) => { const id = 'r' + ++seq; waiting[id] = { res, rej }; N.get(id, url); });
    return fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  }
  const store = {
    load() { try { const s = N ? N.load() : localStorage.getItem('pt_state'); return s ? E.migrate(JSON.parse(s)) : null; } catch (e) { return null; } },
    save(x) { const s = JSON.stringify(x); if (N) N.save(s); else try { localStorage.setItem('pt_state', s); } catch (e) { /* ignore */ } },
    clear() { if (N) N.save(''); else try { localStorage.removeItem('pt_state'); } catch (e) { /* ignore */ } },
  };
  const pref = {
    get(k, d) { try { const v = localStorage.getItem('pt_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pt_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  function download(name, mime, text) {
    if (N && N.download) {
      const where = N.download(name, mime, text);
      return where ? toast('Saved to ' + where) : toast('Could not save ' + name);
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    toast('Downloaded ' + name);
  }

  let st = store.load();
  let tab = 'home';
  let busy = false, cancel = false;
  let setupPicks = new Set(DEFAULTS.tickers);
  let query = '';

  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3800); }

  // ---------------------------------------------------------------- market clock & countdowns
  const at = (d, h, m) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m) - IST;
  function market() {
    const n = ist(), day = n.getUTCDay(), mins = n.getUTCHours() * 60 + n.getUTCMinutes();
    const weekday = day >= 1 && day <= 5, openM = 9 * 60 + 15, closeM = 15 * 60 + 30;
    if (weekday && mins >= openM && mins < closeM) return { open: true, closeAt: at(n, 15, 30), nextOpen: nextOpen(n, mins, openM) };
    return { open: false, nextOpen: nextOpen(n, mins, openM) };
  }
  function nextOpen(n, mins, openM) {
    for (let k = 0; k < 8; k++) {
      const d = new Date(n.getTime() + k * 864e5), wd = d.getUTCDay();
      if (wd >= 1 && wd <= 5 && (k > 0 || mins < openM)) return at(d, 9, 15);
    }
    return null;
  }
  function dur(ms) {
    if (ms <= 0) return 'now';
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
    if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }
  const cdSpan = (ts) => `<span class="cd" data-cd="${ts}">${dur(ts - Date.now())}</span>`;
  function tickCountdowns() {
    document.querySelectorAll('[data-cd]').forEach((el) => { el.textContent = dur(+el.dataset.cd - Date.now()); });
  }
  function marketChip() {
    const mk = market();
    return mk.open ? `<span class="chip live">Market open · closes in ${cdSpan(mk.closeAt)}</span>`
      : `<span class="chip closed">Market closed · opens in ${cdSpan(mk.nextOpen)}</span>`;
  }

  function setStatus() {
    if (busy) return;
    if (!st) { $('status').textContent = 'Not started'; return; }
    const ago = st.lastFetch ? Math.round((Date.now() - st.lastFetch) / 60000) : null;
    const a = ago == null ? 'never' : ago < 1 ? 'just now' : ago < 60 ? ago + ' min ago' : ago < 1440 ? Math.round(ago / 60) + ' h ago' : Math.round(ago / 1440) + ' d ago';
    $('status').textContent = `Updated ${a} · data to ${fdate(st.lastDate)}`;
  }

  // ---------------------------------------------------------------- update with ETA + stop
  function rangeFor() {
    if (!st.lastDate) return st.cfg.warmYears + 2 <= 5 ? '5y' : '10y';
    const gap = (Date.now() - new Date(st.lastDate).getTime()) / 864e5;
    const newStock = st.cfg.tickers.some((t) => !st.tickers[t]);
    return newStock ? '5y' : gap < 300 ? '2y' : gap < 1100 ? '5y' : '10y';
  }
  const url = (s, r) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=${r}&interval=1d&events=div%2Csplit`;

  function progress(done, total, label) {
    const avg = pref.get('fetch_ms', 900), think = st && !st.lastDate ? 1500 : 400;
    const left = (total - done) * avg + think;
    $('progress').hidden = false;
    $('bar').style.width = Math.round((done / (total + 1)) * 100) + '%';
    $('eta').textContent = `${label} · about ${Math.max(1, Math.round(left / 1000))}s left`;
    $('status').textContent = `${done}/${total} downloaded`;
  }

  async function update() {
    if (!st) return;
    if (train.phase === 'loading') { cancel = true; return; }
    if (busy) { cancel = true; $('updateBtn').textContent = 'Stopping…'; return; }
    busy = true; cancel = false;
    const btn = $('updateBtn'); btn.textContent = 'Stop'; btn.classList.add('stop');
    const run = { started: nowIso(), status: 'ok', days: 0, from: null, to: null, msg: '' };
    const syms = [NIFTY, ...st.cfg.tickers], r = rangeFor(), data = {}, failed = [];
    let nifty = null;
    try {
      for (let i = 0; i < syms.length; i++) {
        if (cancel) throw new Error('stopped');
        progress(i, syms.length, `Downloading ${syms[i] === NIFTY ? 'Nifty 50' : sym(syms[i])}`);
        const t0 = Date.now();
        try {
          const p = E.parseYahoo(await httpGet(url(syms[i], r)));
          if (syms[i] === NIFTY) nifty = p; else data[syms[i]] = p;
          pref.set('fetch_ms', Math.round(0.7 * pref.get('fetch_ms', 900) + 0.3 * (Date.now() - t0)));
        } catch (e) {
          if (syms[i] === NIFTY) throw e;
          failed.push(sym(syms[i]));
        }
      }
      if (cancel) throw new Error('stopped');
      progress(syms.length, syms.length, st.lastDate ? 'Trading & learning' : 'Brain practising on past data');
      await new Promise((ok) => setTimeout(ok, 40));
      const before = st.lastDate;
      const res = E.run(st, data, nifty, Date.now());
      Object.assign(run, { days: res.days, from: res.days ? (before || st.warmStart) : null, to: st.lastDate });
      const learned = res.newEvents.filter((e) => e.kind === 'learn' || e.kind === 'unlearn').length;
      if (res.days > 300) toast(`Practised on ${res.days} past sessions · ${learned} lessons learned. Paper trading starts now.`);
      else toast(res.days ? `${res.days} new session${res.days > 1 ? 's' : ''}` + (res.newTrades ? ` · ${res.newTrades} trade event${res.newTrades > 1 ? 's' : ''}` : '') + (learned ? ` · ${learned} lesson${learned > 1 ? 's' : ''}` : '') : 'Already up to date');
      if (failed.length) { run.msg = 'Could not fetch: ' + failed.join(', '); toast(run.msg); }
    } catch (e) {
      run.status = e.message === 'stopped' ? 'stopped' : 'failed';
      run.msg = run.status === 'stopped' ? 'Stopped by you – nothing changed' : e.message;
      toast(run.status === 'stopped' ? 'Update stopped – nothing changed' : 'Update failed – check internet');
    }
    run.finished = nowIso();
    st.runs.push(run); if (st.runs.length > 500) st.runs.shift();
    store.save(st);
    busy = false; cancel = false;
    btn.textContent = 'Update'; btn.classList.remove('stop');
    $('progress').hidden = true;
    setStatus(); render();
  }

  // ---------------------------------------------------------------- charts
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  let gid = 0;
  /** Minimal profit/loss chart: area shaded green above the start, red below. */
  function pnlChart(v) {
    const W = 340, H = 170, P = 4;
    if (v.length < 2) return '';
    const lo = Math.min(100, ...v), hi = Math.max(100, ...v), n = v.length;
    const X = (i) => P + (i / (n - 1)) * (W - 2 * P), Y = (y) => P + (1 - (y - lo) / (hi - lo || 1)) * (H - 2 * P);
    const y0 = Y(100), up = css('--up'), dn = css('--down'), id = 'g' + ++gid;
    const line = v.map((y, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join('');
    const area = `${line}L${X(n - 1).toFixed(1)},${y0.toFixed(1)}L${X(0).toFixed(1)},${y0.toFixed(1)}Z`;
    const last = v[n - 1];
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${id}u" x1="0" y1="${P}" x2="0" y2="${y0}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${up}" stop-opacity=".5"/><stop offset="1" stop-color="${up}" stop-opacity="0"/></linearGradient>
        <linearGradient id="${id}d" x1="0" y1="${y0}" x2="0" y2="${H - P}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${dn}" stop-opacity="0"/><stop offset="1" stop-color="${dn}" stop-opacity=".5"/></linearGradient>
        <clipPath id="${id}a"><rect x="0" y="0" width="${W}" height="${y0}"/></clipPath>
        <clipPath id="${id}b"><rect x="0" y="${y0}" width="${W}" height="${H - y0}"/></clipPath>
      </defs>
      <path d="${area}" fill="url(#${id}u)" clip-path="url(#${id}a)"/>
      <path d="${area}" fill="url(#${id}d)" clip-path="url(#${id}b)"/>
      <line x1="0" x2="${W}" y1="${y0}" y2="${y0}" stroke="${css('--line')}" stroke-width="1" stroke-dasharray="3 3"/>
      <path d="${line}" fill="none" stroke="${up}" stroke-width="2" stroke-linejoin="round" clip-path="url(#${id}a)"/>
      <path d="${line}" fill="none" stroke="${dn}" stroke-width="2" stroke-linejoin="round" clip-path="url(#${id}b)"/>
      <circle cx="${X(n - 1).toFixed(1)}" cy="${Y(last).toFixed(1)}" r="4" fill="${last >= 100 ? up : dn}"/>
    </svg>`;
  }
  /** Time-weighted return index (adding/removing stocks is a deposit/withdrawal, not profit). */
  function returnIndex(rows) {
    if (!rows.length) return [];
    const out = [100]; let idx = 100;
    for (let i = 1; i < rows.length; i++) {
      const flow = (rows[i][3] || 0) - (rows[i - 1][3] || 0), base = rows[i - 1][1] + flow;
      idx *= base > 0 ? rows[i][1] / base : 1; out.push(idx);
    }
    return out;
  }
  function maxDD(v) { let pk = -Infinity, dd = 0; v.forEach((x) => { pk = Math.max(pk, x); dd = Math.min(dd, x / pk - 1); }); return dd * 100; }

  const eqNow = () => Object.values(st.tickers).reduce((s, t) => s + E.equity(t.live, t.lastClose || 0), 0);

  // ---------------------------------------------------------------- views
  function viewHome() {
    if (!st.lastDate) return `<div class="card"><p class="empty">Tap <b>Update</b> to download prices and start.</p><div class="chips">${marketChip()}</div></div>`;
    const eq = eqNow(), pnl = eq + st.withdrawn - st.invested, idx = returnIndex(st.equity);
    const ret = idx.length ? idx[idx.length - 1] - 100 : 0;
    const nf = st.equity.filter((r) => r[2]), nRet = nf.length > 1 ? (nf[nf.length - 1][2] / nf[0][2] - 1) * 100 : null;
    const paused = E.isPaused(st);
    let h = `<div class="card hero">
      <div class="m">Paper account value</div>
      <div class="big">${inr(eq)}</div>
      <p class="sub"><b class="${cls(pnl)}">${inr(pnl)} (${pct(ret, 2)})</b> since ${fdate(st.paperStart)}${nRet != null ? ` · Nifty ${pct(nRet, 2)}` : ''}</p>`;
    if (idx.length >= 2) h += pnlChart(idx);
    else if (st.sim.length > 20) {
      const s = returnIndex(st.sim.map((r) => [r[0], r[1], r[2], 0]));
      const sn = st.sim.filter((r) => r[2]), snr = (sn[sn.length - 1][2] / sn[0][2] - 1) * 100;
      h += pnlChart(s) + `<p class="sub">Brain's practice run ${fdate(st.sim[0][0])} – ${fdate(st.sim[st.sim.length - 1][0])}: ${pct(s[s.length - 1] - 100)} (max drawdown ${pct(maxDD(s))}) vs Nifty ${pct(snr)}. Real paper trading started ${fdate(st.paperStart)}.</p>`;
    }
    h += `<div class="chips">${marketChip()}${paused ? `<span class="chip paused">${paused === 'stop' ? 'Stopped' : 'Paused'}</span>` : ''}</div></div>`;

    if (paused) h += `<div class="banner">${paused === 'stop' ? 'Trading stopped: positions are sold at the next open and no new buys are made.' : 'Trading paused: no new buys. Open positions keep their stop-loss and exit signals.'}<div class="actions"><button class="btn sm" id="resume">Resume trading</button></div></div>`;
    else h += `<div class="actions" style="margin:4px 0 0"><button class="btn ghost sm" id="pause">Pause new buys</button><button class="btn warn sm" id="stopall">Stop &amp; sell all</button></div>`;

    const T = st.tickers, mk = market();
    const pend = Object.entries(T).filter(([, t]) => t.live.pending);
    const blk = Object.entries(T).filter(([, t]) => t.blockedToday && t.blockedToday.d === st.lastDate);
    if (pend.length || blk.length) {
      h += `<div class="sec">Next open · in ${cdSpan(mk.nextOpen)}</div><div class="card">`;
      h += pend.map(([s, t]) => `<div class="row"><div><b>${t.live.pending === 'BUY' ? 'Buy' : 'Sell'} ${sym(s)}</b><div class="m">${t.removing ? 'removing stock' : esc(E.STRATEGIES[t.active]?.label || 'exit to cash')}</div></div><div class="r m">at the open</div></div>`).join('');
      h += blk.map(([s, t]) => `<div class="row"><div><b>Skip ${sym(s)}</b><div class="m">${esc(E.STRATEGIES[t.active]?.label || '')} said buy – blocked by a learned rule: ${t.blockedToday.rules.map((k) => esc(E.FEATURES[k].label.toLowerCase())).join(', ')}</div></div></div>`).join('');
      h += `</div>`;
    }
    const pos = Object.entries(T).filter(([, t]) => t.live.qty > 0);
    h += `<div class="sec">Positions</div><div class="card">`;
    h += pos.length ? pos.map(([s, t]) => {
      const tr = t.live.trades[t.live.trades.length - 1], r = (t.lastClose / tr.ep - 1) * 100;
      return `<div class="row"><div><b>${sym(s)}</b><div class="m">${tr.q} @ ${px(tr.ep)} · ${esc(E.STRATEGIES[tr.s]?.label || '')}${tr.stop ? ` · stop ${px(tr.stop)}` : ''}</div></div>
        <div class="r"><b class="${cls(r)}">${pct(r)}</b><div class="m">${inr((t.lastClose - tr.ep) * tr.q)}</div></div></div>`;
    }).join('') : `<p class="empty">No open positions – all ${inr(eq)} in cash.</p>`;
    h += `</div>`;
    const nextReview = Math.min(...Object.values(T).map((t) => E.REVIEW_EVERY - t.sinceReview));
    h += `<p class="note">Next strategy review in ${Number.isFinite(nextReview) ? nextReview : '–'} session${nextReview === 1 ? '' : 's'}. Countdowns don't include NSE holidays. New prices arrive after 3:45 PM.</p>`;
    return h;
  }

  function stockRow(s, inAcct) {
    const t = st && st.tickers[s];
    const meta = t ? `${t.active ? esc(E.STRATEGIES[t.active].label) : 'cash'}${t.live.qty ? ` · holding ${t.live.qty}` : ''}${t.removing ? ' · removing' : ''}` : inAcct && st ? 'added – downloads on next update' : '';
    const price = t && t.lastClose ? px(t.lastClose) : '';
    return `<div class="row"><div><b>${sym(s)}</b><div class="m">${meta}</div></div>
      <div style="display:flex;align-items:center;gap:10px"><span class="m">${price}</span>
      <button class="add ${inAcct ? 'rm' : ''}" data-${inAcct ? 'rm' : 'add'}="${esc(s)}" aria-label="${inAcct ? 'Remove' : 'Add'} ${sym(s)}">${inAcct ? '−' : '+'}</button></div></div>`;
  }

  function pickList(selected) {
    const q = query.trim().toUpperCase();
    let h = '';
    for (const [grp, list] of Object.entries(CATALOG)) {
      const items = list.map((x) => x + '.NS').filter((x) => !selected.has(x) && (!q || x.includes(q)));
      if (!items.length) continue;
      h += `<div class="grp">${grp}</div>` + items.map((x) => stockRow(x, false)).join('');
    }
    return h || `<p class="empty">No match in the list – add it as a custom symbol below.</p>`;
  }

  function viewStocks() {
    const inAcct = st ? st.cfg.tickers : [...setupPicks];
    const selected = new Set(inAcct);
    let h = `<div class="sec">Your stocks · ${inAcct.length}/${MAX_STOCKS}</div><div class="card">${inAcct.length ? inAcct.map((s) => stockRow(s, true)).join('') : '<p class="empty">No stocks yet.</p>'}</div>`;
    if (st) h += `<p class="note" style="margin-top:0">Each added stock gets ₹${Math.round(st.slice).toLocaleString('en-IN')} of paper money. Removing a stock sells it at the next open and withdraws its cash.</p>`;
    h += `<div class="sec">Add stocks</div><div class="card"><input id="q" placeholder="Search NIFTY 50 & ETFs" value="${esc(query)}" autocomplete="off"><div id="pick">${pickList(selected)}</div>
      <label>Custom NSE symbol</label><div style="display:flex;gap:8px"><input id="custom" placeholder="e.g. PIDILITIND" autocapitalize="characters"><button class="btn sm" id="addCustom">Add</button></div></div>`;
    return h;
  }

  function viewBrain() {
    if (!st.lastDate) return `<p class="empty">The brain starts after the first update.</p>`;
    const R = st.learning.rules;
    let h = `<div class="card"><p class="sub" style="margin:0">Each stock runs ${Object.keys(E.STRATEGIES).length} strategies in hidden paper accounts. Every ${E.REVIEW_EVERY} sessions the brain picks whichever worked best over the last year – or cash if none did. Losing trades are tagged; conditions that keep losing become rules.</p></div>`;
    h += `<div class="sec">Learned rules</div><div class="card">` + Object.entries(E.FEATURES).map(([k, f]) => {
      const r = R[k] || {};
      const ev = r.nWith ? `${r.nWith} trades with it: avg ${pct(r.meanWith)}, win ${Math.round((r.winWith || 0) * 100)}% · without: avg ${pct(r.meanWithout)}` : 'Not enough trades yet';
      return `<div class="row"><div><b>${esc(f.label)}</b><div class="m">${ev}</div></div><div class="r"><span class="pill ${r.active ? 'on' : ''}">${r.active ? 'Avoid' : 'OK'}</span></div></div>`;
    }).join('') + `</div>`;
    h += `<div class="sec">Strategy per stock</div><div class="card">` + Object.entries(st.tickers).map(([s, t]) => {
      const rows = Object.entries(t.scores || {}).filter(([, v]) => v != null && !Number.isNaN(v)).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<tr><td>${k === t.active ? '<b>' : ''}${esc(E.STRATEGIES[k].label)}${k === t.active ? '</b>' : ''}</td><td class="${cls(v)}">${v.toFixed(2)}</td></tr>`).join('');
      return `<details class="row" style="display:block"><summary style="display:flex;justify-content:space-between"><b>${sym(s)}</b><span class="m">${t.active ? esc(E.STRATEGIES[t.active].label) : 'Cash'} · review in ${E.REVIEW_EVERY - t.sinceReview} ›</span></summary>
        <table><tr><td class="m">Strategy</td><td class="m">Sharpe, last year</td></tr>${rows || '<tr><td class="m">Not scored yet</td><td></td></tr>'}</table></details>`;
    }).join('') + `</div>`;
    const evs = st.learning.events.slice(-50).reverse();
    h += `<div class="sec">What happened</div><div class="card">` + (evs.length ? evs.map((e) => `<div class="ev"><span class="d">${fdate(e.date)}${e.date < st.paperStart ? ' · practice' : ''}${e.at && e.kind === 'user' ? ' · ' + istStamp(Date.parse(e.at)).slice(11, 16) : ''}</span><br>${esc(e.text)}</div>`).join('') : '<p class="empty">Nothing yet.</p>') + `</div>`;
    return h;
  }

  function allLiveTrades() {
    return [...Object.entries(st.tickers).flatMap(([s, t]) => t.live.trades.map((x) => ({ ...x, sym: s }))), ...st.archive];
  }

  function viewJournal() {
    if (!st.lastDate) return `<p class="empty">No trades yet.</p>`;
    const liveTr = allLiveTrades();
    const simTr = Object.entries(st.tickers).flatMap(([s, t]) => t.sim.trades.filter((x) => x.x).map((x) => ({ ...x, sym: s })));
    const useSim = liveTr.filter((t) => t.x).length === 0;
    const list = (useSim ? simTr : liveTr).sort((a, b) => (b.x || b.e).localeCompare(a.x || a.e));
    const S = E.stats(list);
    let h = useSim ? `<p class="sub">No closed paper trades yet – showing the brain's practice trades from before ${fdate(st.paperStart)}.</p>` : '';
    h += `<div class="card"><div class="grid">
      <div><div class="m">Closed trades</div><div class="stat">${S.n}</div></div>
      <div><div class="m">Win rate</div><div class="stat">${Number.isNaN(S.winRate) ? '–' : Math.round(S.winRate * 100) + '%'}</div></div>
      <div style="margin-top:10px"><div class="m">Avg win / loss</div><div><b class="up">${pct(S.avgWin)}</b> / <b class="down">${pct(S.avgLoss)}</b></div></div>
      <div style="margin-top:10px"><div class="m">Net P&amp;L</div><div><b class="${cls(S.pnl)}">${inr(S.pnl)}</b></div></div></div></div>`;
    const tally = {};
    list.filter((t) => t.x && t.pnl <= 0).forEach((t) => E.diagnose(t).forEach((g) => { tally[g] = (tally[g] || 0) + 1; }));
    const tl = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (tl.length) h += `<div class="sec">Most common mistakes</div><div class="card">` + tl.slice(0, 6).map(([g, n]) => `<div class="row"><div>${esc(g)}</div><div class="r"><b>${n}</b></div></div>`).join('') + `</div>`;
    h += `<div class="sec">Trades</div><div class="card">` + (list.length ? list.slice(0, 80).map((t) => {
      const open = !t.x, last = st.tickers[t.sym]?.lastClose, r = open ? (last / t.ep - 1) * 100 : t.ret;
      const tags = !open && t.pnl <= 0 ? `<ul class="tags">${E.diagnose(t).map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '';
      return `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px">
        <div><b>${sym(t.sym)}</b> <span class="m">${esc(E.STRATEGIES[t.s]?.label || '')}</span>
        <div class="m">${fdate(t.e)} → ${open ? 'open' : fdate(t.x) + (t.r === 'stop' ? ' (stop)' : '')} · ${t.q} @ ${px(t.ep)}</div></div>
        <div class="r"><b class="${cls(r)}">${pct(r)}</b><div class="m">${open ? '' : inr(t.pnl)}</div></div></div>${tags}</div>`;
    }).join('') : '<p class="empty">No trades yet. The brain only buys when a strategy it trusts gives a fresh signal.</p>') + `</div>`;
    return h;
  }

  function viewSetup() {
    const c = DEFAULTS;
    return `<div class="card hero"><div class="big" style="font-size:26px">Start paper trading</div>
      <p class="sub">Free Yahoo Finance prices. No money, no broker – fills are simulated at the next session's open with Indian costs (STT, stamp duty, GST, DP) and slippage. The brain practises on past data first.</p></div>
      <div class="card"><div class="grid">
        <div><label>Paper capital (₹)</label><input id="s_c" inputmode="numeric" value="${c.capital}"></div>
        <div><label>Practice years</label><input id="s_w" inputmode="numeric" value="${c.warmYears}"></div>
        <div><label>Stop-loss (× ATR, 0 = off)</label><input id="s_s" inputmode="decimal" value="${c.stopAtr}"></div>
        <div><label>Risk per trade % (0 = full)</label><input id="s_r" inputmode="decimal" value="${c.riskPct}"></div>
      </div><div class="actions"><button class="btn" id="s_go">Start with ${setupPicks.size} stock${setupPicks.size === 1 ? '' : 's'}</button></div></div>` + viewStocks();
  }

  function viewMore() {
    let h = '';
    if (N && N.canRemind && N.canRemind()) h += `<div class="sec">Reminder</div><div class="card"><div class="switch"><input type="checkbox" id="s_rem" ${N.reminderOn() ? 'checked' : ''}><span>Remind me at 4:15 PM on weekdays to update</span></div></div>`;
    h += `<div class="sec">Download your data</div><div class="card">
      <div class="row"><div><b>Trades</b><div class="m">Every paper &amp; practice trade: dates, prices, P&amp;L, mistake tags</div></div><button class="btn sm" data-dl="trades">CSV</button></div>
      <div class="row"><div><b>Daily equity</b><div class="m">Date, account value, capital, return, Nifty</div></div><button class="btn sm" data-dl="equity">CSV</button></div>
      <div class="row"><div><b>Brain log</b><div class="m">Every switch, lesson and action, with timestamps</div></div><button class="btn sm" data-dl="brain">CSV</button></div>
      <div class="row"><div><b>Update history</b><div class="m">When each update ran, what it processed, stopped or failed</div></div><button class="btn sm" data-dl="runs">CSV</button></div>
      <div class="row"><div><b>Training runs</b><div class="m">Every past-period training: dates, return vs Nifty, drawdown, trades</div></div><button class="btn sm" data-dl="trainings">CSV</button></div>
      <div class="row"><div><b>Full backup</b><div class="m">Everything, as JSON</div></div><button class="btn sm" data-dl="backup">JSON</button></div>
      <p class="m" style="margin:8px 0 0">File names include the export time, e.g. moli-trades-2026-11-26_16-30-05.csv</p></div>`;
    h += `<div class="sec">Account</div><div class="card">
      <div class="row"><div><b>Started</b><div class="m">${fdate(st.paperStart)} · paper money put in ${inr(st.invested)}${st.withdrawn ? ` · withdrawn ${inr(st.withdrawn)}` : ''}</div></div></div>
      <div class="row"><div><b>Settings</b><div class="m">Stop ${st.cfg.stopAtr}× ATR · risk ${st.cfg.riskPct ? st.cfg.riskPct + '%' : 'full slice'} · ${st.cfg.warmYears}y practice</div></div></div>
      <div class="actions"><button class="btn warn sm" id="s_del">Delete account &amp; start over</button></div></div>`;
    return h;
  }


  // ---------------------------------------------------------------- training on the past
  const MIN_TRAIN = '2008-01-01';
  let train = { phase: 'setup', preset: '5y', from: '', to: '', brain: 'fresh', speed: 4 };
  const yearsAgo = (n) => { const d = new Date(todayIST() + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };
  const PRESETS = {
    '1y': ['Last year', () => [yearsAgo(1), todayIST()]],
    '3y': ['Last 3 years', () => [yearsAgo(3), todayIST()]],
    '5y': ['Last 5 years', () => [yearsAgo(5), todayIST()]],
    '10y': ['Last 10 years', () => [yearsAgo(10), todayIST()]],
    covid: ['COVID crash 2019–21', () => ['2019-07-01', '2021-06-30']],
    gfc: ['2008 crisis 2008–10', () => ['2008-01-01', '2010-12-31']],
    custom: ['Custom dates', () => [train.from || yearsAgo(3), train.to || todayIST()]],
  };
  const SPEEDS = [1, 4, 16, 64]; // × 2 trading days per second
  const trainUrl = (s, p1, p2) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
  const down = (v, n) => (v.length <= n ? v : Array.from({ length: n }, (_, i) => v[Math.round((i * (v.length - 1)) / (n - 1))]));

  function trainRange() {
    let [a, b] = PRESETS[train.preset][1]();
    if (a < MIN_TRAIN) a = MIN_TRAIN;
    if (b > todayIST()) b = todayIST();
    return [a, b];
  }

  async function startTraining() {
    if (busy) return toast('Wait for the update to finish');
    const [start, end] = trainRange();
    if ((Date.parse(end) - Date.parse(start)) / 864e5 < 90) return toast('Pick a period of at least 3 months');
    busy = true; cancel = false;
    train = { ...train, phase: 'loading', start, end, label: train.preset === 'custom' ? `${fdate(start)} – ${fdate(end)}` : PRESETS[train.preset][0] };
    render();
    const btn = $('updateBtn'); btn.textContent = 'Stop'; btn.classList.add('stop');
    const p1 = Math.floor(Date.parse(start) / 1000) - 760 * 86400, p2 = Math.floor(Date.parse(end) / 1000) + 86400;
    const syms = [NIFTY, ...st.cfg.tickers], data = {}, missing = [];
    let nifty = null;
    try {
      for (let i = 0; i < syms.length; i++) {
        if (cancel) throw new Error('stopped');
        progress(i, syms.length, `Downloading ${syms[i] === NIFTY ? 'Nifty 50' : sym(syms[i])} history`);
        try {
          const p = E.parseYahoo(await httpGet(trainUrl(syms[i], p1, p2)));
          if (syms[i] === NIFTY) nifty = p; else if (p.bars.d.length > 260) data[syms[i]] = p; else missing.push(sym(syms[i]));
        } catch (e) { if (syms[i] === NIFTY) throw e; missing.push(sym(syms[i])); }
      }
      if (cancel) throw new Error('stopped');
      const tickers = st.cfg.tickers.filter((t) => data[t]);
      if (!tickers.length) throw new Error('No stock has data for that period');
      const lessons = train.brain === 'lessons' ? E.lessonsBefore(st, start) : [];
      const tst = E.newTraining({ ...st.cfg, tickers, capital: st.slice * tickers.length }, start, end, lessons);
      progress(syms.length, syms.length, 'Warming up');
      await new Promise((ok) => setTimeout(ok, 30));
      const ctx = E.begin(tst, data, nifty, Date.now());
      E.skipTo(ctx, start);
      Object.assign(train, { phase: 'running', tst, ctx, playing: true, acc: 0, missing, lessons: lessons.length, total: E.daysLeft(ctx) });
      train.timer = setInterval(trainTick, 100);
    } catch (e) {
      toast(e.message === 'stopped' ? 'Training cancelled' : 'Could not load history – ' + e.message);
      train.phase = 'setup';
    }
    busy = false; cancel = false;
    btn.textContent = 'Update'; btn.classList.remove('stop'); $('progress').hidden = true;
    render();
  }

  function trainTick() {
    if (!train.ctx || !train.playing) return;
    train.acc += (train.speed * 2) / 10;
    const n = Math.floor(train.acc); train.acc -= n;
    if (n > 0 && E.stepDays(train.ctx, n) === 0) return trainDone();
    if (tab === 'train') render();
  }

  function trainDone() {
    clearInterval(train.timer);
    E.finish(train.ctx);
    const tst = train.tst, eq = tst.equity, idx = returnIndex(eq);
    const nf = eq.filter((r) => r[2]), trades = Object.entries(tst.tickers).flatMap(([s, t]) => t.live.trades.map((x) => ({ ...x, sym: s })));
    const S = E.stats(trades);
    const sum = { id: Date.now().toString(36), at: nowIso(), label: train.label, start: eq[0]?.[0] || train.start, end: eq[eq.length - 1]?.[0] || train.end,
      brain: train.brain, stocks: Object.keys(tst.tickers).length, ret: idx.length ? idx[idx.length - 1] - 100 : 0,
      nret: nf.length > 1 ? (nf[nf.length - 1][2] / nf[0][2] - 1) * 100 : null, dd: maxDD(idx), trades: S.n, win: S.winRate,
      pnl: S.pnl, taught: false, curve: down(idx, 120).map((x) => Math.round(x * 10) / 10) };
    st.trainings.push(sum); if (st.trainings.length > 30) st.trainings.shift();
    store.save(st);
    Object.assign(train, { phase: 'done', playing: false, summary: sum, trades, preview: E.previewTeach(st, tst, todayIST()) });
    if (tab === 'train') render(); else toast('Training finished – see the Train tab');
  }

  function teachLive() {
    const r = E.teach(st, train.tst, todayIST(), `${train.summary.label} (${fdate(train.summary.start)} – ${fdate(train.summary.end)})`);
    train.summary.taught = true;
    const h = st.trainings.find((x) => x.id === train.summary.id); if (h) h.taught = true;
    store.save(st); train.preview = null; render();
    toast(`Live brain learned from ${r.added} past trades`);
  }

  function viewTrain() {
    const ph = train.phase;
    if (ph === 'loading') return `<div class="card hero"><div class="big" style="font-size:24px">Loading history…</div><p class="sub">${esc(train.label)}. Tap Stop to cancel.</p></div>`;
    if (ph === 'running' || ph === 'done') {
      const tst = train.tst, eq = tst.equity, idx = returnIndex(eq), last = eq[eq.length - 1];
      const nf = eq.filter((r) => r[2]), nret = nf.length > 1 ? (nf[nf.length - 1][2] / nf[0][2] - 1) * 100 : null;
      const ret = idx.length ? idx[idx.length - 1] - 100 : 0, done = train.total - E.daysLeft(train.ctx);
      let h = `<div class="card hero"><div class="m">${ph === 'done' ? 'Training finished' : 'Trading the past'} · ${esc(train.label)}</div>
        <div class="big" style="font-size:28px">${last ? fdate(last[0]) : fdate(train.start)}</div>
        <p class="sub"><b class="${cls(ret)}">${pct(ret, 1)}</b> · ${inr(last ? last[1] : 0)}${nret != null ? ` · Nifty ${pct(nret)}` : ''}${idx.length > 1 ? ` · max drawdown ${pct(maxDD(idx))}` : ''}</p>
        ${pnlChart(down(idx, 400))}
        <div class="progress" style="padding:10px 0 0"><div class="bar" style="width:${Math.round((done / Math.max(train.total, 1)) * 100)}%"></div></div>
        <div class="m" style="margin-top:6px">${done}/${train.total} sessions${ph === 'running' && train.playing ? ` · about ${Math.ceil((train.total - done) / (train.speed * 2))}s left` : ''}</div>`;
      if (ph === 'running') {
        h += `<div class="actions"><button class="btn sm" id="t_play">${train.playing ? 'Pause' : 'Play'}</button>
          ${SPEEDS.map((x) => `<button class="chip ${x === train.speed ? 'on' : ''}" data-speed="${x}">${x}×</button>`).join('')}
          <button class="btn ghost sm" id="t_skip">Skip to end</button><button class="btn warn sm" id="t_stop">Stop</button></div>`;
      }
      h += `</div>`;
      if (train.missing && train.missing.length) h += `<p class="note" style="margin-top:0">No data for ${esc(train.missing.join(', '))} in this period – left out.</p>`;
      if (ph === 'done') {
        const s = train.summary, P = train.preview;
        h += `<div class="card"><div class="grid">
          <div><div class="m">Trades</div><div class="stat">${s.trades}</div></div>
          <div><div class="m">Win rate</div><div class="stat">${Number.isNaN(s.win) ? '–' : Math.round(s.win * 100) + '%'}</div></div>
          <div style="margin-top:10px"><div class="m">Net P&amp;L</div><b class="${cls(s.pnl)}">${inr(s.pnl)}</b></div>
          <div style="margin-top:10px"><div class="m">vs Nifty</div><b class="${cls(s.ret - (s.nret || 0))}">${s.nret == null ? '–' : pct(s.ret - s.nret) + ' pts'}</b></div></div></div>`;
        h += `<div class="sec">Teach the live brain</div><div class="card">`;
        if (s.taught) h += `<p class="empty">Done – your live brain now includes these ${train.tst.learning.closed.length} past trades as evidence.</p>`;
        else {
          const ch = [...P.newRules.map((k) => `<li>Start avoiding: ${esc(E.FEATURES[k].label.toLowerCase())}</li>`), ...P.dropped.map((k) => `<li>Stop avoiding: ${esc(E.FEATURES[k].label.toLowerCase())}</li>`)];
          h += `<p class="sub" style="margin:0">Adds ${P.added} past trades (from all ${Object.keys(E.STRATEGIES).length} strategies) to the evidence your live brain uses for its rules.</p>
            <ul class="tags">${ch.length ? ch.join('') : '<li>No rule would change right now – it just adds evidence.</li>'}</ul>
            <div class="actions"><button class="btn sm" id="t_teach"${P.added ? '' : ' disabled'}>Teach my live brain</button></div>`;
        }
        h += `</div>`;
        const tally = {};
        train.trades.filter((t) => t.x && t.pnl <= 0).forEach((t) => E.diagnose(t).forEach((g) => { tally[g] = (tally[g] || 0) + 1; }));
        const tl = Object.entries(tally).sort((a, b) => b[1] - a[1]);
        if (tl.length) h += `<div class="sec">Mistakes in this period</div><div class="card">` + tl.slice(0, 5).map(([g, n]) => `<div class="row"><div>${esc(g)}</div><div class="r"><b>${n}</b></div></div>`).join('') + `</div>`;
        h += `<div class="actions"><button class="btn ghost sm" data-dl="training">Download trades CSV</button><button class="btn sm" id="t_new">Train again</button></div>`;
      }
      const evs = tst.learning.events.filter((e) => e.date >= train.start).slice(-8).reverse();
      const tr = Object.entries(tst.tickers).flatMap(([s, t]) => t.live.trades.map((x) => ({ ...x, sym: s }))).sort((a, b) => (b.x || b.e).localeCompare(a.x || a.e)).slice(0, 8);
      h += `<div class="sec">Latest trades</div><div class="card">` + (tr.length ? tr.map((t) => `<div class="row"><div><b>${sym(t.sym)}</b> <span class="m">${esc(E.STRATEGIES[t.s]?.label || '')}</span><div class="m">${fdate(t.e)} → ${t.x ? fdate(t.x) + (t.r === 'stop' ? ' (stop)' : '') : 'open'}</div></div><div class="r">${t.x ? `<b class="${cls(t.ret)}">${pct(t.ret)}</b>` : '<span class="m">holding</span>'}</div></div>`).join('') : '<p class="empty">No trades yet.</p>') + `</div>`;
      h += `<div class="sec">Brain</div><div class="card">` + (evs.length ? evs.map((e) => `<div class="ev"><span class="d">${fdate(e.date)}</span><br>${esc(e.text)}</div>`).join('') : '<p class="empty">Nothing yet.</p>') + `</div>`;
      return h;
    }
    // setup
    const [a, b] = trainRange();
    let h = `<div class="card hero"><div class="big" style="font-size:24px">Train on the past</div>
      <p class="sub">A separate practice account trades a past period day by day with your ${st.cfg.tickers.length} stocks, as if it were live – it never sees the future. Watch it, then let your live brain learn from what happened.</p></div>
      <div class="sec">Period</div><div class="card"><div class="chips" style="margin:0">${Object.entries(PRESETS).map(([k, v]) => `<button class="chip ${train.preset === k ? 'on' : ''}" data-preset="${k}">${v[0]}</button>`).join('')}</div>`;
    if (train.preset === 'custom') h += `<div class="grid"><div><label>From</label><input type="date" id="t_from" min="${MIN_TRAIN}" max="${todayIST()}" value="${a}"></div><div><label>To</label><input type="date" id="t_to" min="${MIN_TRAIN}" max="${todayIST()}" value="${b}"></div></div>`;
    h += `<p class="m" style="margin:12px 0 0">${fdate(a)} – ${fdate(b)} · about ${Math.round(((Date.parse(b) - Date.parse(a)) / 864e5) * 252 / 365)} sessions. Earliest: 2008 (Nifty data).</p></div>`;
    const nl = E.lessonsBefore(st, a).length;
    h += `<div class="sec">Brain</div><div class="card">
      <label class="switch" style="margin:0"><input type="radio" name="tb" value="fresh" ${train.brain === 'fresh' ? 'checked' : ''}><span><b>Fresh brain</b> – learns only from this period</span></label>
      <label class="switch" style="margin:12px 0 0"><input type="radio" name="tb" value="lessons" ${train.brain === 'lessons' ? 'checked' : ''}><span><b>With earlier lessons</b> – ${nl} trades that ended before ${fdate(a)} (an honest test: no future knowledge)</span></label></div>`;
    h += `<div class="sec">Replay speed</div><div class="card"><div class="chips" style="margin:0">${SPEEDS.map((x) => `<button class="chip ${x === train.speed ? 'on' : ''}" data-speed="${x}">${x}× · ${x * 2} days/s</button>`).join('')}</div></div>
      <div class="actions"><button class="btn" id="t_go">Start training</button></div>`;
    if (st.trainings.length) {
      h += `<div class="sec">Past training runs</div><div class="card">` + st.trainings.slice().reverse().map((x) => `<div class="row"><div><b>${esc(x.label)}</b><div class="m">${fdate(x.start)} – ${fdate(x.end)} · ${x.trades} trades · ${x.brain === 'fresh' ? 'fresh' : 'with lessons'}${x.taught ? ' · taught' : ''}</div></div>
        <div class="r"><b class="${cls(x.ret)}">${pct(x.ret)}</b><div class="m">Nifty ${pct(x.nret)}</div></div></div>`).join('') + `</div>`;
    }
    h += `<p class="note">Training reuses past data, so good results here can be luck or overfitting – the live paper account is the real test.</p>`;
    return h;
  }

  function bindTrain() {
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    document.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = () => { train.preset = b.dataset.preset; render(); }; });
    document.querySelectorAll('[data-speed]').forEach((b) => { b.onclick = () => { train.speed = +b.dataset.speed; render(); }; });
    document.querySelectorAll('input[name=tb]').forEach((r) => { r.onchange = () => { train.brain = r.value; render(); }; });
    const f = $('t_from'), t = $('t_to');
    if (f) f.onchange = () => { train.from = f.value; render(); };
    if (t) t.onchange = () => { train.to = t.value; render(); };
    on('t_go', startTraining);
    on('t_play', () => { train.playing = !train.playing; render(); });
    on('t_skip', () => { E.stepDays(train.ctx, Infinity); trainDone(); });
    on('t_stop', () => { train.ctx.dates.length = train.ctx.pos; trainDone(); });
    on('t_teach', teachLive);
    on('t_new', () => { train = { phase: 'setup', preset: train.preset, from: train.from, to: train.to, brain: train.brain, speed: train.speed }; render(); });
  }

  // ---------------------------------------------------------------- exports
  const csvCell = (v) => { if (v == null || (typeof v === 'number' && Number.isNaN(v))) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  const r2 = (x) => (x == null || Number.isNaN(x) ? '' : Math.round(x * 100) / 100);
  function exportData(kind) {
    const stamp = new Date(Date.now() + IST).toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    const exported = istStamp();
    let rows, name = `moli-${kind}-${stamp}.csv`, mime = 'text/csv';
    if (kind === 'trades') {
      const feats = (f) => (f ? Object.keys(E.FEATURES).filter((k) => f[k]).join('; ') : '');
      const one = (t, phase) => [phase, sym(t.sym), E.STRATEGIES[t.s]?.label || '', t.x ? 'closed' : 'open', t.e, r2(t.ep), t.q, r2(t.stop), t.x || '', r2(t.xp), t.r || '', r2(t.pnl), r2(t.ret), feats(t.f), t.x && t.pnl <= 0 ? E.diagnose(t).join('; ') : '', exported];
      rows = [['phase', 'stock', 'strategy', 'status', 'entry_date', 'entry_price', 'qty', 'stop', 'exit_date', 'exit_price', 'exit_reason', 'pnl_inr', 'return_pct', 'entry_conditions', 'lessons', 'exported_at'],
        ...allLiveTrades().map((t) => one(t, 'paper')),
        ...Object.entries(st.tickers).flatMap(([s, t]) => t.sim.trades.map((x) => one({ ...x, sym: s }, 'practice')))];
    } else if (kind === 'training') {
      const feats = (f) => (f ? Object.keys(E.FEATURES).filter((k) => f[k]).join('; ') : '');
      name = `moli-training-${train.summary.start}_${train.summary.end}-${stamp}.csv`;
      rows = [['training', 'stock', 'strategy', 'status', 'entry_date', 'entry_price', 'qty', 'stop', 'exit_date', 'exit_price', 'exit_reason', 'pnl_inr', 'return_pct', 'entry_conditions', 'lessons', 'exported_at'],
        ...train.trades.map((t) => [train.summary.label, sym(t.sym), E.STRATEGIES[t.s]?.label || '', t.x ? 'closed' : 'open', t.e, r2(t.ep), t.q, r2(t.stop), t.x || '', r2(t.xp), t.r || '', r2(t.pnl), r2(t.ret), feats(t.f), t.x && t.pnl <= 0 ? E.diagnose(t).join('; ') : '', exported])];
    } else if (kind === 'trainings') {
      rows = [['ran_at_ist', 'label', 'from', 'to', 'brain', 'stocks', 'return_pct', 'nifty_return_pct', 'max_drawdown_pct', 'trades', 'win_rate_pct', 'pnl_inr', 'taught_live_brain'],
        ...st.trainings.map((x) => [istStamp(Date.parse(x.at)), x.label, x.start, x.end, x.brain, x.stocks, r2(x.ret), r2(x.nret), r2(x.dd), x.trades, r2((x.win || 0) * 100), r2(x.pnl), x.taught ? 'yes' : 'no'])];
    } else if (kind === 'equity') {
      const idx = returnIndex(st.equity), sidx = returnIndex(st.sim.map((r) => [r[0], r[1], r[2], 0]));
      rows = [['phase', 'date', 'account_value_inr', 'net_capital_inr', 'return_index', 'nifty_close', 'exported_at'],
        ...st.sim.map((r, i) => ['practice', r[0], r[1], '', r2(sidx[i]), r2(r[2]), exported]),
        ...st.equity.map((r, i) => ['paper', r[0], r[1], r[3], r2(idx[i]), r2(r[2]), exported])];
    } else if (kind === 'brain') {
      rows = [['market_date', 'recorded_at_ist', 'kind', 'event'], ...st.learning.events.map((e) => [e.date, e.at ? istStamp(Date.parse(e.at)) : '', e.kind, e.text])];
    } else if (kind === 'runs') {
      rows = [['started_at_ist', 'finished_at_ist', 'status', 'sessions_processed', 'from_date', 'to_date', 'message'],
        ...st.runs.map((r) => [istStamp(Date.parse(r.started)), r.finished ? istStamp(Date.parse(r.finished)) : '', r.status, r.days, r.from, r.to, r.msg])];
    } else {
      name = `moli-backup-${stamp}.json`; mime = 'application/json';
      return download(name, mime, JSON.stringify({ exported_at: exported, app: 'Moli Paper Trader', state: st }, null, 1));
    }
    download(name, mime, csv(rows));
  }

  // ---------------------------------------------------------------- actions
  const normSym = (s) => { s = s.trim().toUpperCase(); return s.includes('.') || s.startsWith('^') ? s : s + '.NS'; };
  async function addStock(s) {
    const list = st ? st.cfg.tickers : [...setupPicks];
    if (list.includes(s)) return toast(sym(s) + ' is already in your list');
    if (list.length >= MAX_STOCKS) return toast(`Maximum ${MAX_STOCKS} stocks`);
    if (!st) { setupPicks.add(s); return render(); }
    E.addTicker(st, s, todayIST(), nowIso()); store.save(st); render();
    toast(`${sym(s)} added – downloading its history`); update();
  }
  async function addCustom() {
    const s = normSym($('custom').value || '');
    if (!s || s === '.NS') return;
    const b = $('addCustom'); b.disabled = true; b.textContent = '…';
    try {
      const p = E.parseYahoo(await httpGet(url(s, '1mo')));
      if (!p.bars.d.length) throw new Error('no data');
      await addStock(s);
    } catch (e) { toast(`${sym(s)} not found on Yahoo Finance`); }
    b.disabled = false; b.textContent = 'Add';
  }
  function removeStock(s) {
    if (!st) { setupPicks.delete(s); return render(); }
    const T = st.tickers[s];
    if (T && T.live.qty > 0 && !confirm(`Sell ${sym(s)} at the next open and remove it?`)) return;
    const gone = E.removeTicker(st, s, todayIST(), nowIso());
    store.save(st); render();
    toast(gone ? `${sym(s)} removed` : `${sym(s)} will be sold at the next open, then removed`);
  }

  function bind() {
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on('pause', () => { E.setPause(st, 'pause', todayIST(), nowIso()); store.save(st); render(); toast('Paused: no new buys'); });
    on('stopall', () => { if (!confirm('Sell every position at the next open and stop buying?')) return; E.setPause(st, 'stop', todayIST(), nowIso()); store.save(st); render(); toast('Stopped: positions sell at the next open'); });
    on('resume', () => { E.setPause(st, null, todayIST(), nowIso()); store.save(st); render(); toast('Trading resumed'); });
    document.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => addStock(b.dataset.add); });
    document.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => removeStock(b.dataset.rm); });
    document.querySelectorAll('[data-dl]').forEach((b) => { b.onclick = () => exportData(b.dataset.dl); });
    const q = $('q');
    if (q) q.oninput = () => { query = q.value; $('pick').innerHTML = pickList(new Set(st ? st.cfg.tickers : setupPicks)); bindPick(); };
    bindPick();
    on('addCustom', addCustom);
    on('s_go', () => {
      const num = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) && v >= 0 ? v : d; };
      if (!setupPicks.size) return toast('Pick at least one stock');
      const cfg = { tickers: [...setupPicks], capital: num('s_c', 500000) || 500000, warmYears: Math.min(Math.round(num('s_w', 2)), 8),
        stopAtr: num('s_s', 3), riskPct: num('s_r', 0), slippage: 0.05 };
      st = E.newState(cfg, todayIST()); store.save(st); tab = 'home'; query = ''; render(); update();
    });
    on('s_del', () => { if (confirm('Delete the paper account and everything the brain learned? Download a backup first if you want to keep it.')) { st = null; store.clear(); setupPicks = new Set(DEFAULTS.tickers); render(); } });
    const rem = $('s_rem');
    if (rem) rem.onchange = () => { N.setReminder(rem.checked); toast(rem.checked ? 'Reminder on' : 'Reminder off'); };
  }
  function bindPick() { document.querySelectorAll('#pick [data-add]').forEach((b) => { b.onclick = () => addStock(b.dataset.add); }); }

  function render() {
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    $('tabs').style.display = st ? '' : 'none';
    $('updateBtn').style.display = st ? '' : 'none';
    const v = !st ? viewSetup() : { home: viewHome, stocks: viewStocks, train: viewTrain, brain: viewBrain, journal: viewJournal, more: viewMore }[tab]();
    $('view').innerHTML = v + `<p class="note">Paper trading only – simulated, not investment advice. Past results don't predict the future. SEBI found 87.7% of individual F&amp;O traders lost money in FY26.</p>`;
    bind(); if (tab === 'train') bindTrain(); setStatus();
  }

  document.querySelectorAll('#tabs a').forEach((a) => { a.onclick = () => { tab = a.dataset.tab; render(); window.scrollTo(0, 0); }; });
  $('updateBtn').onclick = update;
  render();
  if (st && (!st.lastFetch || Date.now() - st.lastFetch > 3600e3)) update();
  setInterval(tickCountdowns, 1000);
  setInterval(setStatus, 60000);
})();
