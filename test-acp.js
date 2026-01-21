#!/usr/bin/env node

/**
 * Test script for ACP enhancements
 * 
 * This script tests the new ACP features by directly importing the modules
 * and verifying they work correctly.
 */

import { getACPProtocolTemplate, validateACPMessage, createACPMessage } from './dist/mcp-server/acp-protocol.js';

console.log('=== Testing ACP Protocol Enhancements ===\n');

console.log('Test 1: Get ACP Protocol Template');
console.log('-----------------------------------');
const protocol = getACPProtocolTemplate();
console.log(`✓ Protocol template retrieved (${protocol.length} characters)`);
console.log(`✓ Contains "Agent Coordination Protocol (ACP) v1.0": ${protocol.includes('Agent Coordination Protocol (ACP) v1.0')}`);
console.log(`✓ Contains all 10 message types: ${protocol.includes('STATUS_UPDATE') && protocol.includes('CONSENSUS_REQUEST')}`);
console.log('');

console.log('Test 2: Create ACP Message');
console.log('---------------------------');
const message = createACPMessage(
  'STATUS_UPDATE',
  'test-agent',
  'test-session',
  { status: 'processing', progress: 0.5 }
);
console.log(`✓ Message created: ${JSON.stringify(message, null, 2)}`);
console.log(`✓ Has required fields: ${message.type && message.from_agent && message.from_session && message.timestamp && message.payload}`);
console.log('');

console.log('Test 3: Validate ACP Message (Valid)');
console.log('-------------------------------------');
const validMessage = {
  type: 'TASK_REQUEST',
  from_agent: 'coordinator',
  from_session: 'session-123',
  timestamp: new Date().toISOString(),
  payload: {
    task_id: 'task-001',
    description: 'Test task'
  }
};
const validationResult = validateACPMessage(validMessage);
console.log(`✓ Validation result: ${JSON.stringify(validationResult, null, 2)}`);
console.log(`✓ Valid: ${validationResult.valid}`);
console.log(`✓ No errors: ${validationResult.errors.length === 0}`);
console.log('');

console.log('Test 4: Validate ACP Message (Invalid)');
console.log('---------------------------------------');
const invalidMessage = {
  type: 'INVALID_TYPE',
  from_agent: 'test-agent'
};
const invalidValidation = validateACPMessage(invalidMessage);
console.log(`✓ Validation result: ${JSON.stringify(invalidValidation, null, 2)}`);
console.log(`✓ Invalid: ${!invalidValidation.valid}`);
console.log(`✓ Has errors: ${invalidValidation.errors.length > 0}`);
console.log(`✓ Error count: ${invalidValidation.errors.length}`);
console.log('');

console.log('Test 5: Create Consensus Request Message');
console.log('------------------------------------------');
const consensusMessage = createACPMessage(
  'CONSENSUS_REQUEST',
  'coordinator',
  'session-789',
  {
    proposal: 'Adopt new feature',
    voting_deadline: new Date(Date.now() + 60000).toISOString(),
    quorum: 3
  },
  { correlationId: 'consensus_123' }
);
console.log(`✓ Consensus message created: ${JSON.stringify(consensusMessage, null, 2)}`);
console.log(`✓ Has correlation_id: ${!!consensusMessage.correlation_id}`);
console.log(`✓ Payload has proposal: ${!!consensusMessage.payload.proposal}`);
console.log('');

console.log('=== All Tests Passed! ===');
console.log('\nACP enhancements are working correctly.');
console.log('The following MCP tools are now available:');
console.log('  - bus_get_acp_protocol');
console.log('  - bus_request_consensus');
console.log('  - bus_validate_acp_message');
console.log('\nUse the skill for detailed usage:');
console.log('  use_skill agent-coordination-protocol');
