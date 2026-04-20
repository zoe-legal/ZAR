# AWS Setup for ZAR Activation

## Purpose

This document captures the AWS-side setup used to activate the current `dev.zoe-legal.net` ZAR environment.

It is being kept in this repo for now because it is directly tied to getting ZAR live. It should eventually move into `zInfra` once the infrastructure boundary is cleaned up.

## Current Public Path

The current public path is:

1. `Route 53` record for `dev.zoe-legal.net`
2. `Application Load Balancer` in `us-west-1`
3. EC2 instance target group on port `80`
4. Dockerized `zar-edge-nginx`
5. internal Docker routing to the ZAR stack

## What Was Set Up

### 1. EC2 Instance

An Ubuntu EC2 instance was created and made reachable over SSH.

Important details:
- security group allows inbound `22` for SSH
- security group allows inbound `80` for ALB/application traffic
- Docker was installed on the instance
- the instance was later given an IAM role so containers could read AWS Secrets Manager without static credentials

### 2. Docker On The Instance

Docker Engine, Buildx, and Docker Compose plugin were installed on the Ubuntu instance.

The machine is now expected to run the ZAR stack through:

```bash
bash bring-up.sh
```

inside the repo.

### 3. Route 53

A hosted zone for `zoe-legal.net` exists in Route 53.

For the current environment:
- `dev.zoe-legal.net` was initially pointed directly at the instance IP during early bring-up
- once the ALB was working, the record was changed to an `Alias A` record pointing to the ALB

That means the domain no longer depends on a single instance IP.

### 4. ACM Certificate

An ACM certificate was requested for:

- `dev.zoe-legal.net`

It was validated through Route 53 DNS validation and then attached to the ALB.

Important note:
- this ACM certificate is for AWS-managed TLS termination
- it is not a portable cert file for direct EC2 reuse

### 5. Application Load Balancer

A public Application Load Balancer was created in `us-west-1`.

Current listener shape:
- `HTTP :80` redirects to `HTTPS :443`
- `HTTPS :443` uses the ACM certificate for `dev.zoe-legal.net`
- `HTTPS :443` forwards to the app target group

### 6. Target Group

A target group was created for the instance on:

- protocol: `HTTP`
- port: `80`

Health checks were wired to a working HTTP path during bring-up.

The initial placeholder nginx served a health endpoint so the ALB path could be validated before the real ZAR stack went in.

### 7. Temporary Nginx Bring-Up

Before the real ZAR stack was deployed, a temporary nginx container was used to prove:
- EC2 reachability
- ALB target health
- TLS termination through ACM
- Route 53 resolution to the ALB

That placeholder stack was later replaced by the real repo-based Docker Compose stack.

### 8. IAM Role For The Instance

An IAM role was attached to the EC2 instance so containers could read from AWS Secrets Manager using the normal AWS credential chain.

This removed the need to depend on a local AWS profile on the server.

At minimum, the role needs access to:
- Secrets Manager read for the relevant config secrets
- S3 access as needed by later ZAR/system work

### 9. Secrets Manager

The current runtime uses AWS Secrets Manager for sensitive configuration.

In practice, this includes:
- Clerk secret key
- Clerk webhook signing secret
- control-plane database URL
- onboarding database URL

The checked-in `.env` files in service folders contain secret names and other non-secret config, not the secret values themselves.

### 10. Compose Stack On The Instance

The instance now runs the repo-local Docker Compose stack, which currently includes:
- `zar-edge-nginx`
- `zar-sample-ui`
- `zar-backend`
- `zoe-onboarding-api`
- `zoe-user-admin-api`
- `openfga`

All of these run on the internal Docker network:
- `zoe_czar`

## Current Operational Notes

### TLS Termination

TLS currently terminates at the ALB, not on the instance.

That means:
- ACM handles the public certificate
- instance services can remain on plain HTTP internally for now
- later service-to-service TLS can be introduced separately if desired

### Why ALB Was Chosen

The ALB path was chosen because instance churn is expected.

Benefits:
- stable DNS target
- stable TLS endpoint
- easier instance replacement
- path to host-based and path-based routing later
- clean future move to ASG / instance group rotation

### Current Gap

This environment is still using a single EC2 instance behind the ALB.

That is acceptable for current development activation, but it is not the final scaling shape.

The likely next infrastructure move later is:
- launch template
- auto scaling group
- same ALB in front

## Future Move To zInfra

This document should eventually be moved into the infrastructure repo once:
- the repo boundaries are cleaned up
- the deployment shape stops changing rapidly
- ZAR and the infrastructure code are managed separately enough that this no longer belongs next to the service code
