/**
 * Billing Console unit tests — no live API needed.
 * Run: node test-unit.js
 */
'use strict';

let PASS = 0, FAIL = 0;
function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log('  [' + (ok ? '✓' : '✗') + '] ' + label +
    (ok ? '' : '\n       got:      ' + JSON.stringify(actual) +
               '\n       expected: ' + JSON.stringify(expected)));
  ok ? PASS++ : FAIL++;
}
function section(name) { console.log('\n=== ' + name + ' ==='); }

// ─────────────────────────────────────────────────────────
// findSummaryCells — identical logic to server.js
// ─────────────────────────────────────────────────────────
function findSummaryCells_fromRows(rows) {
  const find = function(re, start) {
    start = start || 0;
    for (let i = start; i < rows.length; i++)
      if (re.test(String((rows[i] || [])[0] || '').trim())) return i + 1;
    return null;
  };
  const findAll = function(re) {
    const res = [];
    for (let i = 0; i < rows.length; i++)
      if (re.test(String((rows[i] || [])[0] || '').trim())) res.push(i + 1);
    return res;
  };
  const feeDetailRows = findAll(/^TOTAL AMOUNT TO BILL/i);
  const findFeeRowForSection = function(sectionRe) {
    for (let f = 0; f < feeDetailRows.length; f++) {
      const feeRow = feeDetailRows[f];
      const feeIdx = feeRow - 1;
      for (let j = feeIdx - 1; j >= Math.max(0, feeIdx - 5); j--) {
        if (!sectionRe.test(String((rows[j] || [])[0] || '').trim())) continue;
        const dist = feeIdx - j;
        const colC = String((rows[j] || [])[2] || '').trim();
        if (dist <= 2 || /applicable fee/i.test(colC)) return feeRow;
      }
    }
    return null;
  };
  const reconRow = find(/^reconciliation\b/i);
  const lessRow  = find(/less previously charged/i);
  return {
    qrphTopRow:     find(/^QRPH$/i),
    disburseTopRow: find(/^DISBURSE$/i),
    vcaTopRow:      find(/^VCA$/i),
    totalTopRow:    find(/^TOTAL$/i),
    lessRow:        lessRow,
    amountDueRow:   find(/^amount due\b/i),
    periodTopRow:   find(/billing period/i),
    periodReconRow: reconRow ? find(/billing period/i, reconRow) : null,
    vcaFeeRow:      findFeeRowForSection(/^VCA$/i),
    qrphFeeRow:     findFeeRowForSection(/^QRPH$/i),
    disburseFeeRow: findFeeRowForSection(/^DISBURSE$/i),
    subPeriodRows:  lessRow ? [lessRow + 1, lessRow + 2, lessRow + 3] : [],
  };
}

// Mock SUMMARY tab rows (matches our updated template):
// - Row 4: QRPH (top), Row 5: DISBURSE (top), Row 6: TOTAL (top), Row 7: VCA (top, added by us)
// - Row 9: QRPH section header, Row 10: TOTAL AMOUNT TO BILL (qrph fee)
// - Row 15: DISBURSE section header, Row 16: TOTAL AMOUNT TO BILL (disburse fee)
// - Row 22: VCA section header (added by us), Row 23: TOTAL AMOUNT TO BILL (vca fee)
const TEMPLATE_ROWS = [
  ['MAGICPAYMENT BILLING REPORT'],       // row 1
  ['[Billing Period e.g. May 23, 2026]'],// row 2  ← periodTopRow
  [],                                     // row 3
  ['QRPH', '0.00'],                       // row 4  ← qrphTopRow
  ['DISBURSE', '0.00'],                   // row 5  ← disburseTopRow
  ['TOTAL', '0.00'],                      // row 6  ← totalTopRow
  ['VCA', '0.00'],                        // row 7  ← vcaTopRow
  [],                                     // row 8
  ['QRPH', '', 'Applicable Fee'],         // row 9  — QRPH detail header
  ['TOTAL AMOUNT TO BILL', '0.00'],       // row 10 ← qrphFeeRow
  ['TOTAL COUNTS', '0'],                  // row 11
  ['TOTAL VOLUME', '0.00'],               // row 12
  [],                                     // row 13
  [],                                     // row 14
  ['DISBURSE', '', 'Applicable Fee'],     // row 15 — DISBURSE detail header
  ['TOTAL AMOUNT TO BILL', '0.00'],       // row 16 ← disburseFeeRow
  ['TOTAL COUNTS', '0'],                  // row 17
  ['TOTAL VOLUME', '0.00'],               // row 18
  [],                                     // row 19
  [],                                     // row 20
  [],                                     // row 21
  ['VCA', '', 'Applicable Fee'],          // row 22 — VCA detail header
  ['TOTAL AMOUNT TO BILL', '0.00', '0.00'], // row 23 ← vcaFeeRow
  ['TOTAL COUNTS', '0'],                  // row 24
  ['TOTAL VOLUME', '0.00'],               // row 25
  [],                                     // row 26
  ['RECONCILIATION'],                     // row 27
  ['[Billing Period]'],                   // row 28 ← periodReconRow
  ['QRPH', '', '0.00'],                   // row 29
  ['DISBURSE', '', '0.00'],               // row 30
  ['TOTAL', '', '0.00'],                  // row 31
  [],                                     // row 32
  ['Less Previously Charged', '', '0'],   // row 33 ← lessRow
  ['[Sub-period 1]', ''],                 // row 34
  ['[Sub-period 2]', ''],                 // row 35
  ['[Sub-period 3]', ''],                 // row 36
  [],                                     // row 37
  ['AMOUNT DUE', '', '0.00'],             // row 38 ← amountDueRow
];

section('Test 1: findSummaryCells on updated template mock');
const cells = findSummaryCells_fromRows(TEMPLATE_ROWS);
assert('qrphTopRow === 4',       cells.qrphTopRow,    4);
assert('disburseTopRow === 5',   cells.disburseTopRow, 5);
assert('totalTopRow === 6',      cells.totalTopRow,    6);
assert('vcaTopRow === 7',        cells.vcaTopRow,      7);
assert('qrphFeeRow === 10',      cells.qrphFeeRow,    10);
assert('disburseFeeRow === 16',  cells.disburseFeeRow, 16);
assert('vcaFeeRow === 23',       cells.vcaFeeRow,      23);
assert('lessRow === 33',         cells.lessRow,        33);
assert('amountDueRow === 38',    cells.amountDueRow,   38);
assert('subPeriodRows',          cells.subPeriodRows, [34, 35, 36]);
assert('hasVca',                 cells.vcaFeeRow !== null, true);

// ─────────────────────────────────────────────────────────
// amtIdx detection
// ─────────────────────────────────────────────────────────
section('Test 2: amtIdx dynamic detection from sourceHeader');
function detectAmtIdx(sourceHeader, direction) {
  const i = sourceHeader.findIndex(function(h){ return /^cbs_amount_inward$/i.test(String(h||'')); });
  if (i >= 0) return i;
  const j = sourceHeader.findIndex(function(h){ return /^amount$/i.test(String(h||'')); });
  if (j >= 0) return j;
  return direction === 'outgoing' ? 4 : 3;
}
const magicHdr = ['Merchant code','Merchant name','Receiving branch name','Amount','Status','Transfer mode','Reference no'];
const v5Hdr    = ['source_file','branch_id','branch_name','account_name','channel','provider_reference_no','cbs_amount_inward','status'];
assert('Magic incoming amtIdx',  detectAmtIdx(magicHdr, 'incoming'), 3);
assert('Magic outgoing amtIdx',  detectAmtIdx(magicHdr, 'outgoing'), 3);
assert('V5 incoming amtIdx',     detectAmtIdx(v5Hdr,    'incoming'), 6);
assert('V5 vca amtIdx',          detectAmtIdx(v5Hdr,    'vca'),      6);
assert('V5 outgoing amtIdx',     detectAmtIdx(v5Hdr,    'outgoing'), 6);

// ─────────────────────────────────────────────────────────
// modeIdx detection
// ─────────────────────────────────────────────────────────
section('Test 3: modeIdx from sourceHeader (not tplHeader)');
function detectModeIdx(sourceHeader) {
  return sourceHeader.findIndex(function(h){ return /transfer\s*mode/i.test(String(h||'')); });
}
assert('Magic has Transfer mode at idx 5', detectModeIdx(magicHdr), 5);
assert('V5 has no Transfer mode → -1',     detectModeIdx(v5Hdr),   -1);

// ─────────────────────────────────────────────────────────
// Fee math
// ─────────────────────────────────────────────────────────
section('Test 4: Fee math per partner');
function round2(n) { return Math.round(n * 100) / 100; }
const FEE = {
  'magic-payment':  { qrph: function(a){ return Math.max(a*0.007,1); },     vca: function(){ return 0; }, disburse:{interbank:3.5,intrabank:2}   },
  'hopay':          { qrph: function(a){ return Math.min(Math.max(a*0.007,1),7); }, vca: function(){ return 0; }, disburse:{interbank:3.5,intrabank:3.5} },
  'v5-philippines': { qrph: function(a){ return Math.max(a*0.009,2); },     vca: function(){ return 8; }, disburse:{interbank:4,intrabank:4}     },
  'topjuantech':    { qrph: function(a){ return a>=1000?Math.min(a*0.009,7):Math.max(a*0.009,2); }, vca: function(){ return 7; }, disburse:{interbank:5,intrabank:5} },
};
assert('magic qrph(1000) = 7',      round2(FEE['magic-payment'].qrph(1000)), 7);
assert('magic qrph(100) = 1 floor', round2(FEE['magic-payment'].qrph(100)),  1);
assert('magic qrph(200) = 1.4',     round2(FEE['magic-payment'].qrph(200)),  1.4);
assert('magic vca = 0',             FEE['magic-payment'].vca(),               0);
assert('magic interbank = 3.5',     FEE['magic-payment'].disburse.interbank,  3.5);
assert('magic intrabank = 2',       FEE['magic-payment'].disburse.intrabank,  2);
assert('hopay capped at 7',         round2(FEE['hopay'].qrph(2000)),          7);
assert('v5 qrph(500) = 4.5',        round2(FEE['v5-philippines'].qrph(500)),  4.5);
assert('v5 qrph(100) = 2 floor',    round2(FEE['v5-philippines'].qrph(100)),  2);
assert('v5 vca = 8/txn',            FEE['v5-philippines'].vca(),               8);
assert('v5 disburse = 4',           FEE['v5-philippines'].disburse.interbank,  4);
assert('topjuan qrph(1000) cap=7',  round2(FEE['topjuantech'].qrph(1000)),    7);
assert('topjuan qrph(500) = 4.5',   round2(FEE['topjuantech'].qrph(500)),     4.5);
assert('topjuan qrph(100) = 2',     round2(FEE['topjuantech'].qrph(100)),     2);
assert('topjuan vca = 7/txn',       FEE['topjuantech'].vca(),                  7);
assert('topjuan disburse = 5',      FEE['topjuantech'].disburse.interbank,     5);

// ─────────────────────────────────────────────────────────
// CBS row filter
// ─────────────────────────────────────────────────────────
section('Test 5: CBS row filter (SETTLED + product code)');
function filterRows(rows, header, filters) {
  return rows.filter(function(row) {
    return filters.every(function(f) {
      const cols = [f.column].concat(f.altColumns || []);
      return cols.some(function(col) {
        let idx;
        if (typeof col === 'number') idx = col;
        else idx = header.findIndex(function(h){ return String(h||'').trim().toLowerCase() === String(col||'').toLowerCase(); });
        if (idx < 0) return false;
        const val = String(row[idx] || '');
        const eq  = String(f.equals || '');
        return f.caseSensitive === false ? val.toLowerCase() === eq.toLowerCase() : val === eq;
      });
    });
  });
}

// Magic CBS: header columns match header array positions
const magicRows = [
  // [Merchant code, Merchant name, Receiving branch, Amount, Status, Transfer mode, Ref]
  ['V5PH001', 'V5 Philippines', 'Branch A', '500', 'SETTLED',  'QR_P2M', 'REF001'],
  ['V5PH001', 'V5 Philippines', 'Branch A', '300', 'PENDING',  'QR_P2M', 'REF002'],
  ['MAGIC001', 'Magic Payment', 'Branch B', '200', 'SETTLED',  'QR_P2M', 'REF003'],
  ['V5PH001', 'V5 Philippines', 'Branch A', '400', 'SETTLED',  'P2P',    'REF004'],
];
const filteredMagic = filterRows(magicRows, magicHdr, [
  { column: 'Merchant code', equals: 'V5PH001' },
  { column: 'Status', equals: 'SETTLED', caseSensitive: false },
]);
assert('Magic filter V5PH001 SETTLED count = 2', filteredMagic.length, 2);
assert('Magic filter excludes PENDING',  filteredMagic.some(function(r){ return r[4]==='PENDING'; }), false);
assert('Magic filter excludes MAGIC001', filteredMagic.some(function(r){ return r[0]==='MAGIC001'; }), false);
assert('Magic P2P row included (VCA)',   filteredMagic.some(function(r){ return r[5]==='P2P'; }), true);

// V5/TopJuan CBS: product code in branch_id (altColumns)
const v5Rows = [
  // [source_file, branch_id, branch_name, account_name, channel, ref, cbs_amount_inward, status]
  ['2026-06-01', 'V5PH001', 'Branch X', 'John',  'QRPH', 'REF1', '1000', 'settled'],
  ['2026-06-01', 'TOPJUAN', 'Branch Y', 'Jane',  'QRPH', 'REF2', '500',  'settled'],
  ['2026-06-01', 'V5PH001', 'Branch X', 'Alice', 'QRPH', 'REF3', '200',  'SETTLED'],
  ['2026-06-01', 'V5PH001', 'Branch X', 'Bob',   'QRPH', 'REF4', '300',  'PENDING'],
];
const filteredV5 = filterRows(v5Rows, v5Hdr, [
  { column: 'A', altColumns: ['branch_id'], equals: 'V5PH001' },
  { column: 'Status', altColumns: ['status'], equals: 'SETTLED', caseSensitive: false },
]);
assert('V5 branch_id filter count = 2',   filteredV5.length, 2);
assert('V5 cbs_amount_inward idx=6 first', Number(filteredV5[0][6]), 1000);
assert('V5 excludes TOPJUAN',             filteredV5.some(function(r){ return r[1]==='TOPJUAN'; }), false);
assert('V5 excludes PENDING',             filteredV5.some(function(r){ return r[7]==='PENDING'; }), false);

// ─────────────────────────────────────────────────────────
// grandTotal with VCA
// ─────────────────────────────────────────────────────────
section('Test 6: grandTotal includes vcaTotalFee');
const qrphFee    = round2(45.50);
const disburseFee = round2(28.00);
const vcaFee_v5  = round2(8 * 10);  // 10 VCA txns @ PHP 8
const grandV5    = round2(qrphFee + disburseFee + vcaFee_v5);
assert('V5 grandTotal = 153.5', grandV5, 153.5);

const vcaFee_magic = 0;
const grandMagic = round2(qrphFee + disburseFee + vcaFee_magic);
assert('Magic grandTotal = 73.5 (no VCA)', grandMagic, 73.5);

const vcaFee_topjuan = round2(7 * 5); // 5 VCA txns @ PHP 7
assert('TopJuan vcaFee = 35',  vcaFee_topjuan, 35);

// ─────────────────────────────────────────────────────────
// V5 Philippines full filter spec verification
// ─────────────────────────────────────────────────────────
section('Test 7: V5 Philippines filter spec — QRPH, VCA, DISBURSE');

// Full-featured filter (mirrors server.js getMatchedRows logic)
function fullFilterRows(rows, header, filters) {
  function resolveIdx(col, hdr) {
    return hdr.findIndex(function(h) { return String(h||'').trim().toLowerCase() === String(col||'').trim().toLowerCase(); });
  }
  function resolved(f) {
    const cols = [f.column].concat(f.altColumns || []);
    for (var i = 0; i < cols.length; i++) {
      const idx = resolveIdx(cols[i], header);
      if (idx >= 0) return Object.assign({}, f, { index: idx });
    }
    return Object.assign({}, f, { index: -1 });
  }
  const rf = filters.map(resolved);
  return rows.filter(function(row) {
    return rf.every(function(f) {
      if (f.index < 0) return true; // column not found — skip filter (safe)
      const raw = String(row[f.index] === null || row[f.index] === undefined ? '' : row[f.index]).trim();
      const val = f.caseSensitive === false ? raw.toLowerCase() : raw;
      if (f.equals !== undefined) {
        const eq = f.caseSensitive === false ? String(f.equals).toLowerCase() : String(f.equals);
        return val === eq;
      }
      if (f.notEquals !== undefined) {
        const ne = f.caseSensitive === false ? String(f.notEquals).toLowerCase() : String(f.notEquals);
        return val !== ne;
      }
      if (f.includeValues) {
        return f.includeValues.some(function(v) {
          const cv = f.caseSensitive === false ? String(v).toLowerCase() : String(v);
          return val === cv;
        });
      }
      if (f.excludeValues) {
        return !f.excludeValues.some(function(v) {
          const cv = f.caseSensitive === false ? String(v).toLowerCase() : String(v);
          return val === cv;
        });
      }
      return true;
    });
  });
}

// Incoming CBS header (real column names from Cloud Run logs)
const v5IncomingHdr = [
  'Receiving branch name','Channel','Reference number','Amount','Status','Reason',
  'Recipient account number','Sender account number','Sender institution name',
  'Sender institution code','Sender name','Reference label','Store label','Batch ID',
  'Remarks (title)','Full recipient number (if alias used)',
  'Transfer reference code (if alias used)','Operation ID',
  'Registration time (Real Time)','Transaction Id','Transfer mode','Provider Status'
];
const V5CODE = '(Prod)b8994d97-dc38-4dea-9eea-2bad9f6eaf21';
// Indexes (0-based):  0=branch,1=Channel,4=Status,5=Reason,16=TransRefCode,20=TransferMode

const v5IncomingRows = [
  // [branch, Channel, ...skip..., Status, Reason, ...skip..., TransRefCode, ...skip..., TransferMode, ...]
  [V5CODE, 'Instapay', '', '', 'SETTLED',  '',                   '', '', '', '', '', '', '', '', '', '', 'REF001', '', '', '', 'QR_P2M',  ''],  // QRPH ✓
  [V5CODE, 'Instapay', '', '', 'SETTLED',  '',                   '', '', '', '', '', '', '', '', '', '', 'REF002', '', '', '', 'P2P',     ''],  // VCA ✓
  [V5CODE, 'Instapay', '', '', 'SETTLED',  'Some reason',        '', '', '', '', '', '', '', '', '', '', 'REF003', '', '', '', 'P2P',     ''],  // VCA ✓ (Reason=ALL)
  [V5CODE, 'Instapay', '', '', 'SETTLED',  '',                   '', '', '', '', '', '', '', '', '', '', '',       '', '', '', 'P2P',     ''],  // VCA ✗ (blank ref code)
  [V5CODE, 'Instapay', '', '', 'SETTLED',  '',                   '', '', '', '', '', '', '', '', '', '', 'REF005', '', '', '', 'QR_P2P',  ''],  // VCA ✓
  [V5CODE, 'Instapay', '', '', 'REJECTED', '',                   '', '', '', '', '', '', '', '', '', '', 'REF006', '', '', '', 'QR_P2M',  ''],  // excluded (REJECTED)
  ['OTHER', 'Instapay','', '', 'SETTLED',  '',                   '', '', '', '', '', '', '', '', '', '', 'REF007', '', '', '', 'QR_P2M',  ''],  // excluded (wrong branch)
  [V5CODE, 'PESONET',  '', '', 'SETTLED',  '',                   '', '', '', '', '', '', '', '', '', '', 'REF008', '', '', '', 'P2P',     ''],  // excluded from QRPH/VCA (PESONET)
];

// QRPH filter
const qrphFilters = [
  { column: 'Receiving branch name', altColumns: ['branch_id'], equals: V5CODE },
  { column: 'Status', altColumns: ['status'], equals: 'SETTLED', caseSensitive: false },
  { column: 'channel', altColumns: ['Channel'], equals: 'INSTAPAY', caseSensitive: false },
  { column: 'transfer_mode', altColumns: ['Transfer mode', 'transfer mode', 'Transfer Mode'], equals: 'QR_P2M', caseSensitive: false },
];
const qrphResult = fullFilterRows(v5IncomingRows, v5IncomingHdr, qrphFilters);
assert('QRPH: matched=1 (QR_P2M SETTLED INSTAPAY)', qrphResult.length, 1);
assert('QRPH: no REJECTED rows', qrphResult.every(function(r){ return r[4]==='SETTLED'; }), true);
assert('QRPH: all QR_P2M', qrphResult.every(function(r){ return r[20]==='QR_P2M'; }), true);

// VCA filter
const vcaFilters = [
  { column: 'Receiving branch name', altColumns: ['branch_id'], equals: V5CODE },
  { column: 'Status', altColumns: ['status'], equals: 'SETTLED', caseSensitive: false },
  { column: 'channel', altColumns: ['Channel'], equals: 'INSTAPAY', caseSensitive: false },
  { column: 'transfer_mode', altColumns: ['Transfer mode', 'transfer mode', 'Transfer Mode'], includeValues: ['P2P', 'QR_P2P'], caseSensitive: false },
  { column: 'Transfer reference code (if alias used)', altColumns: ['transfer_reference_code'], notEquals: '', caseSensitive: false },
];
const vcaResult = fullFilterRows(v5IncomingRows, v5IncomingHdr, vcaFilters);
assert('VCA: matched=3 (P2P+QR_P2P with non-blank ref, Reason=ALL)', vcaResult.length, 3);
assert('VCA: all SETTLED', vcaResult.every(function(r){ return r[4]==='SETTLED'; }), true);
assert('VCA: all P2P or QR_P2P', vcaResult.every(function(r){ return r[20]==='P2P' || r[20]==='QR_P2P'; }), true);
assert('VCA: all non-blank ref code', vcaResult.every(function(r){ return r[16] !== ''; }), true);
assert('VCA: includes row with non-blank Reason (Reason=ALL)', vcaResult.some(function(r){ return r[5] !== ''; }), true);
assert('VCA: excludes blank ref code row', vcaResult.some(function(r){ return r[16] === '' && r[20] === 'P2P'; }), false);

// Outgoing CBS header (real column names from logs)
const v5OutgoingHdr = [
  'Sending branch name','Channel','Provider reference number','Reference number','Amount',
  'Status','Reason','Sender account number','Recipient account number',
  'Recipient institution name','Recipient institution code','Recipient name',
  'Batch ID','Remarks (title)','Registration time (Real Time)','Transaction Id',
  'Success status code','Transfer mode','Provider Status'
];
// Indexes: 0=branch,1=Channel,5=Status,6=Reason,17=TransferMode,18=ProviderStatus

const v5OutgoingRows = [
  [V5CODE, 'Instapay', '', '', '', 'SETTLED',  '',                          '', '', '', '', '', '', '', '', '', '', 'P2P',    'PROCESSING_OK (DS07)'],  // ✓ billed
  [V5CODE, 'Instapay', '', '', '', 'SETTLED',  '',                          '', '', '', '', '', '', '', '', '', '', 'P2P',    'PROCESSING_OK (DS07)'],  // ✓ billed
  [V5CODE, 'Instapay', '', '', '', 'SETTLED',  'AC01 (Incorrect account)',  '', '', '', '', '', '', '', '', '', '', 'P2P',    'AC01'],                  // ✓ billed (Reason=ALL)
  [V5CODE, 'Instapay', '', '', '', 'SETTLED',  'AC06 (Blocked account)',    '', '', '', '', '', '', '', '', '', '', 'P2P',    'BLOCKED_ACCOUNT (AC06)'], // ✓ billed (Reason=ALL)
  [V5CODE, 'Instapay', '', '', '', 'REJECTED', '',                          '', '', '', '', '', '', '', '', '', '', 'P2P',    'AC01'],                  // ✗ excluded (REJECTED)
  [V5CODE, 'PESONET',  '', '', '', 'SETTLED',  '',                          '', '', '', '', '', '', '', '', '', '', 'P2P',    'PROCESSING_OK (DS07)'],  // ✓ billed (PESONET included)
  ['OTHER','Instapay', '', '', '', 'SETTLED',  '',                          '', '', '', '', '', '', '', '', '', '', 'P2P',    'PROCESSING_OK (DS07)'],  // ✗ excluded (wrong branch)
];

const disburseFilters = [
  { column: 'Sending branch name', altColumns: ['branch_id'], equals: V5CODE },
  { column: 'Status', altColumns: ['status'], equals: 'SETTLED', caseSensitive: false },
];
const disburseResult = fullFilterRows(v5OutgoingRows, v5OutgoingHdr, disburseFilters);
assert('DISBURSE: matched=5 (SETTLED, Reason=ALL, INSTAPAY+PESONET)', disburseResult.length, 5);
assert('DISBURSE: all SETTLED', disburseResult.every(function(r){ return r[5]==='SETTLED'; }), true);
assert('DISBURSE: includes AC01 Reason row (Reason=ALL)', disburseResult.some(function(r){ return r[6].includes('AC01'); }), true);
assert('DISBURSE: includes AC06 Reason row (Reason=ALL)', disburseResult.some(function(r){ return r[6].includes('AC06'); }), true);
assert('DISBURSE: includes PESONET rows', disburseResult.some(function(r){ return r[1]==='PESONET'; }), true);
assert('DISBURSE: excludes REJECTED', disburseResult.every(function(r){ return r[5]==='SETTLED'; }), true);
assert('DISBURSE: excludes wrong branch', disburseResult.every(function(r){ return r[0]===V5CODE; }), true);

// ─────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log('TOTAL: ' + PASS + ' passed, ' + FAIL + ' failed');
if (FAIL > 0) { console.log('\n✗ SOME TESTS FAILED'); process.exit(1); }
else { console.log('\n✓ ALL TESTS PASSED'); }
