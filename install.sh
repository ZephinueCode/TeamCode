#!/usr/bin/env bash
set -euo pipefail

# TeamCode Installer — Linux / macOS / WSL
# Usage: curl -fsSL <url>/install.sh | bash
#    or: ./install.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
GRAY='\033[0;2m'
NC='\033[0m'

TEAMCODE_ROOT="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="${TEAMCODE_INSTALL_DIR:-$HOME/.teamcode}"
BIN_DIR="$INSTALL_DIR/bin"
LAUNCHER="$BIN_DIR/teamcode"
CONFIG_FILE="$INSTALL_DIR/teamcode.jsonc"

echo -e "  ${CYAN}⬢ TeamCode Installer${NC}"
echo -e "  ${GRAY}Source:  $TEAMCODE_ROOT${NC}"
echo -e "  ${GRAY}Install: $INSTALL_DIR${NC}"
echo ""

# ── 1. Detect / install Bun ──
if command -v bun &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} bun $(bun --version)"
else
  echo -e "  ${GRAY}Installing bun...${NC}"
  if command -v curl &>/dev/null; then
    curl -fsSL https://bun.sh/install | bash
  elif command -v wget &>/dev/null; then
    wget -qO- https://bun.sh/install | bash
  else
    echo -e "  ${RED}✗ Need curl or wget to install bun${NC}"
    echo -e "  ${GRAY}Install bun manually: https://bun.sh${NC}"
    exit 1
  fi
  # Source bun profile if it exists
  [ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun" 2>/dev/null || true
  export PATH="$HOME/.bun/bin:$PATH"
  echo -e "  ${GREEN}✓${NC} bun installed"
fi

# ── 2. Install dependencies ──
echo -e "  ${GRAY}Installing packages...${NC}"
cd "$TEAMCODE_ROOT"
if bun install --frozen-lockfile 2>/dev/null; then
  : # lockfile matched, nothing to do
else
  # WSL / cross-filesystem: bun's atomic lockfile rename can fail on NTFS.
  # Remove old lockfiles so bun creates fresh ones without rename().
  rm -f bun.lockb bun.lock package-lock.json 2>/dev/null || true
  bun install
fi
echo -e "  ${GREEN}✓${NC} dependencies"

# ── 3. Create launcher ──
mkdir -p "$BIN_DIR"
cat > "$LAUNCHER" << LAUNCHER_EOF
#!/usr/bin/env bash
cd "\$(pwd)"
exec bun run --conditions=browser "$TEAMCODE_ROOT/src/index.ts" "\$@"
LAUNCHER_EOF
chmod +x "$LAUNCHER"
echo -e "  ${GREEN}✓${NC} launcher → $LAUNCHER"

# ── 4. Copy default config ──
if [ ! -f "$CONFIG_FILE" ] && [ -f "$TEAMCODE_ROOT/teamcode.jsonc" ]; then
  cp "$TEAMCODE_ROOT/teamcode.jsonc" "$CONFIG_FILE"
  echo -e "  ${GREEN}✓${NC} default config → $CONFIG_FILE"
fi

# ── 5. Add to PATH ──
SHELL_RC=""
case "${SHELL##*/}" in
  zsh)  SHELL_RC="$HOME/.zshrc" ;;
  bash) SHELL_RC="$HOME/.bashrc" ;;
  fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
  *)    SHELL_RC="$HOME/.profile" ;;
esac

if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  # Add to current session
  export PATH="$BIN_DIR:$PATH"

  # Persist in shell config
  if [ -f "$SHELL_RC" ]; then
    if ! grep -q "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
      echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
    fi
  fi
  echo -e "  ${GREEN}✓${NC} Added to PATH (restart shell or: source $SHELL_RC)"
else
  echo -e "  ${GREEN}✓${NC} Already in PATH"
fi

echo ""
echo -e "  ${CYAN}TeamCode installed!${NC}"
echo -e "  ${GRAY}Run 'teamcode' from any directory.${NC}"
echo -e "  ${GRAY}Configure API keys in $CONFIG_FILE${NC}"

# ── 6. Quick check ──
if [ -z "${TEAMCODE_PM_API_KEY:-}" ] && [ -z "${TEAMCODE_API_KEY:-}" ]; then
  if grep -q 'apiKey.*TEAMCODE' "$CONFIG_FILE" 2>/dev/null; then
    echo ""
    echo -e "  ${GRAY}Set your API key before first run:${NC}"
    echo -e "  ${GRAY}  export TEAMCODE_API_KEY=sk-your-key${NC}"
    echo -e "  ${GRAY}  or edit $CONFIG_FILE${NC}"
  fi
fi
