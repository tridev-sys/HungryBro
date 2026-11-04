#!/usr/bin/env bash
# Host acceptance checks. Exit 0 only when every check passes. Prints one PASS/FAIL line per check.
set -uo pipefail
fails=0
check() {  # check <label> <command...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "PASS $label"; else echo "FAIL $label"; fails=$((fails + 1)); fi
}

check "ufw active" bash -c 'ufw status | grep -q "Status: active"'

public_ports=$(ss -tln | awk 'NR>1 {print $4}' | grep -E '^(0\.0\.0\.0|\[::\]|\*):' | sed 's/.*://' | sort -un | tr '\n' ' ' | sed 's/ *$//')
check "publicly listening TCP ports are exactly 22 80 443 (got: ${public_ports:-none})" \
  bash -c "[ '$public_ports' = '22 80 443' ]"

swap_bytes=$(swapon --show=SIZE --bytes --noheadings 2>/dev/null | awk '{s+=$1} END {print s+0}')
check "swap is at least 2 GiB" bash -c "[ $swap_bytes -ge 2147483648 ]"

data_src=$(findmnt -n -o SOURCE /home/ubuntu/docker/data 2>/dev/null || true)
root_src=$(findmnt -n -o SOURCE / 2>/dev/null || true)
check "/home/ubuntu/docker/data is a separate mount" bash -c "[ -n '$data_src' ] && [ '$data_src' != '$root_src' ]"

compose_ver=$(docker compose version --short 2>/dev/null || echo 0)
check "docker compose is v2.24.4 or later (got $compose_ver)" \
  bash -c "printf '%s\n%s\n' 2.24.4 '$compose_ver' | sort -V -C"

check "deploy user is in the docker group" bash -c 'id deploy | grep -q "(docker)"'
check "deploy can run docker" sudo -u deploy docker ps
check "password authentication is disabled" bash -c 'sshd -T | grep -qx "passwordauthentication no"'

avail_gib=$(df -P -BG /home/ubuntu/docker/data 2>/dev/null | awk 'NR==2 {gsub("G","",$4); print $4+0}')
check "at least 20 GiB free on the data volume (got ${avail_gib:-0})" bash -c "[ ${avail_gib:-0} -ge 20 ]"

echo "failed checks: $fails"
[ "$fails" -eq 0 ]
