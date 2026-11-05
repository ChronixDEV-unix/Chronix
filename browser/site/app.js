import V86 from "./vm/build/libv86.mjs";

const byId = (id) => document.getElementById(id);
const diskInput = byId("disk-file");
const startButton = byId("start-btn");
const stopButton = byId("stop-btn");
const restartButton = byId("restart-btn");
const saveButton = byId("save-disk-btn");
const fullscreenButton = byId("fullscreen-btn");
const memorySelect = byId("memory-size");
const statusText = byId("status-text");
const statusDot = byId("status-dot");
const message = byId("message");
const placeholder = byId("screen-placeholder");
const screenContainer = byId("screen_container");
const serialLog = byId("serial-log");
const progress = byId("progress");
const progressBar = byId("progress-bar");

let selectedFile = null;
let diskBuffer = null;
let emulator = null;
let starting = false;
let running = false;

function setStatus(label, state = "off") {
  statusText.textContent = label;
  statusDot.className = "status-dot" + (state === "running" ? " running" : state === "busy" ? " busy" : "");
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.className = "message" + (isError ? " error" : "");
}

function appendSerial(text) {
  if (!text) return;
  if (serialLog.textContent.startsWith("Serial output will appear here")) serialLog.textContent = "";
  serialLog.textContent += text;
  if (serialLog.textContent.length > 24000) serialLog.textContent = serialLog.textContent.slice(-24000);
  serialLog.scrollTop = serialLog.scrollHeight;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / (1024 ** 3)).toFixed(2) + " GiB";
  return (bytes / (1024 ** 2)).toFixed(0) + " MiB";
}

diskInput.addEventListener("change", () => {
  selectedFile = diskInput.files && diskInput.files[0] ? diskInput.files[0] : null;
  if (selectedFile) {
    byId("file-name").textContent = selectedFile.name;
    byId("file-size").textContent = formatBytes(selectedFile.size);
    setMessage("Disk image selected. Power on when ready.");
    startButton.disabled = false;
  } else {
    byId("file-name").textContent = "Choose disk image…";
    byId("file-size").textContent = "Raw .img virtual hard disk";
    startButton.disabled = true;
  }
});

async function stopMachine() {
  if (!emulator) return;
  try { await emulator.stop(); } catch (error) { console.warn(error); }
  running = false;
  starting = false;
  stopButton.disabled = true;
  restartButton.disabled = true;
  saveButton.disabled = !diskBuffer;
  startButton.disabled = !selectedFile;
  fullscreenButton.disabled = true;
  setStatus("Machine stopped");
  setMessage("Machine stopped. Save the disk image before closing to keep changes.");
}

async function startMachine() {
  if (starting || running || emulator) return;
  if (!selectedFile) {
    setMessage("Choose the Chronix .img disk file first.", true);
    return;
  }

  starting = true;
  startButton.disabled = true;
  diskInput.disabled = true;
  memorySelect.disabled = true;
  progress.hidden = false;
  progressBar.style.width = "12%";
  setStatus("Loading virtual disk…", "busy");
  setMessage("Reading the local disk image into browser memory. Large images may take a little while.");

  try {
    // v86 accepts an ArrayBuffer for a writable in-memory virtual hard disk.
    diskBuffer = await selectedFile.arrayBuffer();
    progressBar.style.width = "38%";
    setStatus("Starting x86-64 PC…", "busy");

    emulator = new V86({
      wasm_path: "./vm/build/v86.wasm",
      memory_size: Number(memorySelect.value) * 1024 * 1024,
      vga_memory_size: 16 * 1024 * 1024,
      screen_container: screenContainer,
      serial_container: serialLog,
      bios: { url: "./vm/bios/seabios.bin" },
      vga_bios: { url: "./vm/bios/vgabios.bin" },
      hda: { buffer: diskBuffer },
      acpi: true,
      autostart: true
    });

    emulator.add_listener("emulator-ready", () => {
      progressBar.style.width = "100%";
      placeholder.hidden = true;
      running = true;
      starting = false;
      stopButton.disabled = false;
      restartButton.disabled = false;
      saveButton.disabled = false;
      fullscreenButton.disabled = false;
      setStatus("Running", "running");
      setMessage("Chronix is booting. Click inside the display to use the keyboard.");
      setTimeout(() => { progress.hidden = true; }, 700);
    });

    emulator.add_listener("emulator-stopped", () => {
      running = false;
      if (!starting) {
        setStatus("Machine stopped");
        stopButton.disabled = true;
        restartButton.disabled = false;
        saveButton.disabled = !diskBuffer;
      }
    });

    emulator.add_listener("emulator-started", () => {
      appendSerial("\n[Chronix VM started]\n");
    });

    emulator.add_listener("serial0-output-byte", (byte) => {
      appendSerial(String.fromCharCode(byte));
    });

    setMessage("Loading the emulator and booting the virtual machine…");
  } catch (error) {
    console.error(error);
    emulator = null;
    diskBuffer = null;
    starting = false;
    diskInput.disabled = false;
    memorySelect.disabled = false;
    startButton.disabled = !selectedFile;
    progress.hidden = true;
    setStatus("Could not start");
    setMessage(error && error.message ? error.message : String(error), true);
  }
}

startButton.addEventListener("click", startMachine);

stopButton.addEventListener("click", async () => {
  await stopMachine();
  diskInput.disabled = false;
  memorySelect.disabled = false;
});

restartButton.addEventListener("click", async () => {
  if (!emulator) return;
  setStatus("Restarting…", "busy");
  setMessage("Restarting Chronix.");
  try {
    await emulator.restart();
    setStatus("Running", "running");
  } catch (error) {
    setMessage("Restart failed: " + error.message, true);
  }
});

fullscreenButton.addEventListener("click", async () => {
  try {
    if (screenContainer.requestFullscreen) await screenContainer.requestFullscreen();
  } catch (error) {
    setMessage("Fullscreen unavailable: " + error.message, true);
  }
});

saveButton.addEventListener("click", async () => {
  if (!diskBuffer) return;
  const wasRunning = running;
  if (wasRunning) {
    setMessage("Pausing Chronix while the disk image is saved…");
    await emulator.stop();
  }
  try {
    const suggestedName = "chronix-browser-amd64.img";
    if ("showSaveFilePicker" in window) {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "Chronix virtual disk image", accept: { "application/octet-stream": [".img"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(diskBuffer);
      await writable.close();
    } else {
      const blob = new Blob([diskBuffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = suggestedName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    setMessage("Disk image saved. Choose the saved .img file the next time you start Chronix.");
  } catch (error) {
    if (error.name === "AbortError") {
      setMessage("Save cancelled.");
    } else {
      setMessage("Could not save disk image: " + error.message, true);
    }
  } finally {
    if (wasRunning) {
      try { emulator.run(); running = true; setStatus("Running", "running"); } catch (error) { console.warn(error); }
    }
  }
});

window.addEventListener("beforeunload", (event) => {
  if (running || starting) {
    event.preventDefault();
    event.returnValue = "";
  }
});
