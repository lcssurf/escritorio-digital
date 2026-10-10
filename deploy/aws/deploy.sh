#!/usr/bin/env bash
# clodfarm on AWS, one command per step. Needs the AWS CLI v2 and, for login/status/shell,
# the Session Manager plugin: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
#
#   deploy/aws/deploy.sh up [--max-workers 3] [--instance-type t4g.medium] [--workspace-repo URL]
#   deploy/aws/deploy.sh login      # log in to your Claude subscription on the box (URL + code)
#   deploy/aws/deploy.sh status     # clodfarm status on the box
#   deploy/aws/deploy.sh logs       # follow the container logs
#   deploy/aws/deploy.sh shell      # a shell inside the container
#   deploy/aws/deploy.sh down       # delete the stack (the DynamoDB table is kept)
#   deploy/aws/deploy.sh upgrade [--ref main | --from <pip/git URL>]
#                                   # new clodfarm code (daemon, UI, CLI) on the running box: every agent keeps
#                                   # running, the phone conversations too (docs/deploy-aws.md#upgrading)
#   deploy/aws/deploy.sh roll       # a new image (Claude Code, system packages): the box stops taking work,
#                                   # finishes what runs, then the container is recreated on the new image
#
# Optional, so the farm can build and run its own apps on AWS (apps-role.yaml; docs/deploy-aws.md):
#   deploy/aws/deploy.sh apps-role --email you@example.com [--budget 50] [--domain apps.example.com]
#                                  [--regions us-east-1,eu-central-1] [--prefix farm-app]
#   deploy/aws/deploy.sh apps-down  # switch it off again and delete the apps role stack
#
# Env: STACK (default clodfarm), STACK_TAGS (extra "Key=Value ..." tags), AWS_REGION / AWS_PROFILE as usual.
#      APPS_STACK (default <STACK>-apps); APPS_PROFILE puts the apps role in another AWS account (a profile for it).
set -euo pipefail
STACK=${STACK:-clodfarm}
HERE="$(cd "$(dirname "$0")" && pwd)"
REGION=${AWS_REGION:-$(aws configure get region || echo us-east-1)}
cmd=${1:-help}; shift || true

out() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
          --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
on_box() {  # run a command in an interactive SSM session on the instance
  aws ssm start-session --region "$REGION" --target "$(out InstanceId)" \
    --document-name AWS-StartInteractiveCommand --parameters "command=$1"
}
box_run() {  # run a shell script on the instance, non-interactively as root, and print its output
  local id cid b64; id=$(out InstanceId); b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  cid=$(aws ssm send-command --region "$REGION" --instance-ids "$id" --document-name AWS-RunShellScript \
        --parameters "commands=[\"echo $b64 | base64 -d | bash\"]" --query Command.CommandId --output text)
  aws ssm wait command-executed --region "$REGION" --command-id "$cid" --instance-id "$id" || true
  aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$id" \
    --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
}
apps_aws() {  # the account the apps role lives in: APPS_PROFILE if set, else the farm's own
  if [[ -n "${APPS_PROFILE:-}" ]]; then AWS_PROFILE="$APPS_PROFILE" aws --region "$REGION" "$@"; else aws --region "$REGION" "$@"; fi
}
farm_role() { aws cloudformation describe-stack-resource --region "$REGION" --stack-name "$STACK" --logical-resource-id Role \
                --query StackResourceDetail.PhysicalResourceId --output text; }
APPS_STACK=${APPS_STACK:-$STACK-apps}
wait_ready() {
  local id; id=$(out InstanceId)
  echo "waiting for $id to finish setup (usually 2-4 minutes)..."
  for _ in $(seq 1 90); do
    local cid st
    cid=$(aws ssm send-command --region "$REGION" --instance-ids "$id" --document-name AWS-RunShellScript \
          --parameters 'commands=["docker inspect -f {{.State.Running}} clodfarm 2>/dev/null || echo no"]' \
          --query Command.CommandId --output text 2>/dev/null) || { sleep 10; continue; }
    sleep 5
    st=$(aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$id" \
         --query StandardOutputContent --output text 2>/dev/null || true)
    [[ "$st" == true* ]] && { echo "container is running."; return 0; }
    sleep 5
  done
  echo "not ready yet; check: $0 logs" >&2; return 1
}

case "$cmd" in
  up)
    params=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --max-workers) params+=("MaxWorkers=$2"); shift 2 ;;
        --instance-type) params+=("InstanceType=$2"); shift 2 ;;
        --workspace-repo) params+=("WorkspaceRepo=$2"); shift 2 ;;
        --model) params+=("Model=$2"); shift 2 ;;
        --table) params+=("TableName=$2"); shift 2 ;;
        --repo-url) params+=("RepoUrl=$2"); shift 2 ;;
        --repo-ref) params+=("RepoRef=$2"); shift 2 ;;
        --source-tarball) params+=("SourceTarball=$2"); shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
      esac
    done
    aws cloudformation deploy --region "$REGION" --stack-name "$STACK" --template-file "$HERE/template.yaml" \
      --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --tags app=clodfarm ${STACK_TAGS:-} \
      ${params[@]+--parameter-overrides "${params[@]}"}
    wait_ready || true
    cat <<EOF

clodfarm is deployed (stack $STACK, instance $(out InstanceId), table $(out Table)).
Next: log in to your Claude subscription. It prints a URL; open it anywhere, approve, paste the code back:

  $0 login
EOF
    ;;
  apps-role)
    params=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --email) params+=("AlertEmail=$2"); shift 2 ;;
        --budget) params+=("MonthlyBudgetUsd=$2"); shift 2 ;;
        --domain) params+=("AppsDomain=$2"); shift 2 ;;
        --regions) params+=("AllowedRegions=$2"); shift 2 ;;
        --prefix) params+=("RolePrefix=$2"); shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
      esac
    done
    if ! apps_aws cloudformation describe-stacks --stack-name "$APPS_STACK" >/dev/null 2>&1 \
       && [[ " ${params[*]-} " != *" AlertEmail="* ]]; then
      echo "the first apps-role deploy needs --email (budget alerts go there)" >&2; exit 2
    fi
    role=$(farm_role); role_arn=$(aws iam get-role --role-name "$role" --query Role.Arn --output text)
    # 1. the apps role stack: deployer role, permissions boundary, budget lock, optional apps zone
    apps_aws cloudformation deploy --stack-name "$APPS_STACK" --template-file "$HERE/apps-role.yaml" \
      --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --tags app=clodfarm ${STACK_TAGS:-} \
      --parameter-overrides FarmRoleArn="$role_arn" ${params[@]+"${params[@]}"}
    aout() { apps_aws cloudformation describe-stacks --stack-name "$APPS_STACK" \
               --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text | sed 's/^None$//'; }
    deployer=$(aout DeployerArn); domain=$(aout AppsDomain); ns=$(aout AppsZoneNameServers)
    # 2. the farm box's role may assume the deployer (an inline policy; the farm stack itself is untouched)
    aws iam put-role-policy --role-name "$role" --policy-name clodfarm-apps-role --policy-document \
      "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sts:AssumeRole\",\"Resource\":\"$deployer\"}]}"
    # 3. switch it on in the farm: FARM_AWS_APPS_* in /opt/clodfarm/.env, then recreate the container (volumes stay)
    box_run "set -e; cd /opt/clodfarm; touch .env; sed -i '/^FARM_AWS_APPS_/d' .env
cat >> .env <<'EOF'
FARM_AWS_APPS_ROLE=$deployer
FARM_AWS_APPS_BOUNDARY=$(aout BoundaryArn)
FARM_AWS_APPS_PREFIX=$(aout RolePrefix)
FARM_AWS_APPS_BUDGET=$(aout MonthlyBudgetUsd)
FARM_AWS_APPS_DOMAIN=$domain
FARM_AWS_APPS_ZONE_ID=$(aout AppsZoneId)
EOF
docker compose up -d && echo 'farm restarted with the apps role'"
    cat <<EOF

The farm can now build its own apps: its Claudes run \`aws --profile apps ...\` as $deployer
(budget $(aout MonthlyBudgetUsd) USD/month; the role locks itself at 100%).
EOF
    [[ -n "$ns" ]] && echo "Delegate $domain: add an NS record for it at its parent with these servers: $ns"
    ;;
  apps-down)
    box_run "set -e; cd /opt/clodfarm; sed -i '/^FARM_AWS_APPS_/d' .env; docker compose up -d && echo 'farm restarted without the apps role'"
    aws iam delete-role-policy --role-name "$(farm_role)" --policy-name clodfarm-apps-role 2>/dev/null || true
    apps_aws cloudformation delete-stack --stack-name "$APPS_STACK"
    apps_aws cloudformation wait stack-delete-complete --stack-name "$APPS_STACK"
    echo "apps role removed. Apps the farm deployed are separate stacks: they keep running until you delete them." ;;
  upgrade)
    args=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --ref) args+=(--ref "$2"); shift 2 ;;
        --from) args+=(--from "$2"); shift 2 ;;
        --dry-run) DRY=1; shift ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
      esac
    done
    script="docker exec clodfarm clodfarm upgrade ${args[*]:-} && docker exec clodfarm clodfarm upgrade --status"
    if [[ -n "${DRY:-}" ]]; then echo "would run on $(out InstanceId): $script"; exit 0; fi
    box_run "set -e; $script" ;;
  roll)
    # drain: no new sub-agents here, running ones finish (a multi-box farm's other boxes take the queue meanwhile)
    script='set -e; cd /opt/clodfarm; docker compose pull -q
docker exec clodfarm clodfarm drain --exit
for i in $(seq 1 360); do   # up to 6 h: the longest a sub-agent may run is FARM_TASK_TIMEOUT
  docker logs --since 30s clodfarm 2>&1 | grep -q "farm.drained" && break
  [ "$(docker inspect -f {{.State.Running}} clodfarm)" = true ] || break
  sleep 60
done
docker compose up -d --force-recreate && echo "rolled onto the new image"'
    if [[ "${1:-}" == "--dry-run" ]]; then echo "would run on $(out InstanceId):"; echo "$script"; exit 0; fi
    box_run "$script" ;;
  login)  on_box "sudo docker exec -it clodfarm clodfarm login" ;;
  status) on_box "sudo docker exec -it clodfarm clodfarm status" ;;
  logs)   on_box "sudo docker logs -f --tail 100 clodfarm" ;;
  shell)  on_box "sudo docker exec -it clodfarm bash" ;;
  down)
    aws cloudformation delete-stack --region "$REGION" --stack-name "$STACK"
    aws cloudformation wait stack-delete-complete --region "$REGION" --stack-name "$STACK"
    echo "stack deleted. The DynamoDB table is retained; delete it by hand if you no longer need the history." ;;
  *) sed -n '2,23p' "$0" ;;
esac
