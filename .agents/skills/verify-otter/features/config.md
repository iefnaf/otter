# Configuration

`config show`, `config set-model`, and `config set-execution` read and write `~/.otter/settings.json` (mode `0600`). Defaults are model `gpt-4o-mini` and execution disabled.

## Sub-features

- `config-show` prints non-secret settings plus `keychainConfigured`.
- `config-model` sets `gpt-4o-mini` or `deepseek-v4-flash` and rejects anything else.
- `config-execution` toggles `enableExecution` and rejects anything but `enabled` or `disabled`.
- `config-file` writes a private, schema-valid settings file.

## How to get to it (user POV)

- Run `otter config show`.
- Run `otter config set-model <model>`.
- Run `otter config set-execution enabled|disabled`.

## Driving it with control-otter

Preconditions: fresh launch (no settings file in the sandbox).

- **Defaults.** Run `$C run config show0 -- config show`. Exit `0`; stdout has `"model": "gpt-4o-mini"`, `"enableExecution": false`, `"keychainConfigured": false`. `$C note config no-file -- ls /tmp/otter-verify-$OTTER_VERIFY_RUN/home/.otter/settings.json` reports that the file does not exist yet.
- **Set model.** Run `$C run config model -- config set-model deepseek-v4-flash`. Stdout `Analyzer model set to deepseek-v4-flash.`. Then `$C run config show1 -- config show` shows the new model.
- **Reject model.** Run `$C run config bad-model -- config set-model gpt-5`. Exit `2`, stderr `model must be gpt-4o-mini or deepseek-v4-flash`. `config show` still shows `deepseek-v4-flash`.
- **Reject state.** Run `$C run config bad-exec -- config set-execution maybe`. Exit `2`, stderr `state must be enabled or disabled`.
- **Enable and disable.** Run `$C run config enable -- config set-execution enabled`, then `show`, then `$C run config disable -- config set-execution disabled` and `show` again. The flag follows each command.
- **File proof.** `$C note config settings-file -- bash -c 'ls -l /tmp/otter-verify-'$OTTER_VERIFY_RUN'/home/.otter/settings.json; cat /tmp/otter-verify-'$OTTER_VERIFY_RUN'/home/.otter/settings.json'` shows `-rw-------` and exactly the keys `model`, `enableExecution`, and `protectedExecutables`.
- **Reset.** Finish with `config set-model gpt-4o-mini` and `config set-execution disabled` so later features start from defaults.

## Gotchas

- `set-api-key` and `clear-api-key` write the real macOS Keychain, which the sandbox HOME does not isolate. Do not drive them.
- `keychainConfigured` reflects the Keychain, not the sandbox. It is `false` only because no `otter` item exists on this Mac.
- A hand-edited `settings.json` with an unknown key makes every command that reads settings fail with `invalid settings file`. Use only the `config set-*` commands.
