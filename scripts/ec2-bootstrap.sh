#!/usr/bin/env bash
# One-time host setup for the c7i.xlarge (Ubuntu, ap-south-1). Run as root. Safe to re-run.
# Host runs Docker only. Installs Docker Engine + Compose plugin, a deploy user, 2 GiB swap, UFW
# (22, 80, 443 only), SSH hardening, and unattended upgrades. Postgres data is the named volume
# food-os-pgdata on the root disk; no separate data disk is mounted (storage decision 2026-11-04).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root (sudo bash scripts/ec2-bootstrap.sh)" >&2
  exit 1
fi

APP_DIR=/home/ubuntu/docker
DEPLOY_PUBLIC_KEY="${DEPLOY_PUBLIC_KEY:?set DEPLOY_PUBLIC_KEY to the public key of the deploy user}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw unattended-upgrades jq

# Docker Engine and Compose plugin from Docker's apt repository.
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

# deploy user: docker group, key-only login.
id -u deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if ! grep -qxF "$DEPLOY_PUBLIC_KEY" /home/deploy/.ssh/authorized_keys 2>/dev/null; then
  echo "$DEPLOY_PUBLIC_KEY" >> /home/deploy/.ssh/authorized_keys
fi
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# 2 GiB swap.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
fi
chmod 600 /swapfile
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  mkswap /swapfile >/dev/null
  swapon /swapfile
fi
grep -qE '^/swapfile[[:space:]]' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-food-os-swap.conf
sysctl -p /etc/sysctl.d/99-food-os-swap.conf >/dev/null

# Project folder owned by deploy. Postgres data lives in the named volume food-os-pgdata (root disk),
# so no host data directory is created here.
install -d -o deploy -g deploy "$APP_DIR"
chown -R deploy:deploy "$APP_DIR"

# UFW: only 22, 80, 443 inbound.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# SSH: key-only, no root login.
cat > /etc/ssh/sshd_config.d/90-food-os.conf <<'SSHD'
PasswordAuthentication no
PermitRootLogin no
SSHD
systemctl reload ssh

systemctl enable --now unattended-upgrades
echo "bootstrap complete"
