import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LEAD_COLUMNS,
  RULES_VERSION as LEAD_RULES_VERSION,
  routeLead,
  logFailedOutcome,
} from '../demo-lead-response/lib/lead-rules.js';
import { TICKET_COLUMNS, TICKET_STATUS } from '../demo-project-intake/lib/ticket-rules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const SHEETS_CREDENTIAL = {
  googleSheetsOAuth2Api: {
    id: 'REPLACE_WITH_GOOGLE_SHEETS_CREDENTIAL_ID',
    name: 'CKA Demo — Google Sheets',
  },
};

const SMTP_CREDENTIAL = {
  smtp: {
    id: 'REPLACE_WITH_SMTP_CREDENTIAL_ID',
    name: 'CKA Demo — SMTP',
  },
};

const LEADS_SHEET_ID = 'REPLACE_WITH_LEADS_SPREADSHEET_ID';
const TICKETS_SHEET_ID = 'REPLACE_WITH_TICKETS_SPREADSHEET_ID';

function loadRules(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8').replace(/^export /gm, '').trimEnd();
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function nid(prefix, n) {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function link(connections, from, to, outputIndex = 0) {
  if (!connections[from]) connections[from] = { main: [] };
  const main = connections[from].main;
  while (main.length <= outputIndex) main.push([]);
  main[outputIndex].push({ node: to, type: 'main', index: 0 });
}

function sheetLocator(documentId, sheetName) {
  return {
    documentId: { __rl: true, value: documentId, mode: 'id' },
    sheetName: { __rl: true, value: sheetName, mode: 'name' },
  };
}

function columnSchema(columns, matchColumn) {
  return columns.map((id) => ({
    id,
    displayName: id,
    required: false,
    defaultMatch: id === matchColumn,
    display: true,
    type: 'string',
    canBeUsedToMatch: true,
  }));
}

function sheetsNode({
  name,
  id,
  position,
  operation,
  documentId,
  sheetName,
  columns,
  values,
  matchColumn,
  onError = true,
  alwaysOutputData = false,
  notes,
}) {
  const parameters = {
    resource: 'sheet',
    operation,
    ...sheetLocator(documentId, sheetName),
    options: operation === 'read' ? {} : { cellFormat: 'RAW' },
  };
  if (operation !== 'read') {
    parameters.columns = {
      mappingMode: 'defineBelow',
      value: values,
      schema: columnSchema(columns, matchColumn),
      attemptToConvertTypes: false,
      convertFieldsToString: false,
    };
    if (matchColumn) parameters.columns.matchingColumns = [matchColumn];
  }
  return {
    parameters,
    id,
    name,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position,
    credentials: SHEETS_CREDENTIAL,
    ...(alwaysOutputData ? { alwaysOutputData: true } : {}),
    ...(onError ? { onError: 'continueErrorOutput' } : {}),
    ...(notes ? { notes, notesInFlow: true } : {}),
  };
}

function codeNode({ name, id, position, jsCode, notes }) {
  return {
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode,
    },
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    ...(notes ? { notes, notesInFlow: true } : {}),
  };
}

function ifNode({ name, id, position, left, kind, right }) {
  const operator = kind === 'true'
    ? { type: 'boolean', operation: 'true', singleValue: true, name: 'filter.operator.true' }
    : { type: 'string', operation: 'equals', name: 'filter.operator.equals' };
  const condition = {
    id: `${id}-cond`,
    leftValue: left,
    rightValue: kind === 'true' ? '' : right,
    operator,
  };
  return {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [condition],
        combinator: 'and',
      },
      options: {},
    },
    id,
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position,
  };
}

function switchNode({ name, id, position, left, cases }) {
  return {
    parameters: {
      rules: {
        values: cases.map((value) => ({
          conditions: {
            options: {
              caseSensitive: true,
              leftValue: '',
              typeValidation: 'strict',
              version: 2,
            },
            conditions: [
              {
                id: `${id}-${value}`,
                leftValue: left,
                rightValue: value,
                operator: {
                  type: 'string',
                  operation: 'equals',
                  name: 'filter.operator.equals',
                },
              },
            ],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: value,
        })),
      },
      options: { fallbackOutput: 'extra' },
    },
    id,
    name,
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.2,
    position,
  };
}

function webhookNode({ name, id, position, path, webhookId }) {
  return {
    parameters: {
      httpMethod: 'POST',
      path,
      responseMode: 'responseNode',
      options: {},
    },
    id,
    name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position,
    webhookId,
  };
}

function respondNode({ name, id, position }) {
  return {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify($json) }}',
      options: {
        responseCode: '={{ $json.http_status }}',
      },
    },
    id,
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.4,
    position,
  };
}

function manualNode(name, id, position) {
  return {
    parameters: {},
    id,
    name,
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position,
  };
}

function noOpNode(name, id, position) {
  return {
    parameters: {},
    id,
    name,
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position,
  };
}

function stickyNode({ name, id, position, content, height, width, color }) {
  return {
    parameters: { content, height, width, color },
    id,
    name,
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position,
  };
}

function emailNode(name, id, position) {
  return {
    parameters: {
      resource: 'email',
      operation: 'send',
      fromEmail: '={{ $json.from }}',
      toEmail: '={{ $json.to }}',
      subject: '={{ $json.subject }}',
      emailFormat: 'text',
      text: '={{ $json.text }}',
      options: { appendAttribution: false },
    },
    id,
    name,
    type: 'n8n-nodes-base.emailSend',
    typeVersion: 2.1,
    position,
    credentials: SMTP_CREDENTIAL,
    onError: 'continueErrorOutput',
    notes: 'Placeholder addresses only. dispatch@example.com and owner@example.com are not real inboxes.',
  };
}

function mappedValues(columns, overrides = {}) {
  const values = {};
  for (const column of columns) {
    values[column] = Object.prototype.hasOwnProperty.call(overrides, column)
      ? overrides[column]
      : `={{ $json.${column} }}`;
  }
  return values;
}

function stampSource(baseNodeName, outcome, errorMode) {
  const lines = [
    `const base = $('${baseNodeName}').first().json;`,
    'const incoming = $input.first().json;',
  ];
  if (errorMode === 'input') {
    lines.push('const err = incoming.error;');
    lines.push("const error = typeof err === 'string' ? err : (err && err.message) || 'send_failed';");
  } else if (errorMode === 'validation') {
    lines.push('const error = (base.validation_errors || []).join("; ");');
  } else {
    lines.push('const error = "";');
  }
  lines.push('return [{');
  lines.push('  json: {');
  lines.push(`    outcome_status: ${JSON.stringify(outcome.status)},`);
  lines.push(`    contacted: ${outcome.contacted ? 'true' : 'false'},`);
  lines.push(`    action_taken: ${JSON.stringify(outcome.action)},`);
  lines.push(`    http_status: ${outcome.http},`);
  lines.push('    error');
  lines.push('  }');
  lines.push('}];');
  return `${lines.join('\n')}\n`;
}

function workflowShell({ name, nodes, connections, timezone }) {
  return {
    name,
    nodes,
    connections,
    active: false,
    settings: {
      executionOrder: 'v1',
      timezone,
      saveDataErrorExecution: 'all',
      saveDataSuccessExecution: 'all',
      saveManualExecutions: true,
    },
    pinData: {},
    meta: {
      templateCredsSetupCompleted: false,
    },
  };
}

function leadFixture(intent, hours) {
  return { ok: true, intent, business_hours: hours };
}

function buildLeadWorkflow() {
  const rules = loadRules('demo-lead-response/lib/lead-rules.js');
  const quoteSample = readJson('demo-lead-response/samples/quote.json');
  const banner = `// Generated from demo-lead-response/lib/lead-rules.js (${LEAD_RULES_VERSION}).\n// Edit the lib, then run npm run build:workflows.\n`;
  const withRules = (footer) => `${banner}${rules}\n\n${footer.trim()}\n`;

  const quotePending = routeLead({ lead: leadFixture('QUOTE', 'in_hours'), sendResult: 'pending' });
  const quoteSent = routeLead({ lead: leadFixture('QUOTE', 'in_hours'), sendResult: 'success' });
  const quoteSentStale = routeLead({
    lead: leadFixture('QUOTE', 'in_hours'),
    sendResult: 'success',
    sheetUpdate: 'failed',
  });
  const quoteFailed = routeLead({ lead: leadFixture('QUOTE', 'in_hours'), sendResult: 'error' });
  const ownerPending = routeLead({ lead: leadFixture('EMERGENCY', 'after_hours'), sendResult: 'pending' });
  const ownerSent = routeLead({ lead: leadFixture('EMERGENCY', 'after_hours'), sendResult: 'success' });
  const ownerSentStale = routeLead({
    lead: leadFixture('EMERGENCY', 'after_hours'),
    sendResult: 'success',
    sheetUpdate: 'failed',
  });
  const ownerFailed = routeLead({ lead: leadFixture('EMERGENCY', 'after_hours'), sendResult: 'error' });
  const queued = routeLead({ lead: leadFixture('EMERGENCY', 'in_hours') });
  const spam = routeLead({ lead: leadFixture('SPAM', 'in_hours') });
  const duplicate = routeLead({ lead: leadFixture('QUOTE', 'in_hours'), isDuplicate: true });
  const invalid = routeLead({ lead: { ok: false } });
  const dedupeFailed = routeLead({ lead: leadFixture('QUOTE', 'in_hours'), sheetsAvailable: false });
  const unrouted = routeLead({ lead: leadFixture('OTHER', 'in_hours') });
  const logFailed = logFailedOutcome();

  const nodes = [];
  const connections = {};
  const add = (node) => {
    nodes.push(node);
    return node;
  };

  add(stickyNode({
    name: 'Sticky: Read me',
    id: nid('a1000001', 1),
    position: [0, 0],
    color: 4,
    width: 520,
    height: 620,
    content: `## CKA Demo — Lead Response Router
Portfolio demo for Chris Davis / CKA Consulting.
Fake data only. This workflow is **inactive**. It is not a live client system.
Fictional shop in the sample copy: Northwind Home Services.

### Classification (rules, no LLM)
1. Spam terms → SPAM
2. Emergency terms → EMERGENCY
3. Quote terms, or any other valid lead → QUOTE

### Hours — Mon–Fri 08:00–17:00 America/Chicago
- After-hours EMERGENCY emails owner@example.com. The customer is not auto-replied.
- In-hours EMERGENCY is logged as queued_in_hours. No auto email.
- QUOTE gets a polite auto-reply at any hour.
- SPAM and duplicates are logged and never replied to.

### Fail-safe
\`contacted=true\` only after the quote email node succeeds.
A send error leaves contacted false.
Dedupe: same email + normalized message within 24 hours.
If the sheet cannot be read, nothing is sent.

### Placeholders
- Sheet id: \`${LEADS_SHEET_ID}\`
- Google credential name: \`CKA Demo — Google Sheets\`
- SMTP credential name: \`CKA Demo — SMTP\`
- From: dispatch@example.com
- Owner alert: owner@example.com

The manual trigger runs samples/quote.json.
\`demo_received_at\` is honored while ALLOW_DEMO_CLOCK is true.`,
  }));

  add(stickyNode({
    name: 'Sticky: Fail-safe',
    id: nid('a1000001', 2),
    position: [2920, 640],
    color: 3,
    width: 420,
    height: 260,
    content: `## Send, then mark
Rows are appended with contacted=false **before** any email node.
The update nodes run only after the email node.
Success is the only path that can set contacted=true, and only for a quote reply.
Owner alerts stay contacted=false because the customer was not emailed.
If the update node fails, the HTTP result says so and the original row is still contacted=false.`,
  }));

  add(webhookNode({
    name: 'Lead Webhook',
    id: nid('a1000001', 3),
    position: [560, 360],
    path: 'cka-demo-lead-response',
    webhookId: 'c0ffee00-0000-4000-8000-0000000000a1',
  }));
  add(manualNode('Manual Trigger', nid('a1000001', 4), [280, 680]));
  add(codeNode({
    name: 'Sample Lead',
    id: nid('a1000001', 5),
    position: [560, 680],
    notes: 'Inlined from demo-lead-response/samples/quote.json.',
    jsCode: `return [{ json: ${JSON.stringify(quoteSample, null, 2)} }];\n`,
  }));
  add(codeNode({
    name: 'Normalize and Classify',
    id: nid('a1000001', 6),
    position: [880, 480],
    jsCode: withRules(`
const raw = $input.first().json;
const payload = raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body) ? raw.body : raw;
const lead = classifyLead(payload, { allowDemoClock: ALLOW_DEMO_CLOCK });
lead.source = raw.headers || raw.webhookUrl ? 'webhook' : 'manual';
return [{ json: lead }];
`),
  }));
  add(ifNode({
    name: 'Valid Lead?',
    id: nid('a1000001', 7),
    position: [1160, 480],
    left: '={{ $json.ok }}',
    kind: 'true',
  }));
  add(sheetsNode({
    name: 'Log Invalid Lead',
    id: nid('a1000001', 8),
    position: [1420, 760],
    operation: 'append',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    columns: LEAD_COLUMNS,
    values: mappedValues(LEAD_COLUMNS, {
      status: invalid.status,
      contacted: 'false',
      action_taken: invalid.action,
      error: '={{ ($json.validation_errors || []).join("; ") }}',
      duplicate_of: '',
    }),
  }));
  add(sheetsNode({
    name: 'Read Leads',
    id: nid('a1000001', 9),
    position: [1420, 360],
    operation: 'read',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    alwaysOutputData: true,
    notes: 'Fail closed: a read error does not send email.',
  }));
  add(codeNode({
    name: 'Dedupe Against Sheet',
    id: nid('a1000001', 10),
    position: [1680, 360],
    jsCode: withRules(`
const lead = $('Normalize and Classify').first().json;
const rows = $input.all().map((item) => item.json).filter((row) => row && row.email);
const duplicateOf = findDuplicate(lead, rows);
return [{ json: { ...lead, is_duplicate: Boolean(duplicateOf), duplicate_of: duplicateOf || '' } }];
`),
  }));
  add(ifNode({
    name: 'Duplicate?',
    id: nid('a1000001', 11),
    position: [1960, 360],
    left: '={{ $json.is_duplicate }}',
    kind: 'true',
  }));
  add(sheetsNode({
    name: 'Log Duplicate',
    id: nid('a1000001', 12),
    position: [2220, 560],
    operation: 'append',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    columns: LEAD_COLUMNS,
    values: mappedValues(LEAD_COLUMNS, {
      status: duplicate.status,
      contacted: 'false',
      action_taken: duplicate.action,
      error: '',
    }),
  }));
  add(switchNode({
    name: 'Route by Intent',
    id: nid('a1000001', 13),
    position: [2220, 220],
    left: '={{ $json.intent }}',
    cases: ['EMERGENCY', 'QUOTE', 'SPAM'],
  }));
  add(ifNode({
    name: 'After Hours?',
    id: nid('a1000001', 14),
    position: [2500, 40],
    left: '={{ $json.business_hours }}',
    kind: 'equals',
    right: 'after_hours',
  }));
  add(sheetsNode({
    name: 'Log Emergency Pending',
    id: nid('a1000001', 15),
    position: [2760, -40],
    operation: 'append',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    columns: LEAD_COLUMNS,
    values: mappedValues(LEAD_COLUMNS, {
      status: ownerPending.status,
      contacted: 'false',
      action_taken: ownerPending.action,
      error: '',
      duplicate_of: '',
    }),
  }));
  add(codeNode({
    name: 'Prepare Owner Alert',
    id: nid('a1000001', 16),
    position: [3020, -40],
    jsCode: withRules(`
const lead = $('Dedupe Against Sheet').first().json;
const email = buildOwnerAlert(lead);
return [{ json: { ...lead, from: email.from, to: email.to, subject: email.subject, text: email.text } }];
`),
  }));
  add(emailNode('Email Owner Alert', nid('a1000001', 17), [3280, -40]));
  add(sheetsNode({
    name: 'Mark Owner Alerted',
    id: nid('a1000001', 18),
    position: [3540, -160],
    operation: 'update',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    columns: ['lead_id', 'status', 'contacted', 'action_taken', 'error'],
    matchColumn: 'lead_id',
    values: {
      lead_id: "={{ $('Dedupe Against Sheet').first().json.lead_id }}",
      status: ownerSent.status,
      contacted: 'false',
      action_taken: ownerSent.action,
      error: '',
    },
  }));
  add(sheetsNode({
    name: 'Mark Owner Alert Failed',
    id: nid('a1000001', 19),
    position: [3540, 120],
    operation: 'update',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    columns: ['lead_id', 'status', 'contacted', 'action_taken', 'error'],
    matchColumn: 'lead_id',
    values: {
      lead_id: "={{ $('Dedupe Against Sheet').first().json.lead_id }}",
      status: ownerFailed.status,
      contacted: 'false',
      action_taken: ownerFailed.action,
      error: '={{ typeof $json.error === "string" ? $json.error : ($json.error && $json.error.message) || "send_failed" }}',
    },
  }));
  add(sheetsNode({
    name: 'Log Emergency In Hours',
    id: nid('a1000001', 20),
    position: [2760, 200],
    operation: 'append',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    columns: LEAD_COLUMNS,
    values: mappedValues(LEAD_COLUMNS, {
      status: queued.status,
      contacted: 'false',
      action_taken: queued.action,
      error: '',
      duplicate_of: '',
    }),
  }));
  add(sheetsNode({
    name: 'Log Quote Pending',
    id: nid('a1000001', 21),
    position: [2500, 400],
    operation: 'append',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    columns: LEAD_COLUMNS,
    values: mappedValues(LEAD_COLUMNS, {
      status: quotePending.status,
      contacted: 'false',
      action_taken: quotePending.action,
      error: '',
      duplicate_of: '',
    }),
  }));
  add(codeNode({
    name: 'Prepare Quote Reply',
    id: nid('a1000001', 22),
    position: [2760, 400],
    jsCode: withRules(`
const lead = $('Dedupe Against Sheet').first().json;
const email = buildQuoteEmail(lead);
return [{ json: { ...lead, from: email.from, to: email.to, subject: email.subject, text: email.text } }];
`),
  }));
  add(emailNode('Email Quote Reply', nid('a1000001', 23), [3020, 400]));
  add(sheetsNode({
    name: 'Mark Quote Replied',
    id: nid('a1000001', 24),
    position: [3280, 300],
    operation: 'update',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    columns: ['lead_id', 'status', 'contacted', 'action_taken', 'error'],
    matchColumn: 'lead_id',
    values: {
      lead_id: "={{ $('Dedupe Against Sheet').first().json.lead_id }}",
      status: quoteSent.status,
      contacted: 'true',
      action_taken: quoteSent.action,
      error: '',
    },
  }));
  add(sheetsNode({
    name: 'Mark Quote Reply Failed',
    id: nid('a1000001', 25),
    position: [3280, 520],
    operation: 'update',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    columns: ['lead_id', 'status', 'contacted', 'action_taken', 'error'],
    matchColumn: 'lead_id',
    values: {
      lead_id: "={{ $('Dedupe Against Sheet').first().json.lead_id }}",
      status: quoteFailed.status,
      contacted: 'false',
      action_taken: quoteFailed.action,
      error: '={{ typeof $json.error === "string" ? $json.error : ($json.error && $json.error.message) || "send_failed" }}',
    },
  }));
  add(sheetsNode({
    name: 'Log Spam',
    id: nid('a1000001', 26),
    position: [2500, 680],
    operation: 'append',
    documentId: LEADS_SHEET_ID,
    sheetName: 'Leads',
    columns: LEAD_COLUMNS,
    values: mappedValues(LEAD_COLUMNS, {
      status: spam.status,
      contacted: 'false',
      action_taken: spam.action,
      error: '',
      duplicate_of: '',
    }),
  }));

  const stamps = [
    ['Stamp Invalid', invalid, 'validation', [1680, 760]],
    ['Stamp Dedupe Check Failed', dedupeFailed, 'input', [1680, 560]],
    ['Stamp Duplicate', duplicate, 'static', [2480, 560]],
    ['Stamp Log Failed', logFailed, 'input', [3760, 760]],
    ['Stamp Queued In Hours', queued, 'static', [3020, 200]],
    ['Stamp Owner Alerted', ownerSent, 'static', [3800, -160]],
    ['Stamp Owner Alerted Sheet Update Failed', ownerSentStale, 'input', [3800, -20]],
    ['Stamp Owner Alert Failed', ownerFailed, 'input', [3800, 120]],
    ['Stamp Reply Sent', quoteSent, 'static', [3540, 300]],
    ['Stamp Reply Sent Sheet Update Failed', quoteSentStale, 'input', [3540, 400]],
    ['Stamp Reply Failed', quoteFailed, 'input', [3540, 640]],
    ['Stamp Spam', spam, 'static', [2760, 680]],
    ['Stamp Unrouted', unrouted, 'static', [2480, 880]],
  ];
  stamps.forEach(([name, outcome, errorMode, position], index) => {
    add(codeNode({
      name,
      id: nid('a1000001', 40 + index),
      position,
      jsCode: stampSource('Normalize and Classify', outcome, errorMode),
    }));
  });

  add(codeNode({
    name: 'Build Response',
    id: nid('a1000001', 60),
    position: [4080, 360],
    jsCode: `const base = $('Normalize and Classify').first().json;
const incoming = $input.first().json;
let duplicateOf = '';
try {
  duplicateOf = $('Dedupe Against Sheet').first().json.duplicate_of || '';
} catch (err) {
  duplicateOf = '';
}
return [{
  json: {
    demo: true,
    portfolio: 'cka-lead-response',
    rules_version: base.rules_version,
    http_status: incoming.http_status,
    lead_id: base.lead_id || '',
    name: base.name || '',
    email: base.email || '',
    phone: base.phone || '',
    intent: base.intent || '',
    intent_rule: base.intent_rule || '',
    business_hours: base.business_hours || '',
    status: incoming.outcome_status,
    contacted: incoming.contacted === true,
    action_taken: incoming.action_taken,
    error: incoming.error || '',
    duplicate_of: duplicateOf,
    source: base.source || 'manual'
  }
}];
`,
  }));
  add(ifNode({
    name: 'Webhook Call?',
    id: nid('a1000001', 61),
    position: [4340, 360],
    left: '={{ $json.source }}',
    kind: 'equals',
    right: 'webhook',
  }));
  add(respondNode({
    name: 'Respond to Webhook',
    id: nid('a1000001', 62),
    position: [4600, 260],
  }));
  add(noOpNode('Manual Test Complete', nid('a1000001', 63), [4600, 480]));

  link(connections, 'Manual Trigger', 'Sample Lead');
  link(connections, 'Sample Lead', 'Normalize and Classify');
  link(connections, 'Lead Webhook', 'Normalize and Classify');
  link(connections, 'Normalize and Classify', 'Valid Lead?');
  link(connections, 'Valid Lead?', 'Read Leads', 0);
  link(connections, 'Valid Lead?', 'Log Invalid Lead', 1);
  link(connections, 'Log Invalid Lead', 'Stamp Invalid', 0);
  link(connections, 'Log Invalid Lead', 'Stamp Log Failed', 1);
  link(connections, 'Read Leads', 'Dedupe Against Sheet', 0);
  link(connections, 'Read Leads', 'Stamp Dedupe Check Failed', 1);
  link(connections, 'Dedupe Against Sheet', 'Duplicate?');
  link(connections, 'Duplicate?', 'Log Duplicate', 0);
  link(connections, 'Duplicate?', 'Route by Intent', 1);
  link(connections, 'Log Duplicate', 'Stamp Duplicate', 0);
  link(connections, 'Log Duplicate', 'Stamp Log Failed', 1);
  link(connections, 'Route by Intent', 'After Hours?', 0);
  link(connections, 'Route by Intent', 'Log Quote Pending', 1);
  link(connections, 'Route by Intent', 'Log Spam', 2);
  link(connections, 'Route by Intent', 'Stamp Unrouted', 3);
  link(connections, 'After Hours?', 'Log Emergency Pending', 0);
  link(connections, 'After Hours?', 'Log Emergency In Hours', 1);
  link(connections, 'Log Emergency Pending', 'Prepare Owner Alert', 0);
  link(connections, 'Log Emergency Pending', 'Stamp Log Failed', 1);
  link(connections, 'Prepare Owner Alert', 'Email Owner Alert');
  link(connections, 'Email Owner Alert', 'Mark Owner Alerted', 0);
  link(connections, 'Email Owner Alert', 'Mark Owner Alert Failed', 1);
  link(connections, 'Mark Owner Alerted', 'Stamp Owner Alerted', 0);
  link(connections, 'Mark Owner Alerted', 'Stamp Owner Alerted Sheet Update Failed', 1);
  link(connections, 'Mark Owner Alert Failed', 'Stamp Owner Alert Failed', 0);
  link(connections, 'Mark Owner Alert Failed', 'Stamp Owner Alert Failed', 1);
  link(connections, 'Log Emergency In Hours', 'Stamp Queued In Hours', 0);
  link(connections, 'Log Emergency In Hours', 'Stamp Log Failed', 1);
  link(connections, 'Log Quote Pending', 'Prepare Quote Reply', 0);
  link(connections, 'Log Quote Pending', 'Stamp Log Failed', 1);
  link(connections, 'Prepare Quote Reply', 'Email Quote Reply');
  link(connections, 'Email Quote Reply', 'Mark Quote Replied', 0);
  link(connections, 'Email Quote Reply', 'Mark Quote Reply Failed', 1);
  link(connections, 'Mark Quote Replied', 'Stamp Reply Sent', 0);
  link(connections, 'Mark Quote Replied', 'Stamp Reply Sent Sheet Update Failed', 1);
  link(connections, 'Mark Quote Reply Failed', 'Stamp Reply Failed', 0);
  link(connections, 'Mark Quote Reply Failed', 'Stamp Reply Failed', 1);
  link(connections, 'Log Spam', 'Stamp Spam', 0);
  link(connections, 'Log Spam', 'Stamp Log Failed', 1);

  for (const [name] of stamps) link(connections, name, 'Build Response');
  link(connections, 'Build Response', 'Webhook Call?');
  link(connections, 'Webhook Call?', 'Respond to Webhook', 0);
  link(connections, 'Webhook Call?', 'Manual Test Complete', 1);

  return workflowShell({
    name: 'CKA Demo — Lead Response Router',
    nodes,
    connections,
    timezone: 'America/Chicago',
  });
}

function ticketStamp(outcome, errorMode) {
  const lines = [
    "const base = $('Extract Ticket').first().json;",
    'const incoming = $input.first().json;',
  ];
  if (errorMode === 'input') {
    lines.push('const err = incoming.error;');
    lines.push("const error = typeof err === 'string' ? err : (err && err.message) || 'sheets_write_failed';");
  } else if (errorMode === 'validation') {
    lines.push('const error = (base.validation_errors || []).join("; ");');
  } else {
    lines.push('const error = "";');
  }
  lines.push('return [{');
  lines.push('  json: {');
  lines.push(`    outcome_status: ${JSON.stringify(outcome.status)},`);
  lines.push(`    http_status: ${outcome.http},`);
  lines.push('    error');
  lines.push('  }');
  lines.push('}];');
  return `${lines.join('\n')}\n`;
}

function buildIntakeWorkflow() {
  const rules = loadRules('demo-project-intake/lib/ticket-rules.js');
  const sample = readJson('demo-project-intake/samples/access-outage.json');
  const banner = '// Generated from demo-project-intake/lib/ticket-rules.js.\n// Edit the lib, then run npm run build:workflows.\n';
  const withRules = (footer) => `${banner}${rules}\n\n${footer.trim()}\n`;
  const logged = { status: TICKET_STATUS.logged, http: 200 };
  const invalid = { status: TICKET_STATUS.invalid, http: 400 };
  const logFailed = { status: TICKET_STATUS.logFailed, http: 502 };

  const nodes = [];
  const connections = {};
  const add = (node) => {
    nodes.push(node);
    return node;
  };

  add(stickyNode({
    name: 'Sticky: Read me',
    id: nid('b2000002', 1),
    position: [0, 0],
    color: 5,
    width: 500,
    height: 460,
    content: `## CKA Demo — Project Intake Ticket
Portfolio demo for Chris Davis / CKA Consulting.
Fake data only. This workflow is **inactive**. It is not a live client system.
Separate from the lead-response demo.

### What it does
1. Accept a messy email or webhook body.
2. Extract title, priority, requester, category, due window, and acceptance criteria with rules.
3. One rewrite node turns the owner summary into a customer paragraph.
4. Append a row to the Tickets sheet.

No email is sent. There is no second workflow hiding inside the rewrite node.

### Placeholders
- Sheet id: \`${TICKETS_SHEET_ID}\`
- Tab: Tickets
- Google credential name: \`CKA Demo — Google Sheets\`

The manual trigger runs samples/access-outage.json.`,
  }));

  add(webhookNode({
    name: 'Intake Webhook',
    id: nid('b2000002', 2),
    position: [560, 280],
    path: 'cka-demo-project-intake',
    webhookId: 'c0ffee00-0000-4000-8000-0000000000b2',
  }));
  add(manualNode('Manual Trigger', nid('b2000002', 3), [280, 520]));
  add(codeNode({
    name: 'Sample Request',
    id: nid('b2000002', 4),
    position: [560, 520],
    notes: 'Inlined from demo-project-intake/samples/access-outage.json.',
    jsCode: `return [{ json: ${JSON.stringify(sample, null, 2)} }];\n`,
  }));
  add(codeNode({
    name: 'Extract Ticket',
    id: nid('b2000002', 5),
    position: [880, 360],
    jsCode: withRules(`
const raw = $input.first().json;
const payload = raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body) ? raw.body : raw;
const ticket = extractTicket(payload);
ticket.source = raw.headers || raw.webhookUrl ? 'webhook' : 'manual';
return [{ json: ticket }];
`),
  }));
  add(ifNode({
    name: 'Valid Request?',
    id: nid('b2000002', 6),
    position: [1160, 360],
    left: '={{ $json.ok }}',
    kind: 'true',
  }));
  add(sheetsNode({
    name: 'Log Invalid Ticket',
    id: nid('b2000002', 7),
    position: [1420, 560],
    operation: 'append',
    documentId: TICKETS_SHEET_ID,
    sheetName: 'Tickets',
    columns: TICKET_COLUMNS,
    values: mappedValues(TICKET_COLUMNS, {
      summary_customer: '',
      status: invalid.status,
      error: '={{ ($json.validation_errors || []).join("; ") }}',
    }),
  }));
  add(codeNode({
    name: 'Rewrite Customer Summary',
    id: nid('b2000002', 8),
    position: [1420, 240],
    notes: 'The only rewrite step. Swap this one node for an LLM later if you want. The demo default is rules.',
    jsCode: withRules(`
const ticket = $input.first().json;
return [{ json: rewriteForCustomer(ticket) }];
`),
  }));
  add(sheetsNode({
    name: 'Log Ticket',
    id: nid('b2000002', 9),
    position: [1700, 240],
    operation: 'append',
    documentId: TICKETS_SHEET_ID,
    sheetName: 'Tickets',
    columns: TICKET_COLUMNS,
    values: mappedValues(TICKET_COLUMNS, {
      status: logged.status,
      error: '',
    }),
  }));
  add(codeNode({
    name: 'Stamp Invalid',
    id: nid('b2000002', 10),
    position: [1700, 560],
    jsCode: ticketStamp(invalid, 'validation'),
  }));
  add(codeNode({
    name: 'Stamp Logged',
    id: nid('b2000002', 11),
    position: [1960, 160],
    jsCode: ticketStamp(logged, 'static'),
  }));
  add(codeNode({
    name: 'Stamp Log Failed',
    id: nid('b2000002', 12),
    position: [1960, 400],
    jsCode: ticketStamp(logFailed, 'input'),
  }));
  add(codeNode({
    name: 'Build Response',
    id: nid('b2000002', 13),
    position: [2240, 280],
    jsCode: `const extracted = $('Extract Ticket').first().json;
const incoming = $input.first().json;
let ticket = extracted;
try {
  const rewritten = $('Rewrite Customer Summary').first().json;
  if (rewritten && rewritten.summary_customer) ticket = rewritten;
} catch (err) {
  ticket = extracted;
}
return [{
  json: {
    demo: true,
    portfolio: 'cka-project-intake',
    rules_version: extracted.rules_version,
    http_status: incoming.http_status,
    status: incoming.outcome_status,
    error: incoming.error || '',
    source: extracted.source || 'manual',
    ticket_id: ticket.ticket_id || '',
    requester_name: ticket.requester_name || '',
    requester_email: ticket.requester_email || '',
    title: ticket.title || '',
    priority: ticket.priority || '',
    category: ticket.category || '',
    due_window: ticket.due_window || '',
    acceptance_criteria: ticket.acceptance_criteria || '',
    summary_owner: ticket.summary_owner || '',
    summary_customer: ticket.summary_customer || ''
  }
}];
`,
  }));
  add(ifNode({
    name: 'Webhook Call?',
    id: nid('b2000002', 14),
    position: [2500, 280],
    left: '={{ $json.source }}',
    kind: 'equals',
    right: 'webhook',
  }));
  add(respondNode({
    name: 'Respond to Webhook',
    id: nid('b2000002', 15),
    position: [2760, 180],
  }));
  add(noOpNode('Manual Test Complete', nid('b2000002', 16), [2760, 400]));

  link(connections, 'Manual Trigger', 'Sample Request');
  link(connections, 'Sample Request', 'Extract Ticket');
  link(connections, 'Intake Webhook', 'Extract Ticket');
  link(connections, 'Extract Ticket', 'Valid Request?');
  link(connections, 'Valid Request?', 'Rewrite Customer Summary', 0);
  link(connections, 'Valid Request?', 'Log Invalid Ticket', 1);
  link(connections, 'Log Invalid Ticket', 'Stamp Invalid', 0);
  link(connections, 'Log Invalid Ticket', 'Stamp Log Failed', 1);
  link(connections, 'Rewrite Customer Summary', 'Log Ticket');
  link(connections, 'Log Ticket', 'Stamp Logged', 0);
  link(connections, 'Log Ticket', 'Stamp Log Failed', 1);
  link(connections, 'Stamp Invalid', 'Build Response');
  link(connections, 'Stamp Logged', 'Build Response');
  link(connections, 'Stamp Log Failed', 'Build Response');
  link(connections, 'Build Response', 'Webhook Call?');
  link(connections, 'Webhook Call?', 'Respond to Webhook', 0);
  link(connections, 'Webhook Call?', 'Manual Test Complete', 1);

  return workflowShell({
    name: 'CKA Demo — Project Intake Ticket',
    nodes,
    connections,
    timezone: 'America/Chicago',
  });
}

function writeText(relativePath, contents) {
  const fullPath = join(root, relativePath);
  if (checkOnly) {
    let current = '';
    try {
      current = readFileSync(fullPath, 'utf8');
    } catch {
      console.error(`Missing generated file: ${relativePath}`);
      console.error('Run npm run build:workflows');
      process.exitCode = 1;
      return;
    }
    if (current !== contents) {
      console.error(`Out of date: ${relativePath}`);
      console.error('Run npm run build:workflows');
      process.exitCode = 1;
    }
    return;
  }
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, contents);
}

const leadWorkflow = `${JSON.stringify(buildLeadWorkflow(), null, 2)}\n`;
const intakeWorkflow = `${JSON.stringify(buildIntakeWorkflow(), null, 2)}\n`;
const leadHeader = `${LEAD_COLUMNS.join(',')}\n`;
const ticketHeader = `${TICKET_COLUMNS.join(',')}\n`;

writeText('demo-lead-response/cka-lead-response.workflow.json', leadWorkflow);
writeText('demo-project-intake/cka-project-intake.workflow.json', intakeWorkflow);
writeText('demo-lead-response/sheets/leads-headers.csv', leadHeader);
writeText('demo-project-intake/sheets/tickets-headers.csv', ticketHeader);

if (!checkOnly && !process.exitCode) {
  console.log('Wrote lead and intake workflow JSON plus sheet header CSVs.');
}
