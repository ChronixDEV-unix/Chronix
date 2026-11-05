#!/usr/bin/env bash
set -Eeuo pipefail

DISK_IMAGE="build/chronix-browser-amd64.img"
MOUNT_DIR="$RUNNER_TEMP/chronix-browser-root"
DISK_SIZE="1200M"
SUITE="trixie"
MIRROR="http://deb.debian.org/debian"
if [ "$#" -ge 1 ]; then DISK_IMAGE="$1"; fi
if [ "$#" -ge 2 ]; then MOUNT_DIR="$2"; fi

mkdir -p "$(dirname "$DISK_IMAGE")" "$MOUNT_DIR"
rm -f "$DISK_IMAGE"
truncate -s "$DISK_SIZE" "$DISK_IMAGE"

LOOPDEV=""
MOUNTED=0
cleanup() {
    set +e
    if [ "$MOUNTED" -eq 1 ]; then
        for target in "$MOUNT_DIR/dev/pts" "$MOUNT_DIR/dev" "$MOUNT_DIR/proc" "$MOUNT_DIR/sys"; do
            mountpoint -q "$target" && umount -lf "$target"
        done
        mountpoint -q "$MOUNT_DIR" && umount -lf "$MOUNT_DIR"
    fi
    if [ -n "$LOOPDEV" ]; then
        losetup -d "$LOOPDEV" 2>/dev/null || true
    fi
}
trap cleanup EXIT

parted -s "$DISK_IMAGE" mklabel msdos
parted -s "$DISK_IMAGE" mkpart primary ext4 1MiB 100%
parted -s "$DISK_IMAGE" set 1 boot on

LOOPDEV="$(losetup --find --show --partscan "$DISK_IMAGE")"
udevadm settle
PARTITION="$LOOPDEV"p1
for _ in $(seq 1 20); do
    [ -b "$PARTITION" ] && break
    sleep 0.25
done
[ -b "$PARTITION" ] || { echo "Partition device $PARTITION was not created" >&2; exit 1; }

mkfs.ext4 -F -m 0 -L CHRONIX_ROOT "$PARTITION"
mount "$PARTITION" "$MOUNT_DIR"
MOUNTED=1

debootstrap --arch=amd64 --variant=minbase \
    --include=ca-certificates,apt-utils,systemd,systemd-sysv \
    --keyring=/usr/share/keyrings/debian-archive-keyring.gpg \
    "$SUITE" "$MOUNT_DIR" "$MIRROR"

install -d "$MOUNT_DIR/etc/apt/sources.list.d"
cat > "$MOUNT_DIR/etc/apt/sources.list.d/debian.sources" <<EOF
Types: deb
URIs: https://deb.debian.org/debian
Suites: $SUITE $SUITE-updates
Components: main contrib non-free-firmware
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg

Types: deb
URIs: https://security.debian.org/debian-security
Suites: $SUITE-security
Components: main contrib non-free-firmware
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
EOF

mount --bind /dev "$MOUNT_DIR/dev"
mount --bind /dev/pts "$MOUNT_DIR/dev/pts"
mount -t proc proc "$MOUNT_DIR/proc"
mount -t sysfs sysfs "$MOUNT_DIR/sys"
cp /etc/resolv.conf "$MOUNT_DIR/etc/resolv.conf"

printf 'chronix\n' > "$MOUNT_DIR/etc/hostname"
cat > "$MOUNT_DIR/etc/hosts" <<'EOF'
127.0.0.1 localhost
127.0.1.1 chronix
::1 localhost ip6-localhost ip6-loopback
EOF

printf 'lightdm shared/default-x-display-manager select lightdm\n' | chroot "$MOUNT_DIR" debconf-set-selections
chroot "$MOUNT_DIR" env DEBIAN_FRONTEND=noninteractive apt-get update
chroot "$MOUNT_DIR" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    linux-image-amd64 grub-pc-bin grub2-common \
    xserver-xorg-core xserver-xorg-video-all xserver-xorg-input-all \
    lightdm lightdm-gtk-greeter \
    jwm xterm pcmanfm feh lxappearance \
    dbus-x11 sudo network-manager network-manager-gnome \
    fonts-dejavu-core fonts-liberation2 firefox-esr e2fsprogs

chroot "$MOUNT_DIR" useradd --create-home --shell /bin/bash --comment "Chronix User" chronos
PASSWORD_HASH="$(openssl passwd -6 -salt "$(openssl rand -hex 8)" chronos)"
echo "$PASSWORD_HASH" | chroot "$MOUNT_DIR" chpasswd --encrypted
unset PASSWORD_HASH
chroot "$MOUNT_DIR" usermod -aG sudo chronos
install -d -m 0750 "$MOUNT_DIR/etc/sudoers.d"
printf 'chronos ALL=(ALL:ALL) ALL\n' > "$MOUNT_DIR/etc/sudoers.d/chronos"
chmod 0440 "$MOUNT_DIR/etc/sudoers.d/chronos"

install -d "$MOUNT_DIR/etc/jwm" "$MOUNT_DIR/etc/lightdm/lightdm.conf.d" \
    "$MOUNT_DIR/usr/share/backgrounds/chronix" "$MOUNT_DIR/usr/share/pixmaps"
install -m 0644 installer/jwmrc "$MOUNT_DIR/etc/jwm/jwmrc"
if [ -f splash.png ]; then
    install -m 0644 splash.png "$MOUNT_DIR/usr/share/pixmaps/chronix.png"
fi
if [ -f "assets/branding/Wallpaper DARK.png" ]; then
    install -m 0644 "assets/branding/Wallpaper DARK.png" "$MOUNT_DIR/usr/share/backgrounds/chronix/wallpaper-dark.png"
fi
if [ -f "assets/branding/Wallpaper LIGHT.png" ]; then
    install -m 0644 "assets/branding/Wallpaper LIGHT.png" "$MOUNT_DIR/usr/share/backgrounds/chronix/wallpaper-light.png"
fi

cat > "$MOUNT_DIR/etc/lightdm/lightdm.conf.d/10-chronix-browser.conf" <<'EOF'
[Seat:*]
autologin-user=chronos
autologin-user-timeout=0
user-session=jwm
greeter-session=lightdm-gtk-greeter
EOF

cat > "$MOUNT_DIR/etc/skel/.xsession" <<'EOF'
#!/bin/sh
if [ -f /usr/share/backgrounds/chronix/wallpaper-dark.png ]; then
    feh --bg-fill /usr/share/backgrounds/chronix/wallpaper-dark.png >/dev/null 2>&1 || true
fi
exec jwm
EOF
chmod 0755 "$MOUNT_DIR/etc/skel/.xsession"
install -m 0755 "$MOUNT_DIR/etc/skel/.xsession" "$MOUNT_DIR/home/chronos/.xsession"
chroot "$MOUNT_DIR" chown chronos:chronos /home/chronos/.xsession

cat > "$MOUNT_DIR/etc/NetworkManager/conf.d/10-chronix.conf" <<'EOF'
[main]
dhcp=internal
EOF

cat > "$MOUNT_DIR/etc/default/grub" <<'EOF'
GRUB_DEFAULT=0
GRUB_TIMEOUT=0
GRUB_TIMEOUT_STYLE=hidden
GRUB_DISTRIBUTOR="Chronix"
GRUB_CMDLINE_LINUX_DEFAULT="quiet loglevel=3 console=tty0 console=ttyS0,115200n8"
GRUB_CMDLINE_LINUX=""
EOF

ROOT_UUID="$(blkid -s UUID -o value "$PARTITION")"
cat > "$MOUNT_DIR/etc/fstab" <<EOF
UUID=$ROOT_UUID / ext4 errors=remount-ro 0 1
EOF

cat > "$MOUNT_DIR/etc/systemd/system/chronix-browser-ready.service" <<'EOF'
[Unit]
Description=Chronix browser VM boot marker
After=graphical.target
Wants=graphical.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo CHRONIX_BROWSER_VM_READY > /dev/ttyS0 2>/dev/null || true'

[Install]
WantedBy=graphical.target
EOF

chroot "$MOUNT_DIR" systemctl enable lightdm
chroot "$MOUNT_DIR" systemctl enable NetworkManager
chroot "$MOUNT_DIR" systemctl enable chronix-browser-ready.service
chroot "$MOUNT_DIR" update-initramfs -u -k all
chroot "$MOUNT_DIR" update-grub
chroot "$MOUNT_DIR" grub-install --target=i386-pc --recheck "$LOOPDEV"

chroot "$MOUNT_DIR" apt-get clean
rm -rf "$MOUNT_DIR/var/lib/apt/lists/"*
find "$MOUNT_DIR/var/log" -type f -exec truncate -s 0 {} \; || true
rm -f "$MOUNT_DIR/etc/resolv.conf"
sync

for target in "$MOUNT_DIR/dev/pts" "$MOUNT_DIR/dev" "$MOUNT_DIR/proc" "$MOUNT_DIR/sys"; do
    umount "$target"
done
umount "$MOUNT_DIR"
MOUNTED=0
losetup -d "$LOOPDEV"
LOOPDEV=""

file "$DISK_IMAGE"
ls -lh "$DISK_IMAGE"
sha256sum "$DISK_IMAGE"
