const { google } = require('googleapis');
const fs = require('fs');

// Sheet IDs and ranges
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const EMPLOYEES_RANGE = 'employees!A2:E';
const ATTENDANCE_RANGE = 'attendance!A2:G';

let sheetsAuth;
let sheetsApi;

async function setupGoogleSheets() {
  try {
    // Load credentials
    const credentials = JSON.parse(
      process.env.GOOGLE_CREDENTIALS || fs.readFileSync('credentials.json', 'utf8')
    );
    
    const { client_email, private_key } = credentials;
    
    // Create JWT client
    sheetsAuth = new google.auth.JWT(
      client_email,
      null,
      private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    
    // Create sheets API client
    sheetsApi = google.sheets({ version: 'v4', auth: sheetsAuth });
    
    console.log('Google Sheets API initialized successfully');
    return sheetsApi;
  } catch (error) {
    console.error('Error setting up Google Sheets:', error);
    throw error;
  }
}

// Helper function to get employee details
async function getEmployeeDetails(employeeId) {
  if (!sheetsApi) {
    await setupGoogleSheets();
  }

  try {
    const response = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: EMPLOYEES_RANGE
    });
    
    const rows = response.data.values || [];
    
    for (const row of rows) {
      if (row[0] === employeeId) {
        return {
          id: row[0],
          name: row[1],
          department: row[2],
          email: row[3]
        };
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('Error fetching employee details:', error);
    throw error;
  }
}

module.exports = {
  setupGoogleSheets,
  getEmployeeDetails,
  getApi: () => sheetsApi || setupGoogleSheets(),
  SPREADSHEET_ID,
  EMPLOYEES_RANGE,
  ATTENDANCE_RANGE
};