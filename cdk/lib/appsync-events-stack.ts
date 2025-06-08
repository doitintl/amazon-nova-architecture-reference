import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * Properties for the AppSync Events API Stack
 */
export interface AppSyncEventsStackProps extends cdk.StackProps {
  /**
   * The DynamoDB table for Nova Transcribe data
   */
  novaTable: dynamodb.ITable;
  
  /**
   * The DynamoDB table for Restaurant Booking data
   */
  bookingTable: dynamodb.ITable;
}

/**
 * Stack that creates an AppSync Events API with DynamoDB stream integration
 *
 * This stack creates an AppSync API configured as an EVENTS API using the EventApi L2 construct.
 * The EventApi construct is specifically designed for AppSync Events API and provides
 * websocket pubsub functionality.
 */
export class AppSyncEventsStack extends cdk.Stack {
  /**
   * The AppSync Events API
   */
  public readonly api: appsync.EventApi;
  
  /**
   * The AppSync API Key
   */
  public readonly apiKey: string;
  
  /**
   * The AppSync API URL for the Events API
   */
  public readonly apiUrl: string;
  
  /**
   * The AppSync API ID
   */
  public readonly apiId: string;

  constructor(scope: Construct, id: string, props: AppSyncEventsStackProps) {
    super(scope, id, props);

    // Create the AppSync Events API using the EventApi L2 construct
    // Configure API key authentication
    const apiKeyProvider = {
      authorizationType: appsync.AppSyncAuthorizationType.API_KEY,
      apiKey: {
        expires: cdk.Expiration.after(cdk.Duration.days(365)) // 1 year expiration
      }
    };

    // Create the Events API
    const api = new appsync.EventApi(this, 'NovaSonicEventsAPI', {
      apiName: 'NovaSonicEventsAPI',
      ownerContact: 'NovaSonicTeam',
      authorizationConfig: {
        authProviders: [
          apiKeyProvider,
        ],
        connectionAuthModeTypes: [
          appsync.AppSyncAuthorizationType.API_KEY,
        ],
        defaultPublishAuthModeTypes: [
          appsync.AppSyncAuthorizationType.API_KEY,
        ],
        defaultSubscribeAuthModeTypes: [
          appsync.AppSyncAuthorizationType.API_KEY,
        ],
      },
    });

    // Add channel namespace for publishing events
    api.addChannelNamespace('events');

    // Create DynamoDB data source for Nova table
    const novaDataSource = api.addDynamoDbDataSource(
      'NovaDataSource',
      props.novaTable,
      {
        description: 'DynamoDB data source for Nova Transcribe table',
      }
    );

    // Create DynamoDB data source for Booking table
    const bookingDataSource = api.addDynamoDbDataSource(
      'BookingDataSource',
      props.bookingTable,
      {
        description: 'DynamoDB data source for Restaurant Booking table',
      }
    );

    // Store API reference for output
    this.api = api;
    this.apiId = api.apiId;
    
    // Get the API key
    // The API key is created by the EventApi construct but we need to find it
    const apiKeys = api.node.findAll().filter(child =>
      child.node.id.includes('ApiKey') &&
      child.node.id.includes('Default')
    );
    
    // Get the first API key or use a default value
    const apiKey = apiKeys.length > 0 ?
      (apiKeys[0] as cdk.aws_appsync.CfnApiKey).attrApiKey :
      'da2-no-api-key-available';
    
    this.apiKey = apiKey;
    
    // Construct the API URL for Events API
    this.apiUrl = `https://${api.apiId}.appsync-api.${this.region}.amazonaws.com/event`;

    // Output the AppSync API URL and API Key
    new cdk.CfnOutput(this, 'EventsAPIURL', {
      value: this.apiUrl,
      description: 'The URL of the Events API',
      exportName: 'NovaSonicEventsAPIURL',
    });

    new cdk.CfnOutput(this, 'EventsAPIKey', {
      value: this.apiKey,
      description: 'The API Key for the Events API',
      exportName: 'NovaSonicEventsAPIKey',
    });

    new cdk.CfnOutput(this, 'EventsAPIId', {
      value: this.apiId,
      description: 'The ID of the Events API',
      exportName: 'NovaSonicEventsAPIId',
    });
  }
}