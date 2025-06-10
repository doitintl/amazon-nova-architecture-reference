import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { AppSyncEventsStack } from '../lib/appsync-events-stack';
import { DynamoDbStack } from '../lib/dynamodb-stack';
import { LambdaStreamsStack } from '../lib/lambda-streams-stack';
import { DynamoDB, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

const app = new cdk.App();

// Define environment
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1'
};

// Get table names from context or use defaults
const novaTableName = app.node.tryGetContext('novaTableName') || 'NovaTranscribeTable';
const bookingTableName = app.node.tryGetContext('bookingTableName') || 'RestaurantBooking';

console.log(`Using Nova table name: ${novaTableName}`);
console.log(`Using Booking table name: ${bookingTableName}`);

// Check if we should create new DynamoDB tables or use existing ones
const createNewTables = app.node.tryGetContext('createNewTables') === 'true' || false;

// Main function to handle both synchronous and asynchronous flows
async function main() {
  let novaTable: dynamodb.ITable;
  let bookingTable: dynamodb.ITable;
  let dynamoDbStack: DynamoDbStack | undefined;

  if (createNewTables) {
    // Create new DynamoDB tables
    console.log('Creating new DynamoDB tables');
    dynamoDbStack = new DynamoDbStack(app, 'NovaSonicDynamoDbStack', {
      stackName: 'nova-sonic-dynamodb',
      env
    });
    novaTable = dynamoDbStack.novaTable;
    bookingTable = dynamoDbStack.bookingTable;
  } else {
    // Create a reference stack for importing existing resources
    const importStack = new cdk.Stack(app, 'NovaSonicImportStack', {
      stackName: 'nova-sonic-import',
      env
    });
    
    // Import existing DynamoDB tables
    console.log('Importing existing DynamoDB tables');
    
    // Initialize DynamoDB client (AWS SDK v3)
    const dynamoClient = new DynamoDB({
      region: env.region
    });
    
    try {
      // Get Nova table stream ARN
      let novaStreamArn: string;
      let bookingStreamArn: string;
      
      try {
        // Try to get stream ARNs dynamically
        novaStreamArn = await getTableStreamArn(dynamoClient, novaTableName);
        bookingStreamArn = await getTableStreamArn(dynamoClient, bookingTableName);
      } catch (sdkError: any) {
        console.warn('Failed to get stream ARNs dynamically. Using fallback hardcoded ARNs:', sdkError.message);
        
        // Fallback to hardcoded ARNs for local development
        // In a real environment, these would be retrieved dynamically
        novaStreamArn = `arn:aws:dynamodb:${env.region}:${env.account}:table/${novaTableName}/stream/2025-06-07T12:39:44.826`;
        bookingStreamArn = `arn:aws:dynamodb:${env.region}:${env.account}:table/${bookingTableName}/stream/2025-06-07T12:40:07.906`;
        
        console.log('Using fallback stream ARNs:');
        console.log(`Nova table stream ARN: ${novaStreamArn}`);
        console.log(`Booking table stream ARN: ${bookingStreamArn}`);
      }
      
      // Import Nova table with stream ARN
      novaTable = dynamodb.Table.fromTableAttributes(
        importStack,
        'ImportedNovaTranscribeTable',
        {
          tableName: novaTableName,
          tableStreamArn: novaStreamArn
        }
      );
      console.log(`Nova Transcribe table '${novaTableName}' imported successfully with stream ARN: ${novaStreamArn}`);
      
      // Import Booking table with stream ARN
      bookingTable = dynamodb.Table.fromTableAttributes(
        importStack,
        'ImportedRestaurantBookingTable',
        {
          tableName: bookingTableName,
          tableStreamArn: bookingStreamArn
        }
      );
      console.log(`Restaurant Booking table '${bookingTableName}' imported successfully with stream ARN: ${bookingStreamArn}`);
    } catch (error) {
      console.error('Error importing tables:', error);
      process.exit(1);
    }
  }

  // Create the AppSync Events API stack
  const appSyncEventsStack = new AppSyncEventsStack(app, 'NovaSonicAppSyncEventsStack', {
    stackName: 'nova-sonic-appsync-events',
    env,
    novaTable,
    bookingTable,
  });
  
  // Create the Lambda Streams stack to process DynamoDB streams
  const lambdaStreamsStack = new LambdaStreamsStack(app, 'NovaSonicLambdaStreamsStack', {
    stackName: 'nova-sonic-lambda-streams',
    env,
    novaTable,
    bookingTable,
    appSyncApiUrl: appSyncEventsStack.apiUrl,
    appSyncApiKey: appSyncEventsStack.apiKey,
  });
  
  // Add dependencies
  if (dynamoDbStack) {
    appSyncEventsStack.addDependency(dynamoDbStack);
    lambdaStreamsStack.addDependency(dynamoDbStack);
  }
  lambdaStreamsStack.addDependency(appSyncEventsStack);
  
  // Synthesize the app
  app.synth();
}

// Function to get stream ARN for a table
async function getTableStreamArn(dynamoClient: DynamoDB, tableName: string): Promise<string> {
  try {
    const command = new DescribeTableCommand({ TableName: tableName });
    const tableInfo = await dynamoClient.send(command);
    
    if (!tableInfo.Table?.LatestStreamArn) {
      throw new Error(`No stream ARN found for table ${tableName}. Make sure streams are enabled.`);
    }
    
    return tableInfo.Table.LatestStreamArn;
  } catch (error) {
    console.error(`Error getting stream ARN for table ${tableName}:`, error);
    throw error;
  }
}

// Run the main function
main().catch(error => {
  console.error('Error during deployment:', error);
  process.exit(1);
});