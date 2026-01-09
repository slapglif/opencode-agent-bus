---
description: Check message bus status and active agents
allowed-tools:
  - bus_list_agents
  - bus_list_channels
  - bus_receive
argument-hint: "[active_seconds]"
---

Check the agent message bus status.

1. Call `bus_list_agents` with the provided active_seconds (default 300)
2. Call `bus_list_channels` to show available channels
3. Summarize the bus status in a concise table format

$ARGUMENTS can specify the active_within_seconds parameter.
