# OpenPlay Brand Rename Design

## Overview

Rename all `opencode` branding to `openplay` across the codebase, including package names, bin scripts, source code strings, and documentation. Ensure the `openplay` command is globally available via `npm link`.

## Scope

### Package Names

| Current | New |
|---------|-----|
| `opencode` (root) | `openplay` |
| `opencode` (packages/opencode) | `openplay` |
| `@opencode-ai/plugin` | `@openplay-ai/plugin` |
| `@opencode-ai/sdk` | `@openplay-ai/sdk` |
| `@opencode-ai/ui` | `@openplay-ai/ui` |
| `@opencode-ai/script` | `@openplay-ai/script` |
| `@opencode-ai/core` | `@openplay-ai/core` |

### Bin Script

- `packages/opencode/bin/opencode` → `packages/opencode/bin/openplay`
- Environment variable: `OPENCODE_BIN_PATH` → `OPENPLAY_BIN_PATH`
- Binary names: `opencode-{platform}-{arch}` → `openplay-{platform}-{arch}`
- Error messages referencing "opencode" → "openplay"

### Source Code Strings

- CLI help text and error messages
- Version command output
- Any user-facing strings

### Configuration Files

- Keep `opencode.json` / `opencode.jsonc` for backward compatibility
- Already support `openplay.json` / `openplay.jsonc` as priority (P0-2 completed)
- `.opencode/` directory remains for backward compatibility
- `.openplay/` directory already supported as priority

### Documentation

- Update README files to reference `openplay` command
- Keep GitHub repository URL unchanged (future consideration)

## Implementation Steps

1. **Rename bin script**: `bin/opencode` → `bin/openplay`
2. **Update package.json files**: Change all package names and bin entries
3. **Update bin script content**: Replace internal strings
4. **Update source code**: Replace user-facing strings
5. **Update documentation**: README files
6. **Global installation**: Run `npm link` in packages/opencode

## Global Command Installation

After changes, run:

```bash
cd packages/opencode
npm link
```

This creates a global `openplay` command symlinked to the local development version.

## Backward Compatibility

- `opencode.json` configuration files continue to work
- `.opencode/` directory continues to work
- Existing `opencode` global command (if installed from npm) remains separate
- Users can have both `opencode` (from npm) and `openplay` (from local dev) installed

## Files to Modify

### Package.json Files

- `/package.json`
- `/packages/opencode/package.json`
- `/packages/sdk/js/package.json`
- `/packages/ui/package.json`
- `/packages/slack/package.json`

### Bin Script

- `/packages/opencode/bin/opencode` → rename to `openplay`

### Source Files (user-facing strings)

- CLI help text
- Version output
- Error messages

### Documentation

- `/README.md` and all localized versions
- `/SECURITY.md`

## Verification

1. Run `npm link` successfully
2. `openplay --version` shows correct version
3. `openplay` starts the TUI
4. Existing `opencode.json` configs still work
