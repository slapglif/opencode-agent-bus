#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

function sendMcpRequest(toolName, args) {
  return new Promise((resolve, reject) => {
    const mcpPath = path.join(__dirname, 'dist', 'mcp-server', 'index.js');
    const proc = spawn('node', [mcpPath], { stdio: ['pipe', 'pipe', 'inherit'] });

    let buffer = '';
    proc.stdout.on('data', (data) => {
      buffer += data.toString();
    });

    proc.on('close', () => {
      try {
        const lines = buffer.split('\n').filter(line => line.trim());
        const lastLine = lines[lines.length - 1];
        const response = JSON.parse(lastLine);
        resolve(response);
      } catch (err) {
        reject(new Error(`Failed to parse response: ${err.message}`));
      }
    });

    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    proc.stdin.write(JSON.stringify(request) + '\n');
    proc.stdin.end();
  });
}

async function runTest() {
  console.log('🧪 Testing Unacked Messages Feature\n');

  try {
    console.log('Step 1: Register Agent A...');
    const registerA = await sendMcpRequest('bus_register_agent', {
      agent_id: 'agent_a',
      session_id: 'session_a',
      metadata: { role: 'sender' }
    });
    console.log('✓ Agent A registered');
    console.log('  Response:', JSON.stringify(JSON.parse(registerA.content[0].text), null, 2));

    console.log('\nStep 2: Register Agent B...');
    const registerB = await sendMcpRequest('bus_register_agent', {
      agent_id: 'agent_b',
      session_id: 'session_b',
      metadata: { role: 'receiver' }
    });
    console.log('✓ Agent B registered');

    console.log('\nStep 3: Subscribe both agents to "coordination" channel...');
    await sendMcpRequest('bus_subscribe', {
      agent_id: 'agent_a',
      session_id: 'session_a',
      channel: 'coordination'
    });
    const subscribeB = await sendMcpRequest('bus_subscribe', {
      agent_id: 'agent_b',
      session_id: 'session_b',
      channel: 'coordination'
    });
    console.log('✓ Both agents subscribed');
    console.log('  Agent B subscribe response:', JSON.stringify(JSON.parse(subscribeB.content[0].text), null, 2));

    console.log('\nStep 4: Agent A sends a message...');
    const sendMsg = await sendMcpRequest('bus_send', {
      channel: 'coordination',
      agent_id: 'agent_a',
      session_id: 'session_a',
      content: 'Hello from Agent A!'
    });
    console.log('✓ Message sent');
    console.log('  Send response:', JSON.stringify(JSON.parse(sendMsg.content[0].text), null, 2));

    console.log('\nStep 5: Agent B sends heartbeat (SHOULD see unacked messages)...');
    const heartbeat1 = await sendMcpRequest('bus_heartbeat', {
      agent_id: 'agent_b',
      session_id: 'session_b',
      status: 'checking'
    });
    const heartbeat1Data = JSON.parse(heartbeat1.content[0].text);
    console.log('✓ Heartbeat sent');
    console.log('  Response:', JSON.stringify(heartbeat1Data, null, 2));

    if (heartbeat1Data.unacked_messages) {
      console.log('\n✅ SUCCESS: Unacked messages detected!');
      console.log(`   Count: ${heartbeat1Data.unacked_messages.count}`);
      console.log(`   Channels: ${heartbeat1Data.unacked_messages.channels.join(', ')}`);
      console.log(`   Summary: ${heartbeat1Data.unacked_messages.summary}`);
    } else {
      console.log('\n❌ FAIL: No unacked_messages field in response!');
      process.exit(1);
    }

    console.log('\nStep 6: Get messages to find message ID...');
    const receiveMsg = await sendMcpRequest('bus_receive', {
      channel: 'coordination',
      agent_id: 'agent_b',
      limit: 10
    });
    const receivedData = JSON.parse(receiveMsg.content[0].text);
    const messageId = receivedData.messages[0].id;
    console.log(`✓ Found message ID: ${messageId}`);

    console.log('\nStep 7: Agent B acknowledges the message...');
    await sendMcpRequest('bus_acknowledge', {
      message_id: messageId,
      agent_id: 'agent_b'
    });
    console.log('✓ Message acknowledged');

    console.log('\nStep 8: Agent B sends heartbeat again (SHOULD NOT see unacked messages)...');
    const heartbeat2 = await sendMcpRequest('bus_heartbeat', {
      agent_id: 'agent_b',
      session_id: 'session_b',
      status: 'idle'
    });
    const heartbeat2Data = JSON.parse(heartbeat2.content[0].text);
    console.log('✓ Heartbeat sent');
    console.log('  Response:', JSON.stringify(heartbeat2Data, null, 2));

    if (!heartbeat2Data.unacked_messages) {
      console.log('\n✅ SUCCESS: No unacked messages after acknowledgment!');
    } else {
      console.log('\n❌ FAIL: Still showing unacked messages after acknowledgment!');
      process.exit(1);
    }

    console.log('\n🎉 All tests passed!\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTest();
