#!/usr/bin/env bash
set -Eeuo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ACTION="${1:-status}"
PRIORITY="${FAN_PROFILE_PRIORITY:-200}"
ADMIN_MARKER="${FAN_PROFILE_ADMIN_MARKER:-${HOME}/Library/Application Support/Mac Fan Profile/admin-fallback-used}"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

first_executable() {
  local candidate
  for candidate in "$@"; do
    [ -n "$candidate" ] || continue
    case "$candidate" in
      "~/"*) candidate="${HOME}/${candidate#~/}" ;;
    esac
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

command_path() {
  command -v "$1" 2>/dev/null || true
}

shell_quote() {
  local value="${1//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}

applescript_quote() {
  local value="${1//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

find_smcfan() {
  first_executable \
    "${FAN_PROFILE_SMCFAN:-}" \
    "$(command_path smcfan)" \
    "/opt/homebrew/bin/smcfan" \
    "/usr/local/bin/smcfan" \
    "${HOME}/bin/smcfan" \
    "${HOME}/Development/macos-smc-fan/Products/smcfan" \
    "${HOME}/Downloads/macos-smc-fan/Products/smcfan"
}

find_fan_cli() {
  first_executable \
    "${FAN_PROFILE_FANCLI:-}" \
    "$(command_path fan)" \
    "/Applications/FanControl.app/Contents/MacOS/fan" \
    "${HOME}/Applications/FanControl.app/Contents/MacOS/fan"
}

find_legacy_smc() {
  first_executable \
    "${FAN_PROFILE_SMC:-}" \
    "$(command_path smc)" \
    "/Applications/smcFanControl.app/Contents/Resources/smc" \
    "/opt/homebrew/bin/smc" \
    "/usr/local/bin/smc"
}

missing_backend() {
  if [ "$(uname -m)" = "arm64" ]; then
    die "No Apple Silicon fan-control backend was found.

Install FanControl.app or an Apple-Silicon-capable 'smcfan' backend first, then run this app again.

Supported FanControl CLI commands:
  fan list
  fan max
  fan auto

Supported smcfan CLI commands:
  smcfan list
  smcfan set <fan> <rpm>
  smcfan auto <fan>

Install FanControl.app in /Applications, put a fan or smcfan binary on PATH,
or set FAN_PROFILE_FANCLI=/path/to/fan or FAN_PROFILE_SMCFAN=/path/to/smcfan
when running the shell script.

I did not change fan speed."
  fi

  die "No Intel 'smc' fan-control command was found.

Install smcFanControl's smc command or set FAN_PROFILE_SMC=/path/to/smc.

I did not change fan speed."
}

fan_cli_run() {
  local fan_cli="$1"
  shift
  "$fan_cli" "$@"
}

fan_cli_write() {
  local fan_cli="$1"
  local action="$2"
  local output shell_command script

  if output="$("$fan_cli" "$action" 2>&1)"; then
    printf '%s\n' "$output"
    return 0
  fi

  printf '%s\n' "$output" >&2

  if [ -e "$ADMIN_MARKER" ]; then
    die "FanControl still needs helper approval, and the administrator fallback has already been used once.

Open /Applications/FanControl.app once, or approve FanControl in System Settings > General > Login Items > Allow in Background.

I did not ask for administrator credentials again."
  fi

  printf 'Requesting macOS administrator approval...\n'
  mkdir -p "$(dirname "$ADMIN_MARKER")"
  : > "$ADMIN_MARKER"
  shell_command="$(shell_quote "$fan_cli") $(shell_quote "$action") 2>&1"
  script="do shell script $(applescript_quote "$shell_command") with administrator privileges"
  /usr/bin/osascript -e "$script"
}

fan_cli_first_row() {
  awk 'NR > 1 && $1 ~ /^[0-9]+$/ { print; exit }'
}

fan_cli_boost_target() {
  awk '{ print $4, $5, $6 }' | awk '
    NF == 3 {
      auto=$1
      min=$2
      max=$3
      target=int((auto * 1.5) + 0.5)
      if (target < min) target=min
      if (target > max) target=max
      print auto, target
    }
  '
}

fan_cli_boost_shell_command() {
  local fan_cli="$1"
  local quoted_fan
  quoted_fan="$(shell_quote "$fan_cli")"
  cat <<EOF
set -e
$quoted_fan auto >/dev/null 2>&1 || true
sleep 1
line="\$({ $quoted_fan list || true; } | awk 'NR > 1 && \$1 ~ /^[0-9]+\$/ { print; exit }')"
auto="\$(printf '%s\\n' "\$line" | awk '{ print \$4 }')"
min="\$(printf '%s\\n' "\$line" | awk '{ print \$5 }')"
max="\$(printf '%s\\n' "\$line" | awk '{ print \$6 }')"
test -n "\$auto" -a -n "\$min" -a -n "\$max"
boost="\$(awk -v auto="\$auto" -v min="\$min" -v max="\$max" 'BEGIN { target = int((auto * 1.5) + 0.5); if (target < min) target = min; if (target > max) target = max; print target }')"
$quoted_fan "\$boost" >/dev/null
printf 'Auto +50%% active: %s -> %s RPM\\n' "\$auto" "\$boost"
$quoted_fan list
EOF
}

fan_cli_boost() {
  local fan_cli="$1"
  local output row target_info auto target shell_command script

  printf 'Using %s\n' "$fan_cli"
  printf 'Setting fan to 150%% of the macOS Auto target...\n'

  if output="$("$fan_cli" auto 2>&1)"; then
    sleep 1
    row="$("$fan_cli" list | fan_cli_first_row)"
    target_info="$(printf '%s\n' "$row" | fan_cli_boost_target)"
    auto="$(printf '%s\n' "$target_info" | awk '{ print $1 }')"
    target="$(printf '%s\n' "$target_info" | awk '{ print $2 }')"
    if [ -n "$auto" ] && [ -n "$target" ] && output="$("$fan_cli" "$target" 2>&1)"; then
      printf 'Auto +50%% active: %s -> %s RPM\n' "$auto" "$target"
      printf '\nCurrent status:\n'
      fan_cli_run "$fan_cli" list
      return 0
    fi
  fi

  printf '%s\n' "$output" >&2

  if [ -e "$ADMIN_MARKER" ]; then
    die "FanControl still needs helper approval, and the administrator fallback has already been used once.

Open /Applications/FanControl.app once, or approve FanControl in System Settings > General > Login Items > Allow in Background.

I did not ask for administrator credentials again."
  fi

  printf 'Requesting macOS administrator approval...\n'
  mkdir -p "$(dirname "$ADMIN_MARKER")"
  : > "$ADMIN_MARKER"
  shell_command="$(fan_cli_boost_shell_command "$fan_cli")"
  script="do shell script $(applescript_quote "$shell_command") with administrator privileges"
  /usr/bin/osascript -e "$script"
}

fan_cli_max() {
  local fan_cli="$1"
  printf 'Using %s\n' "$fan_cli"
  fan_cli_write "$fan_cli" max
  printf '\nCurrent status:\n'
  fan_cli_run "$fan_cli" list
}

fan_cli_auto() {
  local fan_cli="$1"
  printf 'Using %s\n' "$fan_cli"
  printf 'Returning fan control to macOS automatic thermal management...\n'
  fan_cli_write "$fan_cli" auto
  printf '\nCurrent status:\n'
  fan_cli_run "$fan_cli" list
}

fan_cli_status() {
  local fan_cli="$1"
  fan_cli_run "$fan_cli" list
}

smcfan_list() {
  local smcfan="$1"
  "$smcfan" list
}

smcfan_rows() {
  awk '
    /^Fan [0-9]+:/ {
      fan=$2
      sub(/:/, "", fan)
      max=0
      if (match($0, /Max: [0-9]+/)) {
        max_text=substr($0, RSTART, RLENGTH)
        sub(/Max: /, "", max_text)
        max=max_text
      }
      print fan, max
    }
  '
}

smcfan_set_max() {
  local smcfan="$1"
  local list_output rows fan max target

  if ! list_output="$(smcfan_list "$smcfan" 2>&1)"; then
    die "smcfan list failed:
$list_output"
  fi

  rows="$(printf '%s\n' "$list_output" | smcfan_rows)"
  [ -n "$rows" ] || die "smcfan did not report any fans.

Output:
$list_output"

  printf 'Using %s\n' "$smcfan"
  printf 'Setting all fans to reported maximum RPM...\n'
  while read -r fan max; do
    [ -n "$fan" ] || continue
    target="${FAN_PROFILE_TARGET_RPM:-$max}"
    case "$target" in
      ""|0) die "Fan ${fan} did not report a usable max RPM. Set FAN_PROFILE_TARGET_RPM manually." ;;
    esac
    "$smcfan" --priority "$PRIORITY" set "$fan" "$target"
  done <<EOF
$rows
EOF

  printf '\nCurrent status:\n'
  smcfan_list "$smcfan"
}

smcfan_auto() {
  local smcfan="$1"
  local list_output rows fan max

  if ! list_output="$(smcfan_list "$smcfan" 2>&1)"; then
    die "smcfan list failed:
$list_output"
  fi

  rows="$(printf '%s\n' "$list_output" | smcfan_rows)"
  [ -n "$rows" ] || die "smcfan did not report any fans.

Output:
$list_output"

  printf 'Using %s\n' "$smcfan"
  printf 'Returning all fans to macOS automatic thermal management...\n'
  while read -r fan max; do
    [ -n "$fan" ] || continue
    "$smcfan" --priority "$PRIORITY" auto "$fan"
  done <<EOF
$rows
EOF

  printf '\nCurrent status:\n'
  smcfan_list "$smcfan"
}

legacy_fan_count() {
  local smc="$1"
  local output count
  output="$("$smc" -k FNum -r 2>/dev/null || true)"
  count="$(printf '%s\n' "$output" | awk '{ for (i = 1; i <= NF; i += 1) if ($i ~ /^[0-9]+$/) { print $i; exit } }')"
  printf '%s\n' "${count:-${FAN_PROFILE_FAN_COUNT:-1}}"
}

legacy_max_rpm() {
  local smc="$1"
  local fan="$2"
  local output rpm

  if [ -n "${FAN_PROFILE_TARGET_RPM:-}" ]; then
    printf '%s\n' "$FAN_PROFILE_TARGET_RPM"
    return 0
  fi

  output="$("$smc" -k "F${fan}Mx" -r 2>/dev/null || true)"
  rpm="$(printf '%s\n' "$output" | awk 'match($0, /[0-9]+([.][0-9]+)?/) { print substr($0, RSTART, RLENGTH); exit }')"
  [ -n "$rpm" ] || die "Could not read max RPM for fan ${fan}. Set FAN_PROFILE_TARGET_RPM manually."
  printf '%s\n' "$rpm"
}

fpe2_hex() {
  awk -v rpm="$1" 'BEGIN {
    raw = int((rpm * 4) + 0.5)
    if (raw < 0 || raw > 65535) exit 1
    printf "%04x", raw
  }'
}

legacy_set_max() {
  local smc="$1"
  local count mask_hex fan rpm hex

  count="$(legacy_fan_count "$smc")"
  mask_hex="$(printf '%04x' "$(( (1 << count) - 1 ))")"

  printf 'Using %s\n' "$smc"
  printf 'Setting %s fan(s) to manual maximum...\n' "$count"
  "$smc" -k 'FS!' -w "$mask_hex"

  fan=0
  while [ "$fan" -lt "$count" ]; do
    rpm="$(legacy_max_rpm "$smc" "$fan")"
    hex="$(fpe2_hex "$rpm")"
    "$smc" -k "F${fan}Tg" -w "$hex"
    printf 'Set fan %s to %s RPM\n' "$fan" "$rpm"
    fan="$((fan + 1))"
  done
}

legacy_auto() {
  local smc="$1"
  printf 'Using %s\n' "$smc"
  printf 'Returning fans to macOS automatic thermal management...\n'
  "$smc" -k 'FS!' -w 0000
}

legacy_status() {
  local smc="$1"
  "$smc" -f 2>/dev/null || {
    "$smc" -k FNum -r
    "$smc" -k 'FS!' -r
  }
}

usage() {
  cat <<'EOF'
Usage: fan-profile.sh max|boost|auto|macos|status

Actions:
  max     Set all detected fans to their reported maximum RPM.
  boost   Set fan speed to 150% of the current macOS Auto target.
  auto    Return fan control to macOS automatic thermal management.
  macos   Alias for auto.
  status  Show current fan status.

Environment:
  FAN_PROFILE_SMCFAN=/path/to/smcfan       Apple Silicon backend override.
  FAN_PROFILE_FANCLI=/path/to/fan          FanControl CLI override.
  FAN_PROFILE_SMC=/path/to/smc             Intel backend override.
  FAN_PROFILE_TARGET_RPM=6500              Manual target if max RPM cannot be read.
  FAN_PROFILE_PRIORITY=200                 smcfan write priority.
EOF
}

run() {
  local fan_cli smcfan smc

  case "$ACTION" in
    -h|--help|help) usage; return 0 ;;
  esac

  if fan_cli="$(find_fan_cli)"; then
    case "$ACTION" in
      max) fan_cli_max "$fan_cli" ;;
      boost|auto50|auto+50) fan_cli_boost "$fan_cli" ;;
      auto|macos|default|reset) fan_cli_auto "$fan_cli" ;;
      status) fan_cli_status "$fan_cli" ;;
      *) usage; return 2 ;;
    esac
    return 0
  fi

  if smcfan="$(find_smcfan)"; then
    case "$ACTION" in
      max) smcfan_set_max "$smcfan" ;;
      auto|macos|default|reset) smcfan_auto "$smcfan" ;;
      status) smcfan_list "$smcfan" ;;
      *) usage; return 2 ;;
    esac
    return 0
  fi

  if [ "$(uname -m)" != "arm64" ] && smc="$(find_legacy_smc)"; then
    case "$ACTION" in
      max) legacy_set_max "$smc" ;;
      auto|macos|default|reset) legacy_auto "$smc" ;;
      status) legacy_status "$smc" ;;
      *) usage; return 2 ;;
    esac
    return 0
  fi

  missing_backend
}

run
