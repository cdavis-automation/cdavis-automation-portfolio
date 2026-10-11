import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TICKET_COLUMNS, TICKET_STATUS } from '../demo-project-intake/lib/ticket-rules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const SHEETS_CREDENTIAL = {
  googleSheetsOAuth2Api: {
    id: 'REPLACE_WITH_GOOGLE_SHEETS_CREDENTIAL_ID',
    name: 'CKA Demo — Google Sheets',
  },
};

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

function mappedValues(columns, overrides = {}) {
  const values = {};
  for (const column of columns) {
    values[column] = Object.prototype.hasOwnProperty.call(overrides, column)
      ? overrides[column]
      : `={{ $json.${column} }}`;
  }
  return values;
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

const intakeWorkflow = `${JSON.stringify(buildIntakeWorkflow(), null, 2)}\n`;
const ticketHeader = `${TICKET_COLUMNS.join(',')}\n`;

writeText('demo-project-intake/cka-project-intake.workflow.json', intakeWorkflow);
writeText('demo-project-intake/sheets/tickets-headers.csv', ticketHeader);

if (!checkOnly && !process.exitCode) {
  console.log('Wrote intake workflow JSON plus the sheet header CSV.');
}
