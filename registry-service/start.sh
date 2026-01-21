#!/bin/bash
cd "$(dirname "$0")"

if [ -f registry.pid ]; then
    OLD_PID=$(cat registry.pid)
    if ps -p $OLD_PID > /dev/null 2>&1; then
        echo "Registry already running with PID $OLD_PID"
        exit 0
    fi
fi

nohup node server-persistent.js > logs/registry.log 2>&1 &
echo $! > registry.pid
echo "Registry started with PID $(cat registry.pid)"
echo "Health: http://localhost:3456/api/v1/health"
