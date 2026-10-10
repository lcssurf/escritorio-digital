"""The optional apps role: off by default, a managed [profile apps] block when on, and a guide section for the Claudes."""
import pytest

from clodfarm import awsapps, prompts

ROLE = "arn:aws:iam::123456789012:role/clodfarm-apps-deployer"
BOUNDARY = "arn:aws:iam::123456789012:policy/clodfarm-apps-boundary"


@pytest.fixture
def aws_config(tmp_path, monkeypatch):
    for k in ("FARM_AWS_APPS_ROLE", "FARM_AWS_APPS_BOUNDARY", "FARM_AWS_APPS_PREFIX", "FARM_AWS_APPS_REGION",
              "FARM_AWS_APPS_CREDENTIALS", "FARM_AWS_APPS_DOMAIN", "FARM_AWS_APPS_ZONE_ID", "FARM_AWS_APPS_BUDGET"):
        monkeypatch.delenv(k, raising=False)
    path = tmp_path / "aws" / "config"
    monkeypatch.setenv("AWS_CONFIG_FILE", str(path))
    monkeypatch.setenv("AWS_REGION", "eu-central-1")
    monkeypatch.setenv("FARM_NAME", "myfarm")
    return path


def switch_on(monkeypatch, **extra):
    monkeypatch.setenv("FARM_AWS_APPS_ROLE", ROLE)
    monkeypatch.setenv("FARM_AWS_APPS_BOUNDARY", BOUNDARY)
    for k, v in extra.items():
        monkeypatch.setenv(k, v)


def test_off_by_default_leaves_the_guide_and_the_aws_config_alone(aws_config):
    assert awsapps.settings() is None
    assert prompts.farm_guide() == prompts.FARM_GUIDE
    assert awsapps.install_profile() is False
    assert not aws_config.exists()


def test_on_writes_a_profile_that_assumes_the_role_and_keeps_other_profiles(aws_config, monkeypatch):
    aws_config.parent.mkdir(parents=True)
    aws_config.write_text("[default]\nregion = us-west-2\n")
    switch_on(monkeypatch)
    assert awsapps.install_profile() is True
    text = aws_config.read_text()
    assert text.startswith("[default]\nregion = us-west-2\n")
    assert f"[profile apps]\nrole_arn = {ROLE}\ncredential_source = Ec2InstanceMetadata\n" in text
    assert "role_session_name = myfarm\nregion = eu-central-1\n" in text
    assert awsapps.install_profile() is False  # idempotent
    monkeypatch.setenv("FARM_AWS_APPS_REGION", "us-east-1")
    assert awsapps.install_profile() is True and aws_config.read_text().count("[profile apps]") == 1
    assert "region = us-east-1\n" in aws_config.read_text()


def test_switching_off_removes_only_the_managed_block(aws_config, monkeypatch):
    switch_on(monkeypatch)
    awsapps.install_profile()
    aws_config.write_text(aws_config.read_text() + "\n[profile mine]\nregion = ap-south-1\n")
    monkeypatch.delenv("FARM_AWS_APPS_ROLE")
    assert awsapps.install_profile() is True
    text = aws_config.read_text()
    assert "[profile apps]" not in text and awsapps.START not in text
    assert "[profile mine]\nregion = ap-south-1\n" in text


def test_the_guide_tells_every_claude_how_to_use_the_role(aws_config, monkeypatch):
    switch_on(monkeypatch, FARM_AWS_APPS_BUDGET="50", FARM_AWS_APPS_DOMAIN="apps.example.com",
              FARM_AWS_APPS_ZONE_ID="Z123", FARM_AWS_APPS_PREFIX="app")
    guide = prompts.farm_guide()
    assert guide.startswith(prompts.FARM_GUIDE)
    assert "## AWS: you can build and run apps" in guide
    assert "`aws --profile apps ...`" in guide and "Never set AWS_PROFILE" in guide
    assert "`app-*`" in guide and BOUNDARY in guide
    assert "50 USD a month" in guide and "`<app>.apps.example.com`" in guide and "Z123" in guide


def test_a_bad_credential_source_is_refused(aws_config, monkeypatch):
    switch_on(monkeypatch, FARM_AWS_APPS_CREDENTIALS="SharedFile")
    with pytest.raises(ValueError):
        awsapps.install_profile()


def test_the_cli_is_only_installed_when_the_role_is_on_and_missing(aws_config, monkeypatch):
    fetched = []
    monkeypatch.setattr(awsapps.urllib.request, "urlopen", lambda *a, **k: fetched.append(a) or (_ for _ in ()).throw(OSError))
    assert awsapps.ensure_cli() is None  # off: nothing to do
    switch_on(monkeypatch)
    monkeypatch.setattr(awsapps.shutil, "which", lambda name: "/usr/bin/aws")
    assert awsapps.ensure_cli() is None  # already there
    assert fetched == []
