// ============================================================
// CONFIG
// ============================================================
// Paste your Apps Script Web App URL here after deploying.
// It should look like:
//   https://script.google.com/macros/s/AKfycb.../exec
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyRqTHsLtIffHc1mfiWicpQ5IJjHR8892UG6mrWPpKpqrTkJNlvP-eeFFI2pWp6BMgO4Q/exec";

// ============================================================
// STATE
// ============================================================
let codeReader = null;
let scannerStream = null;
let photoStream = null;
let capturedImageBase64 = null;

// ============================================================
// DOM
// ============================================================
const $ = (id) => document.getElementById(id);

const screens = {
  capture: $("screen-capture"),
  review: $("screen-review"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

function showStatus(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}
function hide(el) {
  el.classList.add("hidden");
}

function setError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ============================================================
// SCANNER
// ============================================================
$("btn-scan").addEventListener("click", startScanner);
$("btn-stop-scan").addEventListener("click", stopScanner);

// ============================================================
// MANUAL ISBN ENTRY
// ============================================================
$("btn-manual").addEventListener("click", () => {
  hide($("error"));
  hide($("status"));
  $("manual-wrap").classList.remove("hidden");
  $("btn-scan").classList.add("hidden");
  $("btn-manual").classList.add("hidden");
  $("btn-photo").classList.add("hidden");
  $("manual-isbn").value = "";
  $("manual-isbn").focus();
});

$("btn-manual-cancel").addEventListener("click", closeManual);

$("btn-manual-lookup").addEventListener("click", () => {
  const raw = $("manual-isbn").value.replace(/[^0-9Xx]/g, "");
  if (raw.length !== 10 && raw.length !== 13) {
    setError($("error"), "ISBN must be 10 or 13 digits.");
    return;
  }
  closeManual();
  handleIsbn(raw);
});

$("manual-isbn").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-manual-lookup").click();
});

function closeManual() {
  $("manual-wrap").classList.add("hidden");
  $("btn-scan").classList.remove("hidden");
  $("btn-manual").classList.remove("hidden");
  $("btn-photo").classList.remove("hidden");
}

async function startScanner() {
  hide($("error"));
  hide($("status"));
  $("scanner-wrap").classList.remove("hidden");
  $("btn-scan").classList.add("hidden");
  $("btn-manual").classList.add("hidden");
  $("btn-photo").classList.add("hidden");

  try {
    codeReader = new ZXing.BrowserMultiFormatReader();
    const devices = await codeReader.listVideoInputDevices();
    // Prefer back camera on mobile
    const back = devices.find((d) => /back|rear|environment/i.test(d.label));
    const deviceId = back ? back.deviceId : devices[0] && devices[0].deviceId;

    await codeReader.decodeFromVideoDevice(
      deviceId,
      "scanner-video",
      (result, err) => {
        if (result) {
          const isbn = result.getText().replace(/[^0-9Xx]/g, "");
          if (isbn.length === 10 || isbn.length === 13) {
            stopScanner();
            handleIsbn(isbn);
          }
        }
      },
    );
  } catch (e) {
    setError($("error"), "Could not start camera: " + e.message);
    stopScanner();
  }
}

function stopScanner() {
  if (codeReader) {
    try {
      codeReader.reset();
    } catch (_) {}
    codeReader = null;
  }
  $("scanner-wrap").classList.add("hidden");
  $("btn-scan").classList.remove("hidden");
  $("btn-manual").classList.remove("hidden");
  $("btn-photo").classList.remove("hidden");
}

// ============================================================
// ISBN LOOKUP
// ============================================================
async function handleIsbn(isbn) {
  showStatus($("status"), `Looking up ISBN ${isbn}…`);
  try {
    let data = await lookupOpenLibrary(isbn);
    if (!data) data = await lookupGoogleBooks(isbn);

    if (data) {
      hide($("status"));
      populateForm({
        title: data.title || "",
        author: data.author || "",
        language: normalizeLanguage(data.language || ""),
        genre: "",
        reading_level: "",
        sub_genre: "",
      });
      showScreen("review");
    } else {
      showStatus(
        $("status"),
        "No metadata found for this ISBN. You can take a photo instead.",
      );
      $("btn-photo").classList.remove("hidden");
    }
  } catch (e) {
    setError($("error"), "Lookup failed: " + e.message);
  }
}

async function lookupOpenLibrary(isbn) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const key = `ISBN:${isbn}`;
  if (!json[key]) return null;
  const book = json[key];
  return {
    title: book.title || "",
    author: (book.authors && book.authors.map((a) => a.name).join(", ")) || "",
    language: "", // Open Library /api/books rarely includes language
  };
}

async function lookupGoogleBooks(isbn) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.items || json.items.length === 0) return null;
  const v = json.items[0].volumeInfo || {};
  return {
    title: v.title || "",
    author: (v.authors && v.authors.join(", ")) || "",
    language: v.language || "",
  };
}

function normalizeLanguage(code) {
  const c = (code || "").toLowerCase();
  if (c === "en" || c.startsWith("eng")) return "English";
  if (c === "hi" || c.startsWith("hin")) return "Hindi";
  if (c === "mr" || c.startsWith("mar")) return "Marathi";
  return "";
}

// ============================================================
// PHOTO FALLBACK
// ============================================================
$("btn-photo").addEventListener("click", startPhoto);
$("btn-capture").addEventListener("click", capturePhoto);
$("btn-retake").addEventListener("click", retakePhoto);
$("btn-use-photo").addEventListener("click", useCapturedPhoto);
$("btn-cancel-photo").addEventListener("click", cancelPhoto);

async function startPhoto() {
  hide($("error"));
  hide($("status"));
  $("photo-wrap").classList.remove("hidden");
  $("btn-scan").classList.add("hidden");
  $("btn-manual").classList.add("hidden");
  $("btn-photo").classList.add("hidden");

  try {
    photoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
    });
    $("photo-video").srcObject = photoStream;
    await $("photo-video").play();
  } catch (e) {
    setError($("error"), "Could not access camera: " + e.message);
    cancelPhoto();
  }
}

function capturePhoto() {
  const video = $("photo-video");
  const canvas = $("photo-canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);

  // Downscale large photos before sending to Gemini
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  if (scale < 1) {
    const tmp = document.createElement("canvas");
    tmp.width = Math.round(canvas.width * scale);
    tmp.height = Math.round(canvas.height * scale);
    tmp.getContext("2d").drawImage(canvas, 0, 0, tmp.width, tmp.height);
    capturedImageBase64 = tmp.toDataURL("image/jpeg", 0.85).split(",")[1];
    $("photo-img").src = tmp.toDataURL("image/jpeg", 0.85);
  } else {
    capturedImageBase64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    $("photo-img").src = canvas.toDataURL("image/jpeg", 0.85);
  }

  // Stop preview, show captured image
  stopPhotoStream();
  $("photo-video").classList.add("hidden");
  $("photo-preview").classList.remove("hidden");
  $("btn-capture").classList.add("hidden");
  $("btn-retake").classList.remove("hidden");
  $("btn-use-photo").classList.remove("hidden");
}

function retakePhoto() {
  capturedImageBase64 = null;
  $("photo-preview").classList.add("hidden");
  $("photo-video").classList.remove("hidden");
  $("btn-retake").classList.add("hidden");
  $("btn-use-photo").classList.add("hidden");
  $("btn-capture").classList.remove("hidden");
  startPhoto();
}

async function useCapturedPhoto() {
  if (!capturedImageBase64) return;
  showStatus($("status"), "Analyzing cover with Gemini…");
  $("btn-use-photo").disabled = true;
  $("btn-retake").disabled = true;

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      // text/plain avoids a CORS preflight against Apps Script
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "geminiVision",
        imageBase64: capturedImageBase64,
      }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Gemini failed");

    const data = json.data || {};
    populateForm({
      title: data.title || "",
      author: data.author || "",
      language: normalizeAllowed(data.language, [
        "Marathi",
        "English",
        "Hindi",
      ]),
      genre: normalizeAllowed(data.genre, [
        "Story / Fiction",
        "Informative / Self-Help",
        "Competitive Exam",
        "Biography",
        "Finance / Business",
        "Reference / Grammar",
        "Other",
      ]),
      reading_level: normalizeAllowed(data.reading_level, [
        "Beginner",
        "Intermediate",
        "Expert",
      ]),
      sub_genre: data.sub_genre || "",
    });
    cancelPhoto();
    showScreen("review");
  } catch (e) {
    setError($("error"), "Gemini error: " + e.message);
  } finally {
    $("btn-use-photo").disabled = false;
    $("btn-retake").disabled = false;
    hide($("status"));
  }
}

function normalizeAllowed(value, allowed) {
  if (!value) return "";
  const v = String(value).trim();
  const exact = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  return exact || "";
}

function stopPhotoStream() {
  if (photoStream) {
    photoStream.getTracks().forEach((t) => t.stop());
    photoStream = null;
  }
}

function cancelPhoto() {
  stopPhotoStream();
  capturedImageBase64 = null;
  $("photo-wrap").classList.add("hidden");
  $("photo-preview").classList.add("hidden");
  $("photo-video").classList.remove("hidden");
  $("btn-capture").classList.remove("hidden");
  $("btn-retake").classList.add("hidden");
  $("btn-use-photo").classList.add("hidden");
  $("btn-scan").classList.remove("hidden");
  $("btn-manual").classList.remove("hidden");
  $("btn-photo").classList.remove("hidden");
}

// ============================================================
// REVIEW FORM
// ============================================================
function populateForm(d) {
  $("f-title").value = d.title || "";
  $("f-author").value = d.author || "";
  $("f-language").value = d.language || "";
  $("f-genre").value = d.genre || "";
  $("f-level").value = d.reading_level || "";
  $("f-subgenre").value = d.sub_genre || "";
  $("f-location").value = "";
  $("f-status").value = "Available";
  $("f-notes").value = "";
}

$("btn-back").addEventListener("click", () => {
  hide($("review-status"));
  hide($("review-error"));
  showScreen("capture");
});

$("btn-save").addEventListener("click", saveRow);

async function saveRow() {
  hide($("review-error"));

  const row = {
    title: $("f-title").value.trim(),
    author: $("f-author").value.trim(),
    language: $("f-language").value,
    genre: $("f-genre").value,
    reading_level: $("f-level").value,
    sub_genre: $("f-subgenre").value.trim(),
    location: $("f-location").value.trim(),
    status: $("f-status").value.trim(),
    notes: $("f-notes").value.trim(),
  };

  if (!row.title) {
    setError($("review-error"), "Title is required.");
    return;
  }

  $("btn-save").disabled = true;
  showStatus($("review-status"), "Saving…");

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "saveRow", row }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Save failed");

    showStatus($("review-status"), "Saved! Ready for the next book.");
    setTimeout(() => {
      hide($("review-status"));
      showScreen("capture");
    }, 1200);
  } catch (e) {
    setError($("review-error"), "Save failed: " + e.message);
  } finally {
    $("btn-save").disabled = false;
  }
}
