import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { AppSyncStack } from '../lib/appsync-stack';

const app = new cdk.App();

// Create a simple DynamoDB table for Nova Transcribe data
const dynamoDbStack = new cdk.Stack(app, 'NovaSonicDynamoDbStack', {
  stackName: 'nova-sonic-dynamodb',
});

const novaTranscribeTable = new dynamodb.Table(dynamoDbStack, 'NovaTranscribeTable', {
  partitionKey: { name: 'conversation_id', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
});

// Create the AppSync stack
const appSyncStack = new AppSyncStack(app, 'NovaSonicAppSyncStack', {
  stackName: 'nova-sonic-appsync',
  novaTranscribeTable: novaTranscribeTable,
});

app.synth();