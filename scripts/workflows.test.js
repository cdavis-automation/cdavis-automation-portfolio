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
