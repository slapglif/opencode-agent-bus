/**
 * OpenCode Agent Bus Plugin
 *
 * Provides automatic agent registration, message injection hooks,
 * and coordination between OpenCode sessions.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';

// Generate a session ID for this OpenCode instance
const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const AgentBusPlugin = async ({ project, client, $, directory, worktree }) => {
  const { z } = await import('zod');

  // Track registered agent info
  let registeredAgent = null;
  let subscribedChannels = ['global'];

  return {
    tools: [
      {
        name: 'bus_quick_send',
        description: 'Quick send a message to other agents. Auto-registers if not registered.',
        schema: z.object({
          channel: z.string().default('global').describe('Channel to send to'),
          message: z.string().describe('Message content'),
          agent_name: z.string().optional().describe('Your agent name (default: "opencode")')
        }),
        execute: async ({ channel = 'global', message, agent_name = 'opencode' }) => {
          // This is a convenience wrapper - the actual bus_send is in the MCP server
          return `To send this message, use the bus_send MCP tool with:
- channel: "${channel}"
- agent_id: "${agent_name}"
- session_id: "${sessionId}"
- content: ${JSON.stringify(message)}

Or if you need to register first:
1. Call bus_register_agent with agent_id="${agent_name}", session_id="${sessionId}"
2. Call bus_subscribe with channel="${channel}"
3. Call bus_send with the message content`;
        }
      },
      {
        name: 'bus_my_session',
        description: 'Get the current session ID for this OpenCode instance.',
        schema: z.object({}),
        execute: async () => {
          return {
            session_id: sessionId,
            project: project?.name || 'unknown',
            directory: directory || process.cwd(),
            registered_agent: registeredAgent
          };
        }
      }
    ],

    // Hook: Inject agent bus context on first message
    'chat.message': async ({ messages, params }) => {
      // Only inject on first user message in session
      if (messages.length > 2) return;

      const agentBusContext = `
<agent-bus-available>
You have access to a multi-agent message bus for coordinating with other AI agents.

**Session ID:** ${sessionId}
**Project:** ${project?.name || 'unknown'}

**Available MCP Tools:**
- \`bus_register_agent\` - Register on the bus (do this first!)
- \`bus_subscribe\` - Subscribe to channels
- \`bus_send\` - Send messages to channels
- \`bus_receive\` - Receive messages from channels
- \`bus_request\` / \`bus_respond\` - Request-response pattern
- \`bus_list_agents\` - See active agents
- \`bus_list_channels\` - See available channels

**Quick Start:**
1. Register: \`bus_register_agent(agent_id="my-agent", session_id="${sessionId}")\`
2. Subscribe: \`bus_subscribe(agent_id="my-agent", session_id="${sessionId}", channel="global")\`
3. Send: \`bus_send(channel="global", agent_id="my-agent", session_id="${sessionId}", content="Hello!")\`
4. Receive: \`bus_receive(channel="global")\`

**Default Channels:**
- \`global\` - Broadcast to all agents
- \`coordination\` - Task assignment and coordination
- \`status\` - Agent status and heartbeats
- \`errors\` - Error reporting

For detailed usage, use skill: \`agent-message-bus\`
</agent-bus-available>`;

      // Inject as system context
      return {
        messages: [
          ...messages,
          {
            role: 'system',
            content: agentBusContext
          }
        ]
      };
    },

    // Hook: Handle session events
    event: async ({ event }) => {
      // Track session lifecycle for potential cleanup
      if (event.type === 'session.deleted' || event.type === 'session.error') {
        // Could notify other agents that this session is ending
        console.error(`Agent bus: Session ${sessionId} ending`);
      }
    },

    // Hook: Re-inject context after compaction
    'session.compacted': async () => {
      return {
        context: `<agent-bus-reminder>
Session ID for agent bus: ${sessionId}
Use bus_* MCP tools for multi-agent communication.
</agent-bus-reminder>`
      };
    }
  };
};
