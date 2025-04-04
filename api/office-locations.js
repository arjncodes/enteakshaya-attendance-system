module.exports = (req, res) => {
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
      // Load office locations from environment variable
      const officeLocations = JSON.parse(process.env.OFFICE_LOCATIONS || "[]");
      return res.status(200).json(officeLocations);
    } catch (error) {
      console.error('Error fetching office locations:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  };