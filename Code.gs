/**
 * Book Cataloguing — Google Apps Script backend
 *
 * Required Script Properties (Project Settings → Script properties):
 *   GEMINI_API_KEY   Your Google AI Studio API key
 *   SHEET_ID
 *   SHEET_NAME
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 */

const COLUMNS = [
  "#",
  "Title",
  "Author",
  "Language",
  "Genre",
  "Reading Level",
  "Sub-Genre / Topic",
  "Location / Shelf",
  "Status",
  "Notes",
];

function doGet(e) {
  // Intentionally distinct from doPost responses so we can detect when a POST
  // was accidentally downgraded to GET (e.g. body stripped on 302 redirect).
  return jsonResponse({
    ok: false,
    via: "doGet",
    error:
      "This endpoint requires POST. If you are seeing this from the app, the request was downgraded to GET — usually a redirect/CORS issue.",
  });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === "saveRow") return jsonResponse(saveRow(body.row));
    if (action === "geminiVision")
      return jsonResponse(geminiVision(body.imageBase64));

    return jsonResponse({ ok: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: String((err && err.message) || err),
    });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

// ============================================================
// SHEET
// ============================================================
function saveRow(row) {
  if (!row || !row.title) return { ok: false, error: "Missing title" };

  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty("SHEET_ID");
  const sheetName = props.getProperty("SHEET_NAME") || "Books";
  if (!sheetId) return { ok: false, error: "SHEET_ID script property not set" };

  const ss = SpreadsheetApp.openById(sheetId);
  Logger.log("Opened spreadsheet: " + ss.getName() + " (" + ss.getUrl() + ")");
  Logger.log(
    "Existing tabs: " +
      ss
        .getSheets()
        .map(function (s) {
          return s.getName();
        })
        .join(" | "),
  );

  let sheet = ss.getSheetByName(sheetName);
  let createdNewTab = false;
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet
      .getRange(1, 1, 1, COLUMNS.length)
      .setValues([COLUMNS])
      .setFontWeight("bold");
    createdNewTab = true;
  }
  Logger.log(
    "Using tab: '" + sheet.getName() + "' (created new? " + createdNewTab + ")",
  );
  // Ensure header row exists
  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(1, 1, 1, COLUMNS.length)
      .setValues([COLUMNS])
      .setFontWeight("bold");
  }

  // Anchor on column A (#). Scan the whole column, find the last row whose
  // column A holds a numeric value, then write directly to the next row.
  // This deliberately ignores stray content elsewhere in the sheet that
  // would otherwise push sheet.appendRow() to the very bottom.
  const maxRows = sheet.getMaxRows();
  let lastDataRow = 1; // row 1 is the header
  let maxSerial = 0;
  if (maxRows >= 2) {
    const colA = sheet.getRange(2, 1, maxRows - 1, 1).getValues();
    for (let i = 0; i < colA.length; i++) {
      const v = colA[i][0];
      if (v === "" || v === null) continue;
      const n = Number(v);
      if (Number.isFinite(n)) {
        if (n > maxSerial) maxSerial = n;
        if (i + 2 > lastDataRow) lastDataRow = i + 2; // i is 0-based; +2 because col A starts at row 2
      }
    }
  }
  const nextSerial = maxSerial + 1;
  const targetRow = lastDataRow + 1;

  // Grow the sheet if needed so setValues doesn't fail.
  if (targetRow > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), targetRow - sheet.getMaxRows());
  }

  sheet
    .getRange(targetRow, 1, 1, COLUMNS.length)
    .setValues([
      [
        nextSerial,
        row.title || "",
        row.author || "",
        row.language || "",
        row.genre || "",
        row.reading_level || "",
        row.sub_genre || "",
        row.location || "",
        row.status || "",
        row.notes || "",
      ],
    ]);
  SpreadsheetApp.flush();

  const writtenRow = targetRow;
  Logger.log(
    "Wrote row " +
      writtenRow +
      " with serial " +
      nextSerial +
      " (title: " +
      (row.title || "") +
      ")",
  );

  return {
    ok: true,
    serial: nextSerial,
    writtenRow: writtenRow,
    spreadsheetUrl: ss.getUrl(),
    spreadsheetName: ss.getName(),
    tabName: sheet.getName(),
    createdNewTab: createdNewTab,
  };
}

// ============================================================
// GEMINI VISION
// ============================================================
function geminiVision(imageBase64) {
  if (!imageBase64) return { ok: false, error: "Missing imageBase64" };

  const apiKey =
    PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey)
    return { ok: false, error: "GEMINI_API_KEY script property not set" };

  const prompt = [
    "You are cataloguing a book for a library in India.",
    "Look at the cover image and return ONLY a JSON object — no prose, no markdown fences.",
    "Schema:",
    '{ "title": "", "author": "", "language": "", "genre": "", "reading_level": "", "sub_genre": "" }',
    "",
    'language MUST be one of: "Marathi", "English", "Hindi".',
    'genre MUST be one of: "Story / Fiction", "Informative / Self-Help", "Competitive Exam", "Biography", "Finance / Business", "Reference / Grammar", "Other".',
    'reading_level MUST be one of: "Beginner", "Intermediate", "Expert".',
    'sub_genre is a short free-text topic (e.g. "Indian History", "UPSC Prelims", "Mystery").',
    "If you cannot read a field, use an empty string.",
  ].join("\n");

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/jpeg", data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) {
    return { ok: false, error: `Gemini HTTP ${code}: ${text.slice(0, 300)}` };
  }

  const json = JSON.parse(text);
  const candidateText =
    json.candidates &&
    json.candidates[0] &&
    json.candidates[0].content &&
    json.candidates[0].content.parts &&
    json.candidates[0].content.parts[0] &&
    json.candidates[0].content.parts[0].text;

  if (!candidateText) return { ok: false, error: "Empty response from Gemini" };

  let data;
  try {
    data = JSON.parse(candidateText);
  } catch (e) {
    // Strip any accidental ```json fences
    const stripped = candidateText.replace(/```json\s*|\s*```/g, "").trim();
    data = JSON.parse(stripped);
  }

  return { ok: true, data: data };
}
