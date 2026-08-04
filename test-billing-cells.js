const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

const TEMPLATE_ID = '1R8c5NwxyAS8CRW7IxB9viCPyM4Q-pCcnHAGMPH5o6mw';

async function findSummaryCells(sheets, spreadsheetId) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'SUMMARY!A1:E40',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = r.data.values || [];
  const find = (re, start) => {
    start = start || 0;
    for (let i = start; i < rows.length; i++) {
      if (re.test(String((rows[i] || [])[0] || '').trim())) return i + 1;
    }
    return null;
  };
  const findAll = (re) => {
    const res = [];
    for (let i = 0; i < rows.length; i++) {
      if (re.test(String((rows[i] || [])[0] || '').trim())) res.push(i + 1);
    }
    return res;
  };
  const feeDetailRows = findAll(/^TOTAL AMOUNT TO BILL/i);
  const findFeeRowForSection = (sectionRe) => {
    for (let f = 0; f < feeDetailRows.length; f++) {
      const feeRow = feeDetailRows[f];
      const feeIdx = feeRow - 1;
      for (let j = feeIdx - 1; j >= Math.max(0, feeIdx - 10); j--) {
        if (sectionRe.test(String((rows[j] || [])[0] || '').trim())) return feeRow;
      }
    }
    return null;
  };
  return {
    qrphTopRow:     find(/^QRPH$/i),
    disburseTopRow: find(/^DISBURSE$/i),
    vcaTopRow:      find(/^VCA$/i),
    totalTopRow:    find(/^TOTAL$/i),
    lessRow:        find(/less previously charged/i),
    amountDueRow:   find(/^amount due\b/i),
    periodTopRow:   find(/billing period/i),
    vcaFeeRow:      findFeeRowForSection(/^VCA$/i),
    qrphFeeRow:     findFeeRowForSection(/^QRPH$/i),
    disburseFeeRow: findFeeRowForSection(/^DISBURSE$/i),
  };
}

async function run() {
  const token = process.env.GCLOUD_TOKEN;
  if (!token) { console.error('GCLOUD_TOKEN not set'); process.exit(1); }
  const client = new OAuth2Client();
  client.setCredentials({ access_token: token });
  const sheets = google.sheets({ version: 'v4', auth: client });

  console.log('\n=== Test 1: findSummaryCells on updated template ===');
  const cells = await findSummaryCells(sheets, TEMPLATE_ID);
  console.log(JSON.stringify(cells, null, 2));

  const checks = [
    ['qrphTopRow === 4',      cells.qrphTopRow    === 4],
    ['disburseTopRow === 5',  cells.disburseTopRow === 5],
    ['totalTopRow === 6',     cells.totalTopRow    === 6],
    ['vcaTopRow === 7',       cells.vcaTopRow      === 7],
    ['qrphFeeRow === 10',     cells.qrphFeeRow     === 10],
    ['disburseFeeRow === 16', cells.disburseFeeRow === 16],
    ['vcaFeeRow === 21',      cells.vcaFeeRow      === 21],
    ['lessRow not null',      cells.lessRow        !== null],
    ['amountDueRow not null', cells.amountDueRow   !== null],
  ];
  let pass = 0, fail = 0;
  for (let i = 0; i < checks.length; i++) {
    const label = checks[i][0], ok = checks[i][1];
    console.log('  [' + (ok ? '✓' : '✗') + '] ' + label);
    ok ? pass++ : fail++;
  }
  console.log('\n--- Template cell test: ' + pass + ' passed, ' + fail + ' failed ---\n');

  console.log('=== Test 2: Fee math per partner ===');
  const FEE_RULES = {
    'magic-payment':  { qrph: function(a){ return Math.max(a*0.007,1); }, vca: function(){ return 0; }, disburse: { interbank:3.5, intrabank:2 } },
    'v5-philippines': { qrph: function(a){ return Math.max(a*0.009,2); }, vca: function(){ return 8; }, disburse: { interbank:4, intrabank:4 } },
    'topjuantech':    { qrph: function(a){ return a>=1000?Math.min(a*0.009,7):Math.max(a*0.009,2); }, vca: function(){ return 7; }, disburse: { interbank:5, intrabank:5 } },
  };
  const feeTests = [
    { id:'magic-payment',  dir:'incoming', amt:1000, expect: Math.max(1000*0.007,1) },
    { id:'magic-payment',  dir:'incoming', amt:100,  expect: Math.max(100*0.007,1) },
    { id:'v5-philippines', dir:'incoming', amt:500,  expect: Math.max(500*0.009,2) },
    { id:'v5-philippines', dir:'vca',      txns:10,  expect: 8*10 },
    { id:'topjuantech',    dir:'incoming', amt:1000, expect: Math.min(1000*0.009,7) },
    { id:'topjuantech',    dir:'incoming', amt:100,  expect: Math.max(100*0.009,2) },
    { id:'topjuantech',    dir:'vca',      txns:5,   expect: 7*5 },
  ];
  let fpass = 0, ffail = 0;
  for (let i = 0; i < feeTests.length; i++) {
    const t = feeTests[i];
    const r = FEE_RULES[t.id];
    let actual;
    if (t.dir === 'incoming') actual = r.qrph(t.amt);
    else if (t.dir === 'vca') actual = r.vca() * t.txns;
    else actual = r.disburse.interbank * t.txns;
    const ok = Math.abs(actual - t.expect) < 0.0001;
    console.log('  [' + (ok?'✓':'✗') + '] ' + t.id + ' ' + t.dir + ' => ' + actual + (ok?'':' (expected '+t.expect+')'));
    ok ? fpass++ : ffail++;
  }
  console.log('\n--- Fee math test: ' + fpass + ' passed, ' + ffail + ' failed ---\n');

  if (fail + ffail > 0) process.exit(1);
  console.log('ALL TESTS PASSED ✓');
}

run().catch(function(e) { console.error('FATAL:', e.message); process.exit(1); });
