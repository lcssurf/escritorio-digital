# Deploy on AWS

`deploy/aws/template.yaml` creates:

| Resource | Notes |
|---|---|
| VPC + one public subnet + internet gateway | Its own small network. No NAT gateway, so no NAT cost. |
| Security group | **No inbound rules.** Outbound HTTPS covers Remote Control, the Claude API, git and SSM. |
| EC2 `t4g.medium` (arm64), Ubuntu 24.04 | Docker, 4 GB swap, encrypted gp3, IMDSv2 with hop limit 2 so the container can use the instance role. |
| IAM role | SSM Session Manager, plus Get/Put/Update/Delete/Query/Describe on **this stack's table only**. |
| DynamoDB table | On-demand, point-in-time recovery, TTL. `DeletionPolicy: Retain`, so deleting the stack keeps your history. |

Cost (ESTIMATE, us-east-1 on-demand prices at the time of writing; check the AWS pricing pages):
- a t4g.medium is about $0.034/h, roughly $25/month;
- 30 GB of gp3 is about $2.40/month;
- DynamoDB on-demand for a farm is usually cents per month.

A t4g.small (2 GB) runs one or two agents. Use t4g.large for 6+.

## Steps

```bash
export AWS_REGION=us-east-1           # and AWS_PROFILE if you use profiles
deploy/aws/deploy.sh up                # 3-6 minutes: stack + Docker build on the box
deploy/aws/deploy.sh login             # opens an SSM session straight into `clodfarm login`
deploy/aws/deploy.sh status
```

`up` accepts `--max-workers N`, `--instance-type`, `--model`, `--workspace-repo <git url>`, and `--table <name>` to
share one budget table between several stacks. Set `STACK=name` to run more than one farm.

The login step opens an interactive SSM session that runs `docker exec -it clodfarm clodfarm login` on the box. You
see a URL: open it on any device, approve, and paste the code back. See [auth.md](auth.md).

Day to day:
```bash
deploy/aws/deploy.sh logs     # follow the container logs
deploy/aws/deploy.sh shell    # a shell inside the container (clodfarm spawn ..., git log, ...)
deploy/aws/deploy.sh down     # delete everything except the DynamoDB table
```

## Working on a private repo

1. Create a deploy key with write access for that one repo, and keep its private half off the repo.
2. Put it in the container: `deploy/aws/deploy.sh shell`, then
   `mkdir -p ~/.ssh && cat > ~/.ssh/id_ed25519` (paste the key), `chmod 600 ~/.ssh/id_ed25519`, then
   `ssh-keyscan github.com >> ~/.ssh/known_hosts`.
   `~/.ssh` isn't a volume, so for a durable setup mount it or bake it into your own image layer.
3. Deploy with `--workspace-repo git@github.com:you/repo.git`, or set `FARM_REPO_URL` in `/opt/clodfarm/.env`
   and run `sudo docker compose up -d` there.

## Updating

`deploy/aws/deploy.sh upgrade` (or `--ref v1.0.1`) puts new clodfarm code on the running box without stopping any
agent: sub-agents mid-run, phone conversations and the farm's browser keep going ([upgrades.md](upgrades.md)). A new
image (a new Claude Code base, system packages) is `deploy/aws/deploy.sh roll`: the box stops taking work, finishes
what runs, and the container is recreated. On a multi-box farm, roll one box at a time and the others take the queue.
The login and the workspace are in volumes and survive both.

## Let the farm build apps on AWS (optional)

By default the agents get no AWS access beyond the farm's own table. The **apps role** is an add-on that lets them
create and run their own serverless apps, inside fences they can't move. Nothing about the plain deployment changes.

```bash
deploy/aws/deploy.sh apps-role --email you@example.com [--budget 50] [--domain apps.example.com] \
                               [--regions us-east-1,eu-central-1] [--prefix farm-app]
deploy/aws/deploy.sh apps-down     # remove it (apps the farm deployed are their own stacks and keep running)
```

`apps-role` does three things, and you can re-run it at any time to change a setting:
1. It deploys [`apps-role.yaml`](../deploy/aws/apps-role.yaml) as the stack `<STACK>-apps` (override with `APPS_STACK`),
   in the account of `APPS_PROFILE` if you set it, else in the farm's own account.
2. It adds an inline policy `clodfarm-apps-role` to the farm box's instance role, allowing `sts:AssumeRole` on the new
   deployer role and nothing else. The farm's own stack isn't updated, so the box isn't replaced.
3. Over SSM, it writes `FARM_AWS_APPS_*` into `/opt/clodfarm/.env` and runs `docker compose up -d`. The login and
   the workspace are volumes, so they survive.

On start, the farm writes an `apps` profile into the container's AWS CLI config (`role_arn` plus
`credential_source = Ec2InstanceMetadata`) and adds an **AWS** section to the guide every Claude reads: use
`aws --profile apps ...`, one CloudFormation stack per app, the naming rule, the budget and the domain. clodfarm itself
keeps using the default credentials, so its store isn't affected. The image has the AWS CLI v2 (since 0.8.0); on an
older image without `aws`, the farm installs it into the farm user's `~/.local` at startup (in the background, about a
minute).

### What the stack creates

| Resource | Purpose |
|---|---|
| `<stack>-deployer` role | The only thing the farm can assume. It trusts just the farm box's role. 4-hour sessions. |
| `<stack>-deploy` policy | Broad on serverless app services (CloudFormation, Lambda, API Gateway, DynamoDB, S3, CloudFront, ACM, Route 53, logs and metrics, EventBridge, Scheduler, SQS, SNS, Step Functions, SSM, Secrets Manager, KMS, Cognito, WAF, Bedrock invoke). IAM writes only on `<prefix>-*` roles and policies, and `CreateRole` only with the boundary attached. |
| `<stack>-boundary` policy | The permissions boundary every app role must carry: app services yes; IAM, Organizations, billing, domains, email and `sts:AssumeRole` never. |
| Hard denies | `DeleteRolePermissionsBoundary`, IAM users and access keys, SES sending, Route 53 domain registration, Marketplace, Savings Plans, budget changes, and changes to this stack. With `--regions`: every regional service outside those regions. |
| Budget and lock | An AWS Budget of `--budget` USD a month (default 50). Emails to `--email` at 50% and 80% actual and 100% forecast. At 100% actual, a Budgets action attaches `<stack>-deny-all` to the deployer. |
| Apps zone (with `--domain`) | A Route 53 hosted zone. Add its name servers (printed at the end) as an NS record for the domain at its parent. |

### Lifting a budget lock

The lock stops new deploys; apps that are already running keep serving (and costing). When you've looked at the spend,
detach the policy yourself: `aws iam detach-role-policy --role-name <stack>-deployer --policy-arn
arn:aws:iam::<account>:policy/<stack>-deny-all`, or raise the cap with `deploy.sh apps-role --budget <more>`.

### An account of its own (recommended)

Put the apps in a separate AWS account (`APPS_PROFILE=<a profile for it>`), for example a new member account in
your AWS Organization. Then nothing the farm deploys can see or touch anything else you run, the budget covers only
the farm's apps, and closing the account removes everything. If you use Organizations, attach an SCP to that account
so the fences hold even if an IAM policy is ever wrong. A starting point:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {"Sid": "NoEscapes", "Effect": "Deny", "Resource": "*",
     "Action": ["organizations:LeaveOrganization", "account:CloseAccount", "iam:CreateUser", "iam:CreateAccessKey",
                "iam:CreateLoginProfile", "route53domains:*", "aws-marketplace:*", "savingsplans:*",
                "ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail", "ses:SendBulkEmail"]},
    {"Sid": "OnlyTheOwnerTouchesTheFences", "Effect": "Deny", "Resource": "*",
     "Action": ["budgets:Modify*", "budgets:Update*", "budgets:Delete*", "budgets:ExecuteBudgetAction"],
     "Condition": {"ArnNotLike": {"aws:PrincipalArn": ["arn:aws:iam::*:role/OrganizationAccountAccessRole",
                                                       "arn:aws:iam::*:role/*-budgets"]}}}
  ]
}
```

### On a Docker host outside AWS

Set the variables yourself in `.env` and give the container credentials that may assume the deployer (for example
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` of a user whose only permission is that `sts:AssumeRole`):

```bash
FARM_AWS_APPS_ROLE=arn:aws:iam::<account>:role/clodfarm-apps-deployer
FARM_AWS_APPS_CREDENTIALS=Environment        # Ec2InstanceMetadata (default) | EcsContainer | Environment
FARM_AWS_APPS_BOUNDARY=arn:aws:iam::<account>:policy/clodfarm-apps-boundary
FARM_AWS_APPS_PREFIX=farm-app                # optional, also: FARM_AWS_APPS_REGION, _BUDGET, _DOMAIN, _ZONE_ID
```

Deploy `apps-role.yaml` with `FarmRoleArn` set to that user's ARN.
