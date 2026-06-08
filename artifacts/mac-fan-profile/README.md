# Mac Fan Profile

Tiny macOS utility for fan telemetry and control from a UI:

- Increase detected fans to their reported maximum RPM.
- Set `Auto +50%`, a middle cooling mode that reads the current macOS Auto
  target RPM and sets a manual target 50% higher, capped at the fan maximum.
- Return fan control to macOS automatic thermal management.
- Show CPU temperature, GPU temperature, chip max temperature, session high,
  and fan status.
- Draw rolling CPU / GPU / chip-max temperature overlays while the app is
  running.
- Click the CPU or GPU metric to switch the graph to per-core / per-sensor
  temperature lines.
- Toggle usage overlays on the graph. CPU usage comes from per-core macOS
  processor ticks; GPU usage comes from the AGX driver utilization counter.
- Show fan RPM on the graph so fan speed changes can be compared with
  temperature movement.
- Append samples to `temperature-log.csv` in the same folder as the app,
  including CPU/GPU usage and `fan_speed_rpm` at the same timestamp as each
  temperature sample.

This Mac mini is Apple Silicon, so the app needs an Apple-Silicon-capable fan
backend. The easiest supported backend is FanControl.app, whose embedded CLI
supports:

```sh
fan list
fan max
fan 1500
fan auto
```

Install FanControl.app from:
<https://fancontrol.dev/>

The wrapper also supports a `smcfan` command with this shape:

```sh
smcfan list
smcfan set <fan> <rpm>
smcfan auto <fan>
```

One backend with that command shape is `agoodkind/macos-smc-fan`:
<https://github.com/agoodkind/macos-smc-fan>

That project uses a privileged helper for Apple Silicon SMC writes. Install its
helper, then put or symlink the `smcfan` binary at `/opt/homebrew/bin/smcfan`,
`/usr/local/bin/smcfan`, or `~/bin/smcfan`.

## Build The App

```sh
cd /Users/zach/Development/agentic-development-platform/artifacts/mac-fan-profile
chmod +x fan-profile.sh build-app.sh
./build-app.sh
open "Mac Fan Profile.app"
```

The app logs every 3 seconds while it is open:

```sh
/Users/zach/Development/agentic-development-platform/artifacts/mac-fan-profile/temperature-log.csv
```

If an older log schema is present, the app archives it as
`temperature-log-<timestamp>.csv` and starts a fresh CSV with CPU, GPU, chip max,
CPU/GPU usage, session high, and fan speed columns.

## Script Usage

```sh
./fan-profile.sh max
./fan-profile.sh boost
./fan-profile.sh auto
./fan-profile.sh macos
./fan-profile.sh status
```

Useful overrides:

```sh
FAN_PROFILE_FANCLI=/Applications/FanControl.app/Contents/MacOS/fan ./fan-profile.sh max
FAN_PROFILE_SMCFAN=/path/to/smcfan ./fan-profile.sh max
FAN_PROFILE_TARGET_RPM=6500 ./fan-profile.sh max
```

The script also has a legacy Intel fallback for the old `smc` command, but it
intentionally does not use that path on Apple Silicon.

## Safety

Setting manual fan speeds can interfere with macOS thermal management. Use
`macOS Control` / `fan-profile.sh auto` when you are done so macOS owns fan
control again, and keep an eye on temperatures during heavy workloads.

Fan writes first try FanControl's helper-backed CLI, so repeated fan changes
work without blocking after the helper is approved. If macOS blocks that path,
the app falls back to macOS administrator approval for the write; passive
monitoring, refreshing, graphing, and CSV logging never request administrator
credentials. To avoid repeated prompts entirely, open `/Applications/FanControl.app`
once and approve its background helper if macOS asks.
