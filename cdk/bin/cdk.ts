#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { CdkStack } from '../lib/cdk-stack';
import { DnsConfig } from '../lib/dns-config';

const app = new cdk.App();

// Define environment
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1'
};

// Load DNS configuration if available
let dnsConfig: DnsConfig | undefined;
const dnsConfigPath = path.join(__dirname, '..', 'dns-config.json');

if (fs.existsSync(dnsConfigPath)) {
  try {
    console.log('Loading DNS configuration from', dnsConfigPath);
    dnsConfig = JSON.parse(fs.readFileSync(dnsConfigPath, 'utf8')) as DnsConfig;
    console.log('DNS configuration loaded successfully');
  } catch (error) {
    console.warn('Failed to load DNS configuration:', error);
  }
}

// Create the main stack
new CdkStack(app, 'NovaSonicStack', {
  env,
  description: 'Nova Sonic Speech-to-Speech Application Infrastructure',
  dnsConfig,
});

// Log whether HTTPS is enabled
if (dnsConfig) {
  console.log('HTTPS is enabled with the following configuration:');
  console.log(`- Domain: ${dnsConfig.domainName}`);
  console.log(`- Webapp: ${dnsConfig.webappSubdomain}.${dnsConfig.domainName}`);
  console.log(`- API: ${dnsConfig.apiSubdomain}.${dnsConfig.domainName}`);
} else {
  console.log('HTTPS is not enabled. Using HTTP with ALB DNS names.');
}

// Tag all resources
cdk.Tags.of(app).add('Project', 'NovaSonic');
cdk.Tags.of(app).add('Environment', 'Production');