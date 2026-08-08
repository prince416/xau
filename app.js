(() => {
  'use strict';

  let STARTING_BALANCE = 100000;
  const TIMEFRAMES = ['M1', 'M3', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
  const PYODIDE_INDEX = 'https://cdn.jsdelivr.net/pyodide/v314.0.4/full/';
  const state = { datasets: new Map(), selectedTimeframe: null, strategy: null, lastReport: null };
  let pyodideInstance = null;
  const $ = (id) => document.getElementById(id);
  const money = (value) => `${value < 0 ? '-' : ''}$${Math.abs(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (value, digits = 2) => `${value < 0 ? '-' : ''}${Math.abs(value || 0).toFixed(digits)}%`;
  const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const timeframeMinutes = { M1: 1, M3: 3, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 };

  const RUNNER_GUIDE = `# Helio Lab runner contract

Helio runs your trusted local Python file as:

    python your_strategy.py --csv selected_xauusd.csv --out trades.csv --balance 100000

Your program must write a CSV to --out. Include these columns:

    entry_time, exit_time, direction, entry, exit, reason, pnl, r

Required: pnl. Recommended: entry_time, exit_time and direction.

Direction may be BUY / SELL or LONG / SHORT. The included liquidity_sweep_bot.py from Downloads already follows this contract.

Important: Helio executes code only on your computer at 127.0.0.1. Run files you trust.
`;

  function enhanceWorkspace() {
    const oldDrop = $('dataDrop');
    const oldInput = $('dataInput');
    const parameterGrid = $('parameterGrid');
    if (oldDrop) oldDrop.hidden = true;
    if (oldInput) oldInput.disabled = true;
    if (parameterGrid) parameterGrid.hidden = true;

    const dataPanelLabel = document.querySelector('#dataPanel .panel-label div');
    if (dataPanelLabel) dataPanelLabel.innerHTML = '<b>Bundled XAUUSD data</b><small>Last-year multi-timeframe data pack</small>';
    const strategyPanelLabel = document.querySelector('#strategyPanel .panel-label div');
    if (strategyPanelLabel) strategyPanelLabel.innerHTML = '<b>Python strategy</b><small>Upload your existing local backtest engine</small>';
    const template = $('downloadTemplate');
    if (template) template.textContent = 'Get runner guide';
    const picker = document.querySelector('.strategy-picker');
    const notice = document.querySelector('.runner-notice');
    if (picker && notice) picker.insertAdjacentElement('afterend', notice);
    $('strategyName').textContent = 'Drop your trusted .py strategy';
    $('strategyMeta').textContent = 'It will run locally against the selected XAUUSD timeframe.';
    const timeframeBar = $('timeframes');
    if (![...timeframeBar.children].some((button) => button.textContent === 'M3')) {
      const button = document.createElement('button'); button.disabled = true; button.textContent = 'M3';
      timeframeBar.children[0].insertAdjacentElement('afterend', button);
    }
    document.querySelector('.workspace-heading h2').textContent = 'Run your real strategy.';
    document.querySelector('.workspace-heading > p').textContent = 'Your strategy runs in an isolated browser sandbox. Nothing is sent to a server.';
    document.querySelector('.side-step[data-jump="dataPanel"] small').textContent = 'Bundled library';
    document.querySelector('.side-step[data-jump="strategyPanel"] small').textContent = 'Run your Python';
    document.querySelector('.side-private').innerHTML = '<i></i> LOCAL<br>RESEARCH';
    $('runButton').innerHTML = 'Run local backtest <span>→</span>';
    $('emptyReport').querySelector('p:last-child').textContent = 'Choose a bundled timeframe, drop a compatible Python strategy, and run it inside your browser. Results are calculated from its exported trade log—never from a preset profile.';
    document.querySelector('.method-copy').innerHTML = '<p>Helio selects the bundled XAUUSD timeframe you choose and reports the exact date range, bar count, trade ledger, and every metric derived from that ledger.</p><p>Your Python strategy runs inside a browser sandbox with no server-side execution. It must use the Helio command-line trade-log contract.</p><a href="#strategyPanel">View the runner contract <span>→</span></a>';
  }

  function updateRunButton() {
    const button = $('runButton');
    const ready = Boolean(state.selectedTimeframe && state.strategy?.source);
    button.disabled = !ready;
    button.classList.toggle('ready', ready);
  }

  function updateTimeframes() {
    const available = [...state.datasets.keys()];
    if (!state.datasets.has(state.selectedTimeframe)) state.selectedTimeframe = available[0] || null;
    document.querySelectorAll('#timeframes button').forEach((button) => {
      const timeframe = button.textContent;
      const isAvailable = state.datasets.has(timeframe);
      button.disabled = !isAvailable;
      button.classList.toggle('available', isAvailable);
      button.classList.toggle('active', timeframe === state.selectedTimeframe);
    });
    const current = state.datasets.get(state.selectedTimeframe);
    $('timeframeHelp').textContent = current
      ? `${current.timeframe} selected · ${current.bars.toLocaleString('en-US')} bars · ${current.start} to ${current.end}`
      : 'Start Helio Lab to activate the bundled timeframes';
    updateRunButton();
  }

  function updateDataSummary() {
    const summary = $('dataSummary');
    summary.replaceChildren();
    const icon = document.createElement('span'); icon.className = 'summary-icon'; icon.textContent = state.datasets.size ? '✓' : '◎';
    const copy = document.createElement('span'); const title = document.createElement('b'); const detail = document.createElement('small');
    if (state.datasets.size) {
      const frames = TIMEFRAMES.filter((frame) => state.datasets.has(frame));
      title.textContent = `${frames.length} timeframe${frames.length === 1 ? '' : 's'} ready`;
      detail.textContent = `Available: ${frames.join(' · ')}. Exact coverage is shown before every run.`;
    } else {
      title.textContent = 'No data library detected';
      detail.textContent = 'Open this page with “Run Helio Lab.bat”.';
    }
    copy.append(title, detail); summary.append(icon, copy);
  }

  async function loadLibrary() {
    const title = $('libraryTitle'); const meta = $('libraryMeta'); const status = $('libraryStatus');
    try {
      const response = await fetch('data/manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Local runner unavailable');
      const datasets = await response.json();
      datasets.forEach((dataset) => state.datasets.set(dataset.timeframe, dataset));
      title.textContent = `${datasets.length} XAUUSD datasets indexed`;
      meta.textContent = 'Last-year window where available · MT4/MT5 source exports · stored locally';
      status.textContent = 'READY'; status.classList.add('ready');
    } catch (error) {
      title.textContent = 'Local runner is not connected';
      meta.textContent = 'Double-click “Run Helio Lab.bat”, then use the page it opens.';
      status.textContent = 'OFFLINE'; status.classList.remove('ready');
    }
    updateDataSummary(); updateTimeframes();
  }

  async function readStrategy(file) {
    const source = await file.text();
    state.strategy = { name: file.name, source };
    $('strategyName').textContent = file.name;
    $('strategyMeta').textContent = `${(file.size / 1024).toFixed(1)} KB · ready for local execution`;
    updateRunButton();
  }

  function durationForBars(count, timeframe) {
    const minutes = Math.max(0, count) * (timeframeMinutes[timeframe] || 60);
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  }

  function reportFromRunner(payload) {
    const trades = (payload.trades || []).map((trade) => ({ ...trade, pnl: Number(trade.pnl) || 0, r: Number(trade.r) || 0, bars: Number(trade.bars) || 0 }));
    const pnls = trades.map((trade) => trade.pnl);
    const grossProfit = pnls.filter((pnl) => pnl > 0).reduce((sum, pnl) => sum + pnl, 0);
    const grossLoss = Math.abs(pnls.filter((pnl) => pnl < 0).reduce((sum, pnl) => sum + pnl, 0));
    const net = pnls.reduce((sum, pnl) => sum + pnl, 0);
    const winners = trades.filter((trade) => trade.pnl > 0);
    const losers = trades.filter((trade) => trade.pnl <= 0);
    const winRate = trades.length ? winners.length / trades.length * 100 : 0;
    const equity = (payload.equity || [STARTING_BALANCE]).map(Number);
    let peak = equity[0] || STARTING_BALANCE; let maxDrawdown = 0;
    equity.forEach((value) => { peak = Math.max(peak, value); maxDrawdown = Math.max(maxDrawdown, peak - value); });
    const maxDrawdownPct = peak ? maxDrawdown / peak * 100 : 0;
    const average = trades.length ? net / trades.length : 0;
    const avgWin = winners.length ? grossProfit / winners.length : 0;
    const avgLoss = losers.length ? grossLoss / losers.length : 0;
    const variance = pnls.length > 1 ? pnls.reduce((sum, value) => sum + (value - average) ** 2, 0) / (pnls.length - 1) : 0;
    const downside = pnls.filter((value) => value < 0);
    const downsideStd = downside.length > 1 ? Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length) : 0;
    const sharpe = variance ? average / Math.sqrt(variance) * Math.sqrt(Math.min(trades.length, 252)) : 0;
    const sortino = downsideStd ? average / downsideStd * Math.sqrt(Math.min(trades.length, 252)) : 0;
    const daily = new Map();
    trades.forEach((trade) => { const day = String(trade.exit || '').slice(0, 10); daily.set(day, (daily.get(day) || 0) + trade.pnl); });
    const largestDailyLoss = Math.min(0, ...daily.values());
    let currentWin = 0, currentLoss = 0, maxWinStreak = 0, maxLossStreak = 0;
    trades.forEach((trade) => { if (trade.pnl > 0) { currentWin++; currentLoss = 0; maxWinStreak = Math.max(maxWinStreak, currentWin); } else { currentLoss++; currentWin = 0; maxLossStreak = Math.max(maxLossStreak, currentLoss); } });
    const returns = pnls.map((pnl) => pnl / STARTING_BALANCE * 100).sort((a, b) => a - b);
    const dataset = payload.dataset;
    return {
      dataset, trades, equity, net, grossProfit, grossLoss, winners, losers, winRate, average, avgWin, avgLoss, sharpe, sortino,
      profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
      maxDrawdown, maxDrawdownPct, largestDailyLoss, maxWinStreak, maxLossStreak,
      valueAtRisk: returns.length ? returns[Math.max(0, Math.floor(returns.length * 0.05) - 1)] : 0,
      longTrades: trades.filter((trade) => trade.side === 'LONG'), shortTrades: trades.filter((trade) => trade.side === 'SHORT'),
      bestTrade: trades.length ? Math.max(...pnls) : 0, worstTrade: trades.length ? Math.min(...pnls) : 0,
      totalReturn: net / STARTING_BALANCE * 100, strategyName: payload.strategyName, riskPercent: payload.riskPercent, runtimeSeconds: payload.runtimeSeconds,
    };
  }

  function svgPath(equity) {
    const samples = 100; const stride = Math.max(1, Math.ceil(equity.length / samples)); const points = [];
    for (let index = 0; index < equity.length; index += stride) points.push(equity[index]);
    if (points[points.length - 1] !== equity[equity.length - 1]) points.push(equity[equity.length - 1]);
    const min = Math.min(...points), max = Math.max(...points), range = Math.max(1, max - min);
    return points.map((value, index) => `${(index / Math.max(1, points.length - 1) * 760).toFixed(1)} ${(194 - (value - min) / range * 164).toFixed(1)}`).join(' L');
  }

  function detailList(target, rows) {
    const list = $(target); list.replaceChildren();
    rows.forEach(([term, value]) => { const row = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = term; dd.textContent = value; row.append(dt, dd); list.append(row); });
  }

  function setRule(valueId, stateId, value, limit, suffix = '%') {
    $(valueId).textContent = `${pct(value)} / ${limit}${suffix}`;
    const dot = $(stateId); dot.className = value <= limit * 0.75 ? 'pass' : value <= limit ? 'warn' : 'fail';
  }

  function renderTrades(trades) {
    const target = $('tradesTable'); target.replaceChildren();
    if (!trades.length) { target.textContent = 'This strategy exported no closed trades for the selected data window.'; return; }
    trades.slice(-12).reverse().forEach((trade) => {
      const row = document.createElement('div'); row.className = 'trade-row';
      [['span', trade.entry], ['span', trade.side], ['span', trade.reason], ['span', money(trade.pnl)], ['span', trade.bars ? durationForBars(trade.bars, state.selectedTimeframe) : '—']].forEach(([tag, value], index) => {
        const cell = document.createElement(tag); cell.textContent = value;
        if (index === 1) cell.className = trade.side === 'LONG' ? 'long' : 'short';
        if (index === 3) cell.className = trade.pnl >= 0 ? 'profit' : 'loss';
        row.append(cell);
      });
      target.append(row);
    });
  }

  function renderDistribution(report) {
    const rows = [
      ['Long trades', report.longTrades.length, report.trades.length ? report.longTrades.length / report.trades.length * 100 : 0],
      ['Short trades', report.shortTrades.length, report.trades.length ? report.shortTrades.length / report.trades.length * 100 : 0],
      ['Winning trades', report.winners.length, report.winRate],
      ['Losing trades', report.losers.length, 100 - report.winRate],
      ['Largest winner', money(report.bestTrade), report.avgWin ? Math.min(100, report.bestTrade / report.avgWin * 20) : 0],
      ['Largest loser', money(report.worstTrade), report.avgLoss ? Math.min(100, Math.abs(report.worstTrade) / report.avgLoss * 20) : 0],
    ];
    const container = $('distribution'); container.replaceChildren();
    rows.forEach(([label, value, width]) => { const row = document.createElement('div'); const name = document.createElement('label'); const bar = document.createElement('div'); const fill = document.createElement('i'); const node = document.createElement('b'); name.textContent = label; bar.className = 'bar'; fill.style.width = `${Math.max(0, Math.min(100, width))}%`; bar.append(fill); node.textContent = value; row.append(name, bar, node); container.append(row); });
  }

  function renderReport(report) {
    state.lastReport = report;
    $('emptyReport').hidden = true; $('resultsWrap').hidden = false;
    $('reportTitle').textContent = `XAUUSD ${report.dataset.timeframe} strategy report`;
    $('reportCoverage').textContent = `${report.dataset.bars.toLocaleString('en-US')} bars · ${report.dataset.start} to ${report.dataset.end} · Python run in ${report.runtimeSeconds}s`;
    $('netProfit').textContent = money(report.net); $('netReturn').textContent = `${report.totalReturn >= 0 ? '+' : ''}${pct(report.totalReturn)} return on ${money(STARTING_BALANCE)}`;
    $('profitFactor').textContent = report.profitFactor === Infinity ? '∞' : number(report.profitFactor); $('grossInfo').textContent = `${money(report.grossProfit)} / ${money(-report.grossLoss)}`;
    $('drawdown').textContent = pct(report.maxDrawdownPct); $('ddInfo').textContent = `${money(report.maxDrawdown)} peak to valley`;
    $('winRate').textContent = pct(report.winRate); $('winInfo').textContent = `${report.winners.length} wins / ${report.losers.length} losses`;
    $('totalTrades').textContent = report.trades.length; $('tradeInfo').textContent = report.trades.length ? `${durationForBars(Math.round(report.trades.reduce((sum, trade) => sum + trade.bars, 0) / report.trades.length), report.dataset.timeframe)} avg hold` : 'No signals generated';
    $('equityValue').textContent = money(STARTING_BALANCE + report.net); $('equityCaption').textContent = `${report.trades.length} closed positions · ${report.strategyName}`;
    const path = svgPath(report.equity); $('equityLine').setAttribute('d', `M${path}`); $('equityArea').setAttribute('d', `M${path} V220 H0 Z`);
    const dailyLossPct = Math.abs(report.largestDailyLoss / STARTING_BALANCE * 100);
    const risk = Number.isFinite(report.riskPercent) ? report.riskPercent : null;
    $('riskGrade').textContent = report.maxDrawdownPct <= 10 && dailyLossPct <= 5 && (risk == null || risk <= 2) ? 'Within limits' : 'Review limits';
    setRule('dailyLoss', 'dailyState', dailyLossPct, 5); setRule('overallLoss', 'overallState', report.maxDrawdownPct, 10);
    $('lossStreak').textContent = `${report.maxLossStreak} trades`; $('streakState').className = report.maxLossStreak <= 5 ? 'pass' : 'warn';
    $('positionRisk').textContent = risk == null ? 'Not declared' : pct(risk); $('positionState').className = risk == null ? 'warn' : risk <= 1 ? 'pass' : risk <= 2 ? 'warn' : 'fail';
    detailList('performanceStats', [
      ['Gross profit', money(report.grossProfit)], ['Gross loss', money(-report.grossLoss)], ['Average trade', money(report.average)], ['Expected payoff', money(report.average)], ['Average winner', money(report.avgWin)], ['Average loser', money(-report.avgLoss)], ['Payoff ratio', report.avgLoss ? number(report.avgWin / report.avgLoss) : '—'], ['Sharpe ratio', number(report.sharpe)], ['Sortino ratio', number(report.sortino)], ['Calmar ratio', report.maxDrawdownPct ? number(report.totalReturn / report.maxDrawdownPct) : '—'], ['Largest win', money(report.bestTrade)], ['Largest loss', money(report.worstTrade)],
    ]);
    detailList('riskStats', [
      ['Maximum drawdown', `${pct(report.maxDrawdownPct)} (${money(report.maxDrawdown)})`], ['Largest daily loss', money(report.largestDailyLoss)], ['Maximum win streak', `${report.maxWinStreak} trades`], ['Maximum loss streak', `${report.maxLossStreak} trades`], ['Value at Risk (5%)', pct(report.valueAtRisk)], ['Risk per position', risk == null ? 'Not declared in code' : pct(risk)], ['Trade frequency', `${report.trades.length} closed positions`], ['Profit factor', report.profitFactor === Infinity ? '∞' : number(report.profitFactor)],
    ]);
    detailList('validationStats', [
      ['Data source', 'Bundled XAUUSD library'], ['Instrument', 'XAUUSD'], ['Timeframe', report.dataset.timeframe], ['Data coverage', `${report.dataset.start} → ${report.dataset.end}`], ['Bar count', report.dataset.bars.toLocaleString('en-US')], ['Strategy model', report.strategyName], ['Trade source', 'Strategy --out CSV'], ['Code handling', 'Executed locally at 127.0.0.1'],
    ]);
    renderDistribution(report); renderTrades(report.trades); $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showError(message) {
    const summary = $('dataSummary');
    summary.querySelector('b').textContent = 'Could not run the backtest';
    summary.querySelector('small').textContent = message.replace(/\s+/g, ' ').slice(0, 260);
  }

  async function getPyodide() {
    if (pyodideInstance) return pyodideInstance;
    if (!window.loadPyodide) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${PYODIDE_INDEX}pyodide.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load the browser Python runtime. Check your internet connection and try again.'));
        document.head.append(script);
      });
    }
    pyodideInstance = await window.loadPyodide({ indexURL: PYODIDE_INDEX });
    await pyodideInstance.loadPackage(['numpy', 'pandas']);
    return pyodideInstance;
  }

  function parseCsv(raw) {
    const rows = []; let row = []; let cell = ''; let quoted = false;
    for (let index = 0; index < raw.length; index++) {
      const character = raw[index];
      if (character === '"') {
        if (quoted && raw[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted;
      } else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
      else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && raw[index + 1] === '\n') index++;
        row.push(cell); if (row.some((value) => value.length)) rows.push(row); row = []; cell = '';
      } else cell += character;
    }
    row.push(cell); if (row.some((value) => value.length)) rows.push(row);
    return rows;
  }

  function browserTradeLog(raw, timeframe) {
    const [headers, ...rows] = parseCsv(raw);
    if (!headers) return [];
    const lookup = Object.fromEntries(headers.map((header, index) => [header.toLowerCase().replace(/[^a-z0-9]/g, ''), index]));
    const field = (row, ...names) => {
      const index = names.map((name) => lookup[name]).find((value) => value !== undefined);
      return index === undefined ? '' : row[index] || '';
    };
    return rows.map((row) => {
      const entry = field(row, 'entrytime', 'entrydate'); const exit = field(row, 'exittime', 'exitdate');
      const elapsed = Date.parse(exit) - Date.parse(entry);
      const bars = Number.isFinite(elapsed) ? Math.max(1, Math.round(elapsed / 60000 / (timeframeMinutes[timeframe] || 60))) : 0;
      let side = (field(row, 'direction', 'side', 'type') || 'TRADE').toUpperCase();
      if (side === 'BUY') side = 'LONG'; if (side === 'SELL') side = 'SHORT';
      return { entry: entry || '—', exit: exit || '—', side, entryPrice: Number(field(row, 'entry', 'entryprice')) || 0, exitPrice: Number(field(row, 'exit', 'exitprice')) || 0, reason: field(row, 'reason', 'exitreason') || 'Strategy exit', pnl: Number(field(row, 'pnl', 'profit', 'netpnl')) || 0, r: Number(field(row, 'r', 'rmultiple')) || 0, bars };
    }).filter((trade) => Number.isFinite(trade.pnl));
  }

  async function runInBrowser(dataset, strategy) {
    const [pyodide, marketResponse] = await Promise.all([getPyodide(), fetch(`data/${dataset.filename}`)]);
    if (!marketResponse.ok) throw new Error(`Could not load ${dataset.filename}.`);
    pyodide.FS.writeFile('source.tsv', await marketResponse.text());
    pyodide.FS.writeFile('strategy.py', strategy.source);
    const started = performance.now();
    const runner = `
import pandas as pd, runpy, sys
raw = pd.read_csv('source.tsv', sep='\\t')
raw.columns = [str(column).strip().lower().replace('<', '').replace('>', '') for column in raw.columns]
date_column = next((column for column in raw.columns if column in ('date', 'datetime', 'time')), None)
if date_column is None: raise ValueError('Market data has no date column')
if 'time' in raw.columns and date_column != 'datetime':
    raw['datetime'] = raw[date_column].astype(str) + ' ' + raw['time'].astype(str)
else:
    raw['datetime'] = raw[date_column].astype(str)
raw = raw.rename(columns={'tickvol': 'volume', 'vol': 'volume'})
for column in ('open', 'high', 'low', 'close'):
    if column not in raw.columns: raise ValueError('Market data has no ' + column + ' column')
raw[['datetime', 'open', 'high', 'low', 'close']].to_csv('market.csv', index=False)
sys.argv = ['strategy.py', '--csv', 'market.csv', '--out', 'trades.csv', '--balance', '100000']
runpy.run_path('strategy.py', run_name='__main__')
`;
    try { await pyodide.runPythonAsync(runner); }
    catch (error) { throw new Error(`Strategy could not complete: ${String(error.message || error).slice(0, 500)}`); }
    let output = '';
    try { output = pyodide.FS.readFile('trades.csv', { encoding: 'utf8' }); }
    catch { throw new Error('Strategy completed but did not export trades.csv. It must support --csv, --out and --balance.'); }
    const trades = browserTradeLog(output, dataset.timeframe);
    const equity = [STARTING_BALANCE]; trades.forEach((trade) => equity.push(equity[equity.length - 1] + trade.pnl));
    const riskMatch = strategy.source.match(/risk(?:_|\\s*)percent[^=\\n]*=\\s*([0-9]+(?:\\.[0-9]+)?)/i);
    return { dataset, trades, equity, strategyName: strategy.name, riskPercent: riskMatch ? Number(riskMatch[1]) : null, runtimeSeconds: ((performance.now() - started) / 1000).toFixed(2) };
  }

  async function animateAndRun() {
    const dataset = state.datasets.get(state.selectedTimeframe);
    if (!dataset || !state.strategy) return;
    const overlay = $('analysisOverlay'); const title = $('analysisTitle'); const detail = $('analysisDetail'); const progress = $('analysisProgress'); const steps = [...document.querySelectorAll('.analysis-steps span')];
    const phases = [
      ['Validating Python runner', `Preparing ${state.strategy.name}.`],
      ['Loading market candles', `Selecting ${dataset.timeframe}: ${dataset.bars.toLocaleString('en-US')} bars.`],
      ['Executing strategy', 'Running your trusted Python file locally.'],
      ['Measuring portfolio risk', 'Calculating performance, distribution and validation metrics.'],
    ];
    overlay.classList.add('show'); overlay.setAttribute('aria-hidden', 'false'); progress.style.width = '0';
    try {
      for (let index = 0; index < 2; index++) { title.textContent = phases[index][0]; detail.textContent = phases[index][1]; progress.style.width = `${(index + 1) * 25}%`; steps.forEach((step, stepIndex) => step.classList.toggle('active', stepIndex === index)); await wait(260); }
      title.textContent = phases[2][0]; detail.textContent = 'Loading browser Python packages, then running the strategy in a sandbox.'; progress.style.width = '70%'; steps.forEach((step, index) => step.classList.toggle('active', index === 2));
      const payload = await runInBrowser(dataset, state.strategy);
      title.textContent = phases[3][0]; detail.textContent = phases[3][1]; progress.style.width = '100%'; steps.forEach((step, index) => step.classList.toggle('active', index === 3)); await wait(350);
      renderReport(reportFromRunner(payload));
    } catch (error) {
      showError(error.message || 'The local runner could not process this strategy.');
    } finally {
      overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function exportTrades() {
    const report = state.lastReport; if (!report || !report.trades.length) return;
    const header = ['Entry', 'Exit', 'Side', 'Entry price', 'Exit price', 'Exit reason', 'PnL', 'R multiple', 'Bars held'];
    const rows = report.trades.map((trade) => [trade.entry, trade.exit, trade.side, trade.entryPrice, trade.exitPrice, trade.reason, trade.pnl.toFixed(2), trade.r.toFixed(3), trade.bars]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = document.createElement('a'); link.href = url; link.download = `helio-xauusd-${report.dataset.timeframe}-trades.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  enhanceWorkspace();
  $('strategyInput').addEventListener('change', (event) => { const file = event.target.files[0]; if (file) readStrategy(file); });
  $('runButton').addEventListener('click', animateAndRun); $('downloadCsv').addEventListener('click', exportTrades);
  $('downloadTemplate').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([RUNNER_GUIDE], { type: 'text/markdown' })); const link = document.createElement('a'); link.href = url; link.download = 'helio-runner-guide.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  document.querySelectorAll('#timeframes button').forEach((button) => button.addEventListener('click', () => { if (!button.disabled) { state.selectedTimeframe = button.textContent; updateTimeframes(); } }));
  document.querySelectorAll('[data-jump]').forEach((button) => button.addEventListener('click', () => $(button.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'center' })));
  document.querySelectorAll('[data-report-tab]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-report-tab]').forEach((item) => item.classList.toggle('active', item === button)); document.querySelectorAll('[data-report-panel]').forEach((panel) => panel.hidden = panel.dataset.reportPanel !== button.dataset.reportTab); }));
  updateDataSummary(); updateTimeframes(); loadLibrary();
})();
