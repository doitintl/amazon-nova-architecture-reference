import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { AppSyncEventsStack } from '../lib/appsync-events-stack';
import { DynamoDbStack } from '../lib/dynamodb-stack';
import { LambdaStreamsStack } from '../lib/lambda-streams-stack';

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
  
  // Import Nova table with stream ARN
  const novaStreamArn = 'arn:aws:dynamodb:ap-southeast-1:654654616949:table/nova-sonic-dynamodb-NovaSonicConversations75DFDA90-8473PY8RVBH1/stream/2025-06-07T12:39:44.826';
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
  const bookingStreamArn = 'arn:aws:dynamodb:ap-southeast-1:654654616949:table/RestaurantBooking/stream/2025-06-07T12:40:07.906';
  bookingTable = dynamodb.Table.fromTableAttributes(
    importStack,
    'ImportedRestaurantBookingTable',
    {
      tableName: bookingTableName,
      tableStreamArn: bookingStreamArn
    }
  );
  console.log(`Restaurant Booking table '${bookingTableName}' imported successfully with stream ARN: ${bookingStreamArn}`);
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