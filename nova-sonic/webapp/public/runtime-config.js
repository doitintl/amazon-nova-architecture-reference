// Runtime configuration for Nova Sonic webapp
window.runtimeConfig = {
  // Using mock data since AppSync is not deployed
  APPSYNC_API_URL: 'https://srtqkgzlqnamzmq5ud2qnp3efm.appsync-api.us-east-1.amazonaws.com/graphql',
  APPSYNC_API_KEY: 'da2-5d2vjvyusnaupaxrquvzt2gnxi',
  
  // STUN/TURN server configuration
  STUN_SERVER: 'stun:stun.l.google.com:19302',
  
  // API endpoint
  API_ENDPOINT: 'http://localhost:8000',
  
  // Logging level
  LOG_LEVEL: 'info'
};

console.log('Nova Sonic webapp configuration loaded:', window.runtimeConfig);