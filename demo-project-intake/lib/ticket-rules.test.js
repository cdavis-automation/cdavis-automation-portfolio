import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACCEPTANCE_FALLBACK,
  extractTicket,
  rewriteForCustomer,
} from './ticket-rules.js';

function loadSample(name) {
  return JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8'));
}

const NOW = '2026-09-29T15:00:00.000Z';

test('messy email text becomes an access ticket', () => {
  const ticket = extractTicket(loadSample('access-outage.json'), { now: NOW });
  assert.equal(ticket.ok, true);
  assert.equal(ticket.requester_name, 'Alex Kim');
  assert.equal(ticket.requester_email, 'alex.kim@example.com');
  assert.equal(ticket.title, "Can't log in");
  assert.equal(ticket.priority, 'P1');
  assert.equal(ticket.category, 'access');
  assert.equal(ticket.due_window, 'today');
  assert.match(ticket.acceptance_criteria, /Need access restored today/);
  assert.match(ticket.acceptance_criteria, /open the CRM/);
  assert.match(ticket.summary_owner, /^\[P1 \| access \| today\]/);
  assert.equal(ticket.summary_customer, undefined);
});

test('structured requests pick category, priority, and due window', () => {
  const reporting = extractTicket(loadSample('reporting-request.json'), { now: NOW });
  assert.equal(reporting.priority, 'P2');
  assert.equal(reporting.category, 'reporting');
  assert.equal(reporting.due_window, 'this_week');
  assert.equal(reporting.requester_email, 'priya.shah@example.com');
  assert.match(reporting.acceptance_criteria, /Done when the AE view matches the stage totals/);

  const billing = extractTicket(loadSample('billing-refund.json'), { now: NOW });
  assert.equal(billing.priority, 'P3');
  assert.equal(billing.category, 'billing');
  assert.equal(billing.due_window, 'this_month');

  const bug = extractTicket(loadSample('bug-import.json'), { now: NOW });
  assert.equal(bug.priority, 'P2');
  assert.equal(bug.category, 'bug');
  assert.equal(bug.due_window, 'this_week');

  const vague = extractTicket(loadSample('vague.json'), { now: NOW });
  assert.equal(vague.priority, 'P3');
  assert.equal(vague.category, 'other');
  assert.equal(vague.due_window, 'unspecified');
  assert.equal(vague.acceptance_criteria, ACCEPTANCE_FALLBACK);
});

test('P1 without an explicit day is due today, and access outranks bug', () => {
  const inferred = extractTicket({
    from_name: 'Alex Kim',
    from_email: 'alex.kim@example.com',
    subject: 'SSO outage',
    body: 'Urgent. SSO is down and the team cannot log in. Need access restored.',
  }, { now: NOW });
  assert.equal(inferred.priority, 'P1');
  assert.equal(inferred.due_window, 'today');
  assert.equal(inferred.category, 'access');
});

test('onboarding is its own category and does not outrank an explicit month', () => {
  const onboarding = extractTicket({
    from_name: 'Mina Patel',
    from_email: 'mina.patel@example.com',
    subject: 'Kickoff for the new hire',
    body: 'Need the onboarding checklist this month.',
  }, { now: NOW });
  assert.equal(onboarding.category, 'onboarding');
  assert.equal(onboarding.due_window, 'this_month');
  assert.equal(onboarding.priority, 'P3');
});

test('a request with no email is invalid and is not rewritten on the valid path', () => {
  const invalid = extractTicket(loadSample('invalid-no-email.json'), { now: NOW });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.validation_errors.includes('requester email is required'));
});

test('the single rewrite step speaks to the customer and hides internal priority codes', () => {
  const ticket = extractTicket(loadSample('access-outage.json'), { now: NOW });
  const rewritten = rewriteForCustomer(ticket);
  assert.match(rewritten.summary_customer, /Hi Alex Kim/);
  assert.match(rewritten.summary_customer, /as an access request/);
  assert.match(rewritten.summary_customer, /aiming for today/);
  assert.match(rewritten.summary_customer, /portfolio demo/);
  assert.doesNotMatch(rewritten.summary_customer, /\[P1/);
  assert.match(rewritten.summary_owner, /\[P1 \| access \| today\]/);
  assert.notEqual(rewritten.summary_owner, rewritten.summary_customer);
});
