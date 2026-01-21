#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f tunnel.pid ]; then
    echo "No tunnel PID file found"
    exit 0
fi

PID=$(cat tunnel.pid)
if kill -0 $PID 2>/dev/null; then
    echo "Stopping tunnel (PID: $PID)..."
    kill $PID
    sleep 2
    
    if kill -0 $PID 2>/dev/null; then
        echo "Tunnel didn't stop gracefully, force killing..."
        kill -9 $PID
    fi
    echo "Tunnel stopped"
else
    echo "Tunnel not running"
fi

rm -f tunnel.pid
