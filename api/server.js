const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Load office locations from .env
const officeLocations = JSON.parse(process.env.OFFICE_LOCATIONS || "[]");

// API endpoint to fetch office locations
app.get('/api/office-locations', (req, res) => {
    res.json(officeLocations);
});

// Google Sheets API setup
let sheetsAuth;
let sheetsApi;

async function setupGoogleSheets() {
    try {
        // Load credentials
        const credentials = JSON.parse(fs.readFileSync('credentials.json'));
        
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
    } catch (error) {
        console.error('Error setting up Google Sheets:', error);
    }
}

// Sheet IDs and ranges
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const EMPLOYEES_RANGE = 'employees!A2:E';
const ATTENDANCE_RANGE = 'attendance!A2:G';

app.get('/api/check-status', async (req, res) => {
    try {
        const { employeeId } = req.query;
        
        if (!employeeId) {
            return res.status(400).json({ success: false, message: 'Employee ID is required' });
        }
        
        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];

        // Get attendance records
        const response = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: ATTENDANCE_RANGE
        });

        const rows = response.data.values || [];

        // Filter records for this employee and today's date
        const todayRecords = rows.filter(row => row[0] === employeeId && row[2].includes(today));

        let lastAction = null;
        let checkedIn = false;
        let checkedOut = false;

        if (todayRecords.length > 0) {
            const lastRow = todayRecords[todayRecords.length - 1]; // Get latest row for today

            checkedIn = true;
            if (lastRow[4] && lastRow[4].trim() !== '') {
                checkedOut = true;
                lastAction = 'checkout';
            } else {
                lastAction = 'checkin';
            }
        }

        const nextAction = lastAction === 'checkin' ? 'checkout' : 'checkin';

        res.json({
            success: true,
            employeeId,
            lastAction,
            nextAction,
            checkedIn,
            checkedOut
        });

    } catch (error) {
        console.error('Error checking status:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});



app.post('/api/record-attendance', async (req, res) => {
    try {
        const { employeeId, action, location, timestamp } = req.body;
        
        if (!employeeId || !action || !location || !timestamp) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        const employeeDetails = await getEmployeeDetails(employeeId);
        if (!employeeDetails) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        // Get attendance records
        const response = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: ATTENDANCE_RANGE
        });

        const rows = response.data.values || [];
        let lastAction = null;
        let lastRowIndex = -1;
        let lastCheckInTime = null;

        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i][0] === employeeId) {
                lastCheckInTime = new Date(`${rows[i][2]}T${rows[i][3]}`);
                lastAction = rows[i][4] === '' ? 'checkin' : 'checkout';
                lastRowIndex = i;
                break;
            }
        }

        const now = new Date(timestamp);
        const formattedDate = now.toISOString().split('T')[0];
        const formattedTime = now.toLocaleTimeString();

        // 🛑 Auto Check-out if last check-in exceeds 14 hours
        if (lastAction === 'checkin' && ((now - lastCheckInTime) / (1000 * 60 * 60)) >= 14) {
            const autoCheckOutTime = new Date(lastCheckInTime.getTime() + 14 * 60 * 60 * 1000);
            const autoCheckOutFormattedTime = autoCheckOutTime.toLocaleTimeString();
            const totalWorkHours = 14; // Maximum allowed work hours

            // 1️⃣ Update last row with auto check-out details
            await sheetsApi.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `attendance!E${lastRowIndex + 2}:G${lastRowIndex + 2}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[autoCheckOutFormattedTime, totalWorkHours, "Auto Check-out"]] }
            });

            // 2️⃣ Create a new check-in entry for today
            const newRow = [
                employeeId,
                employeeDetails.name,
                formattedDate,
                formattedTime,
                '', // Check-out empty
                '', // Work hours empty
                JSON.stringify(location)
            ];

            await sheetsApi.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: 'attendance!A:G',
                valueInputOption: 'USER_ENTERED',
                resource: { values: [newRow] }
            });

            return res.json({
                success: true,
                message: 'Auto check-out applied for exceeding 14 hours. New check-in recorded.',
                employee: employeeDetails,
                attendanceRecord: {
                    autoCheckOutTime,
                    newCheckInTime: timestamp
                }
            });
        }

        // 🔹 Normal check-in and check-out process
        if (action === 'checkin' && lastAction === 'checkin') {
            return res.status(400).json({ success: false, message: 'Already checked in. Please check out first.' });
        }

        if (action === 'checkout' && lastAction !== 'checkin') {
            return res.status(400).json({ success: false, message: 'Cannot check out without a check-in.' });
        }

        if (action === 'checkin') {
            // ✅ Normal Check-in Process
            const newRow = [
                employeeId,
                employeeDetails.name,
                formattedDate,
                formattedTime,
                '', // Check-out empty
                '', // Work hours empty
                JSON.stringify(location)
            ];

            await sheetsApi.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: 'attendance!A:G',
                valueInputOption: 'USER_ENTERED',
                resource: { values: [newRow] }
            });

            return res.json({
                success: true,
                message: 'Check-in recorded successfully',
                employee: employeeDetails,
                attendanceRecord: { checkInTime: timestamp }
            });

        } else if (action === 'checkout') {
            // ✅ Normal Check-out Process
            const checkInTime = new Date(`${rows[lastRowIndex][2]}T${rows[lastRowIndex][3]}`);
            const hoursWorked = ((now - checkInTime) / (1000 * 60 * 60)).toFixed(2);

            await sheetsApi.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `attendance!E${lastRowIndex + 2}:G${lastRowIndex + 2}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[formattedTime, hoursWorked, JSON.stringify(location)]] }
            });

            return res.json({
                success: true,
                message: 'Check-out recorded successfully',
                employee: employeeDetails,
                attendanceRecord: {
                    checkInTime,
                    checkOutTime: timestamp,
                    hoursWorked
                }
            });
        } else {
            return res.status(400).json({ success: false, message: 'Invalid action. Must be "checkin" or "checkout"' });
        }

    } catch (error) {
        console.error('Error recording attendance:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// Helper function to get employee details
async function getEmployeeDetails(employeeId) {
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
   
// Error handler for JSON parsing errors
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ success: false, message: 'Invalid JSON in request body' });
    }
    next(err);
});

// ✅ Export the app for Vercel (No app.listen)
module.exports = app;

