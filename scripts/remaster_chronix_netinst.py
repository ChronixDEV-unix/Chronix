#!/usr/bin/env python3
"""Remaster a Debian amd64 NETINST tree into the first Chronix Standard ISO."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

PRESEED_PARAMETER = "file=/cdrom/chronix-preseed.cfg"


def fail(message: str) -> "NoReturn":
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def replace_text(path: Path, transform, changed: set[str], root: Path) -> None:
    if not path.is_file():
        return
    try:
        old = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return
    new = transform(old)
    if new != old:
        path.write_text(new, encoding="utf-8")
        changed.add(path.relative_to(root).as_posix())


def add_preseed_to_append(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("append ") and "initrd=" in stripped and PRESEED_PARAMETER not in line:
            line = line.rstrip() + " " + PRESEED_PARAMETER
        lines.append(line)
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def set_text_installer_default(text: str) -> str:
    lines = text.splitlines()
    target = None
    for index, line in enumerate(lines):
        if re.match(r"^\s*label\s+install\s*$", line, re.IGNORECASE):
            target = index
            break
    if target is None:
        return text

    end = len(lines)
    for index in range(target + 1, len(lines)):
        if re.match(r"^\s*label\s+", lines[index], re.IGNORECASE):
            end = index
            break

    block = lines[target:end]
    block = [line for line in block if not re.match(r"^\s*menu\s+default\s*$", line, re.IGNORECASE)]
    label_line = next((i for i, line in enumerate(block) if re.match(r"^\s*menu\s+label\b", line, re.IGNORECASE)), None)
    if label_line is not None:
        indent = re.match(r"^(\s*)", block[label_line]).group(1)
        block[label_line] = indent + "menu label ^Chronix Installer (text mode)"
        block.insert(label_line + 1, indent + "menu default")
    else:
        block.insert(1, "\tmenu label ^Chronix Installer (text mode)\n\tmenu default")
    lines[target:end] = block
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def soften_graphical_default(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if re.match(r"^\s*default\s+installgui\s*$", line, re.IGNORECASE):
            continue
        if re.match(r"^\s*menu\s+default\s*$", line, re.IGNORECASE):
            continue
        if re.match(r"^\s*menu\s+label\s+\^?Graphical install\s*$", line, re.IGNORECASE):
            indent = re.match(r"^(\s*)", line).group(1)
            line = indent + "menu label ^Graphical install (optional)"
        lines.append(line)
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def patch_grub(text: str) -> str:
    text = text.replace("Debian GNU/Linux", "Chronix")
    lines = text.splitlines()
    entry_names: list[str] = []
    entry_line_indexes: list[int] = []

    for index, line in enumerate(lines):
        match = re.match(r"""^\s*menuentry\b.*?(['"])(.*?)\1""", line)
        if match:
            entry_names.append(match.group(2))
            entry_line_indexes.append(index)

    default_index = None
    for index, name in enumerate(entry_names):
        lowered = name.lower()
        if "install" in lowered and "graphical" not in lowered and "expert" not in lowered and "rescue" not in lowered:
            default_index = index
            break

    # Rename the standard text installer entry, leaving the graphical option available.
    for i, line in enumerate(lines):
        if re.match(r"""^\s*menuentry\b""", line) and re.search(r"""(['"])Install\1""", line, re.IGNORECASE):
            if "Graphical" not in line and "Expert" not in line and "Rescue" not in line:
                lines[i] = re.sub(r"""(['"])Install\1""", r"\1Chronix Installer (text mode)\1", line, count=1, flags=re.IGNORECASE)
                break

    # Feed the same local preseed to installer kernel entries.
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        if (stripped.startswith("linux ") or stripped.startswith("linuxefi ")) and "install.amd/vmlinuz" in line:
            if PRESEED_PARAMETER not in line:
                lines[i] = line.rstrip() + " " + PRESEED_PARAMETER

    if default_index is not None:
        found_default = False
        for i, line in enumerate(lines):
            if re.match(r"^\s*set\s+default\s*=", line):
                indent = re.match(r"^(\s*)", line).group(1)
                lines[i] = f'{indent}set default="{default_index}"'
                found_default = True
                break
        if not found_default:
            lines.insert(0, f'set default="{default_index}"')

    if not any("set menu_color_highlight=" in line for line in lines):
        insert_at = next((i for i, line in enumerate(lines) if line.lstrip().startswith("menuentry ")), len(lines))
        lines[insert_at:insert_at] = [
            "set menu_color_normal=white/black",
            "set menu_color_highlight=white/dark-red",
        ]

    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def update_md5sums(tree: Path, changed: set[str]) -> None:
    md5_path = tree / "md5sum.txt"
    if not md5_path.is_file():
        return

    updated: list[str] = []
    seen: set[str] = set()
    for line in md5_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "  " not in line:
            updated.append(line)
            continue
        digest, listed = line.split("  ", 1)
        rel = listed.removeprefix("./").lstrip("/")
        file_path = tree / rel
        if rel in changed and file_path.is_file():
            new_digest = hashlib.md5(file_path.read_bytes()).hexdigest()
            updated.append(f"{new_digest}  {listed}")
        else:
            updated.append(line)
        seen.add(rel)

    for rel in sorted(changed):
        if rel in seen or rel == "md5sum.txt":
            continue
        file_path = tree / rel
        if file_path.is_file():
            digest = hashlib.md5(file_path.read_bytes()).hexdigest()
            updated.append(f"{digest}  ./{rel}")

    md5_path.write_text("\n".join(updated) + "\n", encoding="utf-8")
    changed.add("md5sum.txt")


def copy_branding(tree: Path, assets: Path, repo_root: Path, changed: set[str]) -> None:
    chronix_dir = tree / "chronix"
    chronix_dir.mkdir(parents=True, exist_ok=True)

    # Installer assets are optional until the matching files are added to assets/branding.
    mapping = {
        "BOOT&ORGRUB.png": [("isolinux/splash.png", "boot"), ("boot/grub/chronix-background.png", "grub")],
        "logo.png": [("chronix/logo.png", "copy")],
        "splash.png": [("chronix/splash.png", "copy")],
        "Wallpaper DARK.png": [("chronix/wallpaper-dark.png", "copy")],
        "Wallpaper LIGHT.png": [("chronix/wallpaper-light.png", "copy")],
    }

    for source_name, targets in mapping.items():
        source = assets / source_name
        if not source.is_file():
            continue
        for target, mode in targets:
            target_path = tree / target
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target_path)
            changed.add(target)
            if mode == "boot":
                print(f"Using {source_name} as the BIOS installer menu background.")
            elif mode == "grub":
                print(f"Using {source_name} as the GRUB background.")

    # Older repository state contains the logo as a root-level splash.png.
    if not (chronix_dir / "logo.png").is_file():
        legacy_logo = repo_root / "splash.png"
        if legacy_logo.is_file():
            shutil.copy2(legacy_logo, chronix_dir / "logo.png")
            changed.add("chronix/logo.png")
            print("Using the existing repository splash.png as the Chronix logo fallback.")

    if (chronix_dir / "logo.png").is_file():
        changed.add("chronix/logo.png")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--iso-tree", required=True, type=Path)
    parser.add_argument("--base-iso", required=True, type=Path)
    parser.add_argument("--output-iso", required=True, type=Path)
    parser.add_argument("--repo-root", required=True, type=Path)
    parser.add_argument("--assets-dir", required=True, type=Path)
    args = parser.parse_args()

    tree = args.iso_tree.resolve()
    base_iso = args.base_iso.resolve()
    output_iso = args.output_iso.resolve()
    repo_root = args.repo_root.resolve()
    assets = args.assets_dir.resolve()

    if not tree.is_dir():
        fail(f"Extracted ISO tree not found: {tree}")
    if not base_iso.is_file():
        fail(f"Source ISO not found: {base_iso}")
    if not (tree / "install.amd/vmlinuz").is_file() or not (tree / "install.amd/initrd.gz").is_file():
        fail("This does not look like a Debian amd64 NETINST tree (install.amd/vmlinuz and initrd.gz are required).")
    if not (tree / "isolinux/isolinux.bin").is_file():
        fail("The Debian BIOS bootloader /isolinux/isolinux.bin is missing; refusing to build a possibly unbootable ISO.")

    changed: set[str] = set()

    # Keep the Debian Installer text interface and mark it as the default boot option.
    menu_cfg = tree / "isolinux/menu.cfg"
    replace_text(
        menu_cfg,
        lambda s: re.sub(
            r"(?mi)^\s*menu title.*Debian.*$",
            "menu title Chronix Installer | BIOS mode",
            s,
        ),
        changed,
        tree,
    )

    stdmenu_cfg = tree / "isolinux/stdmenu.cfg"
    def style_syslinux(s: str) -> str:
        replacements = {
            "menu color sel": "menu color sel\t\t* #ffffffff #d92755ff *",
            "menu color hotsel": "menu color hotsel\t1;7;37;40 #ffffffff #b51e46ff *",
        }
        lines = []
        for line in s.splitlines():
            key = line.strip().split(None, 3)[:3]
            if len(key) >= 3 and " ".join(key[:3]) in replacements:
                line = replacements[" ".join(key[:3])]
            lines.append(line)
        return "\n".join(lines) + ("\n" if s.endswith("\n") else "")
    replace_text(stdmenu_cfg, style_syslinux, changed, tree)

    txt_cfg = tree / "isolinux/txt.cfg"
    if not txt_cfg.is_file():
        fail("The BIOS text-installer menu /isolinux/txt.cfg is missing.")
    replace_text(txt_cfg, lambda s: set_text_installer_default(add_preseed_to_append(s)), changed, tree)

    gtk_cfg = tree / "isolinux/gtk.cfg"
    if gtk_cfg.is_file():
        replace_text(gtk_cfg, soften_graphical_default, changed, tree)

    # Apply the preseed path to alternate text installer entries, too.
    for cfg in (tree / "isolinux").glob("*.cfg"):
        if cfg in (txt_cfg, gtk_cfg):
            continue
        replace_text(cfg, add_preseed_to_append, changed, tree)

    # Change visible branding and kernel parameters in GRUB while retaining its boot entries.
    grub_cfgs = list((tree / "boot/grub").glob("*.cfg")) if (tree / "boot/grub").is_dir() else []
    if not grub_cfgs:
        fail("The GRUB configuration under /boot/grub was not found.")
    for cfg in grub_cfgs:
        replace_text(cfg, patch_grub, changed, tree)

    # Add Chronix installer-side configuration and artwork.
    installer_dir = repo_root / "installer"
    chronix_dir = tree / "chronix"
    chronix_dir.mkdir(parents=True, exist_ok=True)
    for filename in ("post-install.sh", "jwmrc"):
        source = installer_dir / filename
        if not source.is_file():
            fail(f"Required Chronix installer file is missing: {source}")
        dest = chronix_dir / filename
        shutil.copy2(source, dest)
        changed.add(dest.relative_to(tree).as_posix())

    readme = chronix_dir / "README.txt"
    readme.write_text(
        "CHRONIX STANDARD 1.0\n"
        "Debian 13.7 Trixie amd64 NETINST base\n\n"
        "Installer mode: classic Debian text installer.\n"
        "Disk partitioning and the normal installation choices remain interactive.\n\n"
        "Default account: chronos\n"
        "Initial password: chronos\n"
        "Change the initial password immediately after installation. It is a shared project default.\n"
        "The root account remains present; direct root password login is disabled and chronos has sudo.\n",
        encoding="utf-8",
    )
    changed.add("chronix/README.txt")

    template_path = installer_dir / "chronix-preseed.cfg.in"
    if not template_path.is_file():
        fail(f"Preseed template not found: {template_path}")
    password_hash = os.environ.get("CHRONIX_PASSWORD_HASH", "")
    if not password_hash.startswith("$6$"):
        fail("CHRONIX_PASSWORD_HASH must contain a SHA-512 crypt hash generated during the workflow.")
    preseed = template_path.read_text(encoding="utf-8").replace("@CHRONIX_PASSWORD_HASH@", password_hash)
    if "@CHRONIX_PASSWORD_HASH@" in preseed:
        fail("Password hash placeholder was not replaced.")
    preseed_path = tree / "chronix-preseed.cfg"
    preseed_path.write_text(preseed, encoding="utf-8")
    changed.add("chronix-preseed.cfg")

    copy_branding(tree, assets, repo_root, changed)

    # The ISO's disc metadata should identify Chronix, not Debian.
    disk_info = tree / ".disk/info"
    disk_info.parent.mkdir(parents=True, exist_ok=True)
    disk_info.write_text(
        "Chronix Standard 1.0 amd64 NETINST (Debian 13.7 Trixie)\n",
        encoding="utf-8",
    )
    changed.add(".disk/info")

    update_md5sums(tree, changed)

    # Avoid remapping the El Torito boot image itself. The original boot images
    # stay in place; xorriso replays the original BIOS/UEFI boot records below.
    changed.discard("md5sum.txt")
    map_pairs = []
    for rel in sorted(changed):
        local_path = tree / rel
        if local_path.is_file():
            map_pairs.extend(["-map", str(local_path), "/" + rel])

    # Add the new Chronix directory as a single ISO tree mapping.
    map_pairs.extend(["-map", str(chronix_dir), "/chronix"])

    output_iso.parent.mkdir(parents=True, exist_ok=True)
    if output_iso.exists():
        output_iso.unlink()

    command = [
        "xorriso",
        "-indev", str(base_iso),
        "-outdev", str(output_iso),
        *map_pairs,
        "-volid", "CHRONIX_1_0",
        "-boot_image", "any", "replay",
        "-compliance", "no_emul_toc",
        "-padding", "included",
        "-commit",
        "-end",
    ]
    print("Running xorriso to create the bootable Chronix installer...")
    subprocess.run(command, check=True)
    if not output_iso.is_file() or output_iso.stat().st_size < 650 * 1024 * 1024:
        fail("The remastered ISO is missing or unexpectedly small.")
    print(f"Created {output_iso} ({output_iso.stat().st_size} bytes).")


if __name__ == "__main__":
    main()
