import * as cdk from "aws-cdk-lib"
import * as rds from "aws-cdk-lib/aws-rds"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from "constructs"

export class CdkDockerRdsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // Create a VPC
    const vpc = new ec2.Vpc(this, "MyVpc", {
      cidr: "30.0.0.0/16",
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED
        }
      ]
    })

    // Create an ECS cluster in the VPC
    const cluster = new ecs.Cluster(this, "MyCluster", {
      vpc: vpc
    })

    // Create a private RDS instance
    const dbUsername = config.DB_USERNAME || "postgres"
    const dbPassword = config.DB_PASSWORD || "password"
    const dbDatabase = config.DB_DATABASE || "postgres"
    const dbSchema = config.DB_SCHEMA || "public"

    const database = new rds.DatabaseInstance(this, "MyDB", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_13
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      credentials: rds.Credentials.fromUsername(dbUsername, {
        password: cdk.SecretValue.unsafePlainText(dbPassword)
      }),
      instanceIdentifier: "educando-dev",
      databaseName: dbDatabase,
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      },
      allocatedStorage: 10
    })

    // Build the Docker image and push it to the ECR repository
    const dockerImage = cdk.aws_ecs.ContainerImage.fromAsset("app", {
      platform: Platform.LINUX_AMD64
    })

    cluster.addDefaultCloudMapNamespace({
      name: "my-namespace"
    })

    // Create a load balancer for the ECS service
    const lb = new elbv2.ApplicationLoadBalancer(this, "MyLoadBalancer", {
      vpc,
      internetFacing: true,
      http2Enabled: true
    })

    const listener = lb.addListener("MyListener", {
      port: 80,
      open: true
    })

    // Create an ECS task definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "MyTaskDefinition"
    )

    const jwtSecret = config.JWT_SECRET || "JWT_SECRET"
    const jwtExpiresIn = config.JWT_EXPIRES_IN || "1d"

    taskDefinition.addContainer("MyContainer", {
      image: dockerImage,
      environment: {
        PORT: "80",
        NODE_ENV: "production",
        DB_HOST: database.dbInstanceEndpointAddress,
        DB_PORT: database.dbInstanceEndpointPort,
        DB_DATABASE: dbDatabase,
        DB_USERNAME: dbUsername,
        DB_PASSWORD: dbPassword,
        DB_SCHEMA: dbSchema,
        JWT_SECRET: jwtSecret,
        JWT_EXPIRES_IN: jwtExpiresIn
      },
      memoryLimitMiB: 512,
      cpu: 256,
      portMappings: [
        {
          containerPort: 80,
          protocol: ecs.Protocol.TCP
        }
      ]
    })

    const service = new ecs.FargateService(this, "MyService", {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: true
    })

    listener.addTargets("MyTarget", {
      port: 80,
      targets: [service],
      healthCheck: {
        path: "/"
      }
    })

    // Allow inbound traffic from the load balancer to the service
    service.connections.allowFrom(lb, ec2.Port.tcp(80), "Load balancer access")

    // Allow inbound traffic from the service to the database
    database.connections.allowFrom(
      service,
      ec2.Port.tcp(5432),
      "Service access"
    )

    // Output the load balancer URL
    new cdk.CfnOutput(this, "LoadBalancerDNS", {
      value: `http://${lb.loadBalancerDnsName}`
    })
  }
}
