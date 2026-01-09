---
description: Broadcast a message to all agents on the global channel
allowed-tools:
  - bus_register_agent
  - bus_send
argument-hint: <message>
---

Broadcast a message to all agents.

1. If not registered, call `bus_register_agent` with agent_id="broadcast-cmd" and a generated session_id
2. Call `bus_send` with channel="global" and the provided message
3. Confirm the broadcast was sent

The message to broadcast is: $ARGUMENTS
