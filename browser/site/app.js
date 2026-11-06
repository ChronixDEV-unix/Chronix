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
let hasUnsavedChanges = false;

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
  diskBuffer = null;
  if (selectedFile) {
    byId("file-name").textContent = selectedFile.name;
    byId("file-size").textContent = formatBytes(selectedFile.size);
    if (selectedFile.size < 512 || selectedFile.size % 512 !== 0) {
      selectedFile = null;
      diskInput.value = "";
      byId("file-name").textContent = "Choose disk image…";
      byId("file-size").textContent = "Built-in disk loads automatically";
      setMessage("That file does not look like a valid raw disk image (size must be a multiple of 512 bytes).", true);
      return;
    }
    setMessage("Local disk image selected. It will be used instead of the built-in disk.");
  } else {
    byId("file-name").textContent = "Choose disk image…";
    byId("file-size").textContent = "Built-in disk loads automatically";
    setMessage("The built-in Chronix disk will be used.");
  }
  startButton.disabled = false;
});

async function loadDiskImage() {
  if (selectedFile) {
    setMessage("Reading your local disk image into browser memory…");
    return await selectedFile.arrayBuffer();
  }
  if (diskBuffer) {
    return diskBuffer;
  }

  setMessage("Downloading the built-in Chronix disk image…");
  progressBar.style.width = "18%";
  const response = await fetch("./vm/chronix-browser-amd64.diskdata", { cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new Error("Could not download the built-in VM disk (HTTP " + response.status + ").");
  }
  if (typeof DecompressionStream !== "function") {
    throw new Error("This Chrome version does not support streaming gzip decompression. Choose a local .img file instead.");
  }

  const total = Number(response.headers.get("content-length") || 0);
  if (total) {
    setMessage("Downloading built-in disk image (" + formatBytes(total) + ")…");
  }
  progressBar.style.width = "30%";
  const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
  const buffer = await new Response(decompressed).arrayBuffer();
  if (!buffer.byteLength) {
    throw new Error("The built-in disk image decompressed to an empty file.");
  }
  progressBar.style.width = "38%";
  byId("file-name").textContent = "Built-in Chronix disk";
  byId("file-size").textContent = formatBytes(buffer.byteLength) + " loaded";
  return buffer;
}

async function stopMachine() {
  if (!emulator) return;
  const machine = emulator;
  try { await machine.stop(); } catch (error) { console.warn("VM stop failed:", error); }
  try { await machine.destroy(); } catch (error) { console.warn("VM cleanup failed:", error); }
  emulator = null;
  running = false;
  starting = false;
  stopButton.disabled = true;
  restartButton.disabled = true;
  saveButton.disabled = !diskBuffer;
  startButton.disabled = false;
  fullscreenButton.disabled = true;
  diskInput.disabled = false;
  memorySelect.disabled = false;
  setStatus("Machine stopped");
  setMessage("Machine stopped. Save the disk image before closing to keep changes.");
}

async function startMachine() {
  if (starting || running || emulator) return;

  starting = true;
  startButton.disabled = true;
  diskInput.disabled = true;
  memorySelect.disabled = true;
  progress.hidden = false;
  progressBar.style.width = "8%";
  setStatus("Preparing virtual disk…", "busy");

  try {
    diskBuffer = await loadDiskImage();
    hasUnsavedChanges = true;
    setStatus("Starting x86-64 PC…", "busy");

    emulator = new V86({
      wasm_path: "./vm/build/v86.wasm",
      memory_size: Number(memorySelect.value) * 1024 * 1024,
      vga_memory_size: 16 * 1024 * 1024,
      screen_container: screenContainer,
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

    emulator.add_listener("download-error", async (event) => {
      const filename = event && event.file_name ? event.file_name : "a VM component";
      appendSerial("\n[Download error: " + filename + "]\n");
      const failedMachine = emulator;
      starting = false;
      running = false;
      try { if (failedMachine) await failedMachine.destroy(); } catch (cleanupError) { console.warn(cleanupError); }
      if (emulator === failedMachine) emulator = null;
      diskInput.disabled = false;
      memorySelect.disabled = false;
      startButton.disabled = false;
      stopButton.disabled = true;
      restartButton.disabled = true;
      fullscreenButton.disabled = true;
      progress.hidden = true;
      setStatus("VM component failed to load");
      setMessage("Could not load " + filename + ". Check your connection and try again.", true);
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
    if (emulator) {
      try { await emulator.destroy(); } catch (cleanupError) { console.warn(cleanupError); }
    }
    emulator = null;
    diskBuffer = null;
    starting = false;
    diskInput.disabled = false;
    memorySelect.disabled = false;
    startButton.disabled = false;
    progress.hidden = true;
    setStatus("Could not start");
    setMessage(error && error.message ? error.message : String(error), true);
  }
}

startButton.addEventListener("click", startMachine);

stopButton.addEventListener("click", stopMachine);

restartButton.addEventListener("click", () => {
  if (!emulator) return;
  setStatus("Restarting…", "busy");
  setMessage("Restarting Chronix.");
  try {
    emulator.restart();
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
    hasUnsavedChanges = false;
    setMessage("Disk image saved. Choose the saved .img file the next time you start Chronix.");
  } catch (error) {
    if (error.name === "AbortError") {
      setMessage("Save cancelled.");
    } else {
      setMessage("Could not save disk image: " + error.message, true);
    }
  } finally {
    if (wasRunning && emulator) {
      try {
        await emulator.run();
        running = true;
        setStatus("Running", "running");
      } catch (error) {
        console.warn(error);
      }
    }
  }
});

window.addEventListener("beforeunload", (event) => {
  if (running || starting || hasUnsavedChanges) {
    event.preventDefault();
    event.returnValue = "";
  }
});

window.addEventListener("error", (event) => {
  if (starting && event.error) {
    setMessage("Browser-side VM error: " + event.error.message, true);
  }
});
