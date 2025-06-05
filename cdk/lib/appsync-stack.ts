import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { Construct } from 'constructs';

export interface AppSyncStackProps extends cdk.StackProps {
  /**
   * The DynamoDB table for Nova Transcribe data
   */
  novaTranscribeTable: dynamodb.Table;
  
  /**
   * Optional RestaurantBooking table
   */
  restaurantBookingTable?: dynamodb.ITable;
}

export class AppSyncStack extends cdk.Stack {
  /**
   * The AppSync GraphQL API
   */
  public readonly api: appsync.GraphqlApi;
  
  /**
   * The AppSync API Key
   */
  public readonly apiKey: string;
  
  /**
   * The AppSync API URL
   */
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: AppSyncStackProps) {
    super(scope, id, props);

    // Create the AppSync API
    this.api = new appsync.GraphqlApi(this, 'NovaSonicAPI', {
      name: 'NovaSonicAPI',
      schema: appsync.SchemaFile.fromAsset(path.join(__dirname, '../graphql/schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365)),
          },
        },
      },
      xrayEnabled: true,
    });

    // Create DynamoDB data sources
    const novaTranscribeDataSource = this.api.addDynamoDbDataSource(
      'NovaTranscribeDataSource',
      props.novaTranscribeTable
    );

    // Create resolvers for Nova Transcribe table
    this.createNovaTranscribeResolvers(novaTranscribeDataSource);

    // Add RestaurantBooking data source and resolvers if table is provided
    if (props.restaurantBookingTable) {
      try {
        const restaurantBookingDataSource = this.api.addDynamoDbDataSource(
          'RestaurantBookingDataSource',
          props.restaurantBookingTable
        );
        this.createRestaurantBookingResolvers(restaurantBookingDataSource);
        
        // Log success message
        new cdk.CfnOutput(this, 'RestaurantBookingTableIntegration', {
          value: 'Successfully integrated RestaurantBooking table with AppSync',
          description: 'Status of RestaurantBooking table integration',
        });
      } catch (error) {
        // Log error message if integration fails
        console.log(`Failed to integrate RestaurantBooking table: ${error}`);
        new cdk.CfnOutput(this, 'RestaurantBookingTableIntegration', {
          value: 'Failed to integrate RestaurantBooking table with AppSync',
          description: 'Status of RestaurantBooking table integration',
        });
      }
    } else {
      // Log message if table is not provided
      console.log('RestaurantBooking table not provided, skipping integration');
      new cdk.CfnOutput(this, 'RestaurantBookingTableIntegration', {
        value: 'RestaurantBooking table not provided, integration skipped',
        description: 'Status of RestaurantBooking table integration',
      });
    }

    // Store API key and URL for output
    this.apiKey = this.api.apiKey || '';
    this.apiUrl = this.api.graphqlUrl;

    // Output the AppSync API URL and API Key
    new cdk.CfnOutput(this, 'GraphQLAPIURL', {
      value: this.api.graphqlUrl,
      description: 'The URL of the GraphQL API',
      exportName: 'NovaSonicGraphQLAPIURL',
    });

    new cdk.CfnOutput(this, 'GraphQLAPIKey', {
      value: this.api.apiKey || '',
      description: 'The API Key for the GraphQL API',
      exportName: 'NovaSonicGraphQLAPIKey',
    });
  }

  /**
   * Create resolvers for the Nova Transcribe table
   */
  private createNovaTranscribeResolvers(dataSource: appsync.DynamoDbDataSource): void {
    // Query: Get a conversation by username and conversation_id
    dataSource.createResolver('GetConversation', {
      typeName: 'Query',
      fieldName: 'getConversation',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
            "username": $util.dynamodb.toDynamoDBJson($context.arguments.username),
            "conversation_id": $util.dynamodb.toDynamoDBJson($context.arguments.conversation_id)
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // Query: Get a conversation by conversation_id and timestamp (using GSI)
    dataSource.createResolver('GetConversationByConversationId', {
      typeName: 'Query',
      fieldName: 'getConversationByConversationId',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Query",
          "index": "ConversationIdIndex",
          "query": {
            "expression": "conversation_id = :id",
            "expressionValues": {
              ":id": $util.dynamodb.toDynamoDBJson($context.arguments.conversation_id)
            }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultList(),
    });

    // Query: List conversations for a specific username
    dataSource.createResolver('ListConversations', {
      typeName: 'Query',
      fieldName: 'listConversations',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Query",
          "query": {
            "expression": "username = :username",
            "expressionValues": {
              ":username": $util.dynamodb.toDynamoDBJson($context.arguments.username)
            }
          },
          "limit": #if($context.arguments.limit) $context.arguments.limit #else 20 #end,
          "nextToken": $util.toJson($util.defaultIfNullOrEmpty($context.arguments.nextToken, null))
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultList(),
    });

    // Query: List all conversations (scan)
    dataSource.createResolver('ListAllConversations', {
      typeName: 'Query',
      fieldName: 'listAllConversations',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Scan",
          "limit": #if($context.arguments.limit) $context.arguments.limit #else 20 #end,
          "nextToken": $util.toJson($util.defaultIfNullOrEmpty($context.arguments.nextToken, null))
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultList(),
    });

    // Mutation: Create a conversation entry
    dataSource.createResolver('CreateConversation', {
      typeName: 'Mutation',
      fieldName: 'createConversation',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #set($input = $context.arguments.input)
        {
          "version": "2017-02-28",
          "operation": "PutItem",
          "key": {
            "username": $util.dynamodb.toDynamoDBJson($input.username),
            "conversation_id": $util.dynamodb.toDynamoDBJson($input.conversation_id)
          },
          "attributeValues": $util.dynamodb.toMapValuesJson($input)
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // Note: Subscriptions are defined in the schema.graphql file using @aws_subscribe directive
  }

  /**
   * Create resolvers for the RestaurantBooking table
   */
  private createRestaurantBookingResolvers(dataSource: appsync.DynamoDbDataSource): void {
    // Query: Get a booking by ID
    dataSource.createResolver('GetBooking', {
      typeName: 'Query',
      fieldName: 'getBooking',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
            "booking_id": $util.dynamodb.toDynamoDBJson($context.arguments.bookingId)
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // Query: List bookings
    dataSource.createResolver('ListBookings', {
      typeName: 'Query',
      fieldName: 'listBookings',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Scan",
          "limit": #if($context.arguments.limit) $context.arguments.limit #else 20 #end,
          "nextToken": $util.toJson($util.defaultIfNullOrEmpty($context.arguments.nextToken, null))
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultList(),
    });

    // Mutation: Create a booking
    dataSource.createResolver('CreateBooking', {
      typeName: 'Mutation',
      fieldName: 'createBooking',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        #set($input = $context.arguments.input)
        {
          "version": "2017-02-28",
          "operation": "PutItem",
          "key": {
            "booking_id": $util.dynamodb.toDynamoDBJson($input.booking_id)
          },
          "attributeValues": $util.dynamodb.toMapValuesJson($input)
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // Mutation: Delete a booking
    dataSource.createResolver('DeleteBooking', {
      typeName: 'Mutation',
      fieldName: 'deleteBooking',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "DeleteItem",
          "key": {
            "booking_id": $util.dynamodb.toDynamoDBJson($context.arguments.bookingId)
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // Note: Subscriptions are defined in the schema.graphql file using @aws_subscribe directive
  }
}