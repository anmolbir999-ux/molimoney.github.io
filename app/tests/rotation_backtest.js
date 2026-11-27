/*
 * Honest backtest of the Momentum rotation account.
 *   node app/tests/rotation_backtest.js <data-dir> [download]
 * With "download" it first saves Yahoo daily prices (2008–today) for the test universe – today's Nifty 50
 * plus former members, including stocks that later collapsed – and NIFTYBEES (the Nifty with dividends).
 * Only stocks in the Nifty 50 on each date can be picked (membership history in engine.js). Settings were chosen on
 * 2010–2019 only; 2020–today is the holdout. Results are after costs, slippage and tax. Result: it did NOT beat the index.
 */
const E = require('../web/engine.js'), fs = require('fs'), path = require('path');
const dir = process.argv[2] || 'rotation-data';
const yurl = (s) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?period1=1199145600&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div%2Csplit&includeAdjustedClose=true`;
async function download() {
  fs.mkdirSync(dir, { recursive: true });
  for (const s of [...E.ROT_UNIVERSE, '^NSEI', 'NIFTYBEES.NS']) {
    const f = path.join(dir, s.replace('^', '%5E') + '.json'); if (fs.existsSync(f)) continue;
    try { const r = await fetch(yurl(s), { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.ok) fs.writeFileSync(f, await r.text()); } catch (e) { console.log('skip', s); }
  }
}
function run() {
  const data = {}, load = (s) => E.parseYahoo(fs.readFileSync(path.join(dir, s.replace('^', '%5E') + '.json'), 'utf8'));
  for (const s of E.ROT_UNIVERSE) { try { data[s] = load(s); } catch (e) { /* not available */ } }
  const nifty = load('^NSEI'), bees = load('NIFTYBEES.NS').bars, last = nifty.bars.d[nifty.bars.d.length - 1];
  const tr = (a, z) => { const i = bees.d.findIndex((d) => d >= a); let j = bees.d.length - 1; while (bees.d[j] > z) j--; return bees.ac[j] / bees.ac[i] - 1; };
  console.log(`${Object.keys(data).length} stocks`);
  for (const [a, z, label] of [['2010-01-01', '2019-12-31', 'tuning'], ['2020-01-01', last, 'holdout'], ['2010-01-01', last, 'all']]) {
    const R = E.newRot(1e6); E.rotRun(R, data, nifty, z, a);
    const e = R.equity, yrs = (Date.parse(e[e.length - 1][0]) - Date.parse(e[0][0])) / 3.156e10, ret = e[e.length - 1][1] / e[0][1] - 1;
    let pk = 0, dd = 0; e.forEach((r) => { pk = Math.max(pk, r[1]); dd = Math.min(dd, r[1] / pk - 1); });
    const cg = (x) => (((1 + x) ** (1 / yrs) - 1) * 100).toFixed(1);
    console.log(`${label.padEnd(8)} ${a} → ${z}: ${cg(ret)}%/yr vs Nifty with dividends ${cg(tr(a, z))}%/yr · worst fall ${(dd * 100).toFixed(1)}% · tax ₹${Math.round(R.tax.paid)} · costs ₹${Math.round(R.costs)}`);
  }
}
(process.argv[3] === 'download' ? download() : Promise.resolve()).then(run);
