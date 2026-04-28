/**
 * Fibery Button Action — Create QBO Invoice
 *
 * Database : Agreement Management / Revenue Item
 * Trigger  : Button click on a single Revenue Item record
 *
 * What it does:
 *   1. Reads the current Revenue Item and its related Agreement / Customer / Contact
 *   2. POSTs to the Make.com webhook, which creates an invoice in QuickBooks Online
 *   3. Writes the returned QBO Invoice ID and URL back to the Revenue Item
 *   4. Moves the record to the "Invoiced" workflow state on success,
 *      or writes the error message to "Invoice Error" on failure
 *
 * Workflow state IDs (Agreement Management/Revenue Item):
 *   Invoiced  : 318a8547-599c-4e20-a024-e1933fcad16e
 *   (other states are not changed by this script)
 */
const fibery = context.getService('fibery');
const http   = context.getService('http');

const WEBHOOK_URL = 'https://hook.us2.make.com/53yd3ufqjmcktqt6g774qgexnyorts2q';

const WORKFLOW_STATE_INVOICED = '318a8547-599c-4e20-a024-e1933fcad16e';

// ── 1. Get current entity ─────────────────────────────────────────────────────
// Fibery automation passes entity fields using short names (no namespace prefix).

const [entity] = args.currentEntities;
const name           = entity['Name'];
const milestoneTitle = entity['Milestone Title'];
const targetAmount   = entity['Target Amount'];
const targetDate     = entity['Target Date'];
const qboCustomerId  = entity['Agreement Customer QBO Customer ID'];

// Agreement name: the Name formula is "AgreementName - MilestoneTitle"
const agreementName = (milestoneTitle && name)
  ? name.slice(0, name.lastIndexOf(` - ${milestoneTitle}`))
  : (name || '');

console.log('[1] entityId:', entity['Id']);
console.log('[1] name:', name);
console.log('[1] milestoneTitle:', milestoneTitle);
console.log('[1] targetAmount:', targetAmount, '| targetDate:', targetDate);
console.log('[1] qboCustomerId:', qboCustomerId);
console.log('[1] agreementName (derived):', agreementName);

// ── 3. Validate required fields ───────────────────────────────────────────────

// QBO Customer ID is on the Company record linked to this Agreement.
// Show a targeted dialog so the user knows exactly where to fix it.
if (!qboCustomerId) {
  await fibery.ui.alert(
    `⚠️ QBO Customer ID is missing.\n\n` +
    `Open the Company record linked to "${agreementName || 'the linked Agreement'}", ` +
    `fill in the QBO Customer ID field, then try again.`
  );
  return;
}

const missing = [];
if (!targetAmount) missing.push('Target Amount');
if (!targetDate)   missing.push('Target Date');
if (!name)         missing.push('Name / Milestone Title');

if (missing.length) {
  await fibery.executeSingleCommand({
    command: 'fibery.entity/update',
    args: {
      type: 'Agreement Management/Revenue Item',
      entity: {
        'fibery/id': entity['Id'],
        'Agreement Management/Invoice Error':
          'Missing required fields: ' + missing.join(', '),
      },
    },
  });
  throw new Error('Invoice not created — missing fields: ' + missing.join(', '));
}

// ── 4. Build and send webhook payload ────────────────────────────────────────

const payload = {
  qboCustomerId:   qboCustomerId,
  amount:          parseFloat(targetAmount),
  revenueItemName: name,
  invoiceDate:     targetDate,
  memo:            `Agreement: ${agreementName} | Milestone: ${milestoneTitle}`,
};

console.log('[4] payload:', JSON.stringify(payload));

const response = await http.postAsync(WEBHOOK_URL, {
  headers:          { 'Content-Type': 'application/json' },
  body:             JSON.stringify(payload),
  timeout:          30000,
  followRedirects:  true,
});

const data = JSON.parse(typeof response === 'string' ? response : response.body || '{}');
console.log('[4] response:', JSON.stringify(data));

// ── 5a. Success — write invoice details back and move to Invoiced ─────────────

if (data.success) {
  await fibery.executeSingleCommand({
    command: 'fibery.entity/update',
    args: {
      type: 'Agreement Management/Revenue Item',
      entity: {
        'fibery/id':                          entity['Id'],
        'Agreement Management/QBO Invoice ID':  data.qboInvoiceId,
        'Agreement Management/QBO Invoice URL': data.qboInvoiceUrl,
        'Agreement Management/Invoice Error':   null,
        'workflow/state': { 'fibery/id': WORKFLOW_STATE_INVOICED },
      },
    },
  });
  return `Invoice created: #${data.qboInvoiceNumber} — ${data.qboInvoiceUrl}`;
}

// ── 5b. Failure — write error message ────────────────────────────────────────

const errorMsg = data.error || 'Unexpected response from webhook: ' + JSON.stringify(data);

await fibery.executeSingleCommand({
  command: 'fibery.entity/update',
  args: {
    type: 'Agreement Management/Revenue Item',
    entity: {
      'fibery/id': entity['Id'],
      'Agreement Management/Invoice Error': errorMsg,
    },
  },
});

throw new Error('QBO invoice creation failed: ' + errorMsg);
