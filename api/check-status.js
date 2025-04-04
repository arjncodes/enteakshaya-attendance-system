const { getApi, SPREADSHEET_ID, ATTENDANCE_RANGE } = require('../utils/sheets');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const sheetsApi = await getApi();
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

    return res.status(200).json({
      success: true,
      employeeId,
      lastAction,
      nextAction,
      checkedIn,
      checkedOut
    });

  } catch (error) {
    console.error('Error checking status:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};