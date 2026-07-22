const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");
const multer = require("multer");
const stream = require("stream");
function formatDate(date = new Date()) {
  return date.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

const auth = new google.auth.GoogleAuth({
  keyFile: "google-key.json",
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ]
});

// const auth = new google.auth.GoogleAuth({
//   credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
//   scopes: [
//     "https://www.googleapis.com/auth/spreadsheets",
//     "https://www.googleapis.com/auth/drive",
//   ],
// });

const sheets = google.sheets({
  version: "v4",
  auth
});
const drive = google.drive({
  version: "v3",
  auth,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB
  },
});
// till here
async function createRequestFolder(requestId) {
  const response = await drive.files.create({
    requestBody: {
      name: requestId,
      mimeType: "application/vnd.google-apps.folder",
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  return response.data.id;
}
async function uploadFileToDrive(file, folderId, fileName) {
  const bufferStream = new stream.PassThrough();
  bufferStream.end(file.buffer);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: file.mimetype,
      body: bufferStream,
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
try {
  await drive.permissions.create({
    fileId: response.data.id,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
    supportsAllDrives: true,
  });
} catch (permError) {
    console.warn("Permission propagation delay warning:", permError.message);
  }
  

  return response.data.webViewLink;
}
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "data";
const SHEET_GRID_ID = 0; // TEMP — you'll confirm/replace this in Change 2
const NEW_REQUEST_COLOR = { red: 244, green: 215, blue: 13 }; // bright yellow
const NEW_REQUEST_BORDER_COLOR = { red: 0, green: 0, blue: 0 }; // blue border

async function setDateColumnFormats() {
  function dateFormatRequest(startCol, endCol, type, pattern) {
    return {
      repeatCell: {
        range: {
          sheetId: SHEET_GRID_ID,
          startRowIndex: 1, // skip header row
          startColumnIndex: startCol,
          endColumnIndex: endCol
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type, pattern }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    };
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        dateFormatRequest(1, 2, "DATE_TIME", "dd-mm-yyyy mm:hh am/pm"),  // B: created_at
        dateFormatRequest(4, 5, "DATE", "dd-mm-yyyy"),                   // E: dateOfBirth
        dateFormatRequest(11, 12, "DATE", "dd-mm-yyyy"),                 // L: accidentDate
        dateFormatRequest(16, 17, "DATE", "dd-mm-yyyy"),                 // Q: at_fault_licence_expiry
        dateFormatRequest(24, 25, "TIME", "mm:hh am/pm"),                // Y: time_of_accident
        dateFormatRequest(28, 29, "DATE_TIME", "dd-mm-yyyy mm:hh am/pm") // AC: updated_at
      ]
    }
  });
}

app.get("/", (req, res) => {
  res.send("Google Sheets API Running");
});

app.get("/debug-sheet-id", async (req, res) => {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  res.json(meta.data.sheets.map(s => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId
  })));
});
app.get("/debug-fix-date-formats", async (req, res) => {
  try {
    await setDateColumnFormats();
    res.json({ success: true, message: "Date formats applied." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post(
  "/add-request",


  upload.fields([
    { name: "driverLicence", maxCount: 1 },
    { name: "atFaultLicence", maxCount: 1 },
    { name: "accidentPhotos", maxCount: 20 },
  ]),

  async (req, res) => {
    console.log("Request received");
  try {

    const data = req.body;
    const files = req.files || {};
    // Generate Request ID (CC-001, CC-002...)
const idColumn = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: `${SHEET_NAME}!C:C`,
});

const existingIds = (idColumn.data.values || [])
  .flat()
  .filter(v => /^CC-\d+$/.test(v));

let nextNumber = 1;

if (existingIds.length > 0) {
  const max = Math.max(
    ...existingIds.map(id => Number(id.replace("CC-", "")))
  );

  nextNumber = max + 1;
}

const requestId = `CC-${String(nextNumber).padStart(3, "0")}`;
  //   if (!data.requestId) {
  // return res.status(400).json({
  //   success: false,
  //   message: "Request ID is required.",
  // });
// }

const requestFolderId = await createRequestFolder(requestId);
const requestFolderUrl =
  `https://drive.google.com/drive/folders/${requestFolderId}`;

const driverLicenceUrl =
  files.driverLicence?.[0]
    ? await uploadFileToDrive(
        files.driverLicence[0],
        requestFolderId,
         `Driver Licence.${files.driverLicence[0].originalname.split(".").pop()}`
      )
    : "";


const atFaultLicenceUrl =
  files.atFaultLicence?.[0]
    ? await uploadFileToDrive(
    files.atFaultLicence[0],
    requestFolderId,
    `At Fault Licence.${files.atFaultLicence[0].originalname.split(".").pop()}`
)
    : "";

const accidentPhotoUrls =
  files.accidentPhotos?.length
    ? await Promise.all(
        files.accidentPhotos.map((file, index) =>
          uploadFileToDrive(
            file,
            requestFolderId,
            `Accident Photo ${index + 1}.${file.originalname.split(".").pop()}`
          )
        )
      )
    : [];

    // await sheets.spreadsheets.values.append({
    //   spreadsheetId: SHEET_ID,
    //   range: `${SHEET_NAME}!A:ZZ`,
    //   valueInputOption: "USER_ENTERED",
    //   requestBody: {
    //     values: [[
    //       data.id || "",                          // Column A: id
    //       new Date().toLocaleString(),            // Column B: created_at
    //       data.requestId || "",                   // Column C: request_id
    //       data.customer || "",                    // Column D: customer
    //       data.dateOfBirth || "",                 // Column E: date_of_birth
    //       data.address || "",                     // Column F: address
    //       data.email || "",                       // Column G: email
    //       data.phone || "",                       // Column H: mobile_number
    //       data.vehicleMake || "",                 // Column I: vehicle_make
    //       data.vehicleModel || "",                // Column J: vehicle_model
    //       data.registration || "",                // Column K: vehicle_registration
    //       data.accidentDate || "",                // Column L: accident_date
    //       data.accidentLocation || "",            // Column M: accident_location
    //       data.driverLicenceNumber || "",         // Column N: driver_licence_number
    //       data.atFaultFullName || "",             // Column O: at_fault_full_name
    //       data.atFaultLicenceNumber || "",        // Column P: at_fault_licence_number
    //       data.atFaultLicenceExpiry || "",        // Column Q: at_fault_licence_expiry
    //       data.atFaultInsurance || "",            // Column R: at_fault_insurance
    //       data.atFaultClaimNumber || "",          // Column S: at_fault_claim_number
    //       data.atFaultAddress || "",              // Column T: at_fault_address
    //       data.atFaultMobile || "",               // Column U: at_fault_mobile
    //       data.atFaultEmail || "",                // Column V: at_fault_email
    //       data.ctvRegistration || "No",           // Column W: ctv_registration
    //       data.repairerDetails || "",             // Column X: repairer_details
    //       data.timeOfAccident || "",              // Column Y: time_of_accident
    //       data.accidentDescription || "",         // Column Z: accident_description
    //       data.status || "pending",               // Column AA: status
    //       data.updatedBy || "Customer",           // Column AB: updated_by
    //       new Date().toLocaleString(),            // Column AC: updated_at
    //       driverLicenceUrl,                       // Column AD: driver_licence_url
    //       atFaultLicenceUrl,                      // Column AE: at_fault_licence_url
    //       accidentPhotoUrls.join("\n"),           // Column AF: accident_photos_urls
    //       requestFolderUrl                        // Column AG: request_folder_url
    //     ]]
    //   }
    // });
// Replace the old sheets.spreadsheets.values.append block with this precise grid range setup:
// ---- Find the next truly empty row (using column C, which is always filled) ----
const existingRows = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: `${SHEET_NAME}!B:AG`,
});

const values = existingRows.data.values || [];

let nextRow = 2; // row 1 is header

for (let i = 1; i < values.length; i++) {
  const row = values[i];

  const isEmpty = !row || row.every(cell => cell === "");

  if (isEmpty) {
    nextRow = i + 1;
    break;
  }

  nextRow = i + 2;
}
const targetRange = `${SHEET_NAME}!A${nextRow}:AG${nextRow}`;

const appendResult = await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: targetRange,
  valueInputOption: "USER_ENTERED",
  requestBody: {
    values: [[
      "Pending",          // Column A
      formatDate(),           // Column B: created_at
      // data.requestId || "",                   // Column C: request_id
      requestId,
      data.customer || "",                    // Column D: customer
      data.dateOfBirth || "",                 // Column E: date_of_birth
      data.address || "",                     // Column F: address
      data.email || "",                       // Column G: email
      data.phone || "",                       // Column H: mobile_number
      data.vehicleMake || "",                 // Column I: vehicle_make
      data.vehicleModel || "",                // Column J: vehicle_model
      data.registration || "",                // Column K: vehicle_registration
      data.accidentDate || "",                // Column L: accident_date
      data.accidentLocation || "",            // Column M: accident_location
      data.driverLicenceNumber || "",         // Column N: driver_licence_number
      data.atFaultFullName || "",             // Column O: at_fault_full_name
      data.atFaultLicenceNumber || "",        // Column P: at_fault_licence_number
      data.atFaultLicenceExpiry || "",        // Column Q: at_fault_licence_expiry
      data.atFaultInsurance || "",            // Column R: at_fault_insurance
      data.atFaultClaimNumber || "",          // Column S: at_fault_claim_number
      data.atFaultAddress || "",              // Column T: at_fault_address
      data.atFaultMobile || "",               // Column U: at_fault_mobile
      data.atFaultEmail || "",                // Column V: at_fault_email
      data.ctvRegistration || "No",           // Column W: ctv_registration
      data.repairerDetails || "",             // Column X: repairer_details
      data.timeOfAccident || "",              // Column Y: time_of_accident
      data.accidentDescription || "",         // Column Z: accident_description
      data.updatedBy || "Customer",           // Column AB: updated_by
      formatDate(),              // Column AB: updated_at
      driverLicenceUrl || "",                 // Column AD: driver_licence_url
      atFaultLicenceUrl || "",                // Column AE: at_fault_licence_url
      accidentPhotoUrls.join("\n") || "",     // Column AF: accident_photos_urls
      requestFolderUrl || ""                  // Column AG: request_folder_url
    ]]
  }
});

// ---- Color the newly added row ----
const rowNumber = nextRow;

const rowRange = {
  sheetId: SHEET_GRID_ID,
  startRowIndex: rowNumber - 1,
  endRowIndex: rowNumber,
  startColumnIndex: 0,
  endColumnIndex: 32
};

function dateFormatRequestForRow(rowNumber, startCol, endCol, type, pattern) {
  return {
    repeatCell: {
      range: {
        sheetId: SHEET_GRID_ID,
        startRowIndex: rowNumber - 1,
        endRowIndex: rowNumber,
        startColumnIndex: startCol,
        endColumnIndex: endCol
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type, pattern }
        }
      },
      fields: "userEnteredFormat.numberFormat"
    }
  };
}

await sheets.spreadsheets.batchUpdate({
  spreadsheetId: SHEET_ID,
  requestBody: {
    requests: [
      {
        repeatCell: {
          range: rowRange,
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 1, green: 1, blue: 0.8 },
              textFormat: { bold: true }
            }
          },
          fields: "userEnteredFormat"
        }
      },
      dateFormatRequestForRow(rowNumber, 1, 2, "DATE", "dd-mm-yyyy"),  // B created_at
      dateFormatRequestForRow(rowNumber, 4, 5, "DATE", "dd-mm-yyyy"),                   // E dateOfBirth
      dateFormatRequestForRow(rowNumber, 11, 12, "DATE", "dd-mm-yyyy"),                 // L accidentDate
      dateFormatRequestForRow(rowNumber, 16, 17, "DATE", "dd-mm-yyyy"),                 // Q at_fault_licence_expiry
      dateFormatRequestForRow(rowNumber, 24, 25, "TIME", "hh:mm am/pm"),                // Y time_of_accident
      dateFormatRequestForRow(rowNumber, 28, 29, "DATE", "dd-mm-yyyy"), // AC updated_at
    ]
  }
});
console.log("Formatting applied successfully");
// ------------------------------------

    res.json({
      success: true
    });

  } catch (err) {
  console.error("Upload Error:", err);
  console.error("========== ERROR ==========");
console.error(err);
console.error(err.stack);
console.error("===========================");

res.status(500).json({
  success: false,
  message: err.message,
  stack: err.stack
});
}
}

);
// console.log(req.body);
const PORT = process.env.PORT || 5000;

// Update your app.listen setup to explicitly bind to '0.0.0.0'
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is actively running publicly on port ${PORT}`);
});