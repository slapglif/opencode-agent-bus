#!/bin/bash
cd "$(dirname "$0")"

if [ -f registry.pid ]; then
    PID=$(cat registry.pid)
    if ps -p $PID > /dev/null 2>&1; then
        kill $PID
        echo "Registry stopped (PID $PID)"
        rm registry.pid
    else
        echo "Registry not running"
        rm registry.pid
    fi
else
    echo "No PID file found"
fi
