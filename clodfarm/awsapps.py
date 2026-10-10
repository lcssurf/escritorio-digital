"""Optional: an AWS role the farm builds its own apps with (deploy/aws/apps-role.yaml, docs/deploy-aws.md).

Off unless FARM_AWS_APPS_ROLE is set. When it is, the farm writes an ``apps`` profile into the AWS CLI config (so
``aws --profile apps ...`` runs as that role, with the box's own credentials as the source), installs the AWS CLI v2
into the farm user's home if the image has none, and tells every Claude about it in the farm guide. clodfarm itself
never uses the profile: its store keeps the default credentials. The image stays as it is for everyone else.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

PROFILE = "apps"
START, END = "# >>> clodfarm apps role (managed by clodfarm) >>>", "# <<< clodfarm apps role <<<"
CREDENTIAL_SOURCES = ("Ec2InstanceMetadata", "EcsContainer", "Environment")


def settings() -> dict | None:
    """The apps role settings from the environment, or None when the feature is off."""
    role = os.environ.get("FARM_AWS_APPS_ROLE", "").strip()
    if not role:
        return None
    source = os.environ.get("FARM_AWS_APPS_CREDENTIALS", "").strip() or "Ec2InstanceMetadata"
    if source not in CREDENTIAL_SOURCES:
        raise ValueError(f"FARM_AWS_APPS_CREDENTIALS must be one of {', '.join(CREDENTIAL_SOURCES)}, not {source!r}")
    return {
        "role": role,
        "source": source,
        "boundary": os.environ.get("FARM_AWS_APPS_BOUNDARY", "").strip(),
        "prefix": os.environ.get("FARM_AWS_APPS_PREFIX", "").strip() or "farm-app",
        "region": (os.environ.get("FARM_AWS_APPS_REGION", "").strip() or os.environ.get("AWS_REGION", "").strip()
                   or "us-east-1"),
        "domain": os.environ.get("FARM_AWS_APPS_DOMAIN", "").strip(),
        "zone": os.environ.get("FARM_AWS_APPS_ZONE_ID", "").strip(),
        "budget": os.environ.get("FARM_AWS_APPS_BUDGET", "").strip(),
        "session": os.environ.get("FARM_NAME", "").strip() or "clodfarm",
    }


def config_path() -> str:
    return os.environ.get("AWS_CONFIG_FILE") or os.path.join(os.path.expanduser("~"), ".aws", "config")


def install_profile(path: str | None = None) -> bool:
    """Write (or, when the feature is off, remove) the managed ``[profile apps]`` block. Returns True if it changed."""
    path = path or config_path()
    try:
        cur = open(path).read()
    except OSError:
        cur = ""
    if START in cur and END in cur:
        pre, rest = cur.split(START, 1)
        rest = rest.split(END, 1)[1]
    else:
        pre, rest = cur, ""
    s = settings()
    block = ""
    if s:
        block = (f"{START}\n[profile {PROFILE}]\nrole_arn = {s['role']}\ncredential_source = {s['source']}\n"
                 f"role_session_name = {s['session']}\nregion = {s['region']}\nduration_seconds = 3600\n{END}\n")
    head = pre.rstrip("\n")
    new = (head + "\n\n" if head and block else head + ("\n" if head else "")) + block + rest.lstrip("\n")
    if new == cur:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(new)
    os.replace(tmp, path)
    return True


def ensure_cli(home: str | None = None) -> str | None:
    """Install the AWS CLI v2 into ~/.local (no root needed) when the apps role is on and there is no `aws` yet.
    Returns the installed version line, or None when nothing was needed."""
    if not settings() or shutil.which("aws"):
        return None
    home = home or os.path.expanduser("~")
    arch = {"arm64": "aarch64", "amd64": "x86_64"}.get(platform.machine(), platform.machine())
    url = os.environ.get("FARM_AWS_CLI_URL") or f"https://awscli.amazonaws.com/awscli-exe-linux-{arch}.zip"
    with tempfile.TemporaryDirectory() as tmp:
        zpath = os.path.join(tmp, "awscli.zip")
        with urllib.request.urlopen(url, timeout=120) as r, open(zpath, "wb") as f:
            shutil.copyfileobj(r, f)
        with zipfile.ZipFile(zpath) as z:  # zipfile drops the exec bits: put them back from the archive
            for info in z.infolist():
                out = z.extract(info, tmp)
                mode = info.external_attr >> 16
                if mode:
                    os.chmod(out, mode & 0o777)
        bin_dir = os.path.join(home, ".local", "bin")
        subprocess.run([os.path.join(tmp, "aws", "install"), "--install-dir", os.path.join(home, ".local", "aws-cli"),
                        "--bin-dir", bin_dir, "--update"], check=True, capture_output=True, text=True)
    return subprocess.run([os.path.join(bin_dir, "aws"), "--version"], capture_output=True, text=True).stdout.strip()


def guide_section() -> str:
    """The farm guide's AWS section, or "" when the feature is off."""
    s = settings()
    if not s:
        return ""
    boundary = f"`{s['boundary']}`" if s["boundary"] else "the one this farm's apps role requires"
    lines = [
        "",
        "## AWS: you can build and run apps",
        f"This farm has an AWS role for its own apps. `aws --profile {PROFILE} ...` runs as it (default region "
        f"{s['region']}); from code, use the `{PROFILE}` profile (boto3.Session(profile_name=\"{PROFILE}\")). Never set "
        "AWS_PROFILE for the whole farm: clodfarm itself uses the default credentials.",
        "- Keep each app's code and infrastructure in the repo (its own folder), and deploy it as its own "
        "CloudFormation stack (`aws --profile apps cloudformation deploy ...`). Smoke-test every deploy, and delete "
        "the stack when an app is retired.",
        f"- Every IAM role or policy you create must be named `{s['prefix']}-*`, and every role must carry the "
        f"permissions boundary {boundary}; anything else is denied. Name roles explicitly (auto-generated SAM or "
        "CDK role names fail).",
        "- Serverless services only: Lambda, API Gateway, DynamoDB, S3, CloudFront, ACM, Route 53, CloudWatch, "
        "EventBridge, SQS, SNS, Step Functions, SSM, Secrets Manager, KMS, Cognito, WAF and Bedrock. No EC2, RDS "
        "or containers. Design for pennies: on-demand tables, arm64, short log retention, nothing idle.",
    ]
    if s["budget"]:
        lines.append(f"- The account's budget is {s['budget']} USD a month. At 100% the role is locked until the "
                     "person lifts it (running apps keep serving). Check spend with "
                     f"`aws --profile {PROFILE} ce get-cost-and-usage` before anything that could cost real money.")
    else:
        lines.append("- Running apps cost money: a monthly budget locks the role when it is used up. Check spend "
                     f"with `aws --profile {PROFILE} ce get-cost-and-usage` before anything that could cost real money.")
    if s["domain"]:
        zone = f" (hosted zone {s['zone']})" if s["zone"] else ""
        lines.append(f"- Host apps at `<app>.{s['domain']}`: its Route 53 zone{zone} is in the account. Request "
                     "the certificate with ACM (DNS validation in that zone).")
    lines.append("- Never: IAM users or access keys, sending email, buying domains, or changing the stack that made "
                 "this role. Launching publicly, charging customers or contacting anyone still needs the person.")
    return "\n".join(lines) + "\n"
