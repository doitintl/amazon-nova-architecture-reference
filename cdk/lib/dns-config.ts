import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

/**
 * Configuration for DNS and SSL certificates
 */
export interface DnsConfig {
  /**
   * The domain name for the application (e.g., example.com)
   */
  domainName: string;
  
  /**
   * The subdomain for the webapp (e.g., app.example.com)
   */
  webappSubdomain: string;
  
  /**
   * The subdomain for the API (e.g., api.example.com)
   */
  apiSubdomain: string;
  
  /**
   * The ARN of the ACM certificate for the webapp
   */
  webappCertificateArn: string;
  
  /**
   * The ARN of the ACM certificate for the API
   */
  apiCertificateArn: string;

  restaurantBookingApiUrl: string; // Optional: URL for the restaurant booking API
  NOVA_AWS_ACCESS_KEY_ID: string; // Security RISK!!
  NOVA_AWS_SECRET_ACCESS_KEY: string; // Security RISK!!
}

/**
 * Helper class to create DNS records and configure certificates
 */
export class DnsHelper {
  private readonly config: DnsConfig;
  private readonly scope: Construct;
  private hostedZone?: route53.IHostedZone;

  constructor(scope: Construct, config: DnsConfig) {
    this.scope = scope;
    this.config = config;
  }

  /**
   * Get the hosted zone for the domain
   */
  public getHostedZone(): route53.IHostedZone {
    if (!this.hostedZone) {
      // Look up the hosted zone by domain name
      this.hostedZone = route53.HostedZone.fromLookup(this.scope, 'HostedZone', {
        domainName: this.config.domainName,
      });
    }
    return this.hostedZone;
  }

  /**
   * Get the ACM certificate for the webapp
   */
  public getWebappCertificate(): acm.ICertificate {
    return acm.Certificate.fromCertificateArn(
      this.scope,
      'WebappCertificate',
      this.config.webappCertificateArn
    );
  }

  /**
   * Get the ACM certificate for the API
   */
  public getApiCertificate(): acm.ICertificate {
    return acm.Certificate.fromCertificateArn(
      this.scope,
      'ApiCertificate',
      this.config.apiCertificateArn
    );
  }

  /**
   * Create a DNS record for the webapp
   */
  public createWebappDnsRecord(loadBalancer: elbv2.ILoadBalancerV2): route53.ARecord {
    const webappDomain = `${this.config.webappSubdomain}.${this.config.domainName}`;
    
    return new route53.ARecord(this.scope, 'WebappDnsRecord', {
      zone: this.getHostedZone(),
      recordName: this.config.webappSubdomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(loadBalancer)
      ),
      ttl: cdk.Duration.minutes(5),
    });
  }

  /**
   * Create a DNS record for the API
   */
  public createApiDnsRecord(loadBalancer: elbv2.ILoadBalancerV2): route53.ARecord {
    const apiDomain = `${this.config.apiSubdomain}.${this.config.domainName}`;
    
    return new route53.ARecord(this.scope, 'ApiDnsRecord', {
      zone: this.getHostedZone(),
      recordName: this.config.apiSubdomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(loadBalancer)
      ),
      ttl: cdk.Duration.minutes(5),
    });
  }

  /**
   * Get the full domain name for the webapp
   */
  public getWebappDomainName(): string {
    return `${this.config.webappSubdomain}.${this.config.domainName}`;
  }

  /**
   * Get the full domain name for the API
   */
  public getApiDomainName(): string {
    return `${this.config.apiSubdomain}.${this.config.domainName}`;
  }
}