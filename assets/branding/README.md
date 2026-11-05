# Chronix Standard branding assets

Place the user-approved image files in this directory before running the ISO build:

| File name | Used for |
| --- | --- |
| `BOOT&ORGRUB.png` | GRUB background and Syslinux installer-menu background |
| `logo.png` | Installed-system logo asset |
| `splash.png` | Installer splash artwork |
| `Wallpaper DARK.png` | Default JWM desktop wallpaper |
| `Wallpaper LIGHT.png` | Alternate light wallpaper, installed for later theme switching |

The build script accepts these exact names. It does not fabricate substitutes if one is missing. At present, the repository already contains a root-level `splash.png` logo fallback, but the remaining attachments must be added here to be embedded in the ISO.
