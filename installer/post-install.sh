#!/bin/sh
set -eu

# This script runs inside the installed target system as root.
CHRONIX_DIR="/tmp/chronix"
BG_DIR="/usr/share/backgrounds/chronix"

install -d -m 0755 "$BG_DIR" /usr/share/pixmaps /etc/lightdm/lightdm.conf.d /etc/skel

# Install branding assets only when they are present on the ISO.
[ ! -f "$CHRONIX_DIR/logo.png" ] || install -m 0644 "$CHRONIX_DIR/logo.png" /usr/share/pixmaps/chronix.png
[ ! -f "$CHRONIX_DIR/wallpaper-dark.png" ] || install -m 0644 "$CHRONIX_DIR/wallpaper-dark.png" "$BG_DIR/wallpaper-dark.png"
[ ! -f "$CHRONIX_DIR/wallpaper-light.png" ] || install -m 0644 "$CHRONIX_DIR/wallpaper-light.png" "$BG_DIR/wallpaper-light.png"

if [ -f "$CHRONIX_DIR/jwmrc" ]; then
    install -m 0644 "$CHRONIX_DIR/jwmrc" /etc/jwm/jwmrc
fi

# Keep the regular LightDM login screen. Do not auto-login a shared default account.
cat > /etc/lightdm/lightdm.conf.d/10-chronix.conf <<'EOF'
[Seat:*]
greeter-session=lightdm-gtk-greeter
user-session=jwm
EOF

# Add the Chronix account to sudo without changing the normal root account.
if id chronos >/dev/null 2>&1; then
    usermod -aG sudo chronos
fi

# Provide a JWM session and apply the dark Chronix wallpaper when installed.
cat > /etc/skel/.xsession <<'EOF'
#!/bin/sh
if [ -f /usr/share/backgrounds/chronix/wallpaper-dark.png ]; then
    feh --bg-fill /usr/share/backgrounds/chronix/wallpaper-dark.png >/dev/null 2>&1 || true
fi
exec jwm
EOF
chmod 0755 /etc/skel/.xsession

if id chronos >/dev/null 2>&1; then
    install -m 0755 /etc/skel/.xsession /home/chronos/.xsession
    chown chronos:chronos /home/chronos/.xsession
fi

systemctl set-default graphical.target
systemctl enable lightdm

# Remove the temporary copy of the installer-side script and assets.
rm -rf "$CHRONIX_DIR"
