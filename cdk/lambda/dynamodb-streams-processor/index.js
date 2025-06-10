const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { Amplify } = require('aws-amplify');
const { events } = require('aws-amplify/data');

// AppSync API details from environment variables
const APPSYNC_API_URL = process.env.APPSYNC_API_URL;
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY;

// Extract region from API URL
const getRegion = (apiUrl) => {
  const match = apiUrl?.match(/appsync-api\.([^.]+)\.amazonaws\.com/);
  return match ? match[1] : 'ap-southeast-1'; // Default to ap-southeast-1 if not found
};

const amplifyConfig = {
  "API": {
    "Events": {
      "endpoint": `${APPSYNC_API_URL}/event`,
      "region": getRegion(APPSYNC_API_URL),
      "defaultAuthMode": "apiKey",
      "apiKey": APPSYNC_API_KEY
    }
  }
};

console.log('Amplify configuration:', JSON.stringify(amplifyConfig, null, 2));

// Configure Amplify with AppSync Events API details
Amplify.configure(amplifyConfig);

/**
 * Publishes an event to AppSync Events API using Amplify
 * @param {string} channelName - The channel name to publish to
 * @param {object} eventData - The data to publish
 * @returns {Promise<object>} - The response from AppSync
 */
async function publishToAppSyncEvents(channelName, eventData) {
  if (!APPSYNC_API_URL || !APPSYNC_API_KEY) {
    console.error('AppSync API URL or API Key not provided');
    throw new Error('AppSync API URL or API Key not provided');
  }

  console.log(`Publishing to channel: ${channelName}`);
  console.log('Event data:', JSON.stringify(eventData, null, 2));

  try {
    // Use Amplify events.post to publish to AppSync Events API
    const path = `events/${channelName}`;
    console.log(`Publishing to AppSync Events API path: ${path}`);
    
    const result = await events.post(path, eventData);
    console.log('Successfully published event to AppSync:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error publishing to AppSync:', error);
    throw error;
  }
}

/**
 * Processes DynamoDB stream events and publishes them to AppSync Events API
 * @param {object} event - The DynamoDB stream event
 * @returns {object} - The response status
 */
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  const promises = [];
  
  // Process each record in the stream
  for (const record of event.Records) {
    // Only process INSERT and MODIFY events
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') {
      console.log('Skipping event:', record.eventName);
      continue;
    }
    
    // Get the table name from the event source ARN
    const tableName = record.eventSourceARN.split('/')[1];
    console.log('Processing record from table:', tableName);
    
    // Get the new image (the current state of the item)
    const newImage = record.dynamodb.NewImage;
    if (!newImage) {
      console.log('No new image found in record');
      continue;
    }
    
    // Convert DynamoDB JSON to regular JSON
    const item = unmarshall(newImage);
    console.log('Unmarshalled item:', JSON.stringify(item, null, 2));
    
    // Extract the base table name using regex
    // This handles cases where the table name has a unique identifier appended
    // Example: nova-sonic-dynamodb-NovaSonicConversations75DFDA90-8473PY8RVBH1
    // Look specifically for NovaSonicConversations or RestaurantBooking patterns
    const baseTableNameMatch = tableName.match(/(NovaSonicConversations|Conversations|RestaurantBooking|Booking)[0-9A-Z]*(?:-[0-9A-Z]+)?$/);
    const baseTableName = baseTableNameMatch ? baseTableNameMatch[1] : tableName;
    
    console.log(`Original table name: ${tableName}`);
    console.log(`Extracted base table name: ${baseTableName}`);
    
    // Determine event type and channel based on the base table name
    let channelName;
    let eventData;
    
    if (baseTableName.includes('RestaurantBooking') || baseTableName.includes('Booking')) {
      channelName = 'restaurant-booking';
      
      // Transform the item for the Restaurant Booking event
      eventData = {
        type: 'BOOKING',
        bookingId: item.booking_id || '',
        date: item.date || '',
        name: item.name || '',
        hour: item.hour || '',
        numGuests: item.num_guests ? parseInt(item.num_guests) : 0,
        status: item.status || 'pending',
        timestamp: item.timestamp || new Date().toISOString(),
        source: 'dynamodb-stream'
      };
      
    } else if (baseTableName.includes('NovaSonicConversations') || baseTableName.includes('Conversations')) {
      channelName = 'conversations';
      
      // Transform the item for the Conversations event
      eventData = {
        type: 'CONVERSATION',
        username: item.username || '',
        conversation_id: item.conversation_id || '',
        timestamp: item.timestamp || new Date().toISOString(),
        conversation: item.conversation || '', // Include the conversation content
        source: 'dynamodb-stream'
      };
      
    } else {
      console.log('Unknown table:', tableName);
      continue;
    }
    
    // Add the event name (INSERT or MODIFY) to the event data
    eventData.eventName = record.eventName;
    
    // Publish the event to AppSync Events API
    try {
      promises.push(publishToAppSyncEvents(channelName, eventData));
    } catch (error) {
      console.error(`Error publishing ${channelName} event:`, error);
    }
  }
  
  // Wait for all publish operations to complete
  try {
    await Promise.all(promises);
    console.log('Successfully processed all events');
    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error processing events:', error);
    return { statusCode: 500, body: `Error: ${error.message}` };
  }
};