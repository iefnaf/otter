# Protection rules

`protect` manages executables that `clean` must never offer for stopping. Built-in rules cover common network services (Clash, Surge, v2ray, Shadowrocket, Tailscale and variants). User rules are stored by lowercase executable name in `settings.json` under `protectedExecutables`.

## Sub-features

- `protect-list` prints built-in and user rules.
- `protect-add` adds a user rule, ignores duplicates, and reports built-ins as already protected.
- `protect-remove` removes a user rule, reports a missing one, and refuses built-ins.
- `protect-plan` shows protected executables in the plan as `protected by the network-service rule` and never prompts for them.

## How to get to it (user POV)

- Run `otter protect list`, `otter protect add <executable>`, `otter protect remove <executable>`.

## Driving it with control-otter

Preconditions: fresh launch, `$C doctor` exits 0.

- **List.** `$C run protect list0 -- protect list`. Exit `0`. Output starts with `Built-in network-service rules`, lists `clash`, `tailscaled` and others, then `User rules` with no entries.
- **Add.** `$C run protect add -- protect add my-agent` prints `Protected my-agent.`. `$C run protect list1 -- protect list` shows `my-agent` under `User rules`.
- **Duplicate and case.** `$C run protect add-dup -- protect add MY-AGENT` prints `my-agent is already protected.`.
- **Built-in add.** `$C run protect add-builtin -- protect add tailscaled` prints `tailscaled is already protected by a built-in rule.`.
- **Built-in remove.** `$C run protect rm-builtin -- protect remove tailscaled`. Exit `2`, stderr `tailscaled is a built-in protection rule`.
- **Remove.** `$C run protect remove -- protect remove my-agent` prints `Removed protection for my-agent.`. A second remove prints `No user rule protects my-agent.` with exit `0`.
- **File proof.** `$C note protect settings -- bash -c "cat /tmp/otter-verify-$OTTER_VERIFY_RUN/home/.otter/settings.json"` shows `"protectedExecutables": []` after the remove.
- **Effect on the plan.** On a TTY (`$C tty start -- scan --window 1`), a running Tailscale or Clash appears under `Review required` with `action: protected by the network-service rule`. This depends on those apps running; if they are not running, report it as not reachable.

## Gotchas

- Rules match the executable name exactly (lowercase). `protect add /usr/bin/foo` stores `foo`.
- The plan and a `clean` run list a protected process but must not prompt for it; a `clean` run via `drive-clean` should show prompts only for the fixture container.
- Reset user rules before finishing; settings persist for the rest of the run.
