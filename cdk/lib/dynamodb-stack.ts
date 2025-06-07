import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DynamoDbStack extends cdk.Stack {
  public readonly conversationTable: dynamodb.Table;
  public readonly novaTable: dynamodb.Table;
  public readonly bookingTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create DynamoDB table for conversation history
    this.conversationTable = new dynamodb.Table(this, 'NovaSonicConversations', {
      partitionKey: { name: 'username', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'conversation_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    
    // Create a GSI for querying by conversation_id and timestamp
    this.conversationTable.addGlobalSecondaryIndex({
      indexName: 'ConversationIdIndex',
      partitionKey: { name: 'conversation_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // Output the DynamoDB table name
    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: this.conversationTable.tableName,
      description: 'The name of the DynamoDB table',
      exportName: 'NovaSonicDynamoDBTableName',
    });

    // Create Nova table with stream enabled
    this.novaTable = new dynamodb.Table(this, 'NovaTranscribeTable', {
      tableName: 'NovaTranscribeTable',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_IMAGE, // Enable streams with NEW_IMAGE view type
    });

    // Output the Nova table name and stream ARN
    new cdk.CfnOutput(this, 'NovaTableName', {
      value: this.novaTable.tableName,
      description: 'The name of the Nova Transcribe table',
      exportName: 'NovaTranscribeTableName',
    });

    new cdk.CfnOutput(this, 'NovaTableStreamArn', {
      value: this.novaTable.tableStreamArn || '',
      description: 'The ARN of the Nova Transcribe table stream',
      exportName: 'NovaTranscribeTableStreamArn',
    });

    // Create Booking table with stream enabled
    this.bookingTable = new dynamodb.Table(this, 'RestaurantBooking', {
      tableName: 'RestaurantBooking',
      partitionKey: { name: 'bookingId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_IMAGE, // Enable streams with NEW_IMAGE view type
    });

    // Output the Booking table name and stream ARN
    new cdk.CfnOutput(this, 'BookingTableName', {
      value: this.bookingTable.tableName,
      description: 'The name of the Restaurant Booking table',
      exportName: 'RestaurantBookingTableName',
    });

    new cdk.CfnOutput(this, 'BookingTableStreamArn', {
      value: this.bookingTable.tableStreamArn || '',
      description: 'The ARN of the Restaurant Booking table stream',
      exportName: 'RestaurantBookingTableStreamArn',
    });
  }
}