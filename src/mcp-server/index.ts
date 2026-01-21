#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { initializeDatabase } from './database.js';
import { MessageBus } from './bus.js';
import { FileTransferManager } from './file-transfer.js';
import { MessageScheduler } from './scheduler.js';
import { ConfigManager } from './config.js';
import { RegistryClient } from './registry-client.js';
import { HealthMonitor } from './health-monitor.js';
import { formatMcpResponse } from '../utils/toon-formatter.js';
import { Orchestrator } from './orchestrator.js';
import { getACPProtocolTemplate, validateACPMessage, createACPMessage } from './acp-protocol.js';
import { checkUnackedMessages, type UnackedSummary } from './unacked-checker.js';

// Zod validation schemas for critical tools
const RegisterAgentSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required'),
  session_id: z.string().min(1, 'session_id is required'),
  metadata: z.record(z.unknown()).optional()
});

const SendMessageSchema = z.object({
  channel: z.string().min(1, 'channel is required'),
  agent_id: z.string().min(1, 'agent_id is required'),
  session_id: z.string().min(1, 'session_id is required'),
  content: z.string().min(1, 'content is required'),
  priority: z.number().optional(),
  ttl_seconds: z.number().positive().optional(),
  force_send: z.boolean().optional(),
  wait_for_ack: z.boolean().optional(),
  wait_for_response: z.boolean().optional(),
  wait_timeout_ms: z.number().positive().optional()
});

const RequestSchema = z.object({
  channel: z.string().min(1, 'channel is required'),
  agent_id: z.string().min(1, 'agent_id is required'),
  session_id: z.string().min(1, 'session_id is required'),
  content: z.string().min(1, 'content is required'),
  ttl_seconds: z.number().positive().optional()
});

const RespondSchema = z.object({
  correlation_id: z.string().min(1, 'correlation_id is required'),
  agent_id: z.string().min(1, 'agent_id is required'),
  session_id: z.string().min(1, 'session_id is required'),
  content: z.string().min(1, 'content is required')
});

const db = initializeDatabase();
const bus = new MessageBus(db);
const orchestrator = new Orchestrator(db);
const fileTransfer = new FileTransferManager(db, './file-storage');
const scheduler = new MessageScheduler(db, bus);
const configManager = new ConfigManager();
const healthMonitor = new HealthMonitor(db, configManager);

// Start scheduler
scheduler.start();

function formatResponse(data: any, format = 'toon'): string {
  return format === 'toon' ? formatMcpResponse(data) : JSON.stringify(data, null, 2);
}

function attachUnackedInfo(responseData: any, agentId: string, sessionId: string): any {
  const unackedSummary = checkUnackedMessages(agentId, sessionId, db);
  
  if (unackedSummary) {
    return {
      ...responseData,
      unacked_messages: {
        count: unackedSummary.count,
        channels: unackedSummary.channels,
        oldest_message_age_seconds: unackedSummary.oldest_message_age_seconds,
        summary: unackedSummary.summary
      }
    };
  }
  
  return responseData;
}

// Tool definitions
const tools: Tool[] = [
  {
    name: 'bus_register_agent',
    description: 'Register this agent on the message bus. Call this at the start of any session that needs to communicate with other agents.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Unique identifier for this agent (e.g., "code-reviewer", "test-runner")' },
        session_id: { type: 'string', description: 'Current session ID (use a unique ID per conversation)' },
        metadata: { type: 'object', description: 'Optional metadata about the agent capabilities' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['agent_id', 'session_id']
    }
  },
  {
    name: 'bus_subscribe',
    description: 'Subscribe to a channel to receive messages. Agents only receive messages from channels they subscribe to.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        session_id: { type: 'string', description: 'Your session ID' },
        channel: { type: 'string', description: 'Channel name to subscribe to (e.g., "global", "coordination", "my-team")' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['agent_id', 'session_id', 'channel']
    }
  },
  {
    name: 'bus_unsubscribe',
    description: 'Unsubscribe from a channel to stop receiving its messages.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        session_id: { type: 'string', description: 'Your session ID' },
        channel: { type: 'string', description: 'Channel name to unsubscribe from' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['agent_id', 'session_id', 'channel']
    }
  },
  {
    name: 'bus_send',
    description: 'Send a message to a channel. All agents subscribed to this channel will be able to receive it. Blocks if unacknowledged external messages exist (unless force_send=true). Optionally waits for acknowledgment or response.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel to send message to' },
        agent_id: { type: 'string', description: 'Your agent ID (sender)' },
        session_id: { type: 'string', description: 'Your session ID' },
        content: { type: 'string', description: 'Message content (can be JSON for structured data)' },
        priority: { type: 'number', description: 'Message priority (higher = more urgent). Default: 0' },
        ttl_seconds: { type: 'number', description: 'Time-to-live in seconds. Default: 3600 (1 hour)' },
        force_send: { type: 'boolean', description: 'Skip unacked message check. Default: false' },
        wait_for_ack: { type: 'boolean', description: 'Block until message is acknowledged or timeout. Default: false' },
        wait_for_response: { type: 'boolean', description: 'Block until response received (sets message_type to request). Default: false' },
        wait_timeout_ms: { type: 'number', description: 'Timeout in milliseconds for wait operations. Default: 30000' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['channel', 'agent_id', 'session_id', 'content']
    }
  },
  {
    name: 'bus_receive',
    description: 'Receive messages from a channel. Returns unacknowledged messages by default.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel to receive messages from' },
        agent_id: { type: 'string', description: 'Your agent ID (to exclude your own messages)' },
        limit: { type: 'number', description: 'Maximum number of messages to receive. Default: 10' },
        since: { type: 'string', description: 'Only get messages after this ISO timestamp' },
        include_acknowledged: { type: 'boolean', description: 'Include already acknowledged messages. Default: false' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['channel']
    }
  },
  {
    name: 'bus_acknowledge',
    description: 'Acknowledge receipt/processing of a message. Prevents the message from showing up in future bus_receive calls.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'ID of the message to acknowledge' },
        agent_id: { type: 'string', description: 'Your agent ID (for tracking who acknowledged)' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['message_id', 'agent_id']
    }
  },
  {
    name: 'bus_request',
    description: 'Send a request and wait for responses from other agents. Use for request-response patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel to send request to' },
        agent_id: { type: 'string', description: 'Your agent ID' },
        session_id: { type: 'string', description: 'Your session ID' },
        content: { type: 'string', description: 'Request content' },
        ttl_seconds: { type: 'number', description: 'How long to wait for responses. Default: 60' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['channel', 'agent_id', 'session_id', 'content']
    }
  },
  {
    name: 'bus_respond',
    description: 'Send a response to a previous request.',
    inputSchema: {
      type: 'object',
      properties: {
        correlation_id: { type: 'string', description: 'Correlation ID from the original request message' },
        agent_id: { type: 'string', description: 'Your agent ID' },
        session_id: { type: 'string', description: 'Your session ID' },
        content: { type: 'string', description: 'Response content' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['correlation_id', 'agent_id', 'session_id', 'content']
    }
  },
  {
    name: 'bus_get_responses',
    description: 'Get all responses for a previous request.',
    inputSchema: {
      type: 'object',
      properties: {
        correlation_id: { type: 'string', description: 'Correlation ID from the original request' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['correlation_id']
    }
  },
  {
    name: 'bus_list_channels',
    description: 'List all available channels on the message bus.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      }
    }
  },
  {
    name: 'bus_create_channel',
    description: 'Create a new channel for message routing.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Channel name (lowercase, no spaces)' },
        description: { type: 'string', description: 'Channel description' },
        ttl_seconds: { type: 'number', description: 'Default message TTL for this channel. Default: 3600' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['name']
    }
  },
  {
    name: 'bus_list_agents',
    description: 'List all active agents on the message bus.',
    inputSchema: {
      type: 'object',
      properties: {
        active_within_seconds: { type: 'number', description: 'Only show agents active within this many seconds. Default: 300' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      }
    }
  },
  {
    name: 'bus_heartbeat',
    description: 'Send a heartbeat to indicate this agent is still active. Call periodically during long-running tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        session_id: { type: 'string', description: 'Your session ID' },
        status: { type: 'string', description: 'Optional status message (e.g., "processing", "idle", "waiting")' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['agent_id', 'session_id']
    }
  },
  {
    name: 'bus_upload_file',
    description: 'Upload a file to the message bus for sharing with other agents. Supports base64-encoded file data.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        session_id: { type: 'string', description: 'Your session ID' },
        file_name: { type: 'string', description: 'Name of the file' },
        file_data: { type: 'string', description: 'Base64-encoded file content' },
        content_type: { type: 'string', description: 'MIME type (e.g., "text/plain", "application/json")' },
        recipients: { type: 'array', items: { type: 'string' }, description: 'Agent IDs that can access this file' },
        ttl_seconds: { type: 'number', description: 'Time-to-live in seconds. Default: 3600' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['agent_id', 'session_id', 'file_name', 'file_data', 'content_type']
    }
  },
  {
    name: 'bus_download_file',
    description: 'Download a file from the message bus. Returns base64-encoded file content.',
    inputSchema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'File ID to download' },
        agent_id: { type: 'string', description: 'Your agent ID (for access control)' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['file_id', 'agent_id']
    }
  },
  {
    name: 'bus_list_files',
    description: 'List available files on the message bus that you can access.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        include_expired: { type: 'boolean', description: 'Include expired files. Default: false' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['agent_id']
    }
  },
  {
    name: 'bus_schedule_message',
    description: 'Schedule a message to be sent at a specific time or on a recurring schedule.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel to send message to' },
        agent_id: { type: 'string', description: 'Your agent ID' },
        session_id: { type: 'string', description: 'Your session ID' },
        content: { type: 'string', description: 'Message content' },
        schedule_for: { type: 'string', description: 'ISO datetime (e.g., "2025-01-20T15:30:00Z") or schedule expression (e.g., "interval:3600" for hourly)' },
        recurrence: { type: 'string', description: 'Optional: cron expression for recurring messages (e.g., "*/5 * * * *" for every 5 minutes)' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['channel', 'agent_id', 'session_id', 'content', 'schedule_for']
    }
  },
  {
    name: 'bus_list_scheduled',
    description: 'List all scheduled messages.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Filter by agent ID (optional)' },
        channel: { type: 'string', description: 'Filter by channel (optional)' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      }
    }
  },
  {
    name: 'bus_cancel_scheduled',
    description: 'Cancel a scheduled message.',
    inputSchema: {
      type: 'object',
      properties: {
        schedule_id: { type: 'string', description: 'ID of the scheduled message to cancel' },
        agent_id: { type: 'string', description: 'Your agent ID (must be the sender)' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['schedule_id', 'agent_id']
    }
  },
  {
    name: 'bus_orchestrate',
    description: 'Orchestrate tasks between agents. Single tool with sub-commands for context efficiency.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { 
          type: 'string', 
          enum: ['create_task', 'assign_task', 'accept_task', 'submit_result', 'approve_result', 'list_tasks', 'get_status'],
          description: 'Orchestration command to execute'
        },
        task_id: { type: 'string', description: 'Task ID (required for assign, accept, submit, approve)' },
        agent_id: { type: 'string', description: 'Agent ID (required for create, assign, accept, submit, approve)' },
        title: { type: 'string', description: 'Task title (required for create_task)' },
        description: { type: 'string', description: 'Task description (optional for create_task)' },
        result_data: { type: 'string', description: 'Result data (required for submit_result)' },
        approval_notes: { type: 'string', description: 'Approval notes (optional for approve_result)' },
        status: { type: 'string', description: 'Status filter (optional for list_tasks)' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['command']
    }
  },
  {
    name: 'bus_get_acp_protocol',
    description: 'Get the Agent Coordination Protocol (ACP) v1.0 specification. Returns comprehensive documentation for multi-agent coordination including message types, consensus protocol, task handoff automation, and example workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['markdown', 'json'], description: 'Response format. Default: markdown' }
      }
    }
  },
  {
    name: 'bus_request_consensus',
    description: 'Request consensus from multiple agents on a proposal. Automatically sends CONSENSUS_REQUEST messages and collects CONSENSUS_RESPONSE votes. Returns aggregated results when quorum is reached or voting deadline expires.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel to send consensus request to. Default: "coordination"' },
        agent_id: { type: 'string', description: 'Your agent ID (requester)' },
        session_id: { type: 'string', description: 'Your session ID' },
        proposal: { type: 'string', description: 'Proposal description for agents to vote on' },
        proposal_data: { type: 'object', description: 'Optional: Additional structured data about the proposal' },
        target_agents: { type: 'array', items: { type: 'string' }, description: 'Optional: Specific agent IDs to request votes from' },
        quorum: { type: 'number', description: 'Minimum number of votes required. Default: majority of target_agents or 2' },
        voting_deadline_seconds: { type: 'number', description: 'Seconds to wait for votes. Default: 60' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['agent_id', 'session_id', 'proposal']
    }
  },
  {
    name: 'bus_validate_acp_message',
    description: 'Validate that a message conforms to the Agent Coordination Protocol (ACP) v1.0 specification. Checks for required fields, valid message types, and proper structure.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'object', description: 'Message object to validate against ACP spec' },
        format: { type: 'string', enum: ['json', 'toon'], description: 'Response format. Default: toon' }
      },
      required: ['message']
    }
  }
];

// Create server
const server = new Server(
  {
    name: 'opencode-agent-bus',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: { listChanged: true },
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'bus_register_agent': {
        const { agent_id, session_id, metadata } = RegisterAgentSchema.parse(args);
        const agent = bus.registerAgent(agent_id, session_id, metadata ?? {});
        const responseData = attachUnackedInfo({ success: true, agent }, agent_id, session_id);
        return { content: [{ type: 'text', text: JSON.stringify(responseData, null, 2) }] };
      }

      case 'bus_subscribe': {
        const { agent_id, session_id, channel } = args as { agent_id: string; session_id: string; channel: string };
        bus.subscribeToChannel(agent_id, session_id, channel);
        const responseData = attachUnackedInfo({ success: true, message: `Subscribed to channel: ${channel}` }, agent_id, session_id);
        return { content: [{ type: 'text', text: JSON.stringify(responseData) }] };
      }

      case 'bus_unsubscribe': {
        const { agent_id, session_id, channel } = args as { agent_id: string; session_id: string; channel: string };
        bus.unsubscribeFromChannel(agent_id, session_id, channel);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Unsubscribed from channel: ${channel}` }) }] };
      }

      case 'bus_send': {
        const { channel, agent_id, session_id, content, priority, ttl_seconds, force_send, wait_for_ack, wait_for_response, wait_timeout_ms } = SendMessageSchema.parse(args);
        
        const agent = bus.getAgent(agent_id, session_id);
        if (!agent) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Agent ${agent_id} not registered` }) }] };
        }

        let subscribedChannels: string[] = [];
        try {
          subscribedChannels = JSON.parse(agent.subscribed_channels) as string[];
        } catch {
          subscribedChannels = [];
        }

        if (!force_send && subscribedChannels.length > 0) {
          const hasUnacked = bus.hasUnackedExternalMessages(agent_id, subscribedChannels);
          if (hasUnacked) {
            const unackedInfo = bus.getUnackedExternalMessages(agent_id, subscribedChannels);
            return { 
              content: [{ 
                type: 'text', 
                text: JSON.stringify({ 
                  success: false,
                  blocked: true,
                  block_reason: 'UNACKED_MESSAGES_PENDING',
                  message: `Send blocked: You have ${unackedInfo.count} unacknowledged message(s) from other agents in channels: ${unackedInfo.channels.join(', ')}. This is EXPECTED blocking behavior (not an error). Read and acknowledge them first using bus_receive and bus_acknowledge, or use force_send=true to bypass this check.`,
                  unacked_messages: {
                    count: unackedInfo.count,
                    channels: unackedInfo.channels,
                    oldest_message_age_seconds: Math.round(unackedInfo.oldest_age_seconds ?? 0)
                  },
                  guidance: "This is not an error to fix. This is the blocking send feature preventing message spam. Read your pending messages with bus_receive, acknowledge them with bus_acknowledge, then retry sending."
                }, null, 2) 
              }] 
            };
          }
        }

        let message;
        if (wait_for_response) {
          message = bus.sendRequest(channel, agent_id, session_id, content, ttl_seconds ?? 60);
        } else {
          message = bus.sendMessage(channel, agent_id, session_id, content, {
            priority,
            ttlSeconds: ttl_seconds
          });
        }

        let responseData: any = { success: true, message };

        if (wait_for_ack) {
          const timeoutMs = wait_timeout_ms ?? 30000;
          const acknowledged = await bus.waitForAck(message.id, timeoutMs);
          responseData.wait_for_ack_result = {
            acknowledged,
            timeout_ms: timeoutMs,
            message: acknowledged ? 'Message was acknowledged' : `Timeout after ${timeoutMs}ms without acknowledgment`
          };
        }

        if (wait_for_response) {
          const timeoutMs = wait_timeout_ms ?? 30000;
          const response = await bus.waitForResponse(message.correlation_id!, timeoutMs);
          responseData.wait_for_response_result = {
            received: response !== null,
            timeout_ms: timeoutMs,
            response: response,
            message: response ? 'Response received' : `Timeout after ${timeoutMs}ms without response`
          };
        }

        responseData = attachUnackedInfo(responseData, agent_id, session_id);
        return { content: [{ type: 'text', text: JSON.stringify(responseData, null, 2) }] };
      }

      case 'bus_receive': {
        const { channel, agent_id, limit, since, include_acknowledged } = args as {
          channel: string; agent_id?: string; limit?: number; since?: string; include_acknowledged?: boolean;
        };
        const messages = bus.getMessages(channel, {
          limit: limit ?? 10,
          since,
          unacknowledgedOnly: !include_acknowledged,
          excludeSender: agent_id
        });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, count: messages.length, messages }, null, 2) }] };
      }

      case 'bus_acknowledge': {
        const { message_id, agent_id } = args as { message_id: string; agent_id: string };
        const acknowledged = bus.acknowledgeMessage(message_id, agent_id);
        return { content: [{ type: 'text', text: JSON.stringify({ success: acknowledged, message_id }) }] };
      }

      case 'bus_request': {
        const { channel, agent_id, session_id, content, ttl_seconds } = RequestSchema.parse(args);
        const message = bus.sendRequest(channel, agent_id, session_id, content, ttl_seconds ?? 60);
        return { content: [{ type: 'text', text: JSON.stringify({
          success: true,
          message,
          note: `Use correlation_id "${message.correlation_id}" with bus_get_responses to check for replies`
        }, null, 2) }] };
      }

      case 'bus_respond': {
        const { correlation_id, agent_id, session_id, content } = RespondSchema.parse(args);
        const message = bus.sendResponse(correlation_id, agent_id, session_id, content);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message }, null, 2) }] };
      }

      case 'bus_get_responses': {
        const { correlation_id } = args as { correlation_id: string };
        const responses = bus.getResponses(correlation_id);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, count: responses.length, responses }, null, 2) }] };
      }

      case 'bus_list_channels': {
        const channels = bus.listChannels();
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, channels }, null, 2) }] };
      }

      case 'bus_create_channel': {
        const { name, description, ttl_seconds } = args as { name: string; description?: string; ttl_seconds?: number };
        const channel = bus.createChannel(name, description ?? '', ttl_seconds ?? 3600);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, channel }, null, 2) }] };
      }

      case 'bus_list_agents': {
        const { active_within_seconds } = args as { active_within_seconds?: number };
        const agents = bus.listAgents(active_within_seconds ?? 300);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, count: agents.length, agents }, null, 2) }] };
      }

      case 'bus_heartbeat': {
        const { agent_id, session_id, status } = args as { agent_id: string; session_id: string; status?: string };
        bus.registerAgent(agent_id, session_id, { status: status ?? 'active', heartbeat: new Date().toISOString() });
        if (status) {
          bus.sendMessage('status', agent_id, session_id, JSON.stringify({ status, timestamp: new Date().toISOString() }), {
            ttlSeconds: 300
          });
        }
        const responseData = attachUnackedInfo({ success: true, message: 'Heartbeat recorded' }, agent_id, session_id);
        return { content: [{ type: 'text', text: JSON.stringify(responseData) }] };
      }

      case 'bus_upload_file': {
        const { agent_id, session_id, file_name, file_data, content_type, recipients, ttl_seconds, format } = args as {
          agent_id: string;
          session_id: string;
          file_name: string;
          file_data: string;
          content_type: string;
          recipients?: string[];
          ttl_seconds?: number;
          format?: string;
        };
        const fileId = `file_${Date.now()}_${file_name}`;
        const uploadedAt = new Date().toISOString();
        const expiresAt = ttl_seconds ? new Date(Date.now() + ttl_seconds * 1000).toISOString() : null;
        
        db.prepare(`
          INSERT INTO file_transfers (
            id, filename, mime_type, size_bytes, uploader_agent, uploader_session,
            storage_path, checksum_sha256, uploaded_at, expires_at, access_mode,
            allowed_agents, download_count, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fileId, file_name, content_type, file_data.length, agent_id, session_id,
          file_data, 'base64', uploadedAt, expiresAt, 'private',
          JSON.stringify(recipients || []), 0, '{}'
        );
        
        return { content: [{ type: 'text', text: formatResponse({ file_id: fileId, success: true }, format) }] };
      }

      case 'bus_download_file': {
        const { file_id, agent_id, format } = args as { file_id: string; agent_id: string; format?: string };
        const row = db.prepare('SELECT * FROM file_transfers WHERE id = ?').get(file_id) as any;
        if (!row) {
          return { content: [{ type: 'text', text: formatResponse({ error: 'File not found' }, format) }], isError: true };
        }
        return { content: [{ type: 'text', text: formatResponse({ 
          file_id: row.id,
          filename: row.filename,
          content_type: row.mime_type,
          file_data: row.storage_path,
          size: row.size_bytes
        }, format) }] };
      }

      case 'bus_list_files': {
        const { agent_id, include_expired, format } = args as { agent_id: string; include_expired?: boolean; format?: string };
        let query = 'SELECT id, filename, mime_type, size_bytes, uploaded_at, expires_at FROM file_transfers WHERE 1=1';
        if (!include_expired) {
          query += ' AND (expires_at IS NULL OR datetime(expires_at) > datetime("now"))';
        }
        query += ' ORDER BY uploaded_at DESC';
        const files = db.prepare(query).all();
        return { content: [{ type: 'text', text: formatResponse({ files }, format) }] };
      }

      case 'bus_schedule_message': {
        const { channel, agent_id, session_id, content, schedule_for, recurrence, format } = args as {
          channel: string;
          agent_id: string;
          session_id: string;
          content: string;
          schedule_for: string;
          recurrence?: string;
          format?: string;
        };
        const scheduled = recurrence 
          ? scheduler.createRecurring(channel, agent_id, session_id, content, recurrence)
          : scheduler.createScheduled(channel, agent_id, session_id, content, schedule_for);
        return { content: [{ type: 'text', text: formatResponse({ schedule_id: scheduled.id, success: true }, format) }] };
      }

      case 'bus_list_scheduled': {
        const { agent_id, channel, format } = args as { agent_id?: string; channel?: string; format?: string };
        const scheduled = scheduler.listScheduled(agent_id);
        return { content: [{ type: 'text', text: formatResponse({ scheduled }, format) }] };
      }

      case 'bus_cancel_scheduled': {
        const { schedule_id, agent_id, format } = args as { schedule_id: string; agent_id: string; format?: string };
        const success = scheduler.cancelScheduled(schedule_id, agent_id);
        return { content: [{ type: 'text', text: formatResponse({ success }, format) }] };
      }

      case 'bus_orchestrate': {
        const orchestrateArgs = args as { 
          command: string; 
          task_id?: string; 
          agent_id?: string; 
          title?: string; 
          description?: string; 
          result_data?: string; 
          approval_notes?: string; 
          status?: string; 
          format?: string;
        };
        const { command, format, agent_id } = orchestrateArgs;
        let result: any;
        
        switch (command) {
          case 'create_task':
            result = orchestrator.createTask(
              orchestrateArgs.title!,
              orchestrateArgs.agent_id!,
              orchestrateArgs.description
            );
            break;
          case 'assign_task':
            result = orchestrator.assignTask(orchestrateArgs.task_id!, orchestrateArgs.agent_id!);
            break;
          case 'accept_task':
            result = { success: orchestrator.acceptTask(orchestrateArgs.task_id!, orchestrateArgs.agent_id!) };
            break;
          case 'submit_result':
            result = orchestrator.submitResult(
              orchestrateArgs.task_id!,
              orchestrateArgs.agent_id!,
              orchestrateArgs.result_data!
            );
            break;
          case 'approve_result':
            result = { success: orchestrator.approveResult(
              orchestrateArgs.task_id!,
              orchestrateArgs.agent_id!,
              orchestrateArgs.approval_notes
            ) };
            break;
          case 'list_tasks':
            result = { tasks: orchestrator.listTasks({ status: orchestrateArgs.status }) };
            break;
          default:
            throw new Error(`Unknown orchestrate command: ${command}`);
        }
        
        if (agent_id) {
          const sessionStmt = db.prepare('SELECT session_id FROM agents WHERE agent_id = ? ORDER BY last_seen DESC LIMIT 1');
          const sessionRow = sessionStmt.get(agent_id) as { session_id: string } | undefined;
          if (sessionRow) {
            result = attachUnackedInfo(result, agent_id, sessionRow.session_id);
          }
        }
        
        return { content: [{ type: 'text', text: formatResponse(result, format || 'json') }] };
      }

      case 'bus_get_acp_protocol': {
        const { format } = args as { format?: string };
        const protocol = getACPProtocolTemplate();
        
        if (format === 'json') {
          return { content: [{ type: 'text', text: JSON.stringify({ 
            version: '1.0',
            protocol: protocol,
            message_types: [
              'STATUS_UPDATE', 'TASK_REQUEST', 'TASK_ACCEPTED', 'TASK_REJECTED',
              'TASK_COMPLETE', 'HELP_REQUEST', 'HELP_RESPONSE',
              'CONSENSUS_REQUEST', 'CONSENSUS_RESPONSE', 'ROLE_TRANSFER'
            ]
          }, null, 2) }] };
        }
        
        return { content: [{ type: 'text', text: protocol }] };
      }

      case 'bus_request_consensus': {
        const consensusArgs = args as {
          channel?: string;
          agent_id: string;
          session_id: string;
          proposal: string;
          proposal_data?: object;
          target_agents?: string[];
          quorum?: number;
          voting_deadline_seconds?: number;
          format?: string;
        };
        
        const channel = consensusArgs.channel || 'coordination';
        const votingDeadlineSeconds = consensusArgs.voting_deadline_seconds || 60;
        const votingDeadline = new Date(Date.now() + votingDeadlineSeconds * 1000).toISOString();
        
        const defaultQuorum = consensusArgs.target_agents 
          ? Math.ceil(consensusArgs.target_agents.length / 2)
          : 2;
        const quorum = consensusArgs.quorum || defaultQuorum;
        
        const acpMessage = createACPMessage(
          'CONSENSUS_REQUEST',
          consensusArgs.agent_id,
          consensusArgs.session_id,
          {
            proposal: consensusArgs.proposal,
            voting_deadline: votingDeadline,
            quorum: quorum,
            proposal_data: consensusArgs.proposal_data || {},
            target_agents: consensusArgs.target_agents
          }
        );
        
        const request = bus.sendRequest(
          channel,
          consensusArgs.agent_id,
          consensusArgs.session_id,
          JSON.stringify(acpMessage),
          votingDeadlineSeconds
        );
        
        return { content: [{ type: 'text', text: formatResponse({
          success: true,
          request_id: request.id,
          correlation_id: request.correlation_id,
          voting_deadline: votingDeadline,
          quorum: quorum,
          message: 'Consensus request sent. Use bus_get_responses with correlation_id to collect votes.',
          note: `Poll for responses using: bus_get_responses(correlation_id="${request.correlation_id}")`
        }, consensusArgs.format) }] };
      }

      case 'bus_validate_acp_message': {
        const { message, format } = args as { message: any; format?: string };
        const validation = validateACPMessage(message);
        
        return { content: [{ type: 'text', text: formatResponse({
          valid: validation.valid,
          errors: validation.errors,
          message: validation.valid 
            ? 'Message is ACP-compliant' 
            : `Message validation failed: ${validation.errors.join(', ')}`
        }, format) }] };
      }

      default:
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }], isError: true };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
  }
});

// Periodic cleanup
setInterval(() => {
  const expiredMessages = bus.cleanupExpiredMessages();
  const inactiveAgents = bus.cleanupInactiveAgents();
  if (expiredMessages > 0 || inactiveAgents > 0) {
    console.error(`Cleanup: ${expiredMessages} expired messages, ${inactiveAgents} inactive agents`);
  }
}, 60000); // Every minute

async function main() {
  const config = configManager.getConfig();
  
  if (configManager.isRegistryEnabled()) {
    const registryUrl = configManager.getRegistryUrl();
    if (registryUrl) {
      try {
        const registryClient = new RegistryClient(registryUrl, config.registry?.api_key);
        const servers = await registryClient.discoverServers();
        
        if (servers.length > 0) {
          const lastServer = configManager.getLastServer();
          let targetServer = lastServer 
            ? servers.find(s => s.id === lastServer.id)
            : null;
          
          if (!targetServer || targetServer.status !== 'healthy') {
            targetServer = registryClient.selectBestServer(servers);
          }
          
          if (targetServer) {
            healthMonitor.addServer(targetServer);
            configManager.setLastServer({
              id: targetServer.id,
              url: targetServer.url
            });
            console.error(`Connected to server: ${targetServer.id} (${targetServer.url})`);
          }
        }
      } catch (error) {
        console.error('Registry discovery failed, using local mode:', error);
        if (config.registry?.fallback_to_local) {
          configManager.setLocalOnlyMode(true);
        }
      }
    }
  }
  
  healthMonitor.startMonitoring();
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('OpenCode Agent Bus MCP server running');
}

main().catch(console.error);
