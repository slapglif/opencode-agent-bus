#!/bin/bash
#
# OpenCode Agent Bus - Universal Installer
# Supports both OpenCode and Claude Code
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="opencode-agent-bus"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Detect which AI coding tools are installed
detect_tools() {
    OPENCODE_INSTALLED=false
    CLAUDE_CODE_INSTALLED=false

    if command -v opencode &> /dev/null || [ -d "$HOME/.config/opencode" ]; then
        OPENCODE_INSTALLED=true
    fi

    if command -v claude &> /dev/null || [ -d "$HOME/.claude" ]; then
        CLAUDE_CODE_INSTALLED=true
    fi
}

# Build the MCP server
build_server() {
    log_info "Building MCP server..."
    cd "$SCRIPT_DIR"

    if [ ! -d "node_modules" ]; then
        log_info "Installing dependencies..."
        npm install
    fi

    npm run build
    log_success "MCP server built successfully"
}

# Install for OpenCode
install_opencode() {
    log_info "Installing for OpenCode..."

    OPENCODE_CONFIG_DIR="$HOME/.config/opencode"
    OPENCODE_PLUGIN_DIR="$OPENCODE_CONFIG_DIR/plugin"
    OPENCODE_CONFIG="$OPENCODE_CONFIG_DIR/opencode.json"

    # Create directories
    mkdir -p "$OPENCODE_PLUGIN_DIR"

    # Symlink plugin
    ln -sf "$SCRIPT_DIR/.opencode/plugin/agent-bus.js" "$OPENCODE_PLUGIN_DIR/agent-bus.js"
    log_success "Plugin symlinked to $OPENCODE_PLUGIN_DIR/agent-bus.js"

    # Update or create opencode.json
    if [ -f "$OPENCODE_CONFIG" ]; then
        log_info "Updating existing opencode.json..."
        # Use node to merge configs
        node -e "
const fs = require('fs');
const existing = JSON.parse(fs.readFileSync('$OPENCODE_CONFIG', 'utf8'));
existing.mcp = existing.mcp || {};
existing.mcp['agent-bus'] = {
    type: 'local',
    command: ['node', '$SCRIPT_DIR/dist/mcp-server/index.js'],
    enabled: true
};
existing.plugin = existing.plugin || [];
const pluginPath = 'file://$OPENCODE_PLUGIN_DIR/agent-bus.js';
if (!existing.plugin.includes(pluginPath)) {
    existing.plugin.push(pluginPath);
}
fs.writeFileSync('$OPENCODE_CONFIG', JSON.stringify(existing, null, 2));
"
    else
        log_info "Creating new opencode.json..."
        cat > "$OPENCODE_CONFIG" << EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agent-bus": {
      "type": "local",
      "command": ["node", "$SCRIPT_DIR/dist/mcp-server/index.js"],
      "enabled": true
    }
  },
  "plugin": ["file://$OPENCODE_PLUGIN_DIR/agent-bus.js"]
}
EOF
    fi

    log_success "OpenCode configuration updated at $OPENCODE_CONFIG"

    # Copy skills if skills directory exists
    if [ -d "$OPENCODE_CONFIG_DIR/skills" ] || mkdir -p "$OPENCODE_CONFIG_DIR/skills"; then
        ln -sf "$SCRIPT_DIR/skills/agent-message-bus" "$OPENCODE_CONFIG_DIR/skills/agent-message-bus"
        ln -sf "$SCRIPT_DIR/skills/agent-coordination-patterns" "$OPENCODE_CONFIG_DIR/skills/agent-coordination-patterns"
        log_success "Skills symlinked to $OPENCODE_CONFIG_DIR/skills/"
    fi
}

# Install for Claude Code
install_claude_code() {
    log_info "Installing for Claude Code..."

    CLAUDE_DIR="$HOME/.claude"
    CLAUDE_SETTINGS="$CLAUDE_DIR/settings.json"
    CLAUDE_PLUGINS_DIR="$CLAUDE_DIR/plugins/local"

    # Create directories
    mkdir -p "$CLAUDE_DIR"
    mkdir -p "$CLAUDE_PLUGINS_DIR"

    # Install as local plugin (symlink to plugins/local/)
    ln -sf "$SCRIPT_DIR" "$CLAUDE_PLUGINS_DIR/agent-bus"
    log_success "Plugin symlinked to $CLAUDE_PLUGINS_DIR/agent-bus"

    # Enable the plugin in settings.json
    if [ -f "$CLAUDE_SETTINGS" ]; then
        log_info "Enabling plugin in settings.json..."
        node -e "
const fs = require('fs');
let settings = {};
try {
    settings = JSON.parse(fs.readFileSync('$CLAUDE_SETTINGS', 'utf8'));
} catch (e) {}

// Remove old mcpServers entry if present (doesn't work there)
delete settings.mcpServers?.['agent-bus'];
if (settings.mcpServers && Object.keys(settings.mcpServers).length === 0) {
    delete settings.mcpServers;
}

// Enable as local plugin
settings.enabledPlugins = settings.enabledPlugins || {};
settings.enabledPlugins['agent-bus@local'] = true;

fs.writeFileSync('$CLAUDE_SETTINGS', JSON.stringify(settings, null, 2));
console.log('Plugin enabled in settings.json');
"
    else
        log_info "Creating Claude Code settings with plugin enabled..."
        cat > "$CLAUDE_SETTINGS" << EOF
{
  "enabledPlugins": {
    "agent-bus@local": true
  }
}
EOF
    fi

    log_success "Claude Code plugin installed and enabled"

    # Create Claude Code skill links
    CLAUDE_SKILLS_DIR="$CLAUDE_DIR/skills"
    mkdir -p "$CLAUDE_SKILLS_DIR"
    ln -sf "$SCRIPT_DIR/skills/agent-message-bus" "$CLAUDE_SKILLS_DIR/agent-message-bus"
    ln -sf "$SCRIPT_DIR/skills/agent-coordination-patterns" "$CLAUDE_SKILLS_DIR/agent-coordination-patterns"
    log_success "Skills symlinked to $CLAUDE_SKILLS_DIR/"
}

# Uninstall
uninstall() {
    log_info "Uninstalling Agent Bus..."

    # OpenCode
    rm -f "$HOME/.config/opencode/plugin/agent-bus.js"
    rm -f "$HOME/.config/opencode/skills/agent-message-bus"
    rm -f "$HOME/.config/opencode/skills/agent-coordination-patterns"
    log_info "Removed OpenCode plugin and skills symlinks"
    log_warn "Note: You may need to manually remove 'agent-bus' from ~/.config/opencode/opencode.json"

    # Claude Code
    rm -f "$HOME/.claude/plugins/local/agent-bus"
    rm -f "$HOME/.claude/skills/agent-message-bus"
    rm -f "$HOME/.claude/skills/agent-coordination-patterns"
    log_info "Removed Claude Code plugin and skills symlinks"

    # Disable plugin in settings.json
    if [ -f "$HOME/.claude/settings.json" ]; then
        node -e "
const fs = require('fs');
try {
    const settings = JSON.parse(fs.readFileSync('$HOME/.claude/settings.json', 'utf8'));
    delete settings.enabledPlugins?.['agent-bus@local'];
    fs.writeFileSync('$HOME/.claude/settings.json', JSON.stringify(settings, null, 2));
    console.log('Disabled plugin in settings.json');
} catch (e) {}
"
    fi

    log_success "Uninstall complete"
}

# Print usage
usage() {
    echo "OpenCode Agent Bus Installer"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  install     Install for detected AI coding tools (default)"
    echo "  uninstall   Remove symlinks and print cleanup instructions"
    echo "  opencode    Install only for OpenCode"
    echo "  claude      Install only for Claude Code"
    echo "  both        Install for both OpenCode and Claude Code"
    echo ""
    echo "Options:"
    echo "  -h, --help  Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0              # Auto-detect and install"
    echo "  $0 install      # Same as above"
    echo "  $0 claude       # Install for Claude Code only"
    echo "  $0 both         # Install for both tools"
    echo "  $0 uninstall    # Remove installation"
}

# Main
main() {
    local command="${1:-install}"

    case "$command" in
        -h|--help)
            usage
            exit 0
            ;;
        install)
            detect_tools
            build_server

            if [ "$OPENCODE_INSTALLED" = true ]; then
                install_opencode
            fi

            if [ "$CLAUDE_CODE_INSTALLED" = true ]; then
                install_claude_code
            fi

            if [ "$OPENCODE_INSTALLED" = false ] && [ "$CLAUDE_CODE_INSTALLED" = false ]; then
                log_warn "Neither OpenCode nor Claude Code detected"
                log_info "Installing for both anyway..."
                install_opencode
                install_claude_code
            fi

            echo ""
            log_success "Installation complete!"
            echo ""
            echo "Next steps:"
            echo "  1. Restart your AI coding tool"
            echo "  2. The 'bus_*' MCP tools will be available"
            echo "  3. Use 'bus_register_agent' to register, then 'bus_send'/'bus_receive' to communicate"
            echo ""
            ;;
        uninstall)
            uninstall
            ;;
        opencode)
            build_server
            install_opencode
            log_success "OpenCode installation complete! Restart OpenCode to use."
            ;;
        claude)
            build_server
            install_claude_code
            log_success "Claude Code installation complete! Restart Claude Code to use."
            ;;
        both)
            build_server
            install_opencode
            install_claude_code
            log_success "Installation complete for both tools! Restart them to use."
            ;;
        *)
            log_error "Unknown command: $command"
            usage
            exit 1
            ;;
    esac
}

main "$@"
