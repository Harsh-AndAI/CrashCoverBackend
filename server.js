const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");
const multer = require("multer");
const stream = require("stream");

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// const auth = new google.auth.GoogleAuth({
//   keyFile: "google-key.json",
//   scopes: [
//     "https://www.googleapis.com/auth/spreadsheets",
//     "https://www.googleapis.com/auth/drive"
//   ]
// });

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});

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

app.get("/", (req, res) => {
  res.send("Google Sheets API Running");
});

app.post(
  "/add-request",

  upload.fields([
    { name: "driverLicence", maxCount: 1 },
    { name: "vehicleRegistration", maxCount: 1 },
    { name: "insuranceClaim", maxCount: 1 },
    { name: "atFaultLicence", maxCount: 1 },
    { name: "repairQuote", maxCount: 1 },
    { name: "accidentPhotos", maxCount: 20 },
  ]),

  async (req, res) => {
    console.log("Request received");
  try {

    const data = req.body;
    const files = req.files || {};
    if (!data.requestId) {
  return res.status(400).json({
    success: false,
    message: "Request ID is required.",
  });
}

const requestFolderId = await createRequestFolder(data.requestId);
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

const registrationUrl =
  files.vehicleRegistration?.[0]
    ? await uploadFileToDrive(
        files.vehicleRegistration[0],
        requestFolderId,
        `Registration Document.${files.vehicleRegistration[0].originalname.split(".").pop()}`
      )
    : "";

const insuranceUrl =
  files.insuranceClaim?.[0]
    ? await uploadFileToDrive(
    files.insuranceClaim[0],
    requestFolderId,
    `Insurance Document.${files.insuranceClaim[0].originalname.split(".").pop()}`
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

const repairQuoteUrl =
  files.repairQuote?.[0]
    ? await uploadFileToDrive(
    files.repairQuote[0],
    requestFolderId,
    `Repair Quote.${files.repairQuote[0].originalname.split(".").pop()}`
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

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:ZZ`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          data.id || "",                 // Column A
          new Date().toLocaleString(),   // Column B
          data.requestId || "",          // Column C
          data.customer || "",           // Column D
          data.email || "",              // Column E
          data.phone || "",              // Column F
          data.vehicleMake || "",        // Column G
          data.vehicleModel || "",       // Column H
          data.registration || "",       // Column I
          data.accidentDate || "",       // Column J
          data.accidentLocation || "",   // Column K
          data.insuranceCompany || "",   // Column L
          data.claimNumber || "",        // Column M
          data.driverLicenceNumber || "",// Column N
          data.atFaultFullName || "",    // Column O
          data.atFaultLicence || "",     // Column P
          data.atFaultInsurance || "",   // Column Q
          data.atFaultAddress || "",     // Column R
          data.atFaultMobile || "",      // Column S
          data.atFaultEmail || "",       // Column T
          data.rideshare || "No",        // Column U
          data.repairShopName || "",     // Column V
          data.repairShopPhone || "",    // Column W
          data.repairShopAddress || "",  // Column X
          data.status || "pending",      // Column Y
          data.notes || "",              // Column Z
          data.updatedBy || "Customer",  // Column AA
          new Date().toLocaleString(),    // Column AB
          driverLicenceUrl,
          registrationUrl,
          insuranceUrl,
          atFaultLicenceUrl,
          repairQuoteUrl,
          accidentPhotoUrls.join("\n"),
          requestFolderUrl
        ]]
      }
    });

    res.json({
      success: true
    });

  } catch (err) {
  console.error("Upload Error:", err);

  res.status(500).json({
    success: false,
    message: err.message,
  });
}
}

);

const PORT = process.env.PORT || 5000;

// Update your app.listen setup to explicitly bind to '0.0.0.0'
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is actively running publicly on port ${PORT}`);
});