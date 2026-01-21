#!/bin/bash
cd "$(dirname "$0")"

if [ -f tunnel.pid ] && kill -0 $(cat tunnel.pid) 2>/dev/null; then
    echo "Tunnel already running (PID: $(cat tunnel.pid))"
    exit 0
fi

echo "Starting Cloudflare tunnel..."
nohup cloudflared tunnel --config ~/.cloudflared/config.yml run agent-bus-registry > logs/tunnel.log 2>&1 &
echo $! > tunnel.pid
sleep 2

if kill -0 $(cat tunnel.pid) 2>/dev/null; then
    echo "Tunnel started successfully (PID: $(cat tunnel.pid))"
    echo "Public URL: https://registry.ai-smith.net"
    echo "Check logs: tail -f logs/tunnel.log"
else
    echo "Failed to start tunnel"
    rm -f tunnel.pid
    exit 1
fi
