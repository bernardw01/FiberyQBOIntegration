#!/usr/bin/env node
/**
 * Test harness — Fibery → QBO Invoice Creation (Make.com scenario 4590134)
 *
 * Sends live POST requests to the Make.com webhook and validates responses.
 * ⚠️  Hits PRODUCTION QuickBooks Online — delete any test invoices after use.
 *
 * Logs are written to test/logs/run-YYYYMMDD-HHmmss.log and test/logs/latest.log
 *
 * Usage:
 *   node test/test-webhook.js           run all tests (live)
 *   node test/test-webhook.js --dry     print payloads only, no requests sent
 *   node test/test-webhook.js --case 1  run a single test case by number (1-based)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load .env ─────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    die('.env not found — copy .env.example to .env and fill in values.');
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).replace(/\s*#.*$/, '').trim();
    if (key && val && !process.env[key]) process.env[key] = val;
  }
}

// ── Logger ────────────────────────────────────────────────────────────────────
// Tees all output to stdout and a timestamped log file in test/logs/.

function createLogger() {
  const logsDir  = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const ts       = new Date().toISOString().replace(/[:.]/g, '-').replace('T', 'T').slice(0, 19);
  const runFile  = path.join(logsDir, `run-${ts}.log`);
  const latest   = path.join(logsDir, 'latest.log');
  const stream   = fs.createWriteStream(runFile, { flags: 'w' });

  function write(line) {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    console.log(line);
    stream.write(stamped + '\n');
  }

  function close() {
    return new Promise(resolve => {
      stream.end(() => {
        fs.copyFileSync(runFile, latest);
        resolve();
      });
    });
  }

  return { write, close, runFile };
}

// ── Config ────────────────────────────────────────────────────────────────────

loadEnv();

const WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL_QBO;
const DRY_RUN     = process.argv.includes('--dry');
const caseArg     = process.argv.indexOf('--case');
const ONLY_CASE   = caseArg !== -1 ? parseInt(process.argv[caseArg + 1], 10) - 1 : null;

if (!WEBHOOK_URL) die('MAKE_WEBHOOK_URL_QBO not set in .env');

const today = new Date().toISOString().split('T')[0];

// ── Test cases ────────────────────────────────────────────────────────────────
//
// Seed record sourced from Fibery → Agreement Management/Revenue Item
//   Fibery ID  : 12befbd0-f4cb-11f0-8199-7b964ee4d88a
//   Record     : LeadWhisper - Combined SOWs (PCL) - SOW 20 (Order Form 5): Month 2: (Jan 1 - Jan 31, 2026)
//   Agreement  : LeadWhisper - Combined SOWs (PCL)
//   Customer   : Princess Cruise Lines (QBO ID: 71)
//   Amount     : $13,600
//   Contact    : Astokes@princesscruises.com
//
// Other QBO Customer IDs (production):
//   298  Internal harpin          ← safe for throwaway tests
//   309  Travel + Leisure Operations, Inc.
//   319  Sycuan Casino Resort
//
// ⚠️  All test invoices created here are REAL. Delete them in QBO after validating.

const TESTS = [
  // ── 1 ── Real Fibery record — full payload ───────────────────────────────────
  //   Fibery Revenue Item: 12befbd0-f4cb-11f0-8199-7b964ee4d88a
  //   Validates exact data shape that will be sent from the Fibery JS automation.
  {
    name: 'Real Fibery record — LeadWhisper SOW 20 / Princess Cruise Lines',
    payload: {
      qboCustomerId:   '71',
      amount:          13600.00,
      revenueItemName: 'TEST - LeadWhisper - Combined SOWs (PCL) - SOW 20 (Order Form 5): Month 2: (Jan 1 - Jan 31, 2026)',
      invoiceDate:     '2026-01-01',
      contactEmail:    'Astokes@princesscruises.com',
      memo:            'TEST | Agreement: LeadWhisper - Combined SOWs (PCL) | Milestone: SOW 20 (Order Form 5): Month 2: (Jan 1 - Jan 31, 2026)',
    },
    expect: { success: true, hasInvoiceId: true, hasDocNumber: true, hasInvoiceUrl: true, invoiceStatus: 'Open' },
  },

  // ── 2 ── Safe throwaway — full payload (Internal harpin) ────────────────────
  //   Use this for repeated testing — Internal harpin invoices are safe to delete.
  {
    name: 'Safe test — full payload (Internal harpin)',
    payload: {
      qboCustomerId:   '298',
      amount:          100.00,
      revenueItemName: 'TEST - Fibery QBO Integration - Delete Me',
      invoiceDate:     today,
      contactEmail:    'info@godeap.io',
      memo:            'TEST INVOICE — Fibery QBO integration validation. Safe to delete.',
    },
    expect: { success: true, hasInvoiceId: true, hasDocNumber: true, hasInvoiceUrl: true, invoiceStatus: 'Open' },
  },

  // ── 3 ── Minimal required fields — no email or memo ─────────────────────────
  {
    name: 'Minimal payload — required fields only, no email or memo',
    payload: {
      qboCustomerId:   '298',
      amount:          50.00,
      revenueItemName: 'TEST - Minimal Payload - Delete Me',
      invoiceDate:     today,
    },
    expect: { success: true, hasInvoiceId: true, hasDocNumber: true, hasInvoiceUrl: true, invoiceStatus: 'Open' },
  },

  // ── 4 ── Missing customer ID — should cause Make.com / QBO to error ─────────
  {
    name: 'Error case — missing qboCustomerId',
    payload: {
      amount:          100.00,
      revenueItemName: 'TEST - No Customer - Should Fail',
      invoiceDate:     today,
      contactEmail:    'info@godeap.io',
      memo:            'TEST — expected to fail',
    },
    expect: { success: false },
  },

  // ── 5 ── Invalid customer ID — QBO should reject it ─────────────────────────
  {
    name: 'Error case — invalid qboCustomerId (999999)',
    payload: {
      qboCustomerId:   '999999',
      amount:          100.00,
      revenueItemName: 'TEST - Bad Customer ID - Should Fail',
      invoiceDate:     today,
      contactEmail:    'info@godeap.io',
      memo:            'TEST — expected to fail',
    },
    expect: { success: false },
  },
];

// ── Assertions ────────────────────────────────────────────────────────────────

function assert(log, results, condition, passMsg, failMsg) {
  if (condition) {
    log(`    ✅  ${passMsg}`);
    results.passed++;
  } else {
    log(`    ❌  ${failMsg}`);
    results.failed++;
  }
}

function validateResponse(log, results, body, expect) {
  if (expect.success !== undefined) {
    assert(log, results,
      body.success === expect.success,
      `success === ${expect.success}`,
      `expected success=${expect.success}, got ${JSON.stringify(body.success)}`
    );
  }
  if (expect.hasInvoiceId) {
    assert(log, results,
      !!body.qboInvoiceId,
      `qboInvoiceId present: ${body.qboInvoiceId}`,
      'qboInvoiceId missing or null'
    );
  }
  if (expect.hasDocNumber) {
    assert(log, results,
      !!body.qboInvoiceNumber,
      `qboInvoiceNumber present: ${body.qboInvoiceNumber}`,
      'qboInvoiceNumber missing or null'
    );
  }
  if (expect.hasInvoiceUrl) {
    const hasCorrectRealmId = body.qboInvoiceUrl && body.qboInvoiceUrl.includes('9130350984043716');
    assert(log, results, !!body.qboInvoiceUrl, `qboInvoiceUrl present`, 'qboInvoiceUrl missing or null');
    assert(log, results, hasCorrectRealmId, `qboInvoiceUrl contains correct Realm ID`, `qboInvoiceUrl has wrong Realm ID: ${body.qboInvoiceUrl}`);
  }
  if (expect.invoiceStatus) {
    assert(log, results,
      body.qboInvoiceStatus === expect.invoiceStatus,
      `qboInvoiceStatus === "${expect.invoiceStatus}"`,
      `expected status="${expect.invoiceStatus}", got "${body.qboInvoiceStatus}"`
    );
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function runTest(log, results, tc, index) {
  const num = index + 1;
  log(`\n${'─'.repeat(60)}`);
  log(`Test ${num}: ${tc.name}`);
  log(`${'─'.repeat(60)}`);
  log('  Payload:');
  for (const [k, v] of Object.entries(tc.payload)) {
    log(`    ${k.padEnd(20)} ${v}`);
  }

  if (DRY_RUN) {
    log('\n  ℹ️   DRY RUN — no request sent');
    results.skipped++;
    return { skipped: true };
  }

  let res, body;
  const start = Date.now();
  try {
    res  = await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(tc.payload),
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    log(`\n  ❌  Request failed: ${err.message}`);
    results.failed++;
    return { error: err.message };
  }

  const ms = Date.now() - start;
  log(`\n  HTTP Status : ${res.status} (${ms}ms)`);
  log(`  Raw response: ${JSON.stringify(body)}`);
  log('\n  Response (formatted):');
  log('  ' + JSON.stringify(body, null, 2).replace(/\n/g, '\n  '));

  log('\n  Assertions:');
  validateResponse(log, results, body, tc.expect);

  if (body.qboInvoiceId) {
    log(`\n  ⚠️   Real invoice created — delete it in QBO:`);
    log(`       ${body.qboInvoiceUrl}`);
    results.invoicesCreated.push({ id: body.qboInvoiceId, url: body.qboInvoiceUrl, test: tc.name });
  }

  return body;
}

async function main() {
  const logger  = createLogger();
  const { write: log, close, runFile } = logger;

  const results = { passed: 0, failed: 0, skipped: 0, invoicesCreated: [] };

  log('═'.repeat(60));
  log('  Fibery → QBO Invoice Creation — Webhook Test Harness');
  log('═'.repeat(60));
  log(`  Webhook : ${WEBHOOK_URL}`);
  log(`  Mode    : ${DRY_RUN ? 'DRY RUN (no requests)' : 'LIVE — hits production QBO'}`);
  log(`  Log     : ${runFile}`);
  if (ONLY_CASE !== null) log(`  Filter  : test case ${ONLY_CASE + 1} only`);
  if (!DRY_RUN) {
    log('\n  ⚠️   WARNING: Live mode creates real invoices in QuickBooks Online.');
    log('       Delete all TEST invoices after validating.');
    log('       Tip: run with --dry first to preview payloads.');
  }

  const cases = ONLY_CASE !== null ? [[TESTS[ONLY_CASE], ONLY_CASE]] : TESTS.map((t, i) => [t, i]);

  for (const [tc, i] of cases) {
    if (!tc) { log(`\nNo test case ${ONLY_CASE + 1}`); break; }
    await runTest(log, results, tc, i);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  log('\n' + '═'.repeat(60));
  log('  Summary');
  log('─'.repeat(60));
  log(`  Passed   : ${results.passed}`);
  log(`  Failed   : ${results.failed}`);
  if (results.skipped) log(`  Skipped  : ${results.skipped}`);
  if (results.invoicesCreated.length) {
    log('\n  QBO invoices created during this run (delete these):');
    for (const inv of results.invoicesCreated) {
      log(`    [${inv.id}] ${inv.test}`);
      log(`            ${inv.url}`);
    }
  }
  log('─'.repeat(60));
  log(`  Log saved : ${runFile}`);
  log(`  Latest    : ${path.join(path.dirname(runFile), 'latest.log')}`);
  log('═'.repeat(60) + '\n');

  await close();
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
