/* Paper Trader UI. Data from Yahoo Finance; state stored on the phone. */
(function () {
  'use strict';
  const E = window.Engine;
  const NIFTY = '^NSEI';
  const DEFAULTS = {
    tickers: ['RELIANCE.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'INFY.NS', 'TCS.NS', 'ITC.NS', 'LT.NS', 'SBIN.NS'],
    capital: 500000, stopAtr: 3, riskPct: 0, slippage: 0.05, warmYears: 2,
  };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inr = (x) => (x == null || Number.isNaN(x) ? '–' : '₹' + Math.round(x).toLocaleString('en-IN'));
  const px = (x) => (x == null || Number.isNaN(x) ? '–' : '₹' + x.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }));
  const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : (x > 0 ? '+' : '') + x.toFixed(d) + '%');
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const sym = (s) => s.replace('.NS', '');
  const fdate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '–');
  const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);

  // ---------------------------------------------------------------- native bridge
  const N = window.Android;
  const waiting = {}; let seq = 0;
  window.__resolve = (id, ok, body) => { const w = waiting[id]; if (!w) return; delete waiting[id]; ok ? w.res(body) : w.rej(new Error(body)); };
  function httpGet(url) {
    if (N) return new Promise((res, rej) => { const id = 'r' + ++seq; waiting[id] = { res, rej }; N.get(id, url); });
    return fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  }
  const store = {
    load() { try { const s = N ? N.load() : localStorage.getItem('pt_state'); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
    save(st) { const s = JSON.stringify(st); if (N) N.save(s); else try { localStorage.setItem('pt_state', s); } catch (e) { /* ignore */ } },
    clear() { if (N) N.save(''); else try { localStorage.removeItem('pt_state'); } catch (e) { /* ignore */ } },
  };

  let st = store.load();
  let tab = st ? 'portfolio' : 'settings';
  let busy = false;

  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500); }
  function setStatus() {
    if (busy) return;
    if (!st) { $('status').textContent = 'Not started'; return; }
    const ago = st.lastFetch ? Math.round((Date.now() - st.lastFetch) / 60000) : null;
    const a = ago == null ? 'never' : ago < 1 ? 'just now' : ago < 60 ? ago + ' min ago' : ago < 1440 ? Math.round(ago / 60) + ' h ago' : Math.round(ago / 1440) + ' d ago';
    $('status').textContent = `Updated ${a} · data to ${fdate(st.lastDate)}`;
  }

  // ---------------------------------------------------------------- update
  function rangeFor() {
    if (!st.lastDate) return st.cfg.warmYears + 2 <= 5 ? '5y' : '10y';
    const gap = (Date.now() - new Date(st.lastDate).getTime()) / 864e5;
    return gap < 300 ? '2y' : gap < 1100 ? '5y' : '10y';
  }
  const url = (s, r) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=${r}&interval=1d&events=div%2Csplit`;

  async function update() {
    if (busy || !st) return;
    busy = true; $('updateBtn').disabled = true;
    const r = rangeFor(), data = {}, failed = [];
    try {
      $('status').textContent = 'Fetching Nifty…';
      const nifty = E.parseYahoo(await httpGet(url(NIFTY, r)));
      for (const s of st.cfg.tickers) {
        $('status').textContent = `Fetching ${sym(s)}…`;
        try { data[s] = E.parseYahoo(await httpGet(url(s, r))); } catch (e) { failed.push(sym(s)); }
      }
      $('status').textContent = st.lastDate ? 'Trading & learning…' : 'Warming up the brain on past data…';
      await new Promise((ok) => setTimeout(ok, 30));
      const res = E.run(st, data, nifty, Date.now());
      store.save(st);
      const learned = res.newEvents.filter((e) => e.kind === 'learn' || e.kind === 'unlearn').length;
      const first = res.days > 300;
      if (first) toast(`Practised on ${res.days} past sessions · ${learned} lesson${learned === 1 ? '' : 's'} learned. Paper trading starts now.`);
      else toast(res.days ? `${res.days} new session${res.days > 1 ? 's' : ''} processed` +
        (res.newTrades ? ` · ${res.newTrades} trade event${res.newTrades > 1 ? 's' : ''}` : '') +
        (learned ? ` · ${learned} lesson${learned > 1 ? 's' : ''} learned` : '') : 'Already up to date');
      if (failed.length) toast('Could not fetch: ' + failed.join(', '));
    } catch (e) {
      toast('Update failed – check internet. ' + e.message);
    }
    busy = false; $('updateBtn').disabled = false; setStatus(); render();
  }

  // ---------------------------------------------------------------- charts
  function lineChart(series, opts = {}) {
    const W = 340, H = 170, P = 6;
    const all = series.flatMap((s) => s.v.filter((x) => x != null && !Number.isNaN(x)));
    if (all.length < 2) return '';
    const min = Math.min(...all), max = Math.max(...all), n = Math.max(...series.map((s) => s.v.length));
    const X = (i) => P + (i / Math.max(n - 1, 1)) * (W - 2 * P), Y = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
    const paths = series.map((s) => {
      let d = ''; s.v.forEach((v, i) => { if (v == null || Number.isNaN(v)) return; d += (d ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); });
      return `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="${s.w || 1.6}" ${s.dash ? 'stroke-dasharray="4 3"' : ''} stroke-linejoin="round"/>`;
    }).join('');
    const marks = (opts.marks || []).map((m) => `<circle cx="${X(m.i).toFixed(1)}" cy="${Y(m.v).toFixed(1)}" r="3.5" fill="${m.c}"/>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${paths}${marks}</svg>` +
      `<div class="legend">${series.map((s) => `<span><i style="background:${s.c}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function curve(rows, base) {
    if (!rows.length) return { eq: [], nf: [] };
    const e0 = rows[0][1], n0 = rows.find((r) => r[2])?.[2];
    return { eq: rows.map((r) => (r[1] / e0) * 100), nf: rows.map((r) => (r[2] && n0 ? (r[2] / n0) * 100 : null)) };
  }
  function maxDD(v) { let pk = -Infinity, dd = 0; v.forEach((x) => { pk = Math.max(pk, x); dd = Math.min(dd, x / pk - 1); }); return dd * 100; }

  // ---------------------------------------------------------------- views
  function viewPortfolio() {
    if (!st.lastDate) return `<p class="empty">Tap <b>Update</b> to download prices and start.</p>`;
    const T = st.tickers, cap = st.cfg.capital;
    const eqNow = Object.values(T).reduce((s, t) => s + E.equity(t.live, t.lastClose || 0), 0);
    const live = st.equity, c = curve(live);
    const nRet = c.nf.length > 1 && c.nf[c.nf.length - 1] ? c.nf[c.nf.length - 1] - 100 : null;
    let h = `<div class="big">${inr(eqNow)}</div>
      <p class="sub"><span class="${cls(eqNow - cap)}">${eqNow >= cap ? '+' : ''}${inr(eqNow - cap).replace('₹-', '−₹')} (${pct((eqNow / cap - 1) * 100, 2)})</span>
      since ${fdate(st.paperStart)}${nRet != null ? ` · Nifty ${pct(nRet, 2)}` : ''}</p>`;
    if (live.length >= 3) {
      h += lineChart([{ name: 'Your paper account', v: c.eq, c: css('--fg') }, { name: 'Nifty 50', v: c.nf, c: css('--mut'), dash: 1 }]);
    } else if (st.sim.length > 20) {
      const s = curve(st.sim), r = s.eq[s.eq.length - 1] - 100, nr = s.nf[s.nf.length - 1] - 100;
      h += `<div class="sec">Brain's practice run · ${fdate(st.sim[0][0])} – ${fdate(st.sim[st.sim.length - 1][0])}</div>`;
      h += lineChart([{ name: 'Brain (simulated)', v: s.eq, c: css('--fg') }, { name: 'Nifty 50', v: s.nf, c: css('--mut'), dash: 1 }]);
      h += `<p class="sub">Simulated return ${pct(r)} (max drawdown ${pct(maxDD(s.eq))}) vs Nifty ${pct(nr)} (${pct(maxDD(s.nf.filter((x) => x)))}). Real paper trading started ${fdate(st.paperStart)}.</p>`;
    }
    const pos = Object.entries(T).filter(([, t]) => t.live.qty > 0);
    h += `<div class="sec">Positions</div>`;
    h += pos.length ? pos.map(([s, t]) => {
      const tr = t.live.trades[t.live.trades.length - 1], r = (t.lastClose / tr.ep - 1) * 100;
      return `<div class="row"><div><b>${sym(s)}</b><div class="m">${tr.q} @ ${px(tr.ep)} · ${esc(E.STRATEGIES[tr.s]?.label || '')}${tr.stop ? ` · stop ${px(tr.stop)}` : ''}</div></div>
        <div class="r"><b class="${cls(r)}">${pct(r)}</b><div class="m">${px(t.lastClose)}</div></div></div>`;
    }).join('') : `<p class="empty">No open positions. Cash: ${inr(eqNow)}</p>`;

    const pend = Object.entries(T).filter(([, t]) => t.live.pending);
    const blk = Object.entries(T).filter(([, t]) => t.blockedToday && t.blockedToday.d === st.lastDate);
    if (pend.length || blk.length) {
      h += `<div class="sec">Next session</div>`;
      h += pend.map(([s, t]) => `<div class="row"><div><b>${t.live.pending === 'BUY' ? 'Buy' : 'Sell'} ${sym(s)}</b><div class="m">at the open · ${esc(E.STRATEGIES[t.active]?.label || 'exit to cash')}</div></div></div>`).join('');
      h += blk.map(([s, t]) => `<div class="row"><div><b>Skip ${sym(s)}</b><div class="m">${esc(E.STRATEGIES[t.active]?.label || '')} said buy, but a learned rule blocks it: ${t.blockedToday.rules.map((k) => esc(E.FEATURES[k].label.toLowerCase())).join(', ')}</div></div></div>`).join('');
    }
    h += `<div class="sec">Stocks</div>` + Object.entries(T).map(([s, t]) => {
      const sp = t.spark.c.slice(-120), ch = sp.length > 1 ? (sp[sp.length - 1] / sp[sp.length - 2] - 1) * 100 : 0;
      return `<div class="row"><div><b>${sym(s)}</b><div class="m">${t.active ? esc(E.STRATEGIES[t.active].label) : 'Brain says: stay in cash'}</div></div>
        <div class="r">${px(t.lastClose)}<div class="m ${cls(ch)}">${pct(ch, 2)}</div></div></div>`;
    }).join('');
    return h;
  }

  function viewBrain() {
    if (!st.lastDate) return `<p class="empty">The brain starts after the first update.</p>`;
    const R = st.learning.rules;
    let h = `<p class="sub">Every stock runs ${Object.keys(E.STRATEGIES).length} strategies in hidden paper accounts. Every ${E.REVIEW_EVERY} sessions the brain switches each stock to whichever worked best over the last year, or to cash if none did. Losing trades are tagged with their conditions; conditions that keep losing become rules.</p>`;
    h += `<div class="sec">Learned rules</div>`;
    h += Object.entries(E.FEATURES).map(([k, f]) => {
      const r = R[k] || {};
      const ev = r.nWith ? `${r.nWith} trades with it: avg ${pct(r.meanWith)}, win ${Math.round((r.winWith || 0) * 100)}% · without: avg ${pct(r.meanWithout)}, win ${Math.round((r.winWithout || 0) * 100)}%` : 'Not enough trades yet';
      return `<div class="row"><div><b>${esc(f.label)}</b><div class="m">${ev}</div></div>
        <div class="r"><span class="pill ${r.active ? 'on' : ''}">${r.active ? 'Avoid' : 'Allowed'}</span></div></div>`;
    }).join('');
    h += `<div class="sec">Strategy per stock</div>`;
    h += Object.entries(st.tickers).map(([s, t]) => {
      const rows = Object.entries(t.scores || {}).filter(([, v]) => !Number.isNaN(v) && v != null).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<tr><td>${k === t.active ? '<b>' : ''}${esc(E.STRATEGIES[k].label)}${k === t.active ? '</b>' : ''}</td><td class="${cls(v)}">${v.toFixed(2)}</td></tr>`).join('');
      return `<details class="row" style="display:block"><summary style="display:flex;justify-content:space-between"><b>${sym(s)}</b>
        <span class="m">${t.active ? esc(E.STRATEGIES[t.active].label) : 'Cash'} ›</span></summary>
        <table><tr><td class="m">Strategy</td><td class="m">Sharpe, last year</td></tr>${rows || '<tr><td class="m">Not scored yet</td><td></td></tr>'}</table></details>`;
    }).join('');
    const evs = st.learning.events.slice(-40).reverse();
    h += `<div class="sec">What the brain did</div>` + (evs.length ? evs.map((e) => `<div class="ev"><span class="d">${fdate(e.date)}${e.date < st.paperStart ? ' · practice' : ''}</span><br>${esc(e.text)}</div>`).join('') : '<p class="empty">Nothing yet.</p>');
    return h;
  }

  function viewJournal() {
    if (!st.lastDate) return `<p class="empty">No trades yet.</p>`;
    const liveTr = Object.entries(st.tickers).flatMap(([s, t]) => t.live.trades.map((x) => ({ ...x, sym: s })));
    const simTr = Object.entries(st.tickers).flatMap(([s, t]) => t.sim.trades.map((x) => ({ ...x, sym: s })));
    const useSim = liveTr.filter((t) => t.x).length === 0;
    const list = (useSim ? simTr.filter((t) => t.x) : liveTr).sort((a, b) => (b.x || b.e).localeCompare(a.x || a.e));
    const S = E.stats(list);
    let h = useSim ? `<p class="sub">No closed paper trades yet – showing the brain's practice trades from before ${fdate(st.paperStart)}.</p>` : '';
    h += `<div class="grid" style="margin-top:10px">
      <div><div class="sec">Closed trades</div><div class="big" style="font-size:24px">${S.n}</div></div>
      <div><div class="sec">Win rate</div><div class="big" style="font-size:24px">${Number.isNaN(S.winRate) ? '–' : Math.round(S.winRate * 100) + '%'}</div></div>
      <div><div class="sec">Avg win / loss</div><div style="font-size:16px"><span class="up">${pct(S.avgWin)}</span> / <span class="down">${pct(S.avgLoss)}</span></div></div>
      <div><div class="sec">Net P&amp;L</div><div style="font-size:16px" class="${cls(S.pnl)}">${inr(S.pnl)}</div></div></div>`;
    const losers = list.filter((t) => t.x && t.pnl <= 0), tally = {};
    losers.forEach((t) => E.diagnose(t).forEach((g) => { tally[g] = (tally[g] || 0) + 1; }));
    const tl = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (tl.length) h += `<div class="sec">Most common mistakes</div>` + tl.slice(0, 6).map(([g, n]) => `<div class="row"><div>${esc(g)}</div><div class="r"><b>${n}</b></div></div>`).join('');
    h += `<div class="sec">Trades</div>`;
    h += list.length ? list.slice(0, 80).map((t) => {
      const open = !t.x, r = open ? (st.tickers[t.sym].lastClose / t.ep - 1) * 100 : t.ret;
      const tags = !open && t.pnl <= 0 ? `<ul class="tags">${E.diagnose(t).map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '';
      return `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px">
        <div><b>${sym(t.sym)}</b> <span class="m">${esc(E.STRATEGIES[t.s]?.label || '')}</span>
        <div class="m">${fdate(t.e)} → ${open ? 'open' : fdate(t.x) + (t.r === 'stop' ? ' (stop)' : '')} · ${t.q} sh @ ${px(t.ep)}</div></div>
        <div class="r"><b class="${cls(r)}">${pct(r)}</b><div class="m">${open ? '' : inr(t.pnl)}</div></div></div>${tags}</div>`;
    }).join('') : '<p class="empty">No trades yet. The brain only buys when a strategy it trusts gives a fresh signal.</p>';
    return h;
  }

  function viewSettings() {
    const c = st ? st.cfg : DEFAULTS, locked = !!st;
    let h = st ? `<p class="sub">Paper account started ${fdate(st.paperStart)}. Changing these settings starts a new account.</p>`
      : `<div class="big" style="font-size:26px">Start paper trading</div><p class="sub">Uses free Yahoo Finance prices. No money, no broker – fills are simulated at the next session's open with Indian costs (STT, stamp duty, GST, DP) and slippage.</p>`;
    h += `<label>Stocks (NSE symbols, comma separated)</label><textarea id="s_t">${esc(c.tickers.map(sym).join(', '))}</textarea>
      <div class="grid">
        <div><label>Paper capital (₹)</label><input id="s_c" inputmode="numeric" value="${c.capital}"></div>
        <div><label>Practice years before start</label><input id="s_w" inputmode="numeric" value="${c.warmYears}"></div>
        <div><label>Stop-loss (× ATR, 0 = off)</label><input id="s_s" inputmode="decimal" value="${c.stopAtr}"></div>
        <div><label>Risk per trade % (0 = full slice)</label><input id="s_r" inputmode="decimal" value="${c.riskPct}"></div>
      </div>
      <p class="hint">Capital is split equally across stocks. The brain practises on past data first, then paper trades from today.</p>
      <div class="actions"><button class="btn" id="s_go">${locked ? 'Start new account' : 'Start'}</button></div>`;
    if (N && N.canRemind && N.canRemind()) {
      const on = N.reminderOn();
      h += `<div class="sec">Daily reminder</div><div class="switch"><input type="checkbox" id="s_rem" ${on ? 'checked' : ''}><span>Remind me at 4:15 PM on weekdays to update</span></div>`;
    }
    if (st) h += `<div class="sec">Data</div><div class="actions"><button class="btn danger" id="s_del">Delete paper account</button></div>`;
    return h;
  }

  function bindSettings() {
    const go = $('s_go');
    if (go) go.onclick = () => {
      const tickers = $('s_t').value.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
        .map((s) => (s.includes('.') || s.startsWith('^') ? s : s + '.NS'));
      const num = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) && v >= 0 ? v : d; };
      const cfg = { tickers: [...new Set(tickers)].slice(0, 25), capital: num('s_c', 500000), warmYears: Math.min(Math.round(num('s_w', 2)), 8),
        stopAtr: num('s_s', 3), riskPct: num('s_r', 0), slippage: 0.05 };
      if (!cfg.tickers.length) return toast('Add at least one stock');
      if (st && !confirm('Start a new paper account? The current one will be deleted.')) return;
      st = E.newState(cfg, todayIST()); store.save(st); tab = 'portfolio'; render(); update();
    };
    const del = $('s_del');
    if (del) del.onclick = () => { if (confirm('Delete the paper account and everything the brain learned?')) { st = null; store.clear(); tab = 'settings'; render(); } };
    const rem = $('s_rem');
    if (rem) rem.onchange = () => { N.setReminder(rem.checked); toast(rem.checked ? 'Reminder on' : 'Reminder off'); };
  }

  function render() {
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    $('tabs').style.display = st ? '' : 'none';
    $('updateBtn').style.display = st ? '' : 'none';
    const v = !st ? viewSettings() : tab === 'portfolio' ? viewPortfolio() : tab === 'brain' ? viewBrain() : tab === 'journal' ? viewJournal() : viewSettings();
    $('view').innerHTML = v + `<p class="note">Paper trading only – simulated, not investment advice. Past results don't predict the future. SEBI found 87.7% of individual F&amp;O traders lost money in FY26.</p>`;
    if (!st || tab === 'settings') bindSettings();
    setStatus();
  }

  document.querySelectorAll('#tabs a').forEach((a) => { a.onclick = () => { tab = a.dataset.tab; render(); window.scrollTo(0, 0); }; });
  $('updateBtn').onclick = update;
  render();
  if (st && (!st.lastFetch || Date.now() - st.lastFetch > 3600e3)) update();
  setInterval(setStatus, 60000);
})();
