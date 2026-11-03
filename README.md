# Chronix

Chronix is a Debian-based Linux distribution using **JWM (Joe's Window Manager)**.

The project has two planned editions:

- **PC edition:** a bootable live ISO, with an installer planned.
- **Browser edition:** a browser-hosted x86 Linux virtual machine. This must boot a real Linux kernel and root filesystem; it is not a simulated desktop.

## Project status

This repository is the starting point for Chronix. The first milestone is a reproducible Debian live image with JWM. The browser edition will be developed separately after its emulator and architecture requirements are verified.

## Planned layout

- `config/` — Debian live-build configuration
- `browser/` — browser edition launcher and emulator assets
- `.github/workflows/` — automated cloud builds

## Build environment

Chronix is intended to be built by GitHub Actions so contributors do not need a local Linux installation. Build scripts and workflows will be added after the initial live-build configuration is in place.

## Desktop

The desktop environment is JWM (Joe's Window Manager), not a web-based desktop simulation.

## License

License and redistribution details will be selected before distributing build images.
