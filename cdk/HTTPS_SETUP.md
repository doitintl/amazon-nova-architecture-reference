# HTTPS Setup for Nova Sonic Application

This document describes how to enable HTTPS for the Nova Sonic application using AWS Certificate Manager (ACM) and Route53.

## Overview

The Nova Sonic application has been updated to support HTTPS for both the webapp and API components. This is essential for WebRTC functionality to work properly with microphone access from the browser.

## Prerequisites

1. A registered domain name in Route53
2. SSL/TLS certificates in AWS Certificate Manager (ACM)

## Configuration

### 1. DNS Configuration

The application uses a configuration file (`dns-config.json`) to specify the domain and certificate information. This file should be placed in the `cdk` directory.

Example `dns-config.json`:

```json
{
  "domainName": "example.com",
  "webappSubdomain": "app",
  "apiSubdomain": "api",
  "webappCertificateArn": "arn:aws:acm:REGION:ACCOUNT_ID:certificate/CERTIFICATE_ID_FOR_WEBAPP",
  "apiCertificateArn": "arn:aws:acm:REGION:ACCOUNT_ID:certificate/CERTIFICATE_ID_FOR_API"
}
```

### 2. Certificate Creation

Before deploying, you need to create certificates in AWS Certificate Manager:

1. Go to AWS Certificate Manager in the AWS Console
2. Request a certificate for `app.example.com` (replace with your actual domain)
3. Request a certificate for `api.example.com` (replace with your actual domain)
4. Complete the domain validation process (typically via DNS validation)
5. Note the ARNs of the certificates and update them in the `dns-config.json` file

### 3. Deployment

Once the configuration is set up, deploy the application using CDK:

```bash
cd cdk
npm run build
cdk deploy --all
```

The deployment will:
- Create Route53 DNS records for the webapp and API
- Configure the Application Load Balancers with HTTPS listeners
- Set up HTTP to HTTPS redirection
- Update the API endpoint URL in the webapp configuration

## How It Works

1. The CDK entry point (`bin/cdk.ts`) loads the DNS configuration if available
2. The configuration is passed to the main stack
3. The main stack creates a DNS helper that is passed to both the webapp and API stacks
4. Each stack configures its load balancer with HTTPS if the DNS helper is provided
5. Route53 records are created to point to the load balancers

## Troubleshooting

If HTTPS is not working properly:

1. Verify that the certificates are valid and active in ACM
2. Check that the certificate ARNs in `dns-config.json` are correct
3. Ensure that the Route53 hosted zone for your domain exists
4. Check the CloudFormation outputs for the correct domain names

## Security Considerations

- The application now enforces HTTPS by redirecting HTTP requests to HTTPS
- WebRTC connections will use secure protocols
- Browser microphone access requires HTTPS for security reasons