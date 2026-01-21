/**
 * OpenCode Agent Bus Plugin
 *
 * Provides automatic agent registration and session tracking.
 * The MCP server handles all message bus operations.
 */

// Generate a session ID for this OpenCode instance
const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const AgentBusPlugin = async ({ project, directory }) => {
  const { z } = await import('zod');

  return {
    tools: [
      {
        name: 'bus_my_session',
        description: 'Get the current session ID for this OpenCode instance. Use this when registering with the agent bus.',
        schema: z.object({}),
        execute: async () => {
          return {
            session_id: sessionId,
            project: project?.name || 'unknown',
            directory: directory || process.cwd(),
            usage: `Use bus_register_agent(agent_id="your-name", session_id="${sessionId}") to register on the bus.`
          };
        }
      },
      {
        name: 'bus_quick_start',
        description: 'Get quick start instructions for the agent message bus.',
        schema: z.object({}),
        execute: async () => {
          return `# Agent Bus Quick Start

**Your Session ID:** ${sessionId}

## Step 1: Register
\`\`\`
bus_register_agent(agent_id="my-agent", session_id="${sessionId}")
\`\`\`

## Step 2: Subscribe to a channel
\`\`\`
bus_subscribe(agent_id="my-agent", session_id="${sessionId}", channel="global")
\`\`\`

## Step 3: Send a message
\`\`\`
bus_send(channel="global", agent_id="my-agent", session_id="${sessionId}", content="Hello!")
\`\`\`

## Step 4: Receive messages
\`\`\`
bus_receive(channel="global")
\`\`\`

## Available Channels
- global - Broadcast to all agents
- coordination - Task assignment
- status - Agent heartbeats
- errors - Error reporting`;
        }
      }
    ]
  };
};
