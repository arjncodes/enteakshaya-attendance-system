const { getApi, getEmployeeDetails, SPREADSHEET_ID, ATTENDANCE_RANGE } = require('../utils/sheets');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const sheetsApi = await getApi();
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

      return res.status(200).json({
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

      return res.status(200).json({
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

      return res.status(200).json({
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
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};