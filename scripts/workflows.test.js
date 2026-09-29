import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');

function loadWorkflow(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function runCode(jsCode, inputJson, nodes = {}) {
  const $input = {
    first() {
      return { json: inputJson };
    },
    all() {
      return Array.isArray(inputJson) ? inputJson.map((json) => ({ json })) : [{ json: inputJson }];
    },
  };
  const $ = (name) => ({
    first() {
      if (!Object.prototype.hasOwnProperty.call(nodes, name)) {
        throw new Error(`node has not run: ${name}`);
      }
      return { json: nodes[name] };
    },
  });
  const fn = new Function('$input', '$', jsCode);
  return fn($input, $);
}

function incoming(workflow, target) {
  const sources = [];
  for (const [from, outputs] of Object.entries(workflow.connections)) {
    outputs.main.forEach((group, index) => {
      for (const edge of group || []) {
        if (edge.node === target) sources.push({ from, index });
      }
    });
  }
  return sources;
}

function reachable(workflow, start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const groups = workflow.connections[current]?.main || [];
    for (const group of groups) {
      for (const edge of group || []) queue.push(edge.node);
    }
  }
  return seen;
}

function assertGraph(workflow) {
  assert.equal(workflow.active, false);
  const names = workflow.nodes.map((node) => node.name);
  assert.equal(new Set(names).size, names.length, 'node names must be unique');
  for (const [from, outputs] of Object.entries(workflow.connections)) {
    assert.ok(names.includes(from), `missing source ${from}`);
    for (const group of outputs.main) {
      for (const edge of group || []) {
        assert.ok(names.includes(edge.node), `missing target ${edge.node}`);
        assert.equal(edge.type, 'main');
        assert.equal(edge.index, 0);
      }
    }
  }
  for (const node of workflow.nodes) {
    if (node.type !== 'n8n-nodes-base.code') continue;
    new Function(node.parameters.jsCode);
  }
}

test('lead workflow is an inactive importable demo', () => {
  const workflow = loadWorkflow('demo-lead-response/cka-lead-response.workflow.json');
  assert.equal(workflow.name, 'CKA Demo — Lead Response Router');
  assertGraph(workflow);

  const webhook = workflow.nodes.find((node) => node.name === 'Lead Webhook');
  assert.equal(webhook.parameters.path, 'cka-demo-lead-response');
  assert.equal(webhook.parameters.httpMethod, 'POST');
  assert.equal(webhook.parameters.responseMode, 'responseNode');

  const emails = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.emailSend');
  assert.deepEqual(emails.map((node) => node.name).sort(), ['Email Owner Alert', 'Email Quote Reply']);
  for (const node of emails) {
    assert.equal(node.credentials.smtp.name, 'CKA Demo — SMTP');
    assert.equal(node.credentials.smtp.id, 'REPLACE_WITH_SMTP_CREDENTIAL_ID');
    assert.equal(node.onError, 'continueErrorOutput');
  }
  assert.deepEqual(incoming(workflow, 'Email Quote Reply'), [{ from: 'Prepare Quote Reply', index: 0 }]);
  assert.deepEqual(incoming(workflow, 'Email Owner Alert'), [{ from: 'Prepare Owner Alert', index: 0 }]);

  for (const start of ['Log Spam', 'Log Duplicate', 'Log Emergency In Hours', 'Log Invalid Lead']) {
    const seen = reachable(workflow, start);
    assert.equal(seen.has('Email Quote Reply'), false, start);
    assert.equal(seen.has('Email Owner Alert'), false, start);
  }

  const ownerReach = reachable(workflow, 'Prepare Owner Alert');
  assert.equal(ownerReach.has('Email Owner Alert'), true);
  assert.equal(ownerReach.has('Email Quote Reply'), false);

  const quoteReach = reachable(workflow, 'Prepare Quote Reply');
  assert.equal(quoteReach.has('Email Quote Reply'), true);
  assert.equal(quoteReach.has('Email Owner Alert'), false);

  const trueStamps = workflow.nodes
    .filter((node) => node.name.startsWith('Stamp ') && node.parameters.jsCode.includes('contacted: true'))
    .map((node) => node.name)
    .sort();
  assert.deepEqual(trueStamps, ['Stamp Reply Sent', 'Stamp Reply Sent Sheet Update Failed']);

  for (const name of ['Stamp Owner Alerted', 'Stamp Owner Alert Failed', 'Stamp Spam', 'Stamp Duplicate']) {
    const node = workflow.nodes.find((item) => item.name === name);
    assert.match(node.parameters.jsCode, /contacted: false/);
  }

  const sheetNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets');
  assert.ok(sheetNodes.length >= 1);
  for (const node of sheetNodes) {
    assert.equal(node.credentials.googleSheetsOAuth2Api.name, 'CKA Demo — Google Sheets');
    assert.equal(node.credentials.googleSheetsOAuth2Api.id, 'REPLACE_WITH_GOOGLE_SHEETS_CREDENTIAL_ID');
    assert.equal(node.parameters.documentId.value, 'REPLACE_WITH_LEADS_SPREADSHEET_ID');
    assert.equal(node.parameters.options.cellFormat ?? 'RAW', 'RAW');
    if (node.parameters.operation === 'append') {
      assert.equal(node.parameters.columns.matchingColumns, undefined);
    }
    if (node.parameters.operation === 'update') {
      assert.deepEqual(node.parameters.columns.matchingColumns, ['lead_id']);
      assert.equal(node.parameters.columns.value.contacted === 'true', node.name === 'Mark Quote Replied');
    }
  }

  const quoteReply = workflow.nodes.find((node) => node.name === 'Mark Quote Replied');
  assert.equal(quoteReply.parameters.columns.value.contacted, 'true');
  const ownerMark = workflow.nodes.find((node) => node.name === 'Mark Owner Alerted');
  assert.equal(ownerMark.parameters.columns.value.contacted, 'false');

  assert.equal(
    workflow.nodes.some((node) => /openai|anthropic|langchain/i.test(node.type)),
    false,
  );
});

test('lead code nodes execute the same rules as the lib', () => {
  const workflow = loadWorkflow('demo-lead-response/cka-lead-response.workflow.json');
  const byName = Object.fromEntries(workflow.nodes.map((node) => [node.name, node]));
  const quote = JSON.parse(readFileSync(join(root, 'demo-lead-response/samples/quote.json'), 'utf8'));
  const emergency = JSON.parse(
    readFileSync(join(root, 'demo-lead-response/samples/emergency-after-hours.json'), 'utf8'),
  );
  const existing = JSON.parse(
    readFileSync(join(root, 'demo-lead-response/samples/dedupe-existing-row.json'), 'utf8'),
  );

  const [sampleItem] = runCode(byName['Sample Lead'].parameters.jsCode, {});
  assert.deepEqual(sampleItem.json, quote);

  const [manualLead] = runCode(byName['Normalize and Classify'].parameters.jsCode, quote);
  assert.equal(manualLead.json.intent, 'QUOTE');
  assert.equal(manualLead.json.source, 'manual');
  assert.equal(manualLead.json.business_hours, 'in_hours');
  assert.equal(manualLead.json.ok, true);

  const [webhookLead] = runCode(byName['Normalize and Classify'].parameters.jsCode, {
    headers: { 'content-type': 'application/json' },
    body: emergency,
    webhookUrl: 'http://localhost/webhook-test/cka-demo-lead-response',
  });
  assert.equal(webhookLead.json.intent, 'EMERGENCY');
  assert.equal(webhookLead.json.business_hours, 'after_hours');
  assert.equal(webhookLead.json.source, 'webhook');

  const [fresh] = runCode(
    byName['Dedupe Against Sheet'].parameters.jsCode,
    [],
    { 'Normalize and Classify': manualLead.json },
  );
  assert.equal(fresh.json.is_duplicate, false);

  const [dup] = runCode(
    byName['Dedupe Against Sheet'].parameters.jsCode,
    [existing],
    { 'Normalize and Classify': manualLead.json },
  );
  assert.equal(dup.json.is_duplicate, true);
  assert.equal(dup.json.duplicate_of, 'lead_existing_demo');

  const [quoteMail] = runCode(
    byName['Prepare Quote Reply'].parameters.jsCode,
    {},
    { 'Dedupe Against Sheet': { ...manualLead.json, is_duplicate: false, duplicate_of: '' } },
  );
  assert.equal(quoteMail.json.to, 'jamie.rivera@example.com');
  assert.equal(quoteMail.json.from, 'dispatch@example.com');

  const [ownerMail] = runCode(
    byName['Prepare Owner Alert'].parameters.jsCode,
    {},
    { 'Dedupe Against Sheet': webhookLead.json },
  );
  assert.equal(ownerMail.json.to, 'owner@example.com');
  assert.notEqual(ownerMail.json.to, webhookLead.json.email);
  assert.match(ownerMail.json.text, /was not auto-replied/);
});

test('intake workflow keeps rewrite to one node and does not send email', () => {
  const workflow = loadWorkflow('demo-project-intake/cka-project-intake.workflow.json');
  assert.equal(workflow.name, 'CKA Demo — Project Intake Ticket');
  assertGraph(workflow);
  assert.equal(
    workflow.nodes.filter((node) => node.name === 'Rewrite Customer Summary').length,
    1,
  );
  assert.equal(
    workflow.nodes.some((node) => node.type === 'n8n-nodes-base.emailSend'),
    false,
  );
  assert.equal(
    workflow.nodes.some((node) => /openai|anthropic|langchain/i.test(node.type)),
    false,
  );

  const webhook = workflow.nodes.find((node) => node.name === 'Intake Webhook');
  assert.equal(webhook.parameters.path, 'cka-demo-project-intake');
  assert.equal(webhook.parameters.responseMode, 'responseNode');

  const rewrite = workflow.nodes.find((node) => node.name === 'Rewrite Customer Summary');
  const extract = workflow.nodes.find((node) => node.name === 'Extract Ticket');
  const extractFooter = extract.parameters.jsCode.split('const raw = $input.first()')[1];
  assert.match(rewrite.parameters.jsCode, /rewriteForCustomer\(ticket\)/);
  assert.doesNotMatch(extractFooter, /rewriteForCustomer/);
  assert.deepEqual(incoming(workflow, 'Log Ticket'), [{ from: 'Rewrite Customer Summary', index: 0 }]);

  const sheetNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets');
  for (const node of sheetNodes) {
    assert.equal(node.parameters.documentId.value, 'REPLACE_WITH_TICKETS_SPREADSHEET_ID');
    assert.equal(node.parameters.sheetName.value, 'Tickets');
    assert.equal(node.credentials.googleSheetsOAuth2Api.name, 'CKA Demo — Google Sheets');
  }

  const byName = Object.fromEntries(workflow.nodes.map((node) => [node.name, node]));
  const access = JSON.parse(
    readFileSync(join(root, 'demo-project-intake/samples/access-outage.json'), 'utf8'),
  );
  const [extracted] = runCode(byName['Extract Ticket'].parameters.jsCode, {
    headers: { host: 'localhost' },
    body: access,
  });
  assert.equal(extracted.json.requester_email, 'alex.kim@example.com');
  assert.equal(extracted.json.priority, 'P1');
  assert.equal(extracted.json.category, 'access');
  assert.equal(extracted.json.source, 'webhook');
  assert.equal(extracted.json.summary_customer, undefined);

  const [rewritten] = runCode(byName['Rewrite Customer Summary'].parameters.jsCode, extracted.json);
  assert.match(rewritten.json.summary_customer, /as an access request/);
  assert.match(rewritten.json.summary_owner, /\[P1 \| access \| today\]/);
  assert.doesNotMatch(rewritten.json.summary_customer, /\[P1/);
});
