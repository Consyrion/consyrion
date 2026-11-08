#!/usr/bin/env bash
# Egress network for the code sandbox (#399) – only needed with SANDBOX_DISABLED=false.
#
# Dependency installs run on this network instead of Docker's default bridge. It reaches the internet (package
# registries), but not the host, the LAN, other private ranges or the cloud metadata service (169.254.169.254).
# Idempotent: safe to run on every deploy and at boot (systemd unit consyrion-sandbox-net, see docs/hetzner.md).
# Afterwards it writes the current boot id to the marker; the worker refuses installs while the marker is missing
# or from an earlier boot, because iptables rules do not survive a reboot.
#
# Usage (root): deploy/hetzner/sandbox-network.sh
#   SANDBOX_EGRESS_NETWORK  network name     (default consyrion-sandbox-egress)
#   SANDBOX_EGRESS_SUBNET   subnet           (default 172.31.250.0/24)
#   SANDBOX_EGRESS_MARKER   marker file      (default /srv/consyrion/workspaces/.sandbox-egress-firewall)
set -euo pipefail

NET="${SANDBOX_EGRESS_NETWORK:-consyrion-sandbox-egress}"
SUBNET="${SANDBOX_EGRESS_SUBNET:-172.31.250.0/24}"
MARKER="${SANDBOX_EGRESS_MARKER:-/srv/consyrion/workspaces/.sandbox-egress-firewall}"
BRIDGE="cnr-sbx0"

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }

if ! docker network inspect "$NET" >/dev/null 2>&1; then
  # No inter-container traffic, no IPv6 (the firewall below is IPv4 only).
  docker network create --driver bridge --subnet "$SUBNET" \
    --opt com.docker.network.bridge.name="$BRIDGE" \
    --opt com.docker.network.bridge.enable_icc=false \
    "$NET" >/dev/null
  echo "created network $NET ($SUBNET)"
fi
# Read back what Docker really uses (an existing network may have another subnet).
SUBNET="$(docker network inspect -f '{{(index .IPAM.Config 0).Subnet}}' "$NET")"
BRIDGE_IF="$(docker network inspect -f '{{index .Options "com.docker.network.bridge.name"}}' "$NET")"
[ -n "$BRIDGE_IF" ] || BRIDGE_IF="br-$(docker network inspect -f '{{.Id}}' "$NET" | cut -c1-12)"

# Forwarded traffic: Docker leaves the DOCKER-USER chain to the operator. Drop every private, link-local, CGNAT,
# loopback and multicast destination for this subnet; everything else (public registries) stays allowed.
iptables -N DOCKER-USER 2>/dev/null || true
for dst in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 127.0.0.0/8 0.0.0.0/8 224.0.0.0/4 240.0.0.0/4; do
  iptables -C DOCKER-USER -s "$SUBNET" -d "$dst" -j DROP 2>/dev/null || iptables -I DOCKER-USER -s "$SUBNET" -d "$dst" -j DROP
done
# Traffic to the host itself (gateway address, published ports, SSH) never passes FORWARD – block it on input.
iptables -C INPUT -i "$BRIDGE_IF" -j DROP 2>/dev/null || iptables -I INPUT -i "$BRIDGE_IF" -j DROP

install -d "$(dirname "$MARKER")"
cat /proc/sys/kernel/random/boot_id >"$MARKER"
chmod 0644 "$MARKER"
echo "sandbox egress firewall active for $NET ($SUBNET via $BRIDGE_IF); marker $MARKER"
