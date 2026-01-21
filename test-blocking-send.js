import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function startMcpServer() {
  const serverPath = join(__dirname, 'dist', 'mcp-server', 'index.js');
  return spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function sendRequest(server, id, method, params) {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    let responseData = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to request ${id}`));
    }, 10000);

    const onData = (data) => {
      responseData += data.toString();
      const lines = responseData.split('\n');

      for (let i = 0; i < lines.length - 1; i++) {
        try {
          const response = JSON.parse(lines[i]);
          if (response.id === id) {
            clearTimeout(timeout);
            server.stdout.off('data', onData);
            resolve(response);
            return;
          }
        } catch {}
      }

      responseData = lines[lines.length - 1];
    };

    server.stdout.on('data', onData);
    server.stdin.write(JSON.stringify(request) + '\n');
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🚀 Starting agent-bus MCP server...\n');
  const server = startMcpServer();
  
  await sleep(500);

  let testsPassed = 0;
  let testsFailed = 0;

  try {
    console.log('📝 TEST 1: Register two agents\n');
    const agent1Result = await sendRequest(server, 1, 'tools/call', {
      name: 'bus_register_agent',
      arguments: { agent_id: 'agent1', session_id: 'session1' }
    });
    console.log('✓ Agent1 registered:', JSON.parse(agent1Result.result.content[0].text).success);

    const agent2Result = await sendRequest(server, 2, 'tools/call', {
      name: 'bus_register_agent',
      arguments: { agent_id: 'agent2', session_id: 'session2' }
    });
    console.log('✓ Agent2 registered:', JSON.parse(agent2Result.result.content[0].text).success);
    testsPassed++;

    console.log('\n📝 TEST 2: Subscribe both agents to coordination channel\n');
    await sendRequest(server, 3, 'tools/call', {
      name: 'bus_subscribe',
      arguments: { agent_id: 'agent1', session_id: 'session1', channel: 'coordination' }
    });
    console.log('✓ Agent1 subscribed');

    await sendRequest(server, 4, 'tools/call', {
      name: 'bus_subscribe',
      arguments: { agent_id: 'agent2', session_id: 'session2', channel: 'coordination' }
    });
    console.log('✓ Agent2 subscribed');
    testsPassed++;

    console.log('\n📝 TEST 3: Agent2 sends message to Agent1\n');
    const sendResult1 = await sendRequest(server, 5, 'tools/call', {
      name: 'bus_send',
      arguments: {
        channel: 'coordination',
        agent_id: 'agent2',
        session_id: 'session2',
        content: JSON.stringify({ type: 'TEST', message: 'Hello Agent1!' })
      }
    });
    const sendData1 = JSON.parse(sendResult1.result.content[0].text);
    console.log('✓ Message sent:', sendData1.success);
    console.log('  Message ID:', sendData1.message.id);
    testsPassed++;

    console.log('\n📝 TEST 4: Agent1 attempts to send WITHOUT reading (should BLOCK)\n');
    const blockedSendResult = await sendRequest(server, 6, 'tools/call', {
      name: 'bus_send',
      arguments: {
        channel: 'coordination',
        agent_id: 'agent1',
        session_id: 'session1',
        content: JSON.stringify({ type: 'TEST', message: 'This should be blocked' })
      }
    });
    const blockedData = JSON.parse(blockedSendResult.result.content[0].text);
    if (!blockedData.success && blockedData.blocked === true && blockedData.block_reason === 'UNACKED_MESSAGES_PENDING') {
      console.log('✅ BLOCKED as expected!');
      console.log('   Block reason:', blockedData.block_reason);
      console.log('   Message:', blockedData.message);
      console.log('   Unacked count:', blockedData.unacked_messages.count);
      console.log('   Guidance:', blockedData.guidance);
      testsPassed++;
    } else {
      console.log('❌ FAILED: Should have been blocked but was not!');
      console.log('   Response:', blockedData);
      testsFailed++;
    }

    console.log('\n📝 TEST 5: Agent1 sends with force_send=true (should SUCCEED)\n');
    const forceSendResult = await sendRequest(server, 7, 'tools/call', {
      name: 'bus_send',
      arguments: {
        channel: 'coordination',
        agent_id: 'agent1',
        session_id: 'session1',
        content: JSON.stringify({ type: 'TEST', message: 'Force send test' }),
        force_send: true
      }
    });
    const forceData = JSON.parse(forceSendResult.result.content[0].text);
    if (forceData.success) {
      console.log('✅ Force send SUCCEEDED as expected!');
      testsPassed++;
    } else {
      console.log('❌ FAILED: Force send should have succeeded');
      testsFailed++;
    }

    console.log('\n📝 TEST 6: Agent1 reads and acknowledges ALL messages\n');
    const receiveResult = await sendRequest(server, 8, 'tools/call', {
      name: 'bus_receive',
      arguments: {
        channel: 'coordination',
        agent_id: 'agent1',
        limit: 10
      }
    });
    const receiveData = JSON.parse(receiveResult.result.content[0].text);
    console.log('✓ Received', receiveData.count, 'message(s)');

    for (let i = 0; i < receiveData.messages.length; i++) {
      const messageId = receiveData.messages[i].id;
      await sendRequest(server, 9 + i, 'tools/call', {
        name: 'bus_acknowledge',
        arguments: {
          message_id: messageId,
          agent_id: 'agent1'
        }
      });
      console.log('✓ Message', i + 1, 'acknowledged');
    }
    testsPassed++;

    console.log('\n📝 TEST 7: Agent1 sends again (should SUCCEED now)\n');
    const sendResult2 = await sendRequest(server, 20, 'tools/call', {
      name: 'bus_send',
      arguments: {
        channel: 'coordination',
        agent_id: 'agent1',
        session_id: 'session1',
        content: JSON.stringify({ type: 'TEST', message: 'Now I can send!' })
      }
    });
    const sendData2 = JSON.parse(sendResult2.result.content[0].text);
    if (sendData2.success) {
      console.log('✅ Send SUCCEEDED after acknowledging!');
      testsPassed++;
    } else {
      console.log('❌ FAILED: Should have succeeded after ack');
      console.log('   Error:', sendData2);
      testsFailed++;
    }

    console.log('\n📝 TEST 7.5: Agent2 acknowledges all their messages\n');
    const agent2Receive = await sendRequest(server, 21, 'tools/call', {
      name: 'bus_receive',
      arguments: {
        channel: 'coordination',
        agent_id: 'agent2',
        limit: 10
      }
    });
    const agent2Data = JSON.parse(agent2Receive.result.content[0].text);
    console.log('✓ Agent2 received', agent2Data.count, 'message(s)');
    for (let i = 0; i < agent2Data.messages.length; i++) {
      await sendRequest(server, 22 + i, 'tools/call', {
        name: 'bus_acknowledge',
        arguments: {
          message_id: agent2Data.messages[i].id,
          agent_id: 'agent2'
        }
      });
    }
    console.log('✓ Agent2 acknowledged all messages');

    console.log('\n📝 TEST 8: Test wait_for_response blocking send\n');
    const requestStartTime = Date.now();
    
    const requestPromise = sendRequest(server, 30, 'tools/call', {
      name: 'bus_send',
      arguments: {
        channel: 'coordination',
        agent_id: 'agent1',
        session_id: 'session1',
        content: JSON.stringify({ type: 'REQUEST', message: 'Need help!' }),
        wait_for_response: true,
        wait_timeout_ms: 5000
      }
    });

    await sleep(1000);

    const respondPromise = sendRequest(server, 31, 'tools/call', {
      name: 'bus_receive',
      arguments: {
        channel: 'coordination',
        agent_id: 'agent2',
        limit: 10
      }
    }).then(async (result) => {
      const data = JSON.parse(result.result.content[0].text);
      if (data.messages.length > 0) {
        const requestMsg = data.messages.find(m => {
          try {
            const content = JSON.parse(m.content);
            return content.type === 'REQUEST';
          } catch {
            return false;
          }
        });
        
        if (requestMsg && requestMsg.correlation_id) {
          await sendRequest(server, 32, 'tools/call', {
            name: 'bus_respond',
            arguments: {
              correlation_id: requestMsg.correlation_id,
              agent_id: 'agent2',
              session_id: 'session2',
              content: JSON.stringify({ type: 'RESPONSE', message: 'Here is your help!' })
            }
          });
          console.log('✓ Agent2 sent response');
        }
      }
    });

    const requestResult = await requestPromise;
    const requestDuration = Date.now() - requestStartTime;
    const requestData = JSON.parse(requestResult.result.content[0].text);
    
    if (requestData.wait_for_response_result && requestData.wait_for_response_result.received) {
      console.log('✅ wait_for_response SUCCEEDED!');
      console.log('   Response received in', requestDuration, 'ms');
      console.log('   Response content:', requestData.wait_for_response_result.response.content.substring(0, 50) + '...');
      testsPassed++;
    } else {
      console.log('❌ FAILED: wait_for_response did not receive response');
      console.log('   Result:', requestData.wait_for_response_result);
      testsFailed++;
    }

    await respondPromise;

    console.log('\n📊 TEST SUMMARY\n');
    console.log('✅ Tests Passed:', testsPassed);
    console.log('❌ Tests Failed:', testsFailed);
    console.log('📈 Success Rate:', ((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1) + '%');

    if (testsFailed === 0) {
      console.log('\n🎉 ALL TESTS PASSED!\n');
    }

  } catch (error) {
    console.error('❌ Test error:', error);
    testsFailed++;
  } finally {
    server.kill();
    process.exit(testsFailed === 0 ? 0 : 1);
  }
}

runTests();
