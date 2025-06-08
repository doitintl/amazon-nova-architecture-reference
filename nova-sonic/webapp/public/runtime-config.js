// Runtime configuration for Nova Sonic webapp
window.runtimeConfig = {
  // AppSync Events API configuration
  APPSYNC_API_URL: 'https://df6kdc5jknhudehnk3dmgwz5ee.appsync-api.ap-southeast-1.amazonaws.com',
  APPSYNC_API_KEY: 'da2-uivdvjs5xjebhnphnvgpmmbqhy',
  
  // Flag to explicitly indicate we're using real data
  USE_MOCK_DATA: false,
  
  // STUN/TURN server configuration
  STUN_SERVER: 'stun:stun.l.google.com:19302',
  
  // API endpoint
  API_ENDPOINT: 'http://localhost:8000',
  
  // Logging level
  LOG_LEVEL: 'info'
};

console.log('Nova Sonic webapp configuration loaded:', window.runtimeConfig);
console.log('Using real AppSync Events API endpoint for subscriptions');