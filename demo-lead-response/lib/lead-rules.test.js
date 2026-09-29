import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACTION,
  OWNER_ALERT_EMAIL,
  STATUS,
  buildOwnerAlert,
  buildQuoteEmail,
  businessHours,
  classifyLead,
  findDuplicate,
  normalizeMessage,
  routeLead,
} from './lead-rules.js';

const quoteSample = JSON.parse(readFileSync(new URL('../samples/quote.json', import.meta.url), 'utf8'));
const existingRow = JSON.parse(
  readFileSync(new URL('../samples/dedupe-existing-row.json', import.meta.url), 'utf8'),
);
const dedupeLead = JSON.parse(
  readFileSync(new URL('../samples/dedupe-new-lead.json', import.meta.url), 'utf8'),
);

function loadSample(name) {
  return JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8'));
}

test('business hours use America/Chicago, weekdays 08:00–17:00', () => {
  assert.equal(businessHours(new Date('2026-09-29T15:00:00.000Z')), 'in_hours');
  assert.equal(businessHours(new Date('2026-10-02T21:30:00.000Z')), 'in_hours');
  assert.equal(businessHours(new Date('2026-10-02T22:00:00.000Z')), 'after_hours');
  assert.equal(businessHours(new Date('2026-09-30T02:30:00.000Z')), 'after_hours');
  assert.equal(businessHours(new Date('2026-10-03T15:00:00.000Z')), 'after_hours');
});

test('classification order is spam, then emergency, then quote, then default quote', () => {
  const emergency = classifyLead(loadSample('emergency-after-hours.json'));
  assert.equal(emergency.intent, 'EMERGENCY');
  assert.equal(emergency.intent_rule, 'emergency_term');
  assert.equal(emergency.business_hours, 'after_hours');
  assert.equal(emergency.ok, true);

  const inHours = classifyLead(loadSample('emergency-in-hours.json'));
  assert.equal(inHours.intent, 'EMERGENCY');
  assert.equal(inHours.business_hours, 'in_hours');

  const quote = classifyLead(quoteSample);
  assert.equal(quote.intent, 'QUOTE');
  assert.equal(quote.intent_rule, 'quote_term');
  assert.equal(quote.phone, '');
  assert.equal(quote.business_hours, 'in_hours');

  const spam = classifyLead(loadSample('spam.json'));
  assert.equal(spam.intent, 'SPAM');
  assert.equal(spam.intent_rule, 'spam_term');

  const spamUrgent = classifyLead(loadSample('spam-with-urgent-word.json'));
  assert.equal(spamUrgent.intent, 'SPAM');

  const emergencyQuote = classifyLead(loadSample('emergency-beats-quote.json'));
  assert.equal(emergencyQuote.intent, 'EMERGENCY');

  const ambiguous = classifyLead(loadSample('ambiguous.json'));
  assert.equal(ambiguous.intent, 'QUOTE');
  assert.equal(ambiguous.intent_rule, 'default_quote_no_keyword');
});

test('term matches are whole words or phrases', () => {
  const fireplace = classifyLead({
    name: 'Avery Stone',
    email: 'avery.stone@example.com',
    message: 'Could I get a quote for a fireplace insert?',
    demo_received_at: '2026-09-29T15:00:00.000Z',
  });
  assert.equal(fireplace.intent, 'QUOTE');
  assert.equal(fireplace.intent_rule, 'quote_term');

  const leaky = classifyLead({
    name: 'Avery Stone',
    email: 'avery.stone@example.com',
    message: 'The faucet is leaky. Could I get a quote?',
    demo_received_at: '2026-09-29T15:00:00.000Z',
  });
  assert.equal(leaky.intent, 'QUOTE');

  assert.equal(normalizeMessage("Can't   wait!!! https://spam.example/offer"), 'cant wait');
});

test('invalid leads are not sendable', () => {
  const invalid = classifyLead(loadSample('invalid-missing-email.json'));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.validation_errors.includes('valid email is required'));
  const routed = routeLead({ lead: invalid, sendResult: 'success' });
  assert.equal(routed.status, STATUS.invalid);
  assert.equal(routed.contacted, false);
  assert.equal(routed.send, null);
});

test('dedupe matches email plus normalized message inside 24 hours', () => {
  const lead = classifyLead(dedupeLead);
  assert.equal(lead.email, 'jamie.rivera@example.com');
  assert.equal(findDuplicate(lead, [existingRow]), 'lead_existing_demo');

  const exactEdge = classifyLead({
    ...dedupeLead,
    demo_received_at: '2026-09-30T15:00:00.000Z',
  });
  assert.equal(findDuplicate(exactEdge, [existingRow]), 'lead_existing_demo');

  const tooOld = classifyLead({
    ...dedupeLead,
    demo_received_at: '2026-09-30T15:00:00.001Z',
  });
  assert.equal(findDuplicate(tooOld, [existingRow]), '');

  const otherMessage = classifyLead({
    ...dedupeLead,
    message: 'Different request about a furnace quote.',
  });
  assert.equal(findDuplicate(otherMessage, [existingRow]), '');

  const otherEmail = classifyLead({
    ...dedupeLead,
    email: 'someone.else@example.com',
  });
  assert.equal(findDuplicate(otherEmail, [existingRow]), '');

  const unparseable = {
    ...existingRow,
    received_at: 'not-a-timestamp',
    lead_id: 'lead_bad_clock',
  };
  assert.equal(findDuplicate(lead, [unparseable]), 'lead_bad_clock');

  const replay = classifyLead(dedupeLead);
  assert.equal(findDuplicate(replay, [replay]), replay.lead_id);
});

test('routing never marks contacted unless a quote send succeeds', () => {
  const emergency = classifyLead(loadSample('emergency-after-hours.json'));
  const inHours = classifyLead(loadSample('emergency-in-hours.json'));
  const quote = classifyLead(quoteSample);
  const spam = classifyLead(loadSample('spam.json'));

  assert.deepEqual(routeLead({ lead: emergency, sendResult: 'success' }), {
    status: STATUS.ownerAlerted,
    contacted: false,
    action: ACTION.alertOwner,
    send: 'owner',
    http: 200,
  });
  assert.equal(routeLead({ lead: emergency, sendResult: 'error' }).contacted, false);
  assert.equal(routeLead({ lead: emergency, sendResult: 'error' }).status, STATUS.ownerAlertFailed);
  assert.equal(
    routeLead({ lead: emergency, sendResult: 'success', sheetUpdate: 'failed' }).contacted,
    false,
  );

  const queued = routeLead({ lead: inHours, sendResult: 'success' });
  assert.equal(queued.status, STATUS.queuedInHours);
  assert.equal(queued.send, null);
  assert.equal(queued.contacted, false);

  assert.equal(routeLead({ lead: quote, sendResult: 'pending' }).contacted, false);
  assert.equal(routeLead({ lead: quote, sendResult: 'error' }).status, STATUS.replyFailed);
  assert.equal(routeLead({ lead: quote, sendResult: 'error' }).contacted, false);
  const sent = routeLead({ lead: quote, sendResult: 'success' });
  assert.equal(sent.status, STATUS.replySent);
  assert.equal(sent.contacted, true);
  assert.equal(sent.send, 'customer');
  assert.equal(
    routeLead({ lead: quote, sendResult: 'success', sheetUpdate: 'failed' }).contacted,
    true,
  );

  assert.equal(routeLead({ lead: spam, sendResult: 'success' }).send, null);
  assert.equal(routeLead({ lead: spam, sendResult: 'success' }).contacted, false);
  assert.equal(routeLead({ lead: quote, isDuplicate: true, sendResult: 'success' }).send, null);
  assert.equal(routeLead({ lead: quote, sheetsAvailable: false }).send, null);
  assert.equal(routeLead({ lead: quote, sheetsAvailable: false }).status, STATUS.dedupeCheckFailed);
});

test('owner alerts go to the placeholder inbox and quote replies go to the lead', () => {
  const lead = classifyLead(loadSample('emergency-after-hours.json'));
  const alert = buildOwnerAlert(lead);
  assert.equal(alert.to, OWNER_ALERT_EMAIL);
  assert.equal(alert.to, 'owner@example.com');
  assert.notEqual(alert.to, lead.email);
  assert.match(alert.text, /was not auto-replied/);
  assert.equal(alert.from, 'dispatch@example.com');

  const quote = classifyLead(quoteSample);
  const reply = buildQuoteEmail(quote);
  assert.equal(reply.to, quote.email);
  assert.match(reply.text, /portfolio demo/);
  assert.equal(reply.from, 'dispatch@example.com');
});
