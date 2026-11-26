/* Moli – a paper trader you talk to. Prices from Yahoo Finance; everything is stored on the phone. */
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

  function toast(msg) { if (st && tab === 'chat') return; const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3800); }

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
    if (!st) { $('dfoot').textContent = 'Not started'; return; }
    const ago = st.lastFetch ? Math.round((Date.now() - st.lastFetch) / 60000) : null;
    const a = ago == null ? 'never' : ago < 1 ? 'just now' : ago < 60 ? ago + ' min ago' : ago < 1440 ? Math.round(ago / 60) + ' h ago' : Math.round(ago / 1440) + ' d ago';
    $('dfoot').textContent = `Updated ${a} · data to ${fdate(st.lastDate)}`;
  }

  // ---------------------------------------------------------------- update with ETA + stop
  function rangeFor() {
    if (!st.lastDate) return st.cfg.warmYears + 2 <= 5 ? '5y' : '10y';
    const gap = (Date.now() - new Date(st.lastDate).getTime()) / 864e5;
    const newStock = st.cfg.tickers.some((t) => !st.tickers[t] || st.tickers[t].fresh);
    return gap < 1100 ? '5y' : '10y'; // 5 years: enough history for the prediction odds
  }
  const url = (s, r) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=${r}&interval=1d&events=div%2Csplit`;

  function progress(done, total, label) {
    const avg = pref.get('fetch_ms', 900), think = st && !st.lastDate ? 1500 : 400;
    const left = (total - done) * avg + think;
    $('progress').hidden = false;
    $('bar').style.width = Math.round((done / (total + 1)) * 100) + '%';
    $('eta').textContent = `${label} · about ${Math.max(1, Math.round(left / 1000))}s left`;
    $('dfoot').textContent = `${done}/${total} downloaded`;
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
      for (const s in data) if (st.tickers[s]) { try { st.tickers[s].pred = E.predict(data[s].bars); } catch (e) { /* keep old */ } }
      const brief = briefing(res, before);
      if (brief) say(brief, res.days > 300 ? 'sim' : res.days ? 'pnl' : null);
      Object.assign(run, { days: res.days, from: res.days ? (before || st.warmStart) : null, to: st.lastDate });
      const learned = res.newEvents.filter((e) => e.kind === 'learn' || e.kind === 'unlearn').length;
      if (res.days > 300) toast(`Practised on ${res.days} past sessions · ${learned} lessons learned. Paper trading starts now.`);
      else toast(res.days ? `${res.days} new session${res.days > 1 ? 's' : ''}` + (res.newTrades ? ` · ${res.newTrades} trade event${res.newTrades > 1 ? 's' : ''}` : '') + (learned ? ` · ${learned} lesson${learned > 1 ? 's' : ''}` : '') : 'Already up to date');
      if (failed.length) { run.msg = 'Could not fetch: ' + failed.join(', '); toast(run.msg); }
    } catch (e) {
      run.status = e.message === 'stopped' ? 'stopped' : 'failed';
      run.msg = run.status === 'stopped' ? 'Stopped by you – nothing changed' : e.message;
      toast(run.status === 'stopped' ? 'Update stopped – nothing changed' : 'Update failed – check internet');
      if (run.status === 'failed') say(`I couldn't download prices just now (${e.message}). Check the internet connection and say **update** to try again.`);
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

  function stockRow(s, inAcct) {
    const t = st && st.tickers[s];
    const meta = t && t.fresh ? 'added – studies its history on the next update' : t ? `${t.active ? esc(E.STRATEGIES[t.active].label) : 'cash'}${t.live.qty ? ` · holding ${t.live.qty}` : ''}${t.removing ? ' · removing' : ''}` : inAcct && st ? 'added – downloads on next update' : '';
    const price = t && t.lastClose ? px(t.lastClose) : '';
    return `<div class="row"><div ${t ? `data-stock="${esc(s)}" style="cursor:pointer"` : ''}><b>${sym(s)}</b><div class="m">${meta}${t && t.pred ? ' · chart & predictions ›' : ''}</div></div>
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

  function allLiveTrades() {
    return [...Object.entries(st.tickers).flatMap(([s, t]) => t.live.trades.map((x) => ({ ...x, sym: s }))), ...st.archive];
  }

  function viewMore() {
    let h = '';
    h += `<div class="sec">Paper money</div><div class="card">
      <div class="row"><div><b>Account value</b><div class="m">${inr(E.cashTotal(st))} in cash · put in ${inr(st.invested)}${st.withdrawn ? ` · taken out ${inr(st.withdrawn)}` : ''}</div></div><div class="r"><b>${inr(eqNow())}</b></div></div>
      <label>Amount (₹ – e.g. 50000, 50k, 1.5 lakh)</label><input id="m_amt" inputmode="decimal" placeholder="1 lakh">
      <div class="actions"><button class="btn sm" id="m_add">Add</button><button class="btn ghost sm" id="m_wd">Withdraw</button><button class="btn ghost sm" id="m_set">Set account to this</button></div>
      <p class="m" style="margin:10px 0 0">Added money is split equally across your stocks. Withdrawals come from cash only. Neither counts as profit or loss.</p></div>`;
    const B = E.brainParams(st);
    h += `<div class="sec">Trading style</div><div class="card"><div class="chips" style="margin:0">
        <button class="chip ${!B.quick ? 'on' : ''}" data-tstyle="normal">Normal – ride trends</button>
        <button class="chip ${B.quick ? 'on' : ''}" data-tstyle="quick">Quick – in and out</button></div>
      <p class="m" style="margin:10px 0 0">${B.quick ? 'Enters fast on sharp dips, pullbacks and volume breakouts, and exits fast: at the profit target, the stop-loss or the time limit. Expect many small trades lasting days. More trades means more costs (STT, stamp duty) – they can eat small profits.' : 'Holds trends for weeks or months. Fewer trades, bigger wins and losses.'}</p>
      ${B.quick ? `<label>Take profit at</label><div class="chips" style="margin:0">${[0, 1, 1.5, 2, 3].map((v) => `<button class="chip ${B.tpAtr === v ? 'on' : ''}" data-tp="${v}">${v ? '+' + v + '× ATR' : 'off'}</button>`).join('')}</div>
        <label>Stop-loss</label><div class="chips" style="margin:0">${[1, 1.5, 2, 3].map((v) => `<button class="chip ${B.stopAtr === v ? 'on' : ''}" data-sl="${v}">${v}× ATR</button>`).join('')}</div>
        <label>Time limit</label><div class="chips" style="margin:0">${[0, 3, 5, 10, 20].map((v) => `<button class="chip ${B.maxDays === v ? 'on' : ''}" data-md="${v}">${v ? v + ' sessions' : 'off'}</button>`).join('')}</div>
        <p class="m" style="margin:10px 0 0">ATR = a stock's typical daily move. +2× ATR is roughly two normal days' move – often 3–5%.</p>` : ''}</div>`;
    h += `<div class="card"><div class="setrow"><div class="stx"><h3>Never repeat a mistake</h3><div class="m">When a trade loses more than 1% with warning signs at entry, I note it and never make that exact trade again (same stock, strategy and warning signs). Forgiven if it would have made money more often. ${(st.learning.mistakes || []).filter((m) => !m.forgiven).length} noted now.</div></div><input type="checkbox" class="tog" id="b_mem" ${B.useMemory ? 'checked' : ''}></div></div>`;
    h += `<div class="sec">Brain settings</div><div class="card"><ul class="tags" style="font-size:14px;color:var(--fg);margin:0">${E.describeParams(E.brainParams(st)).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      <div class="actions"><button class="btn ghost sm" id="b_reset">Reset to defaults</button></div><p class="m" style="margin:8px 0 0">Repeat training (Train on the past → Repeat until best) can tune these.</p></div>`;
    h += `<div class="sec">Download your data</div><div class="card">
      <div class="row"><div><b>Trades</b><div class="m">Every paper &amp; practice trade: dates, prices, P&amp;L, mistake tags</div></div><button class="btn sm" data-dl="trades">CSV</button></div>
      <div class="row"><div><b>Daily equity</b><div class="m">Date, account value, capital, return, Nifty</div></div><button class="btn sm" data-dl="equity">CSV</button></div>
      <div class="row"><div><b>Brain log</b><div class="m">Every switch, lesson and action, with timestamps</div></div><button class="btn sm" data-dl="brainlog">CSV</button></div>
      <div class="row"><div><b>Brain data</b><div class="m">Settings, learned rules with evidence, strategy per stock, predictions, training runs – everything it knows</div></div><button class="btn sm" data-dl="brain">JSON</button></div>
      <div class="row"><div><b>Import brain data</b><div class="m">Load a brain file (or restore a full backup) – e.g. from another phone or before a reinstall</div></div><button class="btn sm ghost" data-act="import">Import</button></div>
      <div class="row"><div><b>Brain evidence</b><div class="m">Every trade the brain learned from (lived and from training), with entry conditions</div></div><button class="btn sm" data-dl="braincsv">CSV</button></div>
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


  // ---------------------------------------------------------------- design pieces
  let bid = 0;
  /** Moli, the little advisor: happy | wave | concerned | thinking. Breathes, blinks, waves (CSS). */
  function buddy(size, mood = 'happy') {
    const id = 'bh' + ++bid;
    const ang = (mood === 'thinking' ? -150 : mood === 'wave' ? -62 : 70) * Math.PI / 180;
    const hx = (69 + Math.cos(ang) * 25).toFixed(1), hy = (72 + Math.sin(ang) * 25).toFixed(1);
    const tilt = mood === 'thinking' ? 8 : mood === 'concerned' ? -5 : 0;
    const ex = mood === 'thinking' ? 1.6 : 0, ey = mood === 'thinking' ? -2.2 : 0;
    const F = '#2b2622', SK = '#f1cba8', HR = '#4a3428', PT = '#4a4740', BL = 'rgba(232,144,122,.45)';
    const sprout = [[-90, 8.5], [-58, 6.5], [-122, 6.5]].map(([a, l]) => { const r = a * Math.PI / 180; return `<line x1="50" y1="14.5" x2="${(50 + Math.cos(r) * l).toFixed(1)}" y2="${(14.5 + Math.sin(r) * l).toFixed(1)}" style="stroke:var(--clay)" stroke-width="2.8" stroke-linecap="round"/>`; }).join('');
    const mouth = mood === 'thinking' ? `<circle cx="53" cy="51" r="1.8" fill="${F}"/>`
      : `<path d="M44 49.5Q50 ${mood === 'concerned' ? 43.5 : 55.5} 56 49.5" fill="none" stroke="${F}" stroke-width="2.2" stroke-linecap="round"/>`;
    const brows = mood === 'concerned' ? `<path d="M36 33.5L43 31.5M64 33.5L57 31.5" stroke="${F}" stroke-width="1.8" stroke-linecap="round"/>` : '';
    const dots = mood === 'thinking' ? `<circle class="tdot" cx="80" cy="22" r="2.2" style="fill:var(--clay)"/><circle class="tdot" cx="87" cy="13" r="3" style="fill:var(--clay)"/><circle class="tdot" cx="94" cy="4" r="3.8" style="fill:var(--clay)"/>` : '';
    return `<svg class="buddy ${mood}" width="${size}" height="${Math.round(size * 1.3)}" viewBox="0 0 100 130" aria-hidden="true">
      <defs><clipPath id="${id}"><rect x="0" y="0" width="100" height="31"/></clipPath></defs>
      <ellipse cx="50" cy="126.5" rx="20" ry="2.5" style="fill:var(--ink)" opacity=".1"/>
      <g class="bodyg">
        <line x1="43" y1="100" x2="43" y2="119" stroke="${PT}" stroke-width="8" stroke-linecap="round"/>
        <line x1="57" y1="100" x2="57" y2="119" stroke="${PT}" stroke-width="8" stroke-linecap="round"/>
        <line x1="31" y1="72" x2="23" y2="95" style="stroke:var(--clay-d)" stroke-width="8" stroke-linecap="round"/>
        <circle cx="23" cy="96" r="4.6" fill="${SK}"/>
        <rect x="27" y="63" width="46" height="44" rx="17" style="fill:var(--clay)"/>
        <path d="M43 60Q50 66 57 60" fill="none" style="stroke:var(--clay-d)" stroke-width="2.4" stroke-linecap="round"/>
        <g transform="rotate(${tilt} 50 62)">
          <circle cx="50" cy="38" r="24" fill="${SK}"/>
          <circle cx="50" cy="38" r="25.5" fill="${HR}" clip-path="url(#${id})"/>
          <circle cx="29" cy="33" r="5" fill="${HR}"/><circle cx="71" cy="33" r="5" fill="${HR}"/>
          ${sprout}
          <circle cx="36" cy="47" r="4.2" fill="${BL}"/><circle cx="64" cy="47" r="4.2" fill="${BL}"/>
          <ellipse class="eye" cx="${40 + ex}" cy="${40.5 + ey}" rx="2.3" ry="3.2" fill="${F}"/>
          <ellipse class="eye" cx="${60 + ex}" cy="${40.5 + ey}" rx="2.3" ry="3.2" fill="${F}"/>
          ${brows}${mouth}
        </g>
        <g class="armr"><line x1="69" y1="72" x2="${hx}" y2="${hy}" style="stroke:var(--clay-d)" stroke-width="8" stroke-linecap="round"/><circle cx="${hx}" cy="${hy}" r="4.6" fill="${SK}"/></g>
        ${dots}
      </g></svg>`;
  }
  const GEAR = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  const BACK = '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
  const pageHead = (title, sub, back) => `<div class="ph">${back ? `<button class="iconbtn" data-go="${back}" aria-label="Back">${BACK}</button>` : ''}<div class="t"><h1>${title}</h1>${sub ? `<div class="s">${sub}</div>` : ''}</div></div>`;
  const greeting = () => { const h = ist().getUTCHours(); return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const moodOf = (k) => (k === 'warn' ? 'concerned' : k === 'idea' ? 'thinking' : 'happy');
  const KIND = { warn: 'Heads up', idea: 'Idea', good: 'Nice' };
  const holdValue = () => Object.values(st.tickers).reduce((s, t) => s + t.live.qty * (t.lastClose || 0), 0);
  const updatedAgo = () => { const a = st.lastFetch ? Math.round((Date.now() - st.lastFetch) / 60000) : null; return a == null ? 'never' : a < 1 ? 'just now' : a < 60 ? a + ' min ago' : a < 1440 ? Math.round(a / 60) + ' h ago' : Math.round(a / 1440) + ' d ago'; };

  // ---------------------------------------------------------------- suggestions (Moli's advice)
  const SECTOR = {};
  Object.entries(CATALOG).forEach(([g, l]) => l.forEach((s) => { SECTOR[s + '.NS'] = g; }));
  /** Rule-based suggestions about the paper account, most important first. */
  function advice() {
    if (!st || !st.lastDate) return [];
    const out = [], add = (o) => out.push(o);
    const eq = eqNow(), cash = E.cashTotal(st), pnl = eq + st.withdrawn - st.invested, idx = returnIndex(st.equity);
    const ret = idx.length ? idx[idx.length - 1] - 100 : 0, nf = st.equity.filter((r) => r[2]);
    const nRet = nf.length > 1 ? (nf[nf.length - 1][2] / nf[0][2] - 1) * 100 : null, days = st.equity.length;
    const trades = allLiveTrades(), S = E.stats(trades), B = E.brainParams(st);
    const costs = Object.values(st.tickers).reduce((s, t) => s + t.live.costs, 0);
    const gap = st.lastFetch ? (Date.now() - st.lastFetch) / 36e5 : 99;
    const mk = market();
    if (gap > 20 && !mk.open) add({ kind: 'warn', title: 'Time to catch up', body: `Last update was ${updatedAgo()}. Update so I can trade the sessions I missed and learn from them.`, act: ['update', 'Update now'] });
    const pend = Object.entries(st.tickers).filter(([, t]) => t.live.pending);
    if (pend.length) add({ kind: 'idea', title: `${pend.length} order${pend.length > 1 ? 's' : ''} at the next open`, body: pend.map(([s, t]) => `${t.live.pending === 'BUY' ? 'Buy' : 'Sell'} ${sym(s)}`).join(', ') + `. They fill at 9:15 AM – in ${dur(mk.nextOpen - Date.now())}.`, pill: 'tomorrow' });
    if (nRet != null && days >= 15 && ret < nRet - 3) add({ kind: 'warn', title: `The Nifty is ahead of me by ${(nRet - ret).toFixed(1)} pts`, body: `Since ${fdate(st.paperStart)} I made ${pct(ret)} while a Nifty index fund made ${pct(nRet)}. Most active strategies trail the index over time. Holding part of the money in NIFTYBEES (a Nifty ETF) keeps you close to the market.`, pill: `−${(nRet - ret).toFixed(1)} pts`, neg: true, act: st.cfg.tickers.includes('NIFTYBEES.NS') ? null : ['add:NIFTYBEES.NS', 'Add NIFTYBEES'] });
    if (nRet != null && days >= 15 && ret > nRet + 2) add({ kind: 'good', title: `Ahead of the Nifty by ${(ret - nRet).toFixed(1)} pts`, body: `I made ${pct(ret)} vs the Nifty's ${pct(nRet)} since ${fdate(st.paperStart)}. A short streak can be luck – keep watching it over months.`, pill: `+${(ret - nRet).toFixed(1)} pts` });
    const dd = maxDD(idx);
    if (idx.length > 5 && dd < -8) add({ kind: 'warn', title: `Down ${Math.abs(dd).toFixed(1)}% from the peak`, body: `That's the deepest fall so far. A tighter stop-loss or quick mode limits how far a trade can run against you – or pause new buys while you look.`, pill: pct(dd), neg: true, act: E.isPaused(st) ? null : ['pause', 'Pause new buys'] });
    if (eq > 0 && cash / eq > 0.7 && days >= 10) add({ kind: 'idea', title: `${inr(cash)} is sitting in cash`, body: `${Math.round((cash / eq) * 100)}% of the account isn't invested because no strategy I trust is signalling. That's safe, but idle. Adding a stock or ETF where a strategy is working gives the money a job.`, pill: `${Math.round((cash / eq) * 100)}% idle`, act: ['stocks', 'Browse stocks'] });
    const dead = Object.entries(st.tickers).filter(([, t]) => !t.active && Object.values(t.scores || {}).some((v) => v != null && !Number.isNaN(v)) && Object.values(t.scores).every((v) => !(v >= B.minScore)));
    if (dead.length) { const [s, t] = dead[0]; const best = Math.max(...Object.values(t.scores).filter((v) => !Number.isNaN(v))); add({ kind: 'idea', title: `Nothing works on ${sym(s)} lately`, body: `The best strategy on it scored ${best.toFixed(2)} over the last year – below my bar of ${B.minScore}. I keep it in cash. You could swap it for a stock that trends better.${dead.length > 1 ? ` Same for ${dead.slice(1, 4).map(([x]) => sym(x)).join(', ')}.` : ''}`, act: [`remove:${s}`, `Remove ${sym(s)}`] }); }
    const secs = {}; st.cfg.tickers.forEach((s) => { const g = SECTOR[s] || 'Other'; secs[g] = (secs[g] || 0) + 1; });
    const topSec = Object.entries(secs).sort((a, b) => b[1] - a[1])[0];
    if (topSec && st.cfg.tickers.length >= 4 && topSec[1] / st.cfg.tickers.length > 0.45) add({ kind: 'idea', title: `${Math.round((topSec[1] / st.cfg.tickers.length) * 100)}% of your stocks are ${topSec[0].toLowerCase()}`, body: `When that sector falls, most of the account falls together. Mixing in IT, pharma or consumer stocks spreads the risk.`, act: ['stocks', 'Add other sectors'] });
    const gross = trades.filter((t) => t.x).reduce((s, t) => s + (t.xp - t.ep) * t.q, 0);
    if (S.n >= 5 && costs > Math.max(0.3 * Math.abs(gross), 0.004 * st.invested)) add({ kind: 'warn', title: `Costs took ${inr(costs)}`, body: `STT, stamp duty and fees on ${S.n} closed trades ate ${gross > 0 ? Math.round((costs / gross) * 100) + '% of the profit' : 'into the results'}. ${B.quick ? 'Quick mode trades often – fewer, bigger trades keep more.' : 'Fewer trades would keep more.'}`, pill: `−${inr(costs)}`, neg: true, act: B.quick ? ['quick-off', 'Switch to normal'] : null });
    const losers = trades.filter((t) => t.x && t.pnl <= 0);
    if (losers.length >= 3) {
      const tally = {}; losers.forEach((t) => E.diagnose(t).forEach((g) => { tally[g] = (tally[g] || 0) + 1; }));
      const [g, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      const whip = /Whipsaw/.test(g) && !B.quick;
      add({ kind: 'idea', title: `My most common mistake: ${g.split(':')[0].toLowerCase()}`, body: `${n} of ${losers.length} losing trades. ${whip ? 'Signals keep reversing quickly – quick mode takes profits fast and uses time limits instead.' : 'Once there is enough evidence I turn conditions like this into a rule and skip those entries.'}`, act: whip ? ['quick-on', 'Try quick mode'] : null });
    }
    const lastLearn = st.learning.events.filter((e) => e.kind === 'learn' && /Learned: avoid/.test(e.text)).slice(-1)[0];
    if (lastLearn && lastLearn.date >= st.paperStart) add({ kind: 'good', title: 'I learned something', body: lastLearn.text.replace('Learned: ', 'Now I ') });
    const MM = (st.learning.mistakes || []).filter((m) => !m.forgiven), skipped = MM.reduce((a, m) => a + (m.blocked || 0), 0);
    if (MM.length && skipped) add({ kind: 'good', title: `I skipped ${skipped} repeat${skipped > 1 ? 's' : ''} of past mistakes`, body: `I've noted ${MM.length} mistake${MM.length > 1 ? 's' : ''} and haven't repeated any. The latest: ${memText(MM[MM.length - 1])}, which lost ${pct(MM[MM.length - 1].ret)}.`, pill: `${MM.length} noted`, act: ['guide', 'See them'] });
    const lastTrain = st.trainings.slice(-1)[0];
    if (!lastTrain || Date.now() - Date.parse(lastTrain.at) > 30 * 864e5) add({ kind: 'idea', title: 'Test my settings on the past', body: `Walk-forward training learns on one stretch of history and trades the next one blind – the most honest check of whether my settings work. Takes a few seconds.`, act: ['train-walk', 'Walk forward 5 years'] });
    if (S.n >= 8 && S.winRate < 0.35 && S.avgWin > Math.abs(S.avgLoss) * 2) add({ kind: 'good', title: 'Few wins, but big ones', body: `Only ${Math.round(S.winRate * 100)}% of trades win, but winners average ${pct(S.avgWin)} vs losers ${pct(S.avgLoss)}. That's how trend-following works – the losses are the cost of catching big moves.` });
    if (E.isPaused(st)) add({ kind: 'warn', title: `Trading is ${E.isPaused(st) === 'stop' ? 'stopped' : 'paused'}`, body: 'I\'m not buying anything new. Resume when you\'re ready.', act: ['resume', 'Resume'] });
    if (!out.length) add({ kind: 'good', title: 'All quiet', body: `${accountLine().replace(/\*\*/g, '')} Nothing needs your attention right now.` });
    const order = { warn: 0, idea: 1, good: 2 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]);
  }
  const advCard = (a) => `<div class="card adv"><div class="top"><span class="dot ${a.kind}"></span><span class="lbl">${KIND[a.kind]}</span>${a.pill ? `<span class="pill ${a.neg ? 'neg' : ''}">${esc(a.pill)}</span>` : ''}</div>
    <h3>${esc(a.title)}</h3><p>${esc(a.body)}</p>${a.act ? `<div class="actions"><button class="btn sm ghost" data-act="${esc(a.act[0])}">${esc(a.act[1])}</button></div>` : ''}</div>`;
  let tipIdx = 0;

  function doAct(a) {
    if (a === 'update') return update();
    if (a === 'pause') { E.setPause(st, 'pause', todayIST(), nowIso()); store.save(st); toast('Paused: no new buys'); return render(); }
    if (a === 'resume') { E.setPause(st, null, todayIST(), nowIso()); store.save(st); toast('Trading resumed'); return render(); }
    if (a === 'stopall') { if (!confirm('Sell every position at the next open and stop buying?')) return; E.setPause(st, 'stop', todayIST(), nowIso()); store.save(st); toast('Stopped: positions sell at the next open'); return render(); }
    if (a === 'stocks') { tab = 'stocks'; render(); return window.scrollTo(0, 0); }
    if (a === 'guide') { tab = 'guide'; render(); return window.scrollTo(0, 0); }
    if (a === 'chat') { tab = 'chat'; render(); return scrollEnd(); }
    if (a === 'settings') { tab = 'settings'; render(); return window.scrollTo(0, 0); }
    if (a === 'wrapped') return openWrapped();
    if (a === 'import') return startImport();
    if (a === 'quick-on' || a === 'quick-off') { setStyle(a === 'quick-on'); toast(a === 'quick-on' ? 'Quick trading on' : 'Normal trading on'); return render(); }
    if (a === 'train' || a === 'train-walk') { if (a === 'train-walk') Object.assign(train, { phase: 'setup', mode: 'repeat', route: 'walk', preset: '5y' }); tab = 'train'; render(); return window.scrollTo(0, 0); }
    if (a.startsWith('add:')) return addStock(a.slice(4));
    if (a.startsWith('remove:')) return removeStock(a.slice(7));
    if (a === 'money') { tab = 'settings'; render(); setTimeout(() => { const el = $('m_amt'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }, 50); }
  }

  // ---------------------------------------------------------------- Home
  function viewHome() {
    const now = ist(), month = now.toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' });
    let h = `<div class="ph"><div class="t"><h1>${greeting()}${st.cfg.name ? ', ' + esc(st.cfg.name) : ''}</h1><div class="s">${month} at a glance · updated ${updatedAgo()} · <a data-act="update">Update</a></div></div><button class="iconbtn" data-act="settings" aria-label="Settings">${GEAR}</button></div>`;
    if (!st.lastDate) return h + `<div class="card"><div class="says" style="margin:0">${buddy(70, 'wave')}<div class="bub"><div class="lbl">Moli says</div><h3>Let's get started</h3><p>Tap Update and I'll download prices, practise on the past, then start paper trading.</p></div></div></div>`;
    h += `<a class="wrapban" data-act="wrapped"><span class="ic">✳</span><div><b>Today, wrapped</b><span>Your trading day in a few taps</span></div><span class="play">Play ▸</span></a>`;
    const eq = eqNow(), pnl = eq + st.withdrawn - st.invested, idx = returnIndex(st.equity), ret = idx.length ? idx[idx.length - 1] - 100 : 0;
    const nf = st.equity.filter((r) => r[2]), nRet = nf.length > 1 ? (nf[nf.length - 1][2] / nf[0][2] - 1) * 100 : null;
    h += `<div class="card hero"><div class="lbl">Paper account</div><div class="big">${inr(eq)}</div>
      <p class="sub ${cls(pnl)}">${Math.abs(pnl) < 1 ? 'Unchanged' : `${pnl > 0 ? '+' : '−'}${inr(Math.abs(pnl)).replace('−', '')} (${pct(ret, 2)})`} since ${fdate(st.paperStart)}${nRet != null ? ` · Nifty ${pct(nRet, 2)}` : ''}</p>`;
    if (idx.length >= 2) h += pnlChart(down(idx, 300)) + `<div class="legend"><span><i style="background:var(--sage)"></i>Profit</span><span><i style="background:var(--clay)"></i>Loss</span><a data-go="activity" style="margin-left:auto;color:var(--clay)">All charts ›</a></div>`;
    else if (st.sim.length > 20) {
      const s = returnIndex(st.sim.map((r) => [r[0], r[1], r[2], 0])), sn = st.sim.filter((r) => r[2]);
      h += pnlChart(down(s, 300)) + `<p class="sub">Practice run ${fdate(st.sim[0][0])} – ${fdate(st.sim[st.sim.length - 1][0])}: ${pct(s[s.length - 1] - 100)} vs Nifty ${pct((sn[sn.length - 1][2] / sn[0][2] - 1) * 100)}.</p>`;
    }
    h += `</div>`;
    const cash = E.cashTotal(st), inv = holdValue();
    h += `<div class="tiles"><div class="tile"><div class="lbl">Invested</div><div class="v">${inr(inv)}</div></div>
      <div class="tile"><div class="lbl">Cash</div><div class="v">${inr(cash)}</div></div>
      <div class="tile"><div class="lbl">${pnl >= 0 ? 'Profit' : 'Loss'}</div><div class="v ${cls(pnl)}">${inr(Math.abs(pnl))}</div></div></div>`;
    const adv = advice(), a = adv[tipIdx % Math.max(adv.length, 1)];
    if (a) h += `<div class="says">${buddy(76, moodOf(a.kind))}<div class="bub"><div class="adv"><div class="top" style="margin:0"><span class="lbl">Moli says</span>${a.pill ? `<span class="pill ${a.neg ? 'neg' : ''}">${esc(a.pill)}</span>` : ''}</div></div>
      <h3>${esc(a.title)}</h3><p>${esc(a.body)}</p>
      <div class="actions" style="margin-top:10px">${a.act ? `<button class="btn sm" data-act="${esc(a.act[0])}">${esc(a.act[1])}</button>` : ''}${adv.length > 1 ? `<a class="more" data-act="nexttip">Next tip (${(tipIdx % adv.length) + 1}/${adv.length}) ›</a>` : ''}</div></div></div>`;
    const paused = E.isPaused(st), mk = market();
    h += `<div class="card"><div class="chips" style="margin:0">${marketChip()}${paused ? `<span class="chip paused">${paused === 'stop' ? 'Stopped' : 'Paused'}</span>` : ''}</div>
      <div class="actions">${paused ? `<button class="btn sm" data-act="resume">Resume trading</button>` : `<button class="btn sm ghost" data-act="pause">Pause new buys</button><button class="btn sm warn" data-act="stopall">Stop &amp; sell all</button>`}</div></div>`;
    const T = st.tickers, pend = Object.entries(T).filter(([, t]) => t.live.pending), blk = Object.entries(T).filter(([, t]) => t.blockedToday && t.blockedToday.d === st.lastDate);
    if (pend.length || blk.length) {
      h += `<div class="card"><div class="lbl">Next open · in ${cdSpan(mk.nextOpen)}</div>`;
      h += pend.map(([s, t]) => `<div class="row"><div><b>${t.live.pending === 'BUY' ? 'Buy' : 'Sell'} ${sym(s)}</b><div class="m">${t.removing ? 'removing stock' : esc(E.STRATEGIES[t.active]?.label || 'exit to cash')}</div></div><div class="r m">9:15 AM</div></div>`).join('');
      h += blk.map(([s, t]) => `<div class="row"><div><b>Skip ${sym(s)}</b><div class="m">${esc(E.STRATEGIES[t.active]?.label || '')} said buy – ${(() => { const m = t.blockedToday.mem && (st.learning.mistakes || []).find((x) => x.id === t.blockedToday.mem); return m ? `same mistake as on ${fdate(m.date)} (lost ${pct(m.ret)}) – not again` : `blocked by a learned rule: ${t.blockedToday.rules.map((k) => esc(E.FEATURES[k].label.toLowerCase())).join(', ')}`; })()}</div></div></div>`).join('') + `</div>`;
    }
    const pos = Object.entries(T).filter(([, t]) => t.live.qty > 0);
    h += `<div class="card"><div class="lbl">Positions</div>` + (pos.length ? pos.map(([s, t]) => {
      const tr = t.live.trades[t.live.trades.length - 1], r = (t.lastClose / tr.ep - 1) * 100;
      return `<div class="row"><div><b>${sym(s)}</b><div class="m">${tr.q} @ ${px(tr.ep)} · ${esc(E.STRATEGIES[tr.s]?.label || '')}${tr.stop ? ` · stop ${px(tr.stop)}` : ''}${tr.tp ? ` · target ${px(tr.tp)}` : ''}</div></div><div class="r"><b class="${cls(r)}">${pct(r)}</b><div class="m">${inr((t.lastClose - tr.ep) * tr.q)}</div></div></div>`;
    }).join('') : `<p class="empty">No open positions – everything is in cash.</p>`) + `</div>`;
    h += `<div class="card"><div class="lbl">Your stocks · ${st.cfg.tickers.length}</div>` + Object.entries(T).slice(0, 6).map(([s, t]) => {
      const sp = t.spark.c, ch = sp.length > 1 ? (sp[sp.length - 1] / sp[sp.length - 2] - 1) * 100 : 0;
      const o = t.pred && t.pred.outlook;
      return `<a class="row" data-stock="${esc(s)}"><div><b>${sym(s)}</b><div class="m">${t.fresh ? 'studying its history…' : t.active ? esc(E.STRATEGIES[t.active].label) : 'in cash'}${o && o.lean !== 'none' ? ` · leans ${o.lean}` : ''}</div></div><div class="r">${px(t.lastClose)}<div class="m ${cls(ch)}">${pct(ch, 2)} ›</div></div></a>`;
    }).join('') + `<div class="actions" style="margin-top:8px"><button class="btn sm ghost" data-act="stocks">Manage stocks</button><button class="btn sm ghost" data-act="money">Change money</button></div></div>`;
    return h;
  }

  // ---------------------------------------------------------------- Activity
  function viewActivity() {
    let h = pageHead('Activity', 'Every paper trade, newest first');
    if (!st.lastDate) return h + `<p class="empty">No trades yet.</p>`;
    const liveTr = allLiveTrades(), simTr = Object.entries(st.tickers).flatMap(([s, t]) => t.sim.trades.filter((x) => x.x).map((x) => ({ ...x, sym: s })));
    const useSim = liveTr.filter((t) => t.x).length === 0 && liveTr.length === 0;
    const list = useSim ? simTr : liveTr, S = E.stats(list);
    if (useSim) h += `<div class="card"><p class="sub" style="margin:0">No paper trades yet – showing my practice trades from before ${fdate(st.paperStart)}.</p></div>`;
    h += `<div class="card"><div class="grid">
      <div><div class="lbl">Closed trades</div><div class="stat">${S.n}</div></div>
      <div><div class="lbl">Win rate</div><div class="stat">${Number.isNaN(S.winRate) ? '–' : Math.round(S.winRate * 100) + '%'}</div></div>
      <div><div class="lbl">Avg win / loss</div><div><b class="up">${pct(S.avgWin)}</b> / <b class="down">${pct(S.avgLoss)}</b></div></div>
      <div><div class="lbl">Net P&amp;L</div><div><b class="${cls(S.pnl)}">${inr(S.pnl)}</b></div></div>
      <div><div class="lbl">Avg days held</div><div><b>${Number.isNaN(S.avgDays) ? '–' : S.avgDays.toFixed(1)}</b></div></div>
      <div><div class="lbl">Targets hit</div><div><b>${S.targets}</b></div></div></div></div>`;
    h += paperCharts();
    const tally = {};
    list.filter((t) => t.x && t.pnl <= 0).forEach((t) => E.diagnose(t).forEach((g) => { tally[g] = (tally[g] || 0) + 1; }));
    const tl = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (tl.length) h += `<div class="sec">Mistakes</div><div class="card"><div class="lbl">Most common mistakes</div>` + tl.slice(0, 5).map(([g, n]) => `<div class="row"><div>${esc(g)}</div><div class="r"><b>${n}×</b></div></div>`).join('') + `</div>`;
    const ev = [];
    list.forEach((t) => { ev.push({ d: t.e, k: 'buy', t }); if (t.x) ev.push({ d: t.x, k: 'sell', t }); });
    ev.sort((a, b) => b.d.localeCompare(a.d) || (a.k === 'sell' ? -1 : 1));
    let lastM = '';
    const rows = ev.slice(0, 160).map(({ d, k, t }) => {
      const m = new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const head = m !== lastM ? `${lastM ? '</div>' : ''}<div class="daylbl">${m}</div><div class="card" style="padding:4px 16px">` : ''; lastM = m;
      const open = !t.x, last = st.tickers[t.sym]?.lastClose;
      const ini = sym(t.sym).replace(/[^A-Z]/g, '').slice(0, 3);
      if (k === 'buy') {
        const r = open && last ? (last / t.ep - 1) * 100 : null;
        return head + `<div class="stx"><span class="badge open">${ini}</span><div class="mid"><b>Bought ${sym(t.sym)}</b><div class="m">${fdate(d)} · ${t.q} @ ${px(t.ep)} · ${esc(E.STRATEGIES[t.s]?.label || '')}</div></div><div class="r">${open ? `<b class="${cls(r)}">${pct(r)}</b><div class="m">holding</div>` : `<span class="m">${inr(t.ep * t.q)}</span>`}</div></div>`;
      }
      const mm = t.pnl <= 0 ? memOf(t) : null;
      const tags = t.pnl <= 0 ? `<div class="m" style="margin-top:3px">${esc(E.diagnose(t)[0])}${mm ? ` · <span class="${mm.forgiven ? '' : 'down'}">${mm.forgiven ? 'noted, later forgiven' : 'noted – won\'t repeat'}</span>` : ''}</div>` : '';
      const why = t.r === 'stop' ? 'stop-loss' : t.r === 'target' ? 'profit target' : t.r === 'time' ? 'time limit' : 'signal';
      return head + `<div class="stx"><span class="badge ${t.pnl > 0 ? 'win' : ''}">${ini}</span><div class="mid"><b>Sold ${sym(t.sym)}</b><div class="m">${fdate(d)} · ${why} · held ${t.bars || 0}d</div>${tags}</div><div class="r"><b class="${cls(t.pnl)}">${t.pnl > 0 ? '+' : ''}${inr(t.pnl)}</b><div class="m">${pct(t.ret)}</div></div></div>`;
    }).join('');
    h += rows ? rows + '</div>' : `<div class="card"><p class="empty">No trades yet. I only buy when a strategy I trust gives a fresh signal.</p></div>`;
    return h;
  }

  // ---------------------------------------------------------------- Guide
  function viewGuide() {
    const adv = advice(), S = E.stats(allLiveTrades());
    let h = `<div class="ph withbuddy">${buddy(64, adv[0] ? moodOf(adv[0].kind) : 'happy')}<div class="t"><h1>Your guide</h1><div class="s">Based on ${S.n} closed trade${S.n === 1 ? '' : 's'} and ${st.equity.length} session${st.equity.length === 1 ? '' : 's'} of paper trading</div></div></div>`;
    if (!st.lastDate) return h + `<p class="empty">The guide starts after the first update.</p>`;
    const idx = returnIndex(st.equity), ret = idx.length ? idx[idx.length - 1] - 100 : 0, nf = st.equity.filter((r) => r[2]);
    const nRet = nf.length > 1 ? (nf[nf.length - 1][2] / nf[0][2] - 1) * 100 : null;
    if (nRet != null) h += `<div class="card"><div class="lbl">Me vs the Nifty</div><div class="big ${cls(ret - nRet)}">${ret - nRet >= 0 ? '+' : '−'}${Math.abs(ret - nRet).toFixed(1)}<span class="m" style="font-family:var(--sans);font-size:17px"> pts</span></div><p class="sub">I made ${pct(ret, 2)} since ${fdate(st.paperStart)}; the Nifty made ${pct(nRet, 2)}.</p></div>`;
    const eq = eqNow(), cash = E.cashTotal(st), inv = holdValue(), pnl = eq + st.withdrawn - st.invested, tot = Math.max(inv + cash, 1);
    h += `<div class="card"><div class="lbl">Your money</div><div class="split"><span style="flex:${Math.max(inv, tot * 0.02)};background:var(--slate)"></span><span style="flex:${Math.max(cash, tot * 0.02)};background:var(--ochre)"></span></div>
      <div class="kv"><span class="dot" style="background:var(--slate)"></span><span class="k">In shares</span><span class="v1">${inr(inv)}</span><span class="v2">${Math.round((inv / tot) * 100)}%</span></div>
      <div class="kv"><span class="dot" style="background:var(--ochre)"></span><span class="k">Cash</span><span class="v1">${inr(cash)}</span><span class="v2">${Math.round((cash / tot) * 100)}%</span></div>
      <div class="kv"><span class="dot" style="background:var(--${pnl >= 0 ? 'sage' : 'clay'})"></span><span class="k">${pnl >= 0 ? 'Profit' : 'Loss'} so far</span><span class="v1">${inr(Math.abs(pnl))}</span><span class="v2 ${cls(pnl)}">${pct(ret)}</span></div>
      <p class="m" style="margin:8px 0 0">${E.brainParams(st).quick ? 'Quick trading – in and out within days.' : 'Normal trading – riding trends.'}</p></div>`;
    h += `<div class="sec">Suggestions</div>` + adv.map(advCard).join('');
    h += `<div class="sec">Predictions · candles, chart patterns &amp; trend</div>` + predictionsCard();
    const R = st.learning.rules;
    h += `<div class="sec">Mistakes I won't repeat</div>` + mistakesCard(st.learning.mistakes);
    h += `<div class="sec">What I've learned</div><div class="card">` + Object.entries(E.FEATURES).map(([k, f]) => {
      const r = R[k] || {};
      const evd = r.nWith ? `${r.nWith} trades with it: avg ${pct(r.meanWith)}, win ${Math.round((r.winWith || 0) * 100)}% · without: avg ${pct(r.meanWithout)}` : 'Not enough trades yet';
      return `<div class="row"><div><b>${esc(f.label)}</b><div class="m">${evd}</div></div><div class="r"><span class="pill ${r.active ? 'neg' : ''}">${r.active ? 'Avoid' : 'OK'}</span></div></div>`;
    }).join('') + `</div>`;
    h += `<div class="sec">Strategy per stock</div><div class="card">` + Object.entries(st.tickers).map(([s, t]) => {
      const rows = Object.entries(t.scores || {}).filter(([, v]) => v != null && !Number.isNaN(v)).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<tr><td>${(t.quickSet || [t.active]).includes(k) ? '<b>' : ''}${esc(E.STRATEGIES[k].label)}${(t.quickSet || [t.active]).includes(k) ? '</b>' : ''}</td><td class="${cls(v)}">${E.brainParams(st).quick ? pct(v, 2) : v.toFixed(2)}</td></tr>`).join('');
      return `<details class="row" style="display:block"><summary style="display:flex;justify-content:space-between"><b>${sym(s)}</b><span class="m">${E.brainParams(st).quick && t.quickSet && t.quickSet.length > 1 ? `${t.quickSet.length} quick strategies` : t.active ? esc(E.STRATEGIES[t.active].label) : 'Cash'} · review in ${E.brainParams(st).reviewEvery - t.sinceReview} ›</span></summary>
        <table><tr><td class="m">Strategy</td><td class="m">${E.brainParams(st).quick ? 'Avg per trade, last 20' : 'Sharpe, last year'}</td></tr>${rows || '<tr><td class="m">Not scored yet</td><td></td></tr>'}</table></details>`;
    }).join('') + `</div>`;
    const evs = st.learning.events.slice(-12).reverse();
    h += `<div class="sec">What happened</div><div class="card">` + (evs.length ? evs.map((e) => `<div class="ev"><span class="d">${fdate(e.date)}${e.date < st.paperStart ? ' · practice' : ''}</span><br>${esc(e.text)}</div>`).join('') : '<p class="empty">Nothing yet.</p>') + `</div>`;
    return h;
  }

  // ---------------------------------------------------------------- Welcome / setup
  function viewSetup() {
    const c = DEFAULTS;
    return `<div class="welcome">${buddy(96, 'wave')}<div class="ph" style="margin-top:10px"><div class="t"><h1>Hi, I'm Moli</h1><div class="s">I paper trade Indian stocks with pretend money, learn from my mistakes, and tell you what I'd do. Free Yahoo Finance prices; no broker, no real money.</div></div></div></div>
      <div class="card"><div class="lbl">Your name (optional)</div><input id="s_name" placeholder="e.g. Anmol" autocomplete="off">
        <div class="grid" style="margin-top:4px">
        <div><label>Paper money (₹)</label><input id="s_c" inputmode="numeric" value="${c.capital}"></div>
        <div><label>Practice years</label><input id="s_w" inputmode="numeric" value="${c.warmYears}"></div>
        <div><label>Stop-loss (× ATR)</label><input id="s_s" inputmode="decimal" value="${c.stopAtr}"></div>
        <div><label>Risk per trade %</label><input id="s_r" inputmode="decimal" value="${c.riskPct}"></div></div>
        <div class="actions"><button class="btn block" id="s_go">Start with ${setupPicks.size} stock${setupPicks.size === 1 ? '' : 's'}</button></div></div>` + viewStocks();
  }

  // ---------------------------------------------------------------- Settings
  function viewSettings() {
    let h = pageHead('Settings', '', 'home');
    h += `<div class="card"><div class="lbl">Name</div><input id="set_name" value="${esc(st.cfg.name || '')}" placeholder="Your name" autocomplete="off"></div>`;
    h += `<a class="card" style="display:flex;align-items:center;gap:12px" data-act="stocks"><div style="flex:1"><div class="lbl">Stocks</div><div class="serif" style="font-size:20px;margin-top:4px">${st.cfg.tickers.length} in your list</div><div class="m">${st.cfg.tickers.slice(0, 6).map(sym).join(', ')}${st.cfg.tickers.length > 6 ? '…' : ''}</div></div><span class="m" style="font-size:22px">›</span></a>`;
    if (N && N.canRemind && N.canRemind()) h += `<div class="card"><div class="setrow"><div class="stx"><h3>Daily reminder</h3><div class="m">A nudge at 4:15 PM on weekdays to update and see what I did.</div></div><input type="checkbox" class="tog" id="s_rem" ${N.reminderOn() ? 'checked' : ''}></div></div>`;
    return h + viewMore();
  }

  // ---------------------------------------------------------------- Ask Moli (chat)
  function viewChat() {
    const msgs = st.chat || [];
    let h = pageHead('Ask Moli', 'Questions or orders, in plain words', 'home');
    if (!msgs.length) h += `<div class="says">${buddy(70, 'wave')}<div class="bub"><div class="lbl">Moli says</div><h3>What would you like to know?</h3><p>Try "how am I doing?", "why SBIN?", "quick mode" or "train last 5 years until max profit".</p></div></div>`;
    h += msgs.map((m) => {
      const extra = m.x === 'pnl' && st.equity.length > 1 ? pnlChart(down(returnIndex(st.equity), 300))
        : m.x === 'sim' && st.sim.length > 1 ? pnlChart(down(returnIndex(st.sim.map((r) => [r[0], r[1], r[2], 0])), 300)) : '';
      return m.r === 'you' ? `<div class="msg you"><div><div class="b">${esc(m.t)}</div><div class="t">${timeOf(m.at)}</div></div></div>`
        : `<div class="msg moli">${buddy(34, 'happy')}<div class="bub"><div class="b">${md(m.t)}</div>${extra}<div class="t">${timeOf(m.at)}</div></div></div>`;
    }).join('');
    if (busy) h += `<div class="msg moli typingmsg">${buddy(34, 'thinking')}<div class="bub"><div class="typing"><span></span><span></span><span></span></div></div></div>`;
    return h;
  }

  // ---------------------------------------------------------------- Today, wrapped (story)
  let wslides = [], wi = 0;
  function openWrapped() {
    const d = st.lastDate, nfr = st.equity.length >= 2 ? st.equity.slice(-2) : null;
    const niftyToday = st.equity.length >= 2 && nfr[0][2] && nfr[1][2] ? (nfr[1][2] / nfr[0][2] - 1) * 100 : null;
    const eq = eqNow(), dayPnl = nfr ? nfr[1][1] - nfr[0][1] - ((nfr[1][3] || 0) - (nfr[0][3] || 0)) : 0;
    const today = allLiveTrades().flatMap((t) => [...(t.e === d ? [`Bought ${t.q} ${sym(t.sym)} at ${px(t.ep)}`] : []), ...(t.x === d ? [`Sold ${sym(t.sym)} – ${t.pnl >= 0 ? 'made' : 'lost'} ${inr(Math.abs(t.pnl))}`] : [])]);
    const learnt = st.learning.events.filter((e) => e.date === d && (e.kind === 'learn' || e.kind === 'switch' || e.kind === 'unlearn' || e.kind === 'mistake')).map((e) => e.text);
    const adv = advice()[0];
    const pend = Object.entries(st.tickers).filter(([, t]) => t.live.pending).map(([s, t]) => `${t.live.pending === 'BUY' ? 'buy' : 'sell'} ${sym(s)}`);
    const dayName = new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' });
    wslides = [
      { bg: 'clay', head: dayName, html: `<div class="small">The Nifty ${niftyToday == null ? 'closed at' : niftyToday >= 0 ? 'rose' : 'fell'}</div><div class="huge">${niftyToday == null ? (nfr ? Math.round(nfr[1][2]).toLocaleString('en-IN') : '–') : pct(Math.abs(niftyToday), 2).replace('+', '')}</div><div class="after">${niftyToday == null ? '' : `to ${Math.round(nfr[1][2]).toLocaleString('en-IN')}`}</div>` },
      { bg: '', head: dayName, html: `<div class="small">Your paper account</div><div class="huge">${inr(eq)}</div><div class="after ${cls(dayPnl)}">${nfr ? `${dayPnl >= 0 ? '+' : '−'}${inr(Math.abs(dayPnl)).replace('−', '')} today` : 'Paper trading started today'}</div>` },
      { bg: 'ink', head: dayName, html: `<div class="small">Trades today</div><div class="huge">${today.length}</div>${today.length ? `<ul>${today.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<div class="after">No trades – no strategy I trust gave a fresh signal.</div>`}` },
      { bg: 'sage', head: dayName, html: `<div class="small">What I learned</div>${learnt.length ? `<ul>${learnt.slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<div class="huge" style="font-size:44px">Steady</div><div class="after">No new lessons or strategy switches today.</div>`}` },
      { bg: '', head: dayName, note: true, html: `<h2>Moli's note for tomorrow</h2><div class="wnote">${buddy(84, adv ? moodOf(adv.kind) : 'happy')}<div class="bub">${pend.length ? `At 9:15 I'll ${pend.join(', ')}. ` : ''}${adv ? esc(adv.title) + '. ' + esc(adv.body) : 'Nothing needs your attention.'}</div></div><div class="actions" style="margin-top:28px"><button class="btn block" id="w_done">Done</button></div>` },
    ];
    wi = 0; drawWrapped(); $('wrapped').hidden = false;
  }
  function drawWrapped() {
    const s = wslides[wi], w = $('wrapped');
    w.className = 'wrapped ' + (s.bg || '');
    w.innerHTML = `<div class="wsegs">${wslides.map((_, i) => `<i class="${i <= wi ? 'done' : ''}"></i>`).join('')}</div>
      <div class="whead"><span>Moli Wrapped · ${esc(s.head)}</span><button id="w_x" aria-label="Close">×</button></div>
      <div class="wbody" id="w_body">${s.html}</div>${s.note ? '' : '<div class="wtap">Tap to continue</div>'}`;
    $('w_x').onclick = (e) => { e.stopPropagation(); w.hidden = true; };
    const done = $('w_done'); if (done) done.onclick = () => { w.hidden = true; };
    w.onclick = (e) => { if (s.note || e.target.closest('button')) return; if (wi < wslides.length - 1) { wi++; drawWrapped(); } };
  }

  // ---------------------------------------------------------------- + sheet
  function openSheet() {
    const paused = E.isPaused(st), q = E.brainParams(st).quick;
    const items = [
      ['chat', '💬', 'Ask Moli', 'Questions or orders in plain words'],
      ['update', '↻', 'Update prices', `Last update ${updatedAgo()}`],
      ['stocks', '+', 'Add a stock', 'NIFTY 50, ETFs or any NSE symbol'],
      ['money', '₹', 'Add or withdraw money', `Account ${inr(eqNow())}`],
      ['train', '⟲', 'Train on the past', 'Practise on real history, then apply what works'],
      [q ? 'quick-off' : 'quick-on', q ? '〰' : '⚡', q ? 'Switch to normal trading' : 'Switch to quick trading', q ? 'Ride trends for weeks' : 'In and out within days'],
      [paused ? 'resume' : 'pause', paused ? '▶' : '❚❚', paused ? 'Resume trading' : 'Pause new buys', paused ? 'Start buying again' : 'Keep positions, stop buying'],
      ['wrapped', '✳', 'Today, wrapped', 'Your trading day in a few taps'],
      ['import', '⇪', 'Import brain data', 'Load a brain file or restore a backup'],
    ];
    $('sheet').innerHTML = `<div class="grab"></div><h2>What next?</h2>` + items.map(([a, ic, t, s]) => `<button class="act" data-sa="${a}"><span class="ic">${ic}</span><span><b>${t}</b><span>${s}</span></span></button>`).join('');
    $('sheet').querySelectorAll('[data-sa]').forEach((b) => { b.onclick = () => { closeSheet(); doAct(b.dataset.sa); }; });
    $('sheet').classList.add('open'); $('sheetScrim').classList.add('open');
  }
  function closeSheet() { $('sheet').classList.remove('open'); $('sheetScrim').classList.remove('open'); }

  // ---------------------------------------------------------------- more charts
  /** Several lines on one scale. series: [{ v:[…], color, name, dash, w }]; shade: index after which the area is shaded (unseen data). */
  function multiLine(series, { height = 170, shade = null, vlines = [], base = 100, shadeLabel = '' } = {}) {
    const W = 340, H = height, P = 6, n = Math.max(...series.map((s) => s.v.length));
    if (n < 2) return '';
    const all = series.flatMap((s) => s.v.filter((x) => x != null && Number.isFinite(x)));
    const lo = Math.min(base, ...all), hi = Math.max(base, ...all);
    const X = (i) => P + (i / (n - 1)) * (W - 2 * P), Y = (y) => P + (1 - (y - lo) / (hi - lo || 1)) * (H - 2 * P);
    let g = `<line x1="0" x2="${W}" y1="${Y(base).toFixed(1)}" y2="${Y(base).toFixed(1)}" stroke="${css('--line')}" stroke-dasharray="3 3"/>`;
    if (shade != null && shade < n - 1) g += `<rect x="${X(shade).toFixed(1)}" y="0" width="${(W - X(shade)).toFixed(1)}" height="${H}" fill="${css('--ochre')}" opacity=".09"/>${shadeLabel ? `<text x="${(X(shade) + 4).toFixed(1)}" y="12" font-size="9" fill="${css('--muted')}">${shadeLabel}</text>` : ''}`;
    vlines.forEach((i) => { g += `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="0" y2="${H}" stroke="${css('--line')}"/>`; });
    series.forEach((s) => {
      let d = ''; s.v.forEach((y, i) => { if (y != null && Number.isFinite(y)) d += `${d ? 'L' : 'M'}${X(i).toFixed(1)},${Y(y).toFixed(1)}`; });
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 1.8}" ${s.dash ? 'stroke-dasharray="4 3"' : ''} stroke-linejoin="round"/>`;
    });
    return `<svg class="chart" style="height:${height}px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>
      <div class="legend" style="flex-wrap:wrap;gap:6px 14px">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }
  /** Drop from the running peak, as a red area. */
  function ddChart(v, height = 90) {
    if (v.length < 2) return '';
    let pk = -Infinity; const dd = v.map((x) => { pk = Math.max(pk, x); return (x / pk - 1) * 100; });
    const W = 340, H = height, P = 4, lo = Math.min(-1, ...dd), n = dd.length;
    const X = (i) => P + (i / (n - 1)) * (W - 2 * P), Y = (y) => P + (y / lo) * (H - 2 * P);
    const line = dd.map((y, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join('');
    return `<svg class="chart" style="height:${height}px;margin-top:8px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${line}L${X(n - 1).toFixed(1)},${P}L${X(0).toFixed(1)},${P}Z" fill="${css('--clay')}" opacity=".22"/><path d="${line}" fill="none" stroke="${css('--clay')}" stroke-width="1.4"/></svg>
      <div class="m">Worst drop ${pct(Math.min(...dd))} · now ${pct(dd[n - 1])} from the peak</div>`;
  }
  /** Bars around zero (green up, clay down). items: [{ v, label }] */
  function barChart(items, { height = 130, unit = '' } = {}) {
    if (!items.length) return '<p class="empty">Nothing to show yet.</p>';
    const W = 340, H = height, P = 6, n = items.length, mx = Math.max(...items.map((x) => Math.abs(x.v)), 1e-9);
    const zero = H / 2, bw = Math.max(2, ((W - 2 * P) / n) * 0.7), X = (i) => P + ((i + 0.5) * (W - 2 * P)) / n;
    let g = `<line x1="0" x2="${W}" y1="${zero}" y2="${zero}" stroke="${css('--line')}"/>`;
    items.forEach((x, i) => { const h = (Math.abs(x.v) / mx) * (H / 2 - P); g += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(x.v >= 0 ? zero - h : zero).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="1.5" fill="${x.v >= 0 ? css('--sage') : css('--clay')}"/>`; });
    const lab = n <= 12 ? items.map((x, i) => `<text x="${X(i).toFixed(1)}" y="${H - 1}" font-size="8" text-anchor="middle" fill="${css('--muted')}">${esc(x.label)}</text>`).join('') : '';
    return `<svg class="chart" style="height:${height}px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}${lab}</svg>`;
  }
  /** Account vs Nifty (both start at 100) from equity rows [date, value, nifty, capital]. */
  function vsNifty(rows, extra = {}) {
    const idx = returnIndex(rows), n0 = (rows.find((r) => r[2]) || [])[2];
    return multiLine([{ v: down(idx, 300), color: css('--clay'), name: 'Paper account' }, { v: down(rows.map((r) => (r[2] && n0 ? (r[2] / n0) * 100 : null)), 300), color: css('--slate'), name: 'Nifty 50', dash: 1, w: 1.4 }], extra);
  }
  const monthKey = (d) => d.slice(0, 7), monthLbl = (k) => new Date(k + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
  function monthlyBars(rows) {
    const idx = returnIndex(rows), by = {};
    rows.forEach((r, i) => { const k = monthKey(r[0]); if (!by[k]) by[k] = { first: i === 0 ? 100 : idx[i - 1], last: idx[i] }; by[k].last = idx[i]; });
    return Object.entries(by).slice(-12).map(([k, x]) => ({ v: (x.last / x.first - 1) * 100, label: monthLbl(k) }));
  }
  /** The paper-trading charts block for the Activity page. */
  function paperCharts() {
    const live = st.equity.length >= 2, rows = live ? st.equity : st.sim.map((r) => [r[0], r[1], r[2], 0]);
    if (rows.length < 2) return '';
    const trades = (live ? allLiveTrades() : Object.entries(st.tickers).flatMap(([s, t]) => t.sim.trades.map((x) => ({ ...x, sym: s })))).filter((t) => t.x).sort((a, b) => a.x.localeCompare(b.x)).slice(-40);
    const tag = live ? '' : ' · practice run';
    let h = `<div class="sec">Charts${tag}</div>`;
    h += `<div class="card"><div class="lbl">Account vs the Nifty</div>${vsNifty(rows)}</div>`;
    h += `<div class="card"><div class="lbl">Drop from the peak</div>${ddChart(returnIndex(rows))}</div>`;
    h += `<div class="card"><div class="lbl">Month by month</div>${barChart(monthlyBars(rows))}<div class="m">Return of the whole account each month (deposits and withdrawals excluded).</div></div>`;
    h += `<div class="card"><div class="lbl">Each closed trade</div>${barChart(trades.map((t) => ({ v: t.ret, label: '' })))}<div class="m">${trades.length ? `Last ${trades.length} trades, oldest left. Tallest win ${pct(Math.max(...trades.map((t) => t.ret)))}, worst loss ${pct(Math.min(...trades.map((t) => t.ret)))}.` : 'No closed trades yet.'}</div></div>`;
    const byStock = {}; (live ? allLiveTrades() : []).filter((t) => t.x).forEach((t) => { byStock[t.sym] = (byStock[t.sym] || 0) + t.pnl; });
    const bs = Object.entries(byStock).sort((a, b) => b[1] - a[1]);
    if (bs.length) h += `<div class="card"><div class="lbl">Profit by stock</div>${barChart(bs.map(([s, v]) => ({ v, label: sym(s).slice(0, 5) })))}<div class="m">Closed trades only.</div></div>`;
    return h;
  }

  // ---------------------------------------------------------------- mistake memory UI
  const memText = (m) => `${sym(m.sym)} · ${E.STRATEGIES[m.s] ? E.STRATEGIES[m.s].label : m.s} while ${m.keys.map((k) => E.FEATURES[k].label.toLowerCase()).join(' and ')}`;
  const memOf = (t) => { const keys = Object.keys(E.FEATURES).filter((k) => t.f && t.f[k]).join('+'); return (st.learning.mistakes || []).find((m) => m.id === `${t.sym}|${t.s}|${keys}`); };
  function mistakesCard(list, { empty = 'No mistakes noted yet. When a trade loses more than 1% with warning signs at entry, I note it here and never make that exact trade again.' } = {}) {
    const M = (list || []).slice().reverse(), act = M.filter((m) => !m.forgiven), fg = M.filter((m) => m.forgiven);
    if (!M.length) return `<div class="card"><p class="empty">${empty}</p></div>`;
    const one = (m) => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(memText(m))}</b><span class="pill ${m.forgiven ? '' : 'neg'}" style="${m.forgiven ? 'background:var(--line);color:var(--muted)' : ''}">${m.forgiven ? 'forgiven' : 'never again'}</span></div>
      <div class="m" style="margin-top:3px">Lost ${pct(m.ret)} on ${fdate(m.date)}${m.count > 1 ? ` (noted ${m.count}×)` : ''}${m.from ? ` · learned in ${m.from}` : m.inherited ? ' · from earlier lessons' : ''}.${m.blocked ? ` Skipped it ${m.blocked}× since.` : ''}${m.avoided || m.missed ? ` Similar trades since: ${m.avoided} lost${m.avoided ? ` (avg ${pct(-m.saved / m.avoided)})` : ''}, ${m.missed} won.` : ''}${m.forgiven ? ' Forgiven – those trades made money more often, so it was probably bad luck.' : ''}</div></div>`;
    return `<div class="card">${act.slice(0, 15).map(one).join('')}${act.length > 15 ? `<p class="m">…and ${act.length - 15} more</p>` : ''}${fg.length ? `<details style="margin-top:8px"><summary class="m">Forgiven (${fg.length}) ›</summary>${fg.slice(0, 10).map(one).join('')}</details>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- predictions UI
  let curSym = null, prevTab = 'home';
  function openStock(s) { prevTab = tab === 'stock' ? prevTab : tab; curSym = s; tab = 'stock'; render(); window.scrollTo(0, 0); }
  const leanText = (o) => (o.lean === 'none' ? 'No clear edge' : `${o.strength === 'moderate' ? 'Leans' : 'Slightly leans'} ${o.lean}`);
  /** What history says about one signal on this stock. */
  function verdict(s, base) {
    const st5 = s.h5;
    if (st5.n < 8) return { t: `Too rare to judge here (seen ${st5.n}×)`, c: '' };
    const edge = (st5.up - base.h5.up) * 100;
    const bookUp = s.dir === 'bull', bookDown = s.dir === 'bear';
    if (Math.abs(edge) < 3) return { t: 'No real edge here – about the same as any day', c: '' };
    if ((bookUp && edge < 0) || (bookDown && edge > 0)) return { t: `Textbook says ${bookUp ? 'up' : 'down'} – on this stock it usually went the other way`, c: edge > 0 ? 'up' : 'down' };
    return { t: `Historically ${edge > 0 ? 'bullish' : 'bearish'} here (${edge > 0 ? '+' : ''}${edge.toFixed(0)} pts vs a normal week)`, c: edge > 0 ? 'up' : 'down' };
  }
  function sigRow(s, base) {
    const v = verdict(s, base), k = { candle: 'Candle', chart: 'Chart', trend: 'Trend' }[s.kind];
    return `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><b>${esc(s.label)}</b><span class="pill ${s.dir === 'bear' ? 'neg' : ''}" style="${s.dir === 'neutral' ? 'background:var(--line);color:var(--muted)' : ''}">${k}${s.dir === 'neutral' ? '' : ' · ' + (s.dir === 'bull' ? 'textbook up' : 'textbook down')}</span></div>
      <div class="m" style="margin-top:3px">${esc(s.what)}</div>
      <div style="margin-top:6px;font-size:14px">Higher 5 sessions later: <b>${Number.isNaN(s.h5.up) ? '–' : Math.round(s.h5.up * 100) + '%'}</b> <span class="m">(seen ${s.h5.n}× · avg ${pct(s.h5.avg, 2)} · a normal week ${Math.round(base.h5.up * 100)}%)</span></div>
      <div class="${v.c}" style="font-size:13px;margin-top:2px">${esc(v.t)}</div></div>`;
  }
  /** Candlestick chart with 20/50-day averages, support/resistance, pattern marks and the trend cone. */
  function candleChart(P) {
    const C = P.chart, n = C.c.length, ahead = P.proj.ahead, W = 340, H = 210, padR = 34, padT = 8, padB = 8;
    const vals = [...C.l, ...C.h, ...P.proj.path].filter((x) => x != null); // cone is clipped at the edges
    const lo = Math.min(...vals) * 0.995, hi = Math.max(...vals) * 1.005;
    const slot = (W - padR) / (n + ahead), X = (i) => slot * (i + 0.5), Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const cw = Math.max(1.5, slot * 0.62);
    let g = '';
    const lvl = (v, col, txt) => { if (v < lo || v > hi) return ''; return `<line x1="0" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${col}" stroke-width="1" stroke-dasharray="4 4" opacity=".8"/><text x="${W - padR + 3}" y="${(Y(v) + 3).toFixed(1)}" font-size="8.5" fill="${col}">${txt}</text>`; };
    P.levels.sup.forEach((x) => { g += lvl(x.level, css('--sage'), Math.round(x.level)); });
    P.levels.res.forEach((x) => { g += lvl(x.level, css('--clay'), Math.round(x.level)); });
    const cone = [...P.proj.hiPath.map((v, k) => `${X(n - 1 + k).toFixed(1)},${Y(v).toFixed(1)}`), ...P.proj.loPath.map((v, k) => `${X(n - 1 + k).toFixed(1)},${Y(v).toFixed(1)}`).reverse()].join(' ');
    g += `<polygon points="${cone}" fill="${css('--ochre')}" opacity=".14"/>`;
    g += `<path d="${P.proj.path.map((v, k) => `${k ? 'L' : 'M'}${X(n - 1 + k).toFixed(1)},${Y(v).toFixed(1)}`).join('')}" fill="none" stroke="${css('--ochre')}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
    const line = (arr, col) => { let d = ''; arr.forEach((v, i) => { if (v != null) d += `${d ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; }); return `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.3" opacity=".9"/>`; };
    g += line(C.s50, css('--slate')) + line(C.s20, css('--clay-d'));
    for (let i = 0; i < n; i++) {
      const up = C.c[i] >= C.o[i], col = up ? css('--sage') : css('--clay');
      const yT = Y(Math.max(C.o[i], C.c[i])), yB = Y(Math.min(C.o[i], C.c[i]));
      g += `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${Y(C.h[i]).toFixed(1)}" y2="${Y(C.l[i]).toFixed(1)}" stroke="${col}" stroke-width="1"/>`;
      g += `<rect x="${(X(i) - cw / 2).toFixed(1)}" y="${yT.toFixed(1)}" width="${cw.toFixed(1)}" height="${Math.max(1, yB - yT).toFixed(1)}" fill="${col}" rx="0.6"/>`;
    }
    C.marks.forEach((m) => {
      const x = X(m.i), up = m.dir === 'bull', y = up ? Y(C.l[m.i]) + 7 : Y(C.h[m.i]) - 7, s = 3.6;
      g += `<path d="${up ? `M${x - s},${y + s}L${x + s},${y + s}L${x},${y - s}Z` : `M${x - s},${y - s}L${x + s},${y - s}L${x},${y + s}Z`}" fill="${up ? css('--sage') : css('--clay')}"/>`;
    });
    g += `<line x1="${X(n - 1).toFixed(1)}" x2="${X(n - 1).toFixed(1)}" y1="${padT}" y2="${H - padB}" stroke="${css('--line')}" stroke-width="1"/>`;
    return `<svg class="chart" style="height:230px;overflow:hidden" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>
      <div class="legend" style="flex-wrap:wrap;gap:6px 14px"><span><i style="background:var(--clay-d)"></i>20-day avg</span><span><i style="background:var(--slate)"></i>50-day avg</span><span><i style="background:var(--ochre)"></i>trend cone (2 weeks)</span><span>▲▼ candle patterns</span><span>– – support / resistance</span></div>`;
  }

  function viewStock() {
    const T = st.tickers[curSym], P = T && T.pred;
    let h = pageHead(sym(curSym || ''), T ? `${px(T.lastClose)}${P ? ` · <span class="${cls(P.change)}">${pct(P.change, 2)}</span> on ${fdate(P.asOf)}` : ''}` : '', prevTab);
    if (!T) return h + '<p class="empty">Not in your list.</p>';
    if (!P) return h + `<div class="card"><p class="empty">Predictions appear after the next update.</p><div class="actions"><button class="btn sm" data-act="update">Update now</button></div></div>`;
    const o = P.outlook, mood = o.lean === 'up' ? 'happy' : o.lean === 'down' ? 'concerned' : 'thinking';
    h += `<div class="card"><div class="lbl">Last ${P.chart.c.length} sessions + 2-week trend cone</div>${candleChart(P)}</div>`;
    h += `<div class="says">${buddy(70, mood)}<div class="bub"><div class="adv"><div class="top" style="margin:0"><span class="lbl">Moli's read</span><span class="pill ${o.lean === 'down' ? 'neg' : ''}" style="${o.lean === 'none' ? 'background:var(--line);color:var(--muted)' : ''}">${esc(leanText(o))}</span></div></div>
      <h3>${o.lean === 'none' ? 'Today\'s signals don\'t tell me much' : `Similar setups rose ${Math.round(o.p5 * 100)}% of the time`}</h3>
      <p>${P.active.length ? `${P.active.length} signal${P.active.length > 1 ? 's' : ''} today. ` : 'No signals today. '}On ${sym(curSym)} a normal week ends higher ${Math.round(P.base.h5.up * 100)}% of the time${o.lean === 'none' ? '' : `; with today's signals it was ${Math.round(o.p5 * 100)}% (${o.edge > 0 ? '+' : ''}${o.edge.toFixed(1)} pts, from ${o.n} past cases)`}. Based on ${P.years} years of this stock's prices – a tilt in the odds, not a promise.</p></div></div>`;
    const pr = P.proj;
    h += `<div class="card"><div class="lbl">Trend projection</div><div class="big md">${px(pr.end)}</div>
      <p class="sub">If the last ${pr.look} sessions' trend (${pct(pr.slopePct, 2)} a day) simply continued, that's where it would be in ${pr.ahead} sessions. 9 times in 10 the normal day-to-day swings would land it between ${px(pr.lo)} and ${px(pr.hi)}. ${pr.r2 < 0.3 ? 'The trend has been weak and choppy, so trust this even less.' : `The trend has been fairly steady (fit ${Math.round(pr.r2 * 100)}%), but trends end without warning.`}</p></div>`;
    const lv = P.levels;
    h += `<div class="card"><div class="lbl">Support &amp; resistance</div>
      ${lv.res.map((x) => `<div class="row"><div><b>Resistance ${px(x.level)}</b><div class="m">${pct((x.level / P.price - 1) * 100)} away · rallies stopped here ${x.touches}×</div></div></div>`).join('')}
      ${lv.sup.map((x) => `<div class="row"><div><b>Support ${px(x.level)}</b><div class="m">${pct((x.level / P.price - 1) * 100)} away · falls stopped here ${x.touches}×</div></div></div>`).join('')}
      ${!lv.res.length && !lv.sup.length ? '<p class="empty">No clear levels in the last year.</p>' : ''}${!lv.res.length && lv.sup.length ? '<p class="m" style="margin:6px 0 0">No resistance above – it\'s near its 1-year high.</p>' : ''}</div>`;
    const byKind = (k) => P.active.filter((s) => s.kind === k);
    h += `<div class="sec">Candlestick patterns</div><div class="card">${byKind('candle').length ? byKind('candle').map((s) => sigRow(s, P.base)).join('') : '<p class="empty">No pattern on the last candle.</p>'}
      ${P.recent.length ? `<div class="lbl" style="margin-top:12px">Seen in the last 2 weeks</div>` + P.recent.map((s) => `<div class="row"><div><b>${esc(s.label)}</b><div class="m">${s.ago} session${s.ago > 1 ? 's' : ''} ago · since then ${pct(s.after)}</div></div><div class="r"><span class="m">usually ${Number.isNaN(s.h5.up) ? '–' : Math.round(s.h5.up * 100) + '% up'}</span></div></div>`).join('') : ''}</div>`;
    h += `<div class="sec">Chart patterns</div><div class="card">${byKind('chart').length ? byKind('chart').map((s) => sigRow(s, P.base)).join('') : '<p class="empty">No breakout, level test, double top/bottom, squeeze or cross today.</p>'}</div>`;
    h += `<div class="sec">Trend &amp; momentum</div><div class="card">${byKind('trend').length ? byKind('trend').map((s) => sigRow(s, P.base)).join('') : '<p class="empty">No strong trend, RSI extreme or MACD turn today.</p>'}</div>`;
    h += `<div class="card"><div class="lbl">What I'm doing with it</div><p class="sub" style="margin-top:4px">${T.live.qty ? `Holding ${T.live.qty} shares.` : 'Not holding it.'} ${T.active ? `Strategy: ${esc(E.STRATEGIES[T.active].label)}.` : 'No strategy I trust on it right now.'} My trades follow the strategy I picked – these predictions are here to help you read the chart.</p>
      <div class="actions"><button class="btn sm ghost" data-ask="why ${esc(sym(curSym))}">Ask why</button></div></div>`;
    h += `<p class="note">Every percentage is what happened after the same signal on this stock over the last ${P.years} years (in-sample). Across big Indian stocks most patterns are barely better than a coin flip – Moli shows the numbers so you can judge.</p>`;
    return h;
  }

  function predictionsCard() {
    const rows = Object.entries(st.tickers).filter(([, t]) => t.pred).map(([s, t]) => ({ s, o: t.pred.outlook, n: t.pred.active.length, P: t.pred }));
    if (!rows.length) return `<div class="card"><p class="empty">Predictions appear after the next update.</p></div>`;
    rows.sort((a, b) => Math.abs(b.o.lean === 'none' ? 0 : b.o.edge) - Math.abs(a.o.lean === 'none' ? 0 : a.o.edge));
    return `<div class="card">` + rows.map(({ s, o, n, P }) => `<a class="row" data-stock="${esc(s)}"><div><b>${sym(s)}</b><div class="m">${n ? P.active.slice(0, 2).map((x) => x.label).join(', ') + (n > 2 ? ` +${n - 2}` : '') : 'no signals today'}</div></div>
      <div class="r"><span class="pill ${o.lean === 'down' ? 'neg' : ''}" style="${o.lean === 'none' ? 'background:var(--line);color:var(--muted)' : ''}">${o.lean === 'none' ? 'no edge' : `leans ${o.lean}`}</span>${o.lean === 'none' ? '' : `<div class="m" style="margin-top:3px">${Math.round(o.p5 * 100)}% rose · normally ${Math.round(P.base.h5.up * 100)}%</div>`}</div></a>`).join('') +
      `<p class="m" style="margin:8px 0 0">Odds of being higher in 5 sessions after today's signals, from each stock's own history. Tap a stock for the chart and patterns.</p></div>`;
  }

  function predictText(s) {
    const T = st.tickers[s], P = T && T.pred;
    if (!P) return `I don't have predictions for ${sym(s)} yet – they appear after the next update.`;
    const o = P.outlook;
    return `**${sym(s)}** ${px(P.price)} (${pct(P.change, 2)} on ${fdate(P.asOf)}). **${leanText(o)}**: a normal week ends higher ${Math.round(P.base.h5.up * 100)}% of the time; ${o.lean === 'none' ? "today's signals don't change that much" : `after setups like today's it was ${Math.round(o.p5 * 100)}% (${o.n} past cases)`}.` +
      (P.active.length ? `\n\nToday's signals:\n${P.active.map((x) => `- ${x.label}: higher a week later ${Number.isNaN(x.h5.up) ? '–' : Math.round(x.h5.up * 100) + '%'} of ${x.h5.n} times`).join('\n')}` : '\n\nNo candle or chart pattern today.') +
      `\n\nTrend cone for 2 weeks: about ${px(P.proj.end)} (likely ${px(P.proj.lo)}–${px(P.proj.hi)}).${P.levels.res[0] ? ` Resistance ${px(P.levels.res[0].level)}.` : ''}${P.levels.sup[0] ? ` Support ${px(P.levels.sup[0].level)}.` : ''}\n\nOdds from this stock's last ${P.years} years – not a promise.`;
  }


  // ---------------------------------------------------------------- import brain / restore backup
  /** Let the user pick a file and return its text (Android picker, or a browser file input). */
  function pickFile() {
    if (N && N.pickFile) return new Promise((res, rej) => { const id = 'f' + ++seq; waiting[id] = { res, rej }; N.pickFile(id); });
    return new Promise((res, rej) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json'; inp.style.display = 'none';
      inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return rej(new Error('cancelled')); const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read the file')); r.readAsText(f); inp.remove(); };
      document.body.appendChild(inp); inp.click();
    });
  }
  let pendingImport = null;
  async function startImport() {
    let text;
    try { text = await pickFile(); } catch (e) { if (e.message !== 'cancelled') toast(e.message); return; }
    let obj; try { obj = JSON.parse(text); } catch (e) { return say('That file isn\'t a Moli brain or backup (it isn\'t valid JSON).') || toast('Not a Moli file'); }
    const b = E.readBrain(obj);
    if (b.error) { toast(b.error); return say(`I couldn't import that: ${b.error}. Use a **Brain data** (moli-brain-…json) or **Full backup** (moli-backup-…json) file from Data & settings.`); }
    pendingImport = b; showImportSheet();
  }
  function showImportSheet() {
    const b = pendingImport, opts = pendingImport.opts || (pendingImport.opts = { settings: true, evidence: true });
    let h = `<div class="grab"></div>`;
    if (b.kind === 'backup') {
      const s2 = b.state, eqs = Object.values(s2.tickers || {}).reduce((a, t) => a + (t.live ? t.live.cash + t.live.qty * (t.lastClose || 0) : 0), 0);
      h += `<h2>Restore a backup?</h2><div class="says" style="margin:0 0 6px">${buddy(56, 'thinking')}<div class="bub"><div class="lbl">Backup${b.exported ? ' · ' + esc(b.exported) : ''}</div><h3>${(s2.cfg.tickers || []).length} stocks · ${inr(eqs)}</h3><p>Paper trading since ${fdate(s2.paperStart)}, data to ${fdate(s2.lastDate)}. Restoring <b>replaces</b> your current account and everything I learned. Download a backup of the current one first if you want to keep it.</p></div></div>
        <div class="actions"><button class="btn" id="imp_restore">Replace &amp; restore</button><button class="btn ghost" id="imp_cancel">Cancel</button></div>`;
    } else {
      const pv = E.previewImport(st, b, opts, todayIST()), cur = E.brainParams(st);
      const ch = b.settings ? E.describeParams(b.settings, cur) : [];
      h += `<h2>Import brain data</h2><div class="says" style="margin:0 0 10px">${buddy(56, 'thinking')}<div class="bub"><div class="lbl">Brain file${b.exported ? ' · ' + esc(b.exported) : ''}</div><h3>${b.evidence.length} learned trades${b.mistakes && b.mistakes.length ? ` + ${b.mistakes.length} noted mistakes` : ''}${b.settings ? ' + settings' : ''}</h3><p>${b.rules.length ? `It was avoiding: ${b.rules.map((k) => E.FEATURES[k].label.toLowerCase()).join('; ')}.` : 'It had no avoid-rules switched on.'}${b.trainings.length ? ` ${b.trainings.length} training runs.` : ''}</p></div></div>
        <div class="card" style="margin-bottom:10px"><div class="setrow"><div class="stx"><h3 style="font-size:18px">Use its settings</h3><div class="m">${!b.settings ? 'Not in this file.' : ch.length ? ch.map(esc).join(' · ') : 'Same as mine.'}</div></div><input type="checkbox" class="tog" id="imp_set" ${opts.settings && b.settings ? 'checked' : ''} ${b.settings ? '' : 'disabled'}></div></div>
        <div class="card" style="margin-bottom:10px"><div class="setrow"><div class="stx"><h3 style="font-size:18px">Add what it learned</h3><div class="m">${pv.added} new trades join my evidence (${b.evidence.length - pv.added} I already had).${pv.newRules.length || pv.dropped.length ? ` I'd ${[...pv.newRules.map((k) => 'start avoiding ' + E.FEATURES[k].label.toLowerCase()), ...pv.dropped.map((k) => 'stop avoiding ' + E.FEATURES[k].label.toLowerCase())].join(', ')}.` : ' My rules wouldn\'t change.'}</div></div><input type="checkbox" class="tog" id="imp_ev" ${opts.evidence ? 'checked' : ''}></div></div>
        <p class="m" style="margin:4px 2px 0">Your paper money, stocks and trades stay as they are. Strategy choices per stock are re-learned from your own data.</p>
        <div class="actions"><button class="btn" id="imp_go">Import</button><button class="btn ghost" id="imp_cancel">Cancel</button></div>`;
    }
    $('sheet').innerHTML = h; $('sheet').classList.add('open'); $('sheetScrim').classList.add('open');
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on('imp_cancel', () => { pendingImport = null; closeSheet(); });
    const cs = $('imp_set'), ce = $('imp_ev');
    if (cs) cs.onchange = () => { opts.settings = cs.checked; showImportSheet(); };
    if (ce) ce.onchange = () => { opts.evidence = ce.checked; showImportSheet(); };
    on('imp_go', () => {
      if (!opts.settings && !opts.evidence) return toast('Pick at least one');
      const r = E.importBrain(st, b, opts, todayIST(), nowIso()); store.save(st); pendingImport = null; closeSheet(); render();
      toast('Brain imported');
      say(`Imported the brain file.${r.changes.length ? `\n\nNow using its settings:\n${r.changes.map((c) => '- ' + c).join('\n')}` : ''}${opts.evidence ? `\n\nAdded ${r.added} trades to my evidence.${r.newRules.length ? ` Now avoiding: ${r.newRules.map((k) => E.FEATURES[k].label.toLowerCase()).join('; ')}.` : ''}${r.dropped.length ? ` No longer avoiding: ${r.dropped.map((k) => E.FEATURES[k].label.toLowerCase()).join('; ')}.` : ''}` : ''}\n\nSay **reset brain** to go back to the default settings.`);
    });
    on('imp_restore', () => {
      if (!confirm('Replace your current paper account with this backup?')) return;
      st = E.migrate(JSON.parse(JSON.stringify(b.state))); store.save(st); pendingImport = null; closeSheet(); tab = 'home'; render();
      toast('Backup restored'); say(`Restored the backup: ${st.cfg.tickers.length} stocks, paper trading since ${fdate(st.paperStart)}. Say **update** to catch up on the days since ${fdate(st.lastDate)}.`);
    });
  }

  // ---------------------------------------------------------------- training on the past
  const MIN_TRAIN = '2008-01-01';
  let train = { phase: 'setup', preset: '5y', from: '', to: '', brain: 'fresh', speed: 4, mode: 'watch', rounds: 30, autoApply: false, route: 'climb', style: 'account' };
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

  const trainCapital = () => Math.round(train.capital || Math.max(E.netCapital(st), 10000));

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
      const mistakes = train.brain === 'lessons' ? E.mistakesBefore(st, start) : [];
      const capital = trainCapital();
      if (train.mode === 'repeat') {
        busy = false; cancel = false;
        btn.textContent = 'Update'; btn.classList.remove('stop'); $('progress').hidden = true;
        return startRepeat({ data, nifty, tickers, missing, lessons, mistakes, capital, start, end });
      }
      const P = styleParams(train.style);
      const tst = E.newTraining({ ...st.cfg, tickers, capital, stopAtr: P.stopAtr, brain: { ...P } }, start, end, lessons, mistakes);
      progress(syms.length, syms.length, 'Warming up');
      await new Promise((ok) => setTimeout(ok, 30));
      const ctx = E.begin(tst, data, nifty, Date.now());
      E.skipTo(ctx, start);
      Object.assign(train, { phase: 'running', tst, ctx, playing: true, acc: 0, missing, lessons: lessons.length, total: E.daysLeft(ctx), runCapital: capital });
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
      brain: train.brain, stocks: Object.keys(tst.tickers).length, capital: train.runCapital, ret: idx.length ? idx[idx.length - 1] - 100 : 0,
      nret: nf.length > 1 ? (nf[nf.length - 1][2] / nf[0][2] - 1) * 100 : null, dd: maxDD(idx), trades: S.n, win: S.winRate,
      pnl: S.pnl, taught: false, curve: down(idx, 120).map((x) => Math.round(x * 10) / 10) };
    st.trainings.push(sum); if (st.trainings.length > 30) st.trainings.shift();
    store.save(st);
    Object.assign(train, { phase: 'done', playing: false, summary: sum, trades, preview: E.previewTeach(st, tst, todayIST()) });
    say(trainingReport(sum), 'train');
    if (train.autoApply && train.preview.added) teachLive();
    if (tab === 'train') render();
  }

  function teachLive() {
    const r = E.teach(st, train.tst, todayIST(), `${train.summary.label} (${fdate(train.summary.start)} – ${fdate(train.summary.end)})`);
    train.summary.taught = true;
    const h = st.trainings.find((x) => x.id === train.summary.id); if (h) h.taught = true;
    store.save(st); train.preview = null; render();
    toast(`Live brain learned from ${r.added} past trades`);
    say(`Done – I added **${r.added}** trades from ${esc(train.summary.label)} to my evidence${r.mistakes ? ` and will never repeat its ${r.mistakes} noted mistake${r.mistakes > 1 ? 's' : ''}` : ''}.` +
      (r.newRules.length ? `\n\nNow avoiding:\n${r.newRules.map((k) => '- ' + E.FEATURES[k].label.toLowerCase()).join('\n')}` : '') +
      (r.dropped.length ? `\n\nNo longer avoiding:\n${r.dropped.map((k) => '- ' + E.FEATURES[k].label.toLowerCase()).join('\n')}` : '') +
      (!r.newRules.length && !r.dropped.length ? ' None of my rules changed – it just adds evidence.' : ''));
  }


  // ---------------------------------------------------------------- repeat mode: re-run the past, tune settings
  const ROUTES = {
    climb: ['Step by step', 'Changes one setting at a time and keeps whatever helps. Fast, but can get stuck on a "good enough" answer.'],
    evolve: ['Evolution', 'Starts with a population of very different settings. The fittest survive, mix and mutate, generation after generation – explores much more widely.'],
    walk: ['Walk forward', 'Learns on the past, trades the next stretch it has never seen, adds it to what it knows and moves on. Every result is earned on unseen data – the most honest test.'],
  };
  function startRepeat(args) {
    const { data, nifty, tickers, missing, lessons, mistakes, capital, start, end } = args;
    const days = nifty.bars.d.filter((d) => d >= start && d <= end);
    if (days.length < 120) { toast('Pick a longer period (at least 6 months)'); train.phase = 'setup'; return render(); }
    if (train.route === 'walk') return startWalk(args, days);
    const split = days[Math.floor(days.length * 0.7)];
    const base = styleParams(train.style);
    const cfg = { ...st.cfg, tickers, capital };
    const seed = Date.now() % 100000;
    const opt = train.route === 'evolve' ? E.makeEvolver(base, { maxRounds: train.rounds, popSize: 8, seed }) : E.makeOptimizer(base, { maxRounds: train.rounds, patience: 10, seed });
    Object.assign(train, { phase: 'repeating', rep: { route: train.route, data, nifty, cfg, lessons, mistakes, start, end, split, base, opt, missing, stop: false, first: null }, runCapital: capital });
    render();
    const round = () => {
      const R = train.rep; if (!R || train.phase !== 'repeating') return;
      const p = R.stop ? null : R.opt.next();
      if (!p) return repeatDone();
      const tst = E.evaluate(R.cfg, p, R.data, R.nifty, R.start, R.split, R.lessons, R.mistakes);
      const s0 = E.periodStats(tst, R.start, R.split);
      R.opt.report(p, s0.ret, { dd: s0.dd });
      if (R.first == null) R.first = s0.ret;
      if (tab === 'train') render();
      setTimeout(round, 15);
    };
    setTimeout(round, 30);
  }


  // walk forward: learn on an expanding window, trade the next unseen stretch, repeat
  function startWalk({ data, nifty, tickers, missing, lessons, mistakes, capital, start, end }, days) {
    const F = 3, L0 = Math.floor(days.length * 0.4), size = Math.floor((days.length - L0) / F);
    const folds = Array.from({ length: F }, (_, f) => ({ learnEnd: days[L0 + f * size - 1], start: days[L0 + f * size], end: f === F - 1 ? days[days.length - 1] : days[L0 + (f + 1) * size - 1] }));
    const base = styleParams(train.style), cfg = { ...st.cfg, tickers, capital }, per = Math.max(5, Math.round(train.rounds / F));
    const R = { route: 'walk', data, nifty, cfg, lessons, mistakes, start, end, base, missing, folds, fold: 0, per, cur: E.normParams(base), stop: false, history: [], first: null };
    R.opt = E.makeOptimizer(R.cur, { maxRounds: per, patience: 5, seed: 3 });
    R.baseFull = E.evaluate(cfg, base, data, nifty, start, end, lessons, mistakes);
    Object.assign(train, { phase: 'repeating', rep: R, runCapital: capital });
    render();
    const round = () => {
      if (train.rep !== R || train.phase !== 'repeating') return;
      const F0 = R.folds[R.fold], p = R.stop ? null : R.opt.next();
      if (p) {
        const tst = E.evaluate(R.cfg, p, R.data, R.nifty, R.start, F0.learnEnd, R.lessons, R.mistakes);
        const s0 = E.periodStats(tst, R.start, F0.learnEnd);
        const better = R.opt.report(p, s0.ret, { dd: s0.dd });
        R.history.push({ round: R.history.length + 1, fold: R.fold + 1, params: E.normParams(p), score: s0.ret, dd: s0.dd, better });
      } else {
        // stretch finished: trade the unseen part with the best settings learned so far
        if (R.opt.rounds) R.cur = R.opt.best;
        const tst = E.evaluate(R.cfg, R.cur, R.data, R.nifty, R.start, F0.end, R.lessons, R.mistakes);
        Object.assign(F0, { params: R.cur, changes: E.describeParams(R.cur, R.base), res: E.periodStats(tst, F0.start, F0.end), baseRes: E.periodStats(R.baseFull, F0.start, F0.end) });
        R.fold++;
        if (R.stop || R.fold >= R.folds.length) return walkDone();
        R.opt = E.makeOptimizer(R.cur, { maxRounds: R.per, patience: 5, seed: 3 + R.fold });
      }
      if (tab === 'train') render();
      setTimeout(round, 15);
    };
    setTimeout(round, 30);
  }

  function walkDone() {
    const R = train.rep, done = R.folds.filter((f) => f.res);
    const comp = (k) => (done.reduce((m, f) => m * (1 + f[k].ret / 100), 1) - 1) * 100;
    R.total = comp('res'); R.baseTotal = comp('baseRes');
    R.final = R.cur; R.changes = E.describeParams(R.final, R.base);
    R.good = R.changes.length > 0 && R.total > R.baseTotal;
    R.fullBest = E.evaluate(R.cfg, R.final, R.data, R.nifty, R.start, R.end, R.lessons, R.mistakes);
    const label = train.preset === 'custom' ? `${fdate(R.start)} – ${fdate(R.end)}` : PRESETS[train.preset][0];
    const sum = { id: Date.now().toString(36), at: nowIso(), kind: 'repeat', route: 'walk', label: `${label} · walk forward`, start: R.start, end: R.end,
      brain: train.brain, stocks: R.cfg.tickers.length, capital: train.runCapital, ret: R.total, nret: null, dd: Math.min(0, ...done.map((f) => f.res.dd)),
      trades: 0, win: NaN, pnl: 0, taught: false, unseenBest: R.total, unseenBase: R.baseTotal, changes: R.changes };
    st.trainings.push(sum); if (st.trainings.length > 30) st.trainings.shift();
    R.sum = sum; train.phase = 'repeatDone'; store.save(st);
    say(walkReport(), 'none');
    if (train.autoApply && R.good) applyRepeat(true);
    if (tab === 'train') render();
  }

  function walkReport() {
    const R = train.rep, done = R.folds.filter((f) => f.res);
    let t = `Walk-forward training done on ${fdate(R.start)} – ${fdate(R.end)}. Each time I learned on everything up to a date, then traded the next stretch without having seen it:`;
    t += '\n' + done.map((f) => `- ${fdate(f.start)} – ${fdate(f.end)}: **${pct(f.res.ret)}** (current settings ${pct(f.baseRes.ret)}${f.res.nifty != null ? `, Nifty ${pct(f.res.nifty)}` : ''})`).join('\n');
    t += `\n\nAll unseen, start to finish: **${pct(R.total)}** vs ${pct(R.baseTotal)} with my current settings.`;
    t += R.changes.length ? `\n\nWhat I ended up with:\n${R.changes.map((c) => '- ' + c).join('\n')}` : '\n\nI kept my current settings every time.';
    if (R.changes.length) t += R.good ? `\n\nThis beat my current settings on data I hadn't seen – the most trustworthy kind of result. Say **apply** to use these settings.` : `\n\nIt didn't beat my current settings on unseen data, so I recommend **not** applying. Say **apply anyway** if you want to.`;
    return t;
  }

  function viewWalk() {
    const R = train.rep, done = train.phase === 'repeatDone';
    const fd = R.folds.filter((f) => f.res), comp = (k) => (fd.reduce((m, f) => m * (1 + f[k].ret / 100), 1) - 1) * 100;
    let h = `<div class="card hero"><div class="m">Walk forward${done ? ' · finished' : ` · stretch ${Math.min(R.fold + 1, R.folds.length)} of ${R.folds.length}`} · ${fdate(R.start)} – ${fdate(R.end)} · ${inr(train.runCapital)}</div>
      <div class="big" style="font-size:28px">${fd.length ? pct(comp('res')) : '…'}</div>
      <p class="sub">${fd.length ? `earned on unseen data so far · current settings ${pct(comp('baseRes'))}` : `learning on ${fdate(R.start)} – ${fdate(R.folds[0].learnEnd)}…`}</p>
      ${roundsChart(R.history)}`;
    if (!done) h += `<div class="actions"><button class="btn warn sm" id="r_stop">Stop and check results</button></div>`;
    if (done && R.fullBest) h += `<div style="margin-top:10px">${compareChart(R.fullBest.equity, R.baseFull.equity, R.folds[0].start, R.folds.map((f) => f.start).slice(1))}</div>`;
    h += `</div><div class="sec">Stretches</div><div class="card">` + R.folds.map((f, i) => `<div class="row"><div><b>${i + 1}. Learn to ${fdate(f.learnEnd)} → trade ${fdate(f.start)} – ${fdate(f.end)}</b><div class="m">${f.res ? esc(f.changes.join('; ') || 'current settings') : i === R.fold && !done ? 'learning…' : 'waiting'}</div></div>
      <div class="r">${f.res ? `<b class="${cls(f.res.ret - f.baseRes.ret)}">${pct(f.res.ret)}</b><div class="m">current ${pct(f.baseRes.ret)}</div>` : ''}</div></div>`).join('') + `</div>`;
    if (done) {
      h += `<p class="sub">${!R.changes.length ? 'I kept the current settings throughout.' : R.good ? 'Beat the current settings on unseen data – the most trustworthy kind of result.' : 'Did not beat the current settings on unseen data – better not to apply.'}</p>`;
      if (R.changes.length) h += `<div class="sec">Settings it ended with</div><div class="card"><ul class="tags" style="font-size:14px;color:var(--fg)">${R.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>`;
      h += `<div class="actions">${R.sum.taught ? '<span class="m">Applied to the live brain.</span>' : R.good || !R.changes.length ? `<button class="btn sm" id="r_apply">Apply ${R.changes.length ? 'settings + lessons' : 'lessons'}</button>` : `<button class="btn warn sm" id="r_force">Apply anyway</button>`}<button class="btn ghost sm" id="t_new">Train again</button></div>`;
    }
    return h;
  }

  function repeatDone() {
    const R = train.rep, o = R.opt;
    const fullBest = E.evaluate(R.cfg, o.best, R.data, R.nifty, R.start, R.end, R.lessons, R.mistakes);
    const fullBase = E.evaluate(R.cfg, R.base, R.data, R.nifty, R.start, R.end, R.lessons, R.mistakes);
    R.fullBase = fullBase;
    const after = (d) => R.nifty.bars.d.find((x) => x > d) || d;
    Object.assign(R, {
      bestTrain: o.bestScore, baseTrain: R.first,
      unseenBest: E.periodStats(fullBest, after(R.split), R.end), unseenBase: E.periodStats(fullBase, after(R.split), R.end),
      fullBest, changes: E.describeParams(o.best, R.base),
    });
    R.good = R.changes.length > 0 && R.unseenBest.ret > R.unseenBase.ret;
    const label = train.preset === 'custom' ? `${fdate(R.start)} – ${fdate(R.end)}` : PRESETS[train.preset][0];
    const sum = { id: Date.now().toString(36), at: nowIso(), kind: 'repeat', route: R.route, label: `${label} · ${R.route === 'evolve' ? `evolution ×${o.rounds}` : `repeat ×${o.rounds}`}`, start: R.start, end: R.end,
      brain: train.brain, stocks: R.cfg.tickers.length, capital: train.runCapital, ret: R.bestTrain, nret: null, dd: o.history.find((h) => h.better && E.paramKey(h.params) === E.paramKey(o.best))?.dd || 0,
      trades: 0, win: NaN, pnl: 0, taught: false, unseenBest: R.unseenBest.ret, unseenBase: R.unseenBase.ret, changes: R.changes };
    st.trainings.push(sum); if (st.trainings.length > 30) st.trainings.shift();
    R.sum = sum; train.phase = 'repeatDone'; store.save(st);
    say(repeatReport(), 'none');
    if (train.autoApply && R.good) applyRepeat(true);
    if (tab === 'train') render();
  }

  function repeatReport() {
    const R = train.rep, o = R.opt;
    const why = R.route === 'evolve' ? `I bred ${o.generations} generations of ${o.rounds / o.generations | 0}` : o.local ? 'no single change made it better any more' : o.stale >= 10 ? '10 rounds in a row found nothing better' : `I reached the ${o.maxRounds}-round limit`;
    let t = `${R.route === 'evolve' ? 'Evolution' : 'Repeat'} training done: **${o.rounds} rounds** on ${fdate(R.start)} – ${fdate(R.split)}. I stopped because ${why}.`;
    t += R.changes.length ? `\n\nBest settings made **${pct(R.bestTrain)}** there, vs ${pct(R.baseTrain)} with my current settings. The changes:\n${R.changes.map((c) => '- ' + c).join('\n')}`
      : `\n\nNothing beat my current settings (${pct(R.baseTrain)}).`;
    if (R.changes.length) {
      t += `\n\nThe honest test – ${fdate(R.unseenBest && R.split)} to ${fdate(R.end)}, which the search never saw: new settings **${pct(R.unseenBest.ret)}**, current settings ${pct(R.unseenBase.ret)}${R.unseenBest.nifty != null ? `, Nifty ${pct(R.unseenBest.nifty)}` : ''}.`;
      t += R.good ? `\n\nThey held up on unseen data, so they may be a real improvement. Say **apply** to use them (and add what I learned to my evidence).`
        : `\n\nThey did **worse** on unseen data – the gain was most likely luck from fitting the past (overfitting). I recommend **not** applying them. If you still want to, say **apply anyway**.`;
    }
    return t;
  }

  function applyRepeat(auto, force) {
    const R = train.rep; if (!R || train.phase !== 'repeatDone') return say('There\'s no finished repeat training. Try **train on the 2008 crisis until max profit**.');
    if (!R.good && !force && R.changes.length) return say('Those settings failed the unseen-data test, so I didn\'t apply them. Say **apply anyway** if you\'re sure.');
    const ch = R.changes.length ? E.applyParams(st, R.final || R.opt.best, todayIST(), nowIso()) : [];
    const t = E.teach(st, R.fullBest, todayIST(), `${R.sum.label}`);
    R.sum.taught = true; const h = st.trainings.find((x) => x.id === R.sum.id); if (h) h.taught = true;
    store.save(st);
    say(`${auto ? 'Applied automatically: ' : 'Applied. '}${ch.length ? `My live brain now uses these settings:\n${ch.map((c) => '- ' + c).join('\n')}\n\n` : 'Settings unchanged. '}I also added ${t.added} past trades to my evidence${t.newRules.length || t.dropped.length ? ` (${[...t.newRules.map((k) => 'now avoiding ' + E.FEATURES[k].label.toLowerCase()), ...t.dropped.map((k) => 'no longer avoiding ' + E.FEATURES[k].label.toLowerCase())].join('; ')})` : ''}. Say **reset brain** to go back to the default settings.`);
    if (tab === 'train') render();
  }

  /** Two training accounts + Nifty over the whole period; the part after `split` (never used for tuning) is shaded. */
  function compareChart(eqA, eqB, split, vl = []) {
    const n0 = (eqA.find((r) => r[2]) || [])[2], k = Math.ceil(eqA.length / 300) || 1, pick = (a) => a.filter((_, i) => i % k === 0 || i === a.length - 1);
    const A = pick(eqA), B = pick(eqB.slice(0, eqA.length));
    const si = A.findIndex((r) => r[0] >= split);
    return multiLine([
      { v: A.map((r) => (r[1] / A[0][1]) * 100), color: css('--clay'), name: 'Best settings found' },
      { v: B.map((r) => (r[1] / B[0][1]) * 100), color: css('--sage'), name: 'Current settings', w: 1.5 },
      { v: A.map((r) => (r[2] && n0 ? (r[2] / n0) * 100 : null)), color: css('--slate'), name: 'Nifty 50', dash: 1, w: 1.2 },
    ], { shade: si >= 0 ? si : null, shadeLabel: 'unseen', vlines: vl.map((d) => A.findIndex((r) => r[0] >= d)).filter((i) => i > 0) });
  }
  function roundsChart(hist) {
    if (hist.length < 1) return '';
    const W = 340, H = 140, P = 8, v = hist.map((h) => h.score), lo = Math.min(0, ...v), hi = Math.max(...v, lo + 1), n = Math.max(hist.length, 2);
    const X = (i) => P + (i / (n - 1)) * (W - 2 * P), Y = (y) => P + (1 - (y - lo) / (hi - lo)) * (H - 2 * P);
    let best = -Infinity; const line = hist.map((h, i) => { best = Math.max(best, h.score); return `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(best).toFixed(1)}`; }).join('');
    const dots = hist.map((h, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(h.score).toFixed(1)}" r="${h.better ? 4 : 2.6}" fill="${h.better ? css('--acc') : css('--mut')}" opacity="${h.better ? 1 : 0.6}"/>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="${css('--line')}" stroke-dasharray="3 3"/><path d="${line}" fill="none" stroke="${css('--acc')}" stroke-width="2"/>${dots}</svg>
      <div class="m">Each dot is one round's profit on the training part; the line is the best so far.</div>`;
  }

  function viewRepeat() {
    if (train.rep.route === 'walk') return viewWalk();
    const R = train.rep, o = R.opt, done = train.phase === 'repeatDone';
    let h = `<div class="card hero"><div class="m">${R.route === 'evolve' ? `Evolution${done ? ' finished' : ` · generation ${o.gen} of ${o.generations}`}` : done ? 'Repeat training finished' : 'Repeat training'} · ${fdate(R.start)} – ${fdate(R.end)} · ${inr(train.runCapital)}</div>
      <div class="big" style="font-size:28px">${o.bestScore > -Infinity ? pct(o.bestScore) : '…'}</div>
      <p class="sub">best profit on the training part (${fdate(R.start)} – ${fdate(R.split)}) after ${o.rounds} of up to ${o.maxRounds} rounds${R.first != null ? ` · first round ${pct(R.first)}` : ''}</p>
      ${roundsChart(o.history)}`;
    if (!done) h += `<div class="actions"><button class="btn warn sm" id="r_stop">Stop and check results</button></div>`;
    h += `</div>`;
    if (done && R.fullBest && R.fullBase) h += `<div class="card"><div class="lbl">Best settings vs current, whole period</div>${compareChart(R.fullBest.equity, R.fullBase.equity, R.split)}</div>`;
    if (done) {
      h += `<div class="sec">Honest test on unseen data</div><div class="card">
        <div class="row"><div><b>Training part</b><div class="m">${fdate(R.start)} – ${fdate(R.split)} · what the search optimised</div></div><div class="r"><b>${pct(R.bestTrain)}</b><div class="m">current ${pct(R.baseTrain)}</div></div></div>
        <div class="row"><div><b>Unseen part</b><div class="m">${fdate(R.split)} – ${fdate(R.end)} · never used in the search</div></div><div class="r"><b class="${cls(R.unseenBest.ret - R.unseenBase.ret)}">${pct(R.unseenBest.ret)}</b><div class="m">current ${pct(R.unseenBase.ret)}${R.unseenBest.nifty != null ? ` · Nifty ${pct(R.unseenBest.nifty)}` : ''}</div></div></div>
        <p class="sub">${!R.changes.length ? 'Nothing beat the current settings.' : R.good ? 'The new settings also did better on unseen data – they may be a real improvement.' : 'The new settings did worse on unseen data – the gain was most likely luck (overfitting). Better not to apply them.'}</p></div>`;
      if (R.changes.length) h += `<div class="sec">Best settings found</div><div class="card"><ul class="tags" style="font-size:14px;color:var(--fg)">${R.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>`;
      h += `<div class="actions">${R.sum.taught ? '<span class="m">Applied to the live brain.</span>' : R.good || !R.changes.length ? `<button class="btn sm" id="r_apply">Apply ${R.changes.length ? 'settings + lessons' : 'lessons'}</button>` : `<button class="btn warn sm" id="r_force">Apply anyway</button>`}<button class="btn ghost sm" id="t_new">Train again</button></div>`;
    }
    const last = o.history.slice(-12).reverse();
    h += `<div class="sec">Rounds</div><div class="card">` + (last.length ? last.map((x) => `<div class="row"><div><b>Round ${x.round}${x.gen ? ` · gen ${x.gen}` : ''}</b>${x.better ? ' <span class="pill on" style="border-color:var(--acc);color:var(--acc)">new best</span>' : ''}<div class="m">${esc(E.describeParams(x.params, R.base).join('; ') || 'current settings')}</div></div><div class="r"><b class="${cls(x.score)}">${pct(x.score)}</b><div class="m">worst drop ${pct(x.dd)}</div></div></div>`).join('') : '<p class="empty">Starting…</p>') + `</div>`;
    return h;
  }

  function viewTrain() {
    const ph = train.phase;
    if (ph === 'repeating' || ph === 'repeatDone') return viewRepeat();
    if (ph === 'loading') return `<div class="card hero"><div class="big" style="font-size:24px">Loading history…</div><p class="sub">${esc(train.label)}. Tap Stop to cancel.</p></div>`;
    if (ph === 'running' || ph === 'done') {
      const tst = train.tst, eq = tst.equity, idx = returnIndex(eq), last = eq[eq.length - 1];
      const nf = eq.filter((r) => r[2]), nret = nf.length > 1 ? (nf[nf.length - 1][2] / nf[0][2] - 1) * 100 : null;
      const ret = idx.length ? idx[idx.length - 1] - 100 : 0, done = train.total - E.daysLeft(train.ctx);
      let h = `<div class="card hero"><div class="m">${ph === 'done' ? 'Training finished' : 'Trading the past'} · ${esc(train.label)}</div>
        <div class="big" style="font-size:28px">${last ? fdate(last[0]) : fdate(train.start)}</div>
        <p class="sub"><b class="${cls(ret)}">${pct(ret, 1)}</b> · ${inr(last ? last[1] : train.runCapital)} from ${inr(train.runCapital)}${nret != null ? ` · Nifty ${pct(nret)}` : ''}${idx.length > 1 ? ` · max drawdown ${pct(maxDD(idx))}` : ''}</p>
        ${eq.length >= 2 ? vsNifty(eq) : ''}
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
        const ct = train.trades.filter((t) => t.x).sort((a, b) => a.x.localeCompare(b.x));
        h += `<div class="card"><div class="lbl">Drop from the peak</div>${ddChart(idx)}</div>`;
        h += `<div class="card"><div class="lbl">Month by month</div>${barChart(monthlyBars(eq).slice(-24))}<div class="m">Return each month of the run (last 24 months shown).</div></div>`;
        h += `<div class="card"><div class="lbl">Each closed trade</div>${barChart(ct.slice(-60).map((t) => ({ v: t.ret, label: '' })))}<div class="m">${ct.length} trades${ct.length > 60 ? ', last 60 shown' : ''}.</div></div>`;
        h += `<div class="card"><div class="grid">
          <div><div class="m">Trades</div><div class="stat">${s.trades}</div></div>
          <div><div class="m">Win rate</div><div class="stat">${Number.isNaN(s.win) ? '–' : Math.round(s.win * 100) + '%'}</div></div>
          <div style="margin-top:10px"><div class="m">Net P&amp;L</div><b class="${cls(s.pnl)}">${inr(s.pnl)}</b></div>
          <div style="margin-top:10px"><div class="m">vs Nifty</div><b class="${cls(s.ret - (s.nret || 0))}">${s.nret == null ? '–' : pct(s.ret - s.nret) + ' pts'}</b></div></div></div>`;
        h += `<div class="sec">Mistakes noted in this run</div>` + mistakesCard((train.tst.learning.mistakes || []), { empty: 'No mistakes noted in this run.' });
        h += `<div class="sec">Apply to the live brain</div><div class="card">`;
        if (s.taught) h += `<p class="empty">Done – your live brain now includes these ${train.tst.learning.closed.length} past trades as evidence.</p>`;
        else {
          const ch = [...P.newRules.map((k) => `<li>Start avoiding: ${esc(E.FEATURES[k].label.toLowerCase())}</li>`), ...P.dropped.map((k) => `<li>Stop avoiding: ${esc(E.FEATURES[k].label.toLowerCase())}</li>`)];
          h += `<p class="sub" style="margin:0">Adds ${P.added} past trades (from all ${Object.keys(E.STRATEGIES).length} strategies) to the evidence your live brain uses for its rules${(train.tst.learning.mistakes || []).filter((m) => !m.forgiven && !m.inherited).length ? `, and ${(train.tst.learning.mistakes || []).filter((m) => !m.forgiven && !m.inherited).length} mistakes to never repeat` : ''}.</p>
            <ul class="tags">${ch.length ? ch.join('') : '<li>No rule would change right now – it just adds evidence.</li>'}</ul>
            <div class="actions"><button class="btn sm" id="t_teach"${P.added ? '' : ' disabled'}>Apply what it learned</button></div>`;
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
    h += `<div class="sec">Trading style for this run</div><div class="card"><div class="chips" style="margin:0">
        ${[['account', `Like my account (${isQuick() ? 'quick' : 'normal'})`], ['normal', 'Normal – ride trends'], ['quick', 'Quick – in and out']].map(([k, t]) => `<button class="chip ${train.style === k ? 'on' : ''}" data-style="${k}">${t}</button>`).join('')}</div>
      <p class="m" style="margin:10px 0 0">${(train.style === 'quick' || (train.style === 'account' && isQuick())) ? 'Fast entries (sharp dips, pullbacks, volume breakouts) and fast exits: profit target, tight stop-loss and a time limit. Trades last days, not months.' : 'Trend strategies that hold for weeks or months.'}</p></div>`;
    h += `<div class="sec">Brain</div><div class="card">
      <label class="switch" style="margin:0"><input type="radio" name="tb" value="fresh" ${train.brain === 'fresh' ? 'checked' : ''}><span><b>Fresh brain</b> – learns only from this period</span></label>
      <label class="switch" style="margin:12px 0 0"><input type="radio" name="tb" value="lessons" ${train.brain === 'lessons' ? 'checked' : ''}><span><b>With earlier lessons</b> – ${nl} trades that ended before ${fdate(a)} (an honest test: no future knowledge)</span></label></div>`;
    h += `<div class="sec">Mode</div><div class="card"><div class="chips" style="margin:0">
        <button class="chip ${train.mode === 'watch' ? 'on' : ''}" data-mode="watch">Watch one run</button>
        <button class="chip ${train.mode === 'repeat' ? 'on' : ''}" data-mode="repeat">Repeat until best</button></div>
      <p class="m" style="margin:10px 0 0">${train.mode === 'repeat' ? 'Re-runs the period again and again, changing one brain setting each round and keeping whatever makes more profit, until nothing improves. It tunes on the first 70% and then checks the winner on the last 30%, which it never saw.' : 'Trades the period once, day by day, so you can watch.'}</p>
      ${train.mode === 'repeat' ? `<label>Learning route</label><div class="chips" style="margin:0">${Object.entries(ROUTES).map(([k, v]) => `<button class="chip ${train.route === k ? 'on' : ''}" data-route="${k}">${v[0]}</button>`).join('')}</div>
        <p class="m" style="margin:8px 0 0">${ROUTES[train.route][1]}</p>` : ''}
      ${train.mode === 'repeat' ? `<label>Maximum rounds</label><div class="chips" style="margin:0">${[10, 20, 30, 50].map((x) => `<button class="chip ${x === train.rounds ? 'on' : ''}" data-rounds="${x}">${x}</button>`).join('')}</div>` : ''}
      <label class="switch" style="margin:14px 0 0"><input type="checkbox" id="t_auto" ${train.autoApply ? 'checked' : ''}><span>Apply what it learns to my live brain automatically${train.mode === 'repeat' ? ' (only if it passes the unseen-data test)' : ''}</span></label></div>`;
    h += `<div class="sec">Paper money for this run</div><div class="card">
      <input id="t_cap" inputmode="decimal" value="${inr(trainCapital()).replace('₹', '')}" placeholder="e.g. 5 lakh">
      <p class="m" style="margin:8px 0 0">Split equally across your ${st.cfg.tickers.length} stocks (${inr(trainCapital() / st.cfg.tickers.length)} each). Doesn't touch your real paper account.</p></div>`;
    if (train.mode === 'watch') h += `<div class="sec">Replay speed</div><div class="card"><div class="chips" style="margin:0">${SPEEDS.map((x) => `<button class="chip ${x === train.speed ? 'on' : ''}" data-speed="${x}">${x}× · ${x * 2} days/s</button>`).join('')}</div></div>`;
    h += `<div class="actions"><button class="btn" id="t_go">${train.mode === 'repeat' ? 'Start repeat training' : 'Start training'}</button></div>`;
    if (st.trainings.length) {
      h += `<div class="sec">Past training runs</div><div class="card">` + st.trainings.slice().reverse().map((x) => `<div class="row"><div><b>${esc(x.label)}</b><div class="m">${fdate(x.start)} – ${fdate(x.end)}${x.capital ? ` · ${inr(x.capital)}` : ''} · ${x.kind === 'repeat' ? 'search' : x.trades + ' trades'} · ${x.brain === 'fresh' ? 'fresh' : 'with lessons'}${x.taught ? ' · taught' : ''}</div></div>
        <div class="r"><b class="${cls(x.ret)}">${pct(x.ret)}</b><div class="m">${x.kind === 'repeat' ? `unseen ${pct(x.unseenBest)} vs ${pct(x.unseenBase)}` : `Nifty ${pct(x.nret)}`}</div></div></div>`).join('') + `</div>`;
    }
    h += `<p class="note">Training reuses past data, so good results here can be luck or overfitting – the live paper account is the real test.</p>`;
    return h;
  }

  function bindTrain() {
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    document.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = () => { train.preset = b.dataset.preset; render(); }; });
    document.querySelectorAll('[data-speed]').forEach((b) => { b.onclick = () => { train.speed = +b.dataset.speed; render(); }; });
    document.querySelectorAll('input[name=tb]').forEach((r) => { r.onchange = () => { train.brain = r.value; render(); }; });
    const cap = $('t_cap');
    if (cap) cap.onchange = () => { const a = parseAmount(cap.value); if (a && a >= 10000) train.capital = a; else toast('Enter at least ₹10,000'); render(); };
    const f = $('t_from'), t = $('t_to');
    if (f) f.onchange = () => { train.from = f.value; render(); };
    if (t) t.onchange = () => { train.to = t.value; render(); };
    on('t_go', startTraining);
    document.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { train.mode = b.dataset.mode; render(); }; });
    document.querySelectorAll('[data-style]').forEach((b) => { b.onclick = () => { train.style = b.dataset.style; render(); }; });
    document.querySelectorAll('[data-route]').forEach((b) => { b.onclick = () => { train.route = b.dataset.route; render(); }; });
    document.querySelectorAll('[data-rounds]').forEach((b) => { b.onclick = () => { train.rounds = +b.dataset.rounds; render(); }; });
    const au = $('t_auto'); if (au) au.onchange = () => { train.autoApply = au.checked; };
    on('r_stop', () => { if (train.rep) train.rep.stop = true; });
    on('r_apply', () => applyRepeat(false));
    on('r_force', () => { if (confirm('These settings did worse on unseen data. Apply anyway?')) applyRepeat(false, true); });
    on('t_play', () => { train.playing = !train.playing; render(); });
    on('t_skip', () => { E.stepDays(train.ctx, Infinity); trainDone(); });
    on('t_stop', () => { train.ctx.dates.length = train.ctx.pos; trainDone(); });
    on('t_teach', teachLive);
    on('t_new', () => { train = { phase: 'setup', preset: train.preset, from: train.from, to: train.to, brain: train.brain, speed: train.speed, mode: train.mode, rounds: train.rounds, autoApply: train.autoApply, capital: train.capital, route: train.route, style: train.style }; render(); });
  }


  // ---------------------------------------------------------------- trading style (normal / quick)
  const isQuick = () => !!E.brainParams(st).quick;
  /** Brain settings for a style: 'account' = what the live brain uses now. */
  function styleParams(style) {
    const B = E.brainParams(st);
    if (style === 'quick') return B.quick ? B : { ...B, ...E.QUICK_PRESET, strategies: null };
    if (style === 'normal') return B.quick ? { ...B, ...E.NORMAL_PRESET, strategies: null } : B;
    return B;
  }
  function setStyle(quick, extra) {
    const B = E.brainParams(st);
    const next = quick ? { ...B, ...(B.quick ? {} : { ...E.QUICK_PRESET, strategies: null }), ...(extra || {}) } : { ...B, ...E.NORMAL_PRESET, strategies: null, ...(extra || {}) };
    const ch = E.applyParams(st, next, todayIST(), nowIso()); store.save(st);
    return ch;
  }
  const styleText = () => {
    const B = E.brainParams(st);
    return B.quick ? `**Quick trading**: short swings with ${E.QUICK.map((k) => E.STRATEGIES[k].label).join(', ')}. Profit target ${B.tpAtr ? '+' + B.tpAtr + '× ATR' : 'off'}, stop-loss ${B.stopAtr ? B.stopAtr + '× ATR' : 'off'}, time limit ${B.maxDays ? B.maxDays + ' sessions' : 'off'}.`
      : `**Normal trading**: ride trends for weeks or months with ${E.NORMAL.map((k) => E.STRATEGIES[k].label).join(', ')}. Stop-loss ${B.stopAtr ? B.stopAtr + '× ATR' : 'off'}.`;
  };

  // ---------------------------------------------------------------- paper money
  /** "50000", "50,000", "50k", "1.5 lakh", "2 crore", "₹3,00,000" → rupees (or null). */
  function parseAmount(text) {
    const m = String(text).toLowerCase().replace(/₹|rs\.?|inr/g, ' ').match(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|l|lakhs?|lacs?|cr|crores?)?\b/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, '')), u = m[2] || '';
    const mult = /^k|thousand/.test(u) ? 1e3 : /^(l|lakh|lac)/.test(u) ? 1e5 : /^cr/.test(u) ? 1e7 : 1;
    return Number.isFinite(n) && n > 0 ? Math.round(n * mult) : null;
  }
  /** mode: 'add' | 'withdraw' | 'set' (set the account value). Returns a sentence for the user. */
  function changeMoney(mode, amt) {
    const delta = mode === 'set' ? amt - eqNow() : mode === 'withdraw' ? -amt : amt;
    if (Math.abs(delta) < 1) return `The account is already ${inr(eqNow())}.`;
    const r = E.adjustCapital(st, delta, todayIST(), nowIso());
    if (!r.ok) return `I can't take out ${inr(-delta)}. ${r.reason}. Sell first (say **stop and sell all**), or withdraw less.`;
    store.save(st);
    return `${delta > 0 ? `Added ${inr(delta)}` : `Withdrew ${inr(-delta)}`} of paper money. The account is now **${inr(eqNow())}** (${inr(E.cashTotal(st))} in cash). Each stock now gets about ${inr(st.slice)} for new buys. This counts as a ${delta > 0 ? 'deposit' : 'withdrawal'}, not profit or loss.`;
  }

  // ---------------------------------------------------------------- conversation
  function md(t) { // tiny markdown: **bold**, "- " bullets, blank-line paragraphs
    return esc(t).split(/\n{2,}/).map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => l.startsWith('- '))) return `<ul>${lines.map((l) => `<li>${l.slice(2)}</li>`).join('')}</ul>`;
      const head = [], items = [];
      lines.forEach((l) => (l.startsWith('- ') ? items.push(l.slice(2)) : items.length ? items.push(l) : head.push(l)));
      return (head.length ? `<p>${head.join('<br>')}</p>` : '') + (items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : '');
    }).join('').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }
  function say(text, extra, role) {
    if (!st) return;
    st.chat = st.chat || [];
    st.chat.push({ r: role || 'moli', t: text, at: nowIso(), x: extra || null });
    if (st.chat.length > 300) st.chat.splice(0, st.chat.length - 300);
    store.save(st);
    if (tab === 'chat') { render(); scrollEnd(); }
  }
  const scrollEnd = () => setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 30);
  const timeOf = (iso) => { const d = new Date(Date.parse(iso) + IST); return `${fdate(d.toISOString().slice(0, 10))}, ${d.toISOString().slice(11, 16)}`; };

  function accountLine() {
    const eq = eqNow(), pnl = eq + st.withdrawn - st.invested, idx = returnIndex(st.equity);
    const ret = idx.length ? idx[idx.length - 1] - 100 : 0, nf = st.equity.filter((r) => r[2]);
    const nRet = nf.length > 1 ? (nf[nf.length - 1][2] / nf[0][2] - 1) * 100 : null;
    return `Account **${inr(eq)}** – ${Math.abs(pnl) < 1 ? 'unchanged' : `${pnl > 0 ? 'up' : 'down'} ${inr(Math.abs(pnl))} (${pct(ret, 2)})`} since ${fdate(st.paperStart)}${nRet != null ? `; the Nifty is ${pct(nRet, 2)}` : ''}.`;
  }
  function pendingLines() {
    return Object.entries(st.tickers).filter(([, t]) => t.live.pending).map(([s, t]) => `- ${t.live.pending === 'BUY' ? 'Buy' : 'Sell'} ${sym(s)} at the next open (${t.removing ? 'you removed it' : E.STRATEGIES[t.active]?.label || 'exit to cash'})`);
  }
  function briefing(res, prev) {
    if (res.days > 300) {
      const s = returnIndex(st.sim.map((r) => [r[0], r[1], r[2], 0])), sn = st.sim.filter((r) => r[2]);
      const rules = Object.entries(st.learning.rules).filter(([, r]) => r.active).map(([k]) => E.FEATURES[k].label.toLowerCase());
      const act = Object.entries(st.tickers).filter(([, t]) => t.active).map(([k, t]) => `${sym(k)} → ${E.STRATEGIES[t.active].label}`);
      return `I practised on the last ${st.cfg.warmYears} years of prices. Trading the way I do, I would have made **${pct(s[s.length - 1] - 100)}** (worst drop ${pct(maxDD(s))}) while the Nifty did ${pct((sn[sn.length - 1][2] / sn[0][2] - 1) * 100)}.` +
        (rules.length ? `\n\nWhat I learned to avoid:\n${rules.map((r) => '- ' + r).join('\n')}` : '') +
        `\n\n${act.length ? `Strategies I trust right now:\n${act.map((a) => '- ' + a).join('\n')}` : 'No strategy has been good enough lately, so I start in cash.'}` +
        `\n\nPaper trading starts today. I'll write here after every update – ask me anything, or give me an order.`;
    }
    if (!res.days) return null;
    const days = new Set(); Object.values(st.tickers).forEach((t) => t.spark.d.slice(-res.days).forEach((d) => days.add(d)));
    const acts = [];
    Object.entries(st.tickers).forEach(([s, t]) => t.live.trades.forEach((x) => {
      if (x.e > (prev || '')) acts.push([x.e, `Bought ${x.q} ${sym(s)} at ${px(x.ep)} (${E.STRATEGIES[x.s]?.label || ''})`]);
      if (x.x && x.x > (prev || '')) acts.push([x.x, `Sold ${sym(s)} at ${px(x.xp)} – ${x.pnl >= 0 ? 'made' : 'lost'} ${inr(Math.abs(x.pnl))} (${pct(x.ret)})${x.r === 'stop' ? ', stop-loss hit' : x.r === 'target' ? ', profit target hit' : x.r === 'time' ? ', time limit' : ''}${x.bars ? ` after ${x.bars} session${x.bars > 1 ? 's' : ''}` : ''}`]);
    }));
    st.archive.forEach((x) => { if (x.x && x.x > (prev || '')) acts.push([x.x, `Sold ${sym(x.sym)} at ${px(x.xp)} (${pct(x.ret)}) and removed it`]); });
    acts.sort((a, b) => a[0].localeCompare(b[0]));
    const evs = res.newEvents.filter((e) => e.kind === 'learn' || e.kind === 'unlearn' || e.kind === 'switch' || e.kind === 'mistake').map((e) => e.text);
    const pend = pendingLines();
    return `**${fdate(st.lastDate)}** – ${res.days} new session${res.days > 1 ? 's' : ''}.` +
      `\n\n${acts.length ? acts.map((a) => `- ${a[1]}`).join('\n') : 'No trades.'}` +
      (evs.length ? `\n\n${evs.map((e) => '- ' + e).join('\n')}` : '') +
      `\n\n${accountLine()}` + (pend.length ? `\n\nAt the next open:\n${pend.join('\n')}` : '');
  }
  function trainingReport(sum) {
    const tally = {};
    train.trades.filter((t) => t.x && t.pnl <= 0).forEach((t) => E.diagnose(t).forEach((g) => { tally[g] = (tally[g] || 0) + 1; }));
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const P = train.preview, ch = [...P.newRules.map((k) => `start avoiding ${E.FEATURES[k].label.toLowerCase()}`), ...P.dropped.map((k) => `stop avoiding ${E.FEATURES[k].label.toLowerCase()}`)];
    const S2 = E.stats(train.trades);
    const TM = train.tst.learning.mistakes || [], tmNew = TM.filter((m) => !m.inherited), tmBlocked = TM.reduce((a, m) => a + (m.blocked || 0), 0);
    sum.mistakes = tmNew.length; sum.skipped = tmBlocked;
    return `Training on **${sum.label}** (${fdate(sum.start)} – ${fdate(sum.end)}, ${E.brainParams(train.tst).quick ? 'quick' : 'normal'} trading) is done. I noted ${tmNew.length} mistake${tmNew.length === 1 ? '' : 's'} along the way and skipped repeating them ${tmBlocked}×. Trades lasted ${Number.isNaN(S2.avgDays) ? '–' : S2.avgDays.toFixed(1)} sessions on average${S2.targets ? `, ${S2.targets} hit the profit target` : ''}. Starting with ${inr(sum.capital)}, I ended with **${inr(sum.capital * (1 + sum.ret / 100))}** – **${pct(sum.ret)}** with a worst drop of ${pct(sum.dd)}; the Nifty did ${pct(sum.nret)}. ${sum.trades} trades, ${Number.isNaN(sum.win) ? '–' : Math.round(sum.win * 100) + '%'} winners.` +
      (top.length ? `\n\nMy most common mistakes:\n${top.map(([g, n]) => `- ${g} (${n}×)`).join('\n')}` : '') +
      `\n\n${ch.length ? `Say **apply** and I'll use what I learned: add these ${P.added} trades to my evidence and ${ch.join(', ')}.` : `Say **apply** and I'll add these ${P.added} trades to my evidence. None of my rules would change.`} Remember: a good result on the past can be luck.`;
  }

  // what Moli understands
  const STRAT_HELP = 'I can: **update**, tell you **how I\'m doing**, show **positions**, explain **why RELIANCE**, list **what I learned** or my **mistakes**, **pause**, **resume**, **stop and sell all**, **add AXISBANK**, **remove ITC**, change paper money (**add 1 lakh**, **withdraw 50,000**, **set money to 10 lakh**), **train on the 2008 crisis** (or "train 2015 to 2018", "train last 5 years", "with lessons", "with 10 lakh", "until max profit", "30 rounds", "evolution", "walk forward"), **apply** what it learned, show or **reset brain** settings, **quick mode** / **normal mode** (in and out fast vs ride trends; **take profit at 2 ATR**, **time limit 5 days**, **stop-loss 1.5 ATR**, **train quick last 5 years**), **teach**, say when the **market opens**, and **predict RELIANCE** (candlestick, chart-pattern and trend odds), **download trades** (or equity, brain data, brain evidence, brain log, history, backup), **import brain** (or restore a backup).';
  async function respond(text) {
    const q = text.trim(), l = q.toLowerCase();
    const known = new Set([...Object.values(CATALOG).flat(), ...st.cfg.tickers.map(sym)]);
    const symIn = () => { const w = q.toUpperCase().match(/[A-Z][A-Z0-9&-]{1,15}(?:\.[A-Z]{2})?/g) || []; return w.find((x) => known.has(x.replace('.NS', ''))) || w.filter((x) => !/^(ADD|REMOVE|DROP|BUY|WHY|SELL|AND|THE|ABOUT|IS|WHAT|HOW|STOCK)$/.test(x)).pop(); };
    if (/^(hi|hello|hey|namaste)\b/.test(l)) return say(`Hi! ${accountLine()}\n\n${STRAT_HELP}`);
    if (/\b(help|what can you do|commands)\b/.test(l)) return say(STRAT_HELP);
    if (/^(update|refresh|sync|check)\b|update now|get prices/.test(l)) { if (busy) return say('I\'m already updating.'); say('Downloading the latest prices…'); return update(); }
    if (/\b(reset|default)\b.*\b(brain|settings?)\b|\b(brain|settings?)\b.*\b(reset|default)\b/.test(l)) {
      const ch = E.applyParams(st, { ...E.BRAIN_DEFAULTS, stopAtr: 3 }, todayIST(), nowIso()); store.save(st);
      return say(ch.length ? `Back to the default brain settings:\n${ch.map((c) => '- ' + c).join('\n')}` : 'I\'m already on the default settings.');
    }
    if (/\b(brain settings|my settings|current settings|settings)\b/.test(l) && !/\b(train|repeat)\b/.test(l)) {
      return say(`My brain settings:\n${E.describeParams(E.brainParams(st)).map((c) => '- ' + c).join('\n')}\n\nRepeat training can tune these – say **train on the 2008 crisis until max profit**.`);
    }
    if (/\b(teach|apply|use what you learn)/.test(l)) {
      if (train.phase === 'repeatDone' && !train.rep.sum.taught) return applyRepeat(false, /anyway|force|still/.test(l));
      if (train.phase === 'done' && !train.summary.taught) return teachLive();
      return say('There\'s nothing new to apply. Run a training first – e.g. **train on the 2008 crisis** or **train last 5 years until max profit**.');
    }
    if (/\btrain|practi[cs]e|backtest|optimi[sz]e|until max|max(imum)? profit|evolv|walk forward|learn differently|alternat\w* route\b/.test(l)) {
      const yrs = l.match(/(19|20)\d\d/g);
      if (/2008|crisis|crash of 08|gfc/.test(l) && !(yrs && yrs.length >= 2)) train.preset = 'gfc';
      else if (/covid|2020|pandemic/.test(l) && !(yrs && yrs.length >= 2)) train.preset = 'covid';
      else if (yrs && yrs.length >= 2) { train.preset = 'custom'; train.from = `${yrs[0]}-01-01`; train.to = `${yrs[1]}-12-31`; }
      else { const m = l.match(/(\d+)\s*(y|yr|year)/); train.preset = m ? ({ 1: '1y', 3: '3y', 5: '5y', 10: '10y' }[m[1]] || 'custom') : '5y';
        if (train.preset === 'custom' && m) { train.from = yearsAgo(+m[1]); train.to = todayIST(); } }
      train.brain = /lesson|experience|what you know/.test(l) ? 'lessons' : 'fresh';
      train.style = /\b(quick|fast|short[- ]term|swing|in and out)\b/.test(l) ? 'quick' : /\b(normal|long[- ]term|trend)\b/.test(l) ? 'normal' : 'account';
      const mm = l.match(/(?:₹|rs\.?\s*|with\s+|using\s+)(\d[\d,.]*\s*(?:k|lakhs?|lacs?|crores?|cr)?)\b|(\d[\d,.]*\s*(?:k|lakhs?|lacs?|crores?|cr))\b/);
      const ta = mm && parseAmount(mm[1] || mm[2]);
      if (ta && !/^(19|20)\d\d$/.test((mm[1] || mm[2]).trim())) { if (ta < 10000) return say('Use at least ₹10,000 for a training run.'); train.capital = ta; }
      train.speed = 64; train.phase = 'setup';
      train.route = /walk|rolling|step forward|move forward|realistic|honest/.test(l) ? 'walk' : /evolv|genetic|population|different(ly)?|alternat|another way|other way|explore/.test(l) ? 'evolve' : 'climb';
      train.mode = train.route !== 'climb' || /repeat|until|optimi[sz]|best setting|max(imum)? profit|tune|again and again/.test(l) ? 'repeat' : 'watch';
      const rr = l.match(/(\d+)\s*(?:rounds?|times)/); if (rr) train.rounds = Math.min(Math.max(+rr[1], 3), 60);
      if (/auto(matically)?\s*apply|apply automatically/.test(l)) train.autoApply = true;
      const [a, b] = trainRange();
      say(train.mode === 'repeat' && train.route === 'walk'
        ? `Starting walk-forward training on ${fdate(a)} – ${fdate(b)} with ${inr(trainCapital())}: I'll learn on the first 40%, then trade three stretches I haven't seen, learning more after each. Open the **Train** tab to watch.`
        : train.mode === 'repeat' && train.route === 'evolve'
        ? `Starting evolution training on ${fdate(a)} – ${fdate(b)} with ${inr(trainCapital())}: ${Math.max(2, Math.round(train.rounds / 8))} generations of 8 very different brain settings; the fittest survive and mix. I'll tune on the first 70% and test the winner on the last 30%.`
        : train.mode === 'repeat'
        ? `Starting repeat training on ${fdate(a)} – ${fdate(b)} with ${inr(trainCapital())}: up to ${train.rounds} rounds, changing one setting at a time and keeping whatever makes more profit. I'll tune on the first 70% and test the winner on the last 30%. Open the **Train** tab to watch.`
        : `Starting a training run on ${fdate(a)} – ${fdate(b)} with ${inr(trainCapital())} and ${train.brain === 'fresh' ? 'a fresh brain' : 'only lessons from before ' + fdate(a)}. I'll tell you how it went – or open the **Train** tab to watch.`);
      return startTraining();
    }
    if (/\b(resume|unpause|start trading|continue)\b/.test(l)) { if (!E.isPaused(st)) return say('I\'m not paused – trading as normal.'); E.setPause(st, null, todayIST(), nowIso()); store.save(st); return say('Resumed. I\'ll buy again when a strategy I trust gives a signal.'); }
    if (/\b(stop|sell (all|everything)|exit all|close all)\b/.test(l) && !/stop[- ]?loss/.test(l)) {
      if (!confirm('Sell every position at the next open and stop buying?')) return say('OK, I won\'t.');
      E.setPause(st, 'stop', todayIST(), nowIso()); store.save(st);
      const n = Object.values(st.tickers).filter((t) => t.live.qty).length;
      return say(`Stopped. ${n ? `I'll sell all ${n} position${n > 1 ? 's' : ''} at the next open` : 'I hold nothing'} and won't buy until you say **resume**.`);
    }
    if (/\b(quick|fast|short[- ]term|swing|scalp|in and out)\b/.test(l) && !/\btrain|practi[cs]e\b/.test(l) || /\b(normal|long[- ]term|slow)\s*(mode|trading|style)?\b/.test(l) && /\b(mode|trading|style|switch|go|use)\b/.test(l) && !/\btrain\b/.test(l)) {
      const quick = /\b(quick|fast|short[- ]term|swing|scalp|in and out)\b/.test(l) && !/\b(stop|turn off|disable|no more)\b.*\bquick/.test(l);
      const ch = setStyle(quick);
      return say(`${ch.length ? 'Done. ' : 'Already set. '}${styleText()}${quick ? `\n\nI'll learn which quick strategy works on each stock and which entries keep losing. Change the target with e.g. **take profit at 3 ATR** or **time limit 5 days**. To find the best target and time limit, say **train quick last 5 years until max profit**.\n\nHonest note: quick trades pay STT and stamp duty every time – many small trades can turn a small edge into a loss.` : ''}`);
    }
    if (/\b(take profit|profit target|target)\b/.test(l) && /\d/.test(l) && !/\btrain\b/.test(l)) {
      const v = parseFloat(l.match(/(\d+(?:\.\d+)?)/)[1]); setStyle(true, { tpAtr: Math.min(Math.max(v, 0), 10) });
      return say(`Profit target set to +${v}× ATR. ${styleText()}`);
    }
    if (/\b(time limit|max(imum)? days|exit after|sell after|hold (for )?max)\b/.test(l) && /\d/.test(l)) {
      const v = Math.round(parseFloat(l.match(/(\d+)/)[1])); setStyle(true, { maxDays: Math.min(Math.max(v, 0), 120) });
      return say(`Time limit set to ${v} sessions. ${styleText()}`);
    }
    if (/\b(stop[- ]?loss)\b/.test(l) && /\d/.test(l)) {
      const v = parseFloat(l.match(/(\d+(?:\.\d+)?)/)[1]); setStyle(isQuick(), { stopAtr: Math.min(Math.max(v, 0), 10) });
      return say(`Stop-loss set to ${v}× ATR. ${styleText()}`);
    }
    if (/\b(style|mode)\b/.test(l) && /\b(what|which|my|current)\b/.test(l)) return say(styleText());
    if (/\bpause\b/.test(l)) { E.setPause(st, 'pause', todayIST(), nowIso()); store.save(st); return say('Paused. No new buys – but open positions keep their stop-loss and exit signals. Say **resume** when you\'re ready.'); }
    const amt = parseAmount(l);
    if (/\b(deposit|withdraw|top ?up|capital|money|cash|funds?|rupees?)\b|₹|\brs\b/.test(l) || (amt && /^(add|put|remove|take|withdraw|set|change|make|increase|reduce)\b/.test(l))) {
      if (!amt) return say(`The account is **${inr(eqNow())}**, with ${inr(E.cashTotal(st))} in cash. You've put in ${inr(st.invested)}${st.withdrawn ? ` and taken out ${inr(st.withdrawn)}` : ''}.\n\nTo change it, say **add 1 lakh**, **withdraw 50,000**, or **set money to 10 lakh**.`);
      const mode = /\b(set|change|make)\b|\bto\b/.test(l) ? 'set' : /withdraw|remove|take|minus|reduce|less/.test(l) ? 'withdraw' : 'add';
      return say(changeMoney(mode, amt));
    }
    if (/^(add|buy|follow|track)\b/.test(l)) {
      const s0 = symIn(); if (!s0) return say('Which stock? For example **add AXISBANK**.');
      const s = normSym(s0); if (st.cfg.tickers.includes(s)) return say(`${sym(s)} is already in my list.`);
      try { const p = E.parseYahoo(await httpGet(url(s, '1mo'))); if (!p.bars.d.length) throw new Error(); }
      catch (e) { return say(`I can't find ${sym(s)} on the NSE (Yahoo Finance). Check the symbol – for example TMPV for Tata Motors.`); }
      say(`Adding ${sym(s)} with ${inr(st.slice)} of paper money. I'll first study its past so I know which strategy suits it.`);
      return addStock(s);
    }
    if (/^(remove|drop|delete)\b/.test(l)) {
      const s0 = symIn(); const s = s0 && normSym(s0);
      if (!s || !st.cfg.tickers.includes(s)) return say(`Which stock? I'm trading ${st.cfg.tickers.map(sym).join(', ')}.`);
      const T = st.tickers[s]; const gone = E.removeTicker(st, s, todayIST(), nowIso()); store.save(st);
      return say(gone ? `Removed ${sym(s)}; its ${inr(T ? T.live.cash : st.slice)} is withdrawn.` : `I'll sell ${sym(s)} at the next open, then remove it.`);
    }
    if (/\b(import|load|restore|upload)\b/.test(l) && /\b(brain|backup|data|file|settings)\b/.test(l)) {
      say('Pick the brain or backup file – I\'ll show you what\'s in it before changing anything.');
      return startImport();
    }
    if (/\b(download|export|save)\b/.test(l)) {
      const k = /equity|value|daily/.test(l) ? 'equity' : /evidence/.test(l) ? 'braincsv' : /brain/.test(l) && !/log/.test(l) ? 'brain' : /log|event/.test(l) ? 'brainlog' : /history|update|run/.test(l) ? 'runs' : /backup|everything|all|json/.test(l) ? 'backup' : /training/.test(l) ? 'trainings' : 'trades';
      exportData(k); return say(`Saved the ${({ trades: 'trades', equity: 'daily equity', brain: 'brain data', braincsv: 'brain evidence', brainlog: 'brain log', runs: 'update history', backup: 'full backup', trainings: 'training runs' })[k]} file${N ? ' to Downloads/Moli' : ''}.`);
    }
    if (/\b(market|open|close|when)\b/.test(l)) { const mk = market(); return say(mk.open ? `The market is open – it closes in ${dur(mk.closeAt - Date.now())} (3:30 PM). New prices arrive after 3:45 PM.` : `The market is closed. It opens in ${dur(mk.nextOpen - Date.now())} (9:15 AM, holidays not counted).${pendingLines().length ? `\n\nAt the open:\n${pendingLines().join('\n')}` : ''}`); }
    if (/\b(position|holding|hold|own|portfolio|invested in)/.test(l)) {
      const pos = Object.entries(st.tickers).filter(([, t]) => t.live.qty > 0);
      return say(pos.length ? `I hold:\n${pos.map(([s, t]) => { const x = t.live.trades[t.live.trades.length - 1], r = (t.lastClose / x.ep - 1) * 100; return `- ${sym(s)}: ${x.q} at ${px(x.ep)}, now ${px(t.lastClose)} (${pct(r)})${x.stop ? `, stop ${px(x.stop)}` : ''}`; }).join('\n')}\n\n${accountLine()}` : `I hold nothing – everything is in cash. ${accountLine()}`);
    }
    if (/\b(predict|prediction|forecast|outlook|pattern|candle|candlestick|chart|support|resistance|will \w+ (go|rise|fall)|going up|going down)/.test(l)) {
      const s0 = symIn(), s = s0 && normSym(s0);
      if (s && st.tickers[s]) return say(predictText(s));
      const rows = Object.entries(st.tickers).filter(([, t]) => t.pred);
      if (!rows.length) return say('Predictions appear after the next update – say **update**.');
      const lean = rows.filter(([, t]) => t.pred.outlook.lean !== 'none');
      return say(`${lean.length ? `Where today's signals tilt the odds:\n${lean.map(([x, t]) => `- ${sym(x)}: leans ${t.pred.outlook.lean} – ${Math.round(t.pred.outlook.p5 * 100)}% of similar setups rose within a week vs ${Math.round(t.pred.base.h5.up * 100)}% normally (${t.pred.active.map((a) => a.label).slice(0, 2).join(', ')})`).join('\n')}` : 'None of your stocks has signals with a clear edge today.'}\n\n${rows.length - lean.length} stock${rows.length - lean.length === 1 ? '' : 's'} with no clear edge. Ask **predict RELIANCE** for one stock, or open it in the Guide for the candlestick chart.`);
    }
    if (/\b(graph|graphs|chart|charts)\b/.test(l) && !symIn()) { tab = 'activity'; render(); return window.scrollTo(0, 0); }
    if (/\b(learn|lesson|rule|brain|smart|avoid)/.test(l)) {
      const R = st.learning.rules, act = Object.entries(R).filter(([, r]) => r.active);
      const evs = st.learning.events.filter((e) => e.kind === 'learn' || e.kind === 'unlearn').slice(-3).map((e) => `- ${fdate(e.date)}: ${e.text}`);
      return say((act.length ? `I avoid buying when:\n${act.map(([k, r]) => `- ${E.FEATURES[k].label.toLowerCase()} – ${r.nWith} such trades averaged ${pct(r.meanWith)} vs ${pct(r.meanWithout)} otherwise`).join('\n')}` : 'I haven\'t found any condition that clearly loses money yet.') + (evs.length ? `\n\nLatest:\n${evs.join('\n')}` : ''));
    }
    if (/\b(mistake|wrong|losing|losses)/.test(l) && !/how/.test(l)) {
      const M = (st.learning.mistakes || []), act = M.filter((m) => !m.forgiven);
      const memLine = M.length ? `\n\nMistakes I won't repeat (${act.length}${M.length - act.length ? `, ${M.length - act.length} forgiven` : ''}):\n${act.slice(-6).reverse().map((m) => `- ${memText(m)} – lost ${pct(m.ret)} on ${fdate(m.date)}${m.blocked ? `, skipped ${m.blocked}× since` : ''}`).join('\n')}` : '\n\nNo mistakes noted yet.';
      const tr = allLiveTrades().filter((t) => t.x && t.pnl <= 0), tally = {};
      tr.forEach((t) => E.diagnose(t).forEach((g) => { tally[g] = (tally[g] || 0) + 1; }));
      const tl = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      return say((tr.length ? `${tr.length} losing trade${tr.length > 1 ? 's' : ''} so far. What went wrong:\n${tl.slice(0, 5).map(([g, n]) => `- ${g} (${n}×)`).join('\n')}` : 'No losing paper trades yet.') + memLine);
    }
    if (/\bwhy\b|\?$/.test(l) || symIn()) {
      const s0 = symIn(), s = s0 && normSym(s0), T = s && st.tickers[s];
      if (T) {
        const ok = E.allowedStrategies(E.brainParams(st));
        const sc = Object.entries(T.scores || {}).filter(([k, v]) => ok.includes(k) && v != null && !Number.isNaN(v)).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const lastT = T.live.trades.slice(-1)[0];
        return say(`**${sym(s)}** at ${px(T.lastClose)}. ${T.active ? (E.brainParams(st).quick ? `Quick trading with **${(T.quickSet || [T.active]).map((k) => E.STRATEGIES[k].label).join(', ')}** – ${(T.quickSet || [T.active]).length > 1 ? 'they have' : 'it has'} averaged ${pct(T.scores[T.active], 2)} a trade over the last 20 trades.` : `I'm using **${E.STRATEGIES[T.active].label}** because it had the best record over the last year (Sharpe ${T.scores[T.active].toFixed(2)}).`) : !sc.length ? 'I just changed trading style, so I\'ll pick the best strategy for it at the next update.' : 'No strategy has worked well enough on it lately, so I keep it in cash.'}` +
          (sc.length ? `\n\nBest strategies on it lately:\n${sc.map(([k, v]) => `- ${E.STRATEGIES[k].label}: ${E.brainParams(st).quick ? pct(v, 2) + '/trade' : v.toFixed(2)}`).join('\n')}` : '') +
          `\n\n${T.live.qty ? `I hold ${T.live.qty} shares bought at ${px(lastT.ep)} (${pct((T.lastClose / lastT.ep - 1) * 100)}).` : 'I don\'t hold it.'} ${!sc.length ? '' : `Next review in ${Math.max(1, E.brainParams(st).reviewEvery - T.sinceReview)} sessions.`}`);
      }
    }
    if (/\b(how|doing|going|status|perform|profit|p&l|pnl|summary|money)\b/.test(l)) {
      const S = E.stats(allLiveTrades());
      return say(`${accountLine()}\n\n${S.n ? `${S.n} closed trades, ${Math.round(S.winRate * 100)}% winners, net ${inr(S.pnl)}.` : 'No closed trades yet.'} ${E.isPaused(st) ? `Trading is **${E.isPaused(st) === 'stop' ? 'stopped' : 'paused'}**.` : ''}`, 'pnl');
    }
    return say(`I didn't catch that. ${STRAT_HELP}`);
  }

  function chipList() {
    const s = [];
    if ((train.phase === 'done' && train.summary && !train.summary.taught) || (train.phase === 'repeatDone' && train.rep.good && !train.rep.sum.taught)) s.push('Apply');
    if (E.isPaused(st)) s.push('Resume');
    s.push('How am I doing?', 'Update', 'What have you learned?', 'Positions', 'Add 1 lakh', 'Train on the 2008 crisis', 'Train last 5 years until max profit', 'Walk forward last 5 years', 'Evolve on the 2008 crisis', 'Predictions', 'Quick mode', 'Train quick last 5 years until max profit', 'Download brain', 'Import brain', 'Mistakes', 'When does the market open?', 'Pause', 'Help');
    return s.slice(0, 8);
  }

  function bindChat() {
    $('sugg').innerHTML = chipList().map((x) => `<button type="button">${esc(x)}</button>`).join('');
    $('sugg').querySelectorAll('button').forEach((b) => { b.onclick = () => send(b.textContent); });
  }
  async function send(text) {
    text = (text || '').trim(); if (!text || !st) return;
    $('msg').value = ''; autosize();
    say(text, null, 'you');
    try { await respond(text); } catch (e) { say('Something went wrong: ' + e.message); }
  }
  function autosize() { const t = $('msg'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; }

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
      rows = [['ran_at_ist', 'label', 'from', 'to', 'brain', 'stocks', 'capital_inr', 'return_pct', 'unseen_new_settings_pct', 'unseen_current_settings_pct', 'settings_found', 'nifty_return_pct', 'max_drawdown_pct', 'trades', 'win_rate_pct', 'pnl_inr', 'taught_live_brain'],
        ...st.trainings.map((x) => [istStamp(Date.parse(x.at)), x.label, x.start, x.end, x.brain, x.stocks, x.capital || '', r2(x.ret), r2(x.unseenBest), r2(x.unseenBase), (x.changes || []).join('; '), r2(x.nret), r2(x.dd), x.trades, r2((x.win || 0) * 100), r2(x.pnl), x.taught ? 'yes' : 'no'])];
    } else if (kind === 'braincsv') {
      name = `moli-brain-evidence-${stamp}.csv`;
      const feats = (f) => (f ? Object.keys(E.FEATURES).filter((k) => f[k]).join('; ') : '');
      const one = (t, src) => [src, sym(t.sym || ''), E.STRATEGIES[t.s]?.label || t.s, t.e, t.x, r2(t.ret), t.r || '', t.bars ?? '', feats(t.f)];
      rows = [['source', 'stock', 'strategy', 'entry_date', 'exit_date', 'return_pct', 'exit_reason', 'sessions_held', 'entry_conditions'],
        ...(st.learning.trained || []).map((t) => one(t, 'training')), ...st.learning.closed.map((t) => one(t, 'lived'))];
    } else if (kind === 'brain') {
      name = `moli-brain-${stamp}.json`; mime = 'application/json';
      const brain = {
        exported_at: exported, app: 'Moli Trader', what: 'Everything the brain knows: settings, learned rules with evidence, strategy choice per stock, the trades it learned from, its history, training runs and today\'s predictions.',
        settings: E.brainParams(st), style: E.brainParams(st).quick ? 'quick' : 'normal',
        rules: Object.fromEntries(Object.entries(E.FEATURES).map(([k, f]) => [k, { condition: f.label, ...(st.learning.rules[k] || {}) }])),
        strategies: Object.fromEntries(Object.entries(st.tickers).map(([s, t]) => [sym(s), { active: t.active ? E.STRATEGIES[t.active].label : null, scores_sharpe_last_year: Object.fromEntries(Object.entries(t.scores || {}).filter(([, v]) => v != null && !Number.isNaN(v)).map(([k, v]) => [E.STRATEGIES[k].label, Math.round(v * 100) / 100])), next_review_in_sessions: E.brainParams(st).reviewEvery - t.sinceReview }])),
        predictions: Object.fromEntries(Object.entries(st.tickers).filter(([, t]) => t.pred).map(([s, t]) => { const { chart, ...rest } = t.pred; return [sym(s), rest]; })),
        evidence: { lived: st.learning.closed, from_training: st.learning.trained || [] },
        mistakes: st.learning.mistakes || [],
        events: st.learning.events, trainings: st.trainings,
      };
      return download(name, mime, JSON.stringify(brain, null, 1));
    } else if (kind === 'equity') {
      const idx = returnIndex(st.equity), sidx = returnIndex(st.sim.map((r) => [r[0], r[1], r[2], 0]));
      rows = [['phase', 'date', 'account_value_inr', 'net_capital_inr', 'return_index', 'nifty_close', 'exported_at'],
        ...st.sim.map((r, i) => ['practice', r[0], r[1], '', r2(sidx[i]), r2(r[2]), exported]),
        ...st.equity.map((r, i) => ['paper', r[0], r[1], r[3], r2(idx[i]), r2(r[2]), exported])];
    } else if (kind === 'brainlog') {
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
      st = E.newState(cfg, todayIST()); st.chat = [];
      const nm = ($('s_name') || {}).value; if (nm && nm.trim()) st.cfg.name = nm.trim().slice(0, 30);
      say(`Hi – I'm Moli. I'll paper trade your ${cfg.tickers.length} stocks with ${inr(cfg.capital)} of pretend money and learn from my mistakes.\n\nFirst I'm practising on the last ${cfg.warmYears} years so I don't start from zero. This takes a few seconds.`);
      store.save(st); tab = 'home'; query = ''; render(); update();
    });
    on('s_del', () => { if (confirm('Delete the paper account and everything the brain learned? Download a backup first if you want to keep it.')) { st = null; store.clear(); setupPicks = new Set(DEFAULTS.tickers); render(); } });
    const money = (mode) => () => {
      const a = parseAmount($('m_amt').value); if (!a) return toast('Type an amount, e.g. 50000 or 1 lakh');
      const msg = changeMoney(mode, a); toast(msg.replace(/\*\*/g, '').split('. ')[0]); render();
    };
    document.querySelectorAll('[data-tstyle]').forEach((b) => { b.onclick = () => { const ch = setStyle(b.dataset.tstyle === 'quick'); toast(ch.length ? (b.dataset.tstyle === 'quick' ? 'Quick trading on' : 'Normal trading on') : 'No change'); render(); }; });
    document.querySelectorAll('[data-tp]').forEach((b) => { b.onclick = () => { setStyle(true, { tpAtr: +b.dataset.tp }); render(); }; });
    document.querySelectorAll('[data-sl]').forEach((b) => { b.onclick = () => { setStyle(true, { stopAtr: +b.dataset.sl }); render(); }; });
    document.querySelectorAll('[data-md]').forEach((b) => { b.onclick = () => { setStyle(true, { maxDays: +b.dataset.md }); render(); }; });
    const bm = $('b_mem'); if (bm) bm.onchange = () => { E.applyParams(st, { ...E.brainParams(st), useMemory: bm.checked }, todayIST(), nowIso()); store.save(st); toast(bm.checked ? 'Mistake memory on' : 'Mistake memory off'); };
    on('b_reset', () => { const ch = E.applyParams(st, { ...E.BRAIN_DEFAULTS, stopAtr: 3 }, todayIST(), nowIso()); store.save(st); toast(ch.length ? 'Brain settings reset' : 'Already on defaults'); render(); });
    on('m_add', money('add')); on('m_wd', money('withdraw')); on('m_set', money('set'));
    document.querySelectorAll('[data-act]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); const a = b.dataset.act; if (a === 'nexttip') { tipIdx++; return render(); } doAct(a); }; });
    document.querySelectorAll('[data-stock]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); openStock(b.dataset.stock); }; });
    document.querySelectorAll('[data-ask]').forEach((b) => { b.onclick = () => { tab = 'chat'; render(); send(b.dataset.ask); }; });
    document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { tab = b.dataset.go; render(); window.scrollTo(0, 0); }; });
    const nmi = $('set_name'); if (nmi) nmi.onchange = () => { st.cfg.name = nmi.value.trim().slice(0, 30); store.save(st); toast('Saved'); };
    const rem = $('s_rem');
    if (rem) rem.onchange = () => { N.setReminder(rem.checked); toast(rem.checked ? 'Reminder on' : 'Reminder off'); };
  }
  function bindPick() { document.querySelectorAll('#pick [data-add]').forEach((b) => { b.onclick = () => addStock(b.dataset.add); }); }

  const NAV = { home: 'home', activity: 'activity', train: 'train', guide: 'guide', stocks: 'home', settings: 'home', chat: '', stock: '' };
  function render() {
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === NAV[tab]));
    $('tabs').style.display = st ? '' : 'none';
    $('fab').style.display = st ? '' : 'none';
    document.body.classList.toggle('chat', !!st && tab === 'chat');
    const pages = { home: viewHome, activity: viewActivity, train: viewTrain, guide: viewGuide, stocks: () => pageHead('Stocks', `${st.cfg.tickers.length} in your list`, 'home') + viewStocks(), settings: viewSettings, chat: viewChat, stock: viewStock };
    const page = !st ? viewSetup() : (pages[tab] || viewHome)();
    const note = `<p class="note">Paper trading only – simulated, not investment advice. SEBI found 87.7% of individual F&amp;O traders lost money in FY26.</p>`;
    $('view').innerHTML = page + (tab === 'chat' && st ? '' : note);
    bind(); if (tab === 'train') bindTrain(); if (st && tab === 'chat') bindChat(); setStatus();
  }

  document.querySelectorAll('#tabs a').forEach((a) => { a.onclick = () => { tab = a.dataset.tab; render(); window.scrollTo(0, 0); }; });
  $('fab').onclick = openSheet;
  $('sheetScrim').onclick = closeSheet;
  $('updateBtn').onclick = update;
  $('composer').onsubmit = (e) => { e.preventDefault(); send($('msg').value); };
  $('msg').addEventListener('input', autosize);
  $('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('msg').value); } });
  render();
  if (st && (!st.lastFetch || Date.now() - st.lastFetch > 3600e3)) update();
  setInterval(tickCountdowns, 1000);
  setInterval(setStatus, 60000);
})();
