import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

export interface LambdaStreamsStackProps extends cdk.StackProps {
  /**
   * The DynamoDB table for Nova Transcribe data
   */
  novaTable: dynamodb.ITable;
  
  /**
   * The DynamoDB table for Restaurant Booking data
   */
  bookingTable: dynamodb.ITable;
  
  /**
   * The AppSync API URL
   */
  appSyncApiUrl: string;
  
  /**
   * The AppSync API Key
   */
  appSyncApiKey: string;
}

export class LambdaStreamsStack extends cdk.Stack {
  /**
   * The Lambda function that processes DynamoDB streams
   */
  public readonly streamsProcessorFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaStreamsStackProps) {
    super(scope, id, props);

    // Create the Lambda function to process DynamoDB streams
    this.streamsProcessorFunction = new lambda.Function(this, 'DynamoDBStreamsProcessor', {
      functionName: 'nova-sonic-dynamodb-streams-processor',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/dynamodb-streams-processor', {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          command: [
            'bash', '-c', [
              'mkdir -p /asset-output',
              'cp -r /asset-input/* /asset-output/',
              'cd /asset-output',
              'npm install --production --no-package-lock --cache=/tmp/.npm'
            ].join(' && ')
          ],
          environment: {
            HOME: '/tmp'  // Set HOME to a writable directory
          }
        }
      }),
      environment: {
        APPSYNC_API_URL: props.appSyncApiUrl,
        APPSYNC_API_KEY: props.appSyncApiKey
      },
      timeout: cdk.Duration.seconds(45),  // Increased timeout for Amplify initialization
      architecture: lambda.Architecture.ARM_64,
      memorySize: 384,  // Increased memory for Amplify
    });
    
    // Add Lambda Insights for monitoring - using ARM64 compatible layer
    const lambdaInsightsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'LambdaInsightsLayer',
      `arn:aws:lambda:${this.region}:580247275435:layer:LambdaInsightsExtension-Arm64:2`
    );
    this.streamsProcessorFunction.addLayers(lambdaInsightsLayer);
    
    // Add DynamoDB stream event sources
    this.streamsProcessorFunction.addEventSource(
      new lambdaEventSources.DynamoEventSource(props.novaTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 3,
      })
    );
    
    this.streamsProcessorFunction.addEventSource(
      new lambdaEventSources.DynamoEventSource(props.bookingTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 3,
      })
    );
    
    // Grant permissions to the Lambda function
    // 1. Permission to read from DynamoDB streams - using broader permissions since we don't have stream ARNs
    this.streamsProcessorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:ListStreams'
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.novaTable.tableName}/stream/*`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.bookingTable.tableName}/stream/*`
        ]
      })
    );
    
    // 2. Permission to publish to AppSync API
    this.streamsProcessorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'appsync:GraphQL',
          'appsync:PublishToEventBus',  // Required for Amplify events API
          'appsync:PublishEvents'       // Required for Amplify events API
        ],
        resources: [`arn:aws:appsync:${this.region}:${this.account}:apis/*`],
      })
    );
    
    // Output the Lambda function ARN
    new cdk.CfnOutput(this, 'StreamsProcessorFunctionArn', {
      value: this.streamsProcessorFunction.functionArn,
      description: 'The ARN of the DynamoDB Streams Processor Lambda function',
      exportName: 'NovaSonicStreamsProcessorFunctionArn',
    });
  }
}