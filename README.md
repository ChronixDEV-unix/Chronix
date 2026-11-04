## !WARNING PLEASE READ!

A majority of this is VibeCoded by CHATGPT, this is an experiment to see its capabilities. **I DO NOT CONDONE THE USE OF AI AGENTS BY DOING THIS.**

# Chronix

Chronix is a Debian-based Linux distribution using **JWM (Joe's Window Manager)**, and **DWM (Dynamic Window Manager)**.

The project has two planned versions *and 2 subversions*:

- **Chronix Desktop/LITE:** a bootable live ISO, with an installer planned.
- **Chronix Chrome/LITE:** a browser-hosted x86 Linux virtual machine. This must boot a real Linux kernel and root filesystem; it is not a simulated desktop.

## Project status

This repository is the starting point for Chronix. The goal is a reproducible Debian live image with JWM. The browser edition will be developed separately after its emulator and architecture requirements are complete.

## Planned layout

- `config/` — Debian live-build configuration
- `browser/` — browser edition launcher and emulator assets
- `.github/workflows/` — automated cloud builds

## Environment

Chronix is intended to be built by GitHub Actions so contributors do not need a local Linux installation. Build scripts and workflows will be added after the initial live-build configuration is in place.

## Desktop

The desktop environment is JWM (Joe's Window Manager), not a web-based desktop simulation. I repeat, **The desktop version of Chronix IS REAL LINUX.**

## License

License and redistribution details will be made before distributing build images.
