#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkStack } from '../lib/cdk-stack';
import { NetworkStack } from '../lib/network-stack';
import { WebappStack } from '../lib/webapp-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

// Define environment
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1'
};

// Create the main stack
new CdkStack(app, 'NovaSonicStack', {
  env,
  description: 'Nova Sonic Speech-to-Speech Application Infrastructure',
});

// Tag all resources
cdk.Tags.of(app).add('Project', 'NovaSonic');
cdk.Tags.of(app).add('Environment', 'Production');