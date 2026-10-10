# clodfarm: always-on Claude Code agents. Runs as the non-root user "farm";
# the container itself is the sandbox the agents work in.
FROM debian:bookworm-slim
LABEL org.opencontainers.image.title="clodfarm" \
      org.opencontainers.image.description="Always-on Claude Code agents with Remote Control, sub-agents and a per-account budget governor" \
      org.opencontainers.image.source="https://github.com/matank001/clodfarm" \
      org.opencontainers.image.licenses="MIT"

# the newest Claude Code (the "latest" channel, ahead of "stable"); the farm keeps it current (FARM_CLAUDE_UPDATE)
ARG CLAUDE_VERSION=latest
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PATH=/home/farm/.local/bin:/opt/clodfarm/bin:$PATH \
    CLAUDE_CONFIG_DIR=/home/farm/.claude \
    DISABLE_AUTOUPDATER=1 \
    FARM_CLAUDE_UPDATE=3600 \
    FARM_WORKSPACE=/workspace \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client tmux jq less procps ripgrep tini \
      python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 -s /bin/bash farm \
    && mkdir -p /workspace /home/farm/.claude && chown farm:farm /workspace /home/farm/.claude

# Node (npm, npx) and the AWS CLI v2 on every box: the Claudes build and ship with them. The apps role
# (docs/deploy-aws.md) puts an `apps` profile in the AWS CLI config; without it `aws` has no credentials.
ARG NODE_MAJOR=22
RUN set -eux; \
    apt-get update && apt-get install -y --no-install-recommends xz-utils unzip && rm -rf /var/lib/apt/lists/*; \
    arch="$(dpkg --print-architecture | sed 's/amd64/x64/')"; \
    base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"; \
    file="$(curl -fsSL "$base/SHASUMS256.txt" | awk -v a="linux-$arch.tar.xz" '$2 ~ a"$" {print $2}')"; \
    curl -fsSLo "/tmp/$file" "$base/$file"; \
    curl -fsSL "$base/SHASUMS256.txt" | grep " $file\$" | (cd /tmp && sha256sum -c -); \
    tar -xJf "/tmp/$file" -C /usr/local --strip-components=1 --exclude='*/CHANGELOG.md' --exclude='*/README.md'; \
    rm "/tmp/$file"; node --version; npm --version; \
    curl -fsSLo /tmp/awscli.zip "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip"; \
    unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip; aws --version

# The farm's browser (docs/browser.md): Chromium on a virtual screen that you log in to sites with from the farm UI,
# noVNC to draw it there, and Playwright's MCP server so every Claude drives it. BROWSER=0 builds without it.
ARG BROWSER=1
ARG NOVNC_VERSION=1.6.0
RUN if [ "$BROWSER" = "1" ]; then set -eux; \
      apt-get update && apt-get install -y --no-install-recommends \
        chromium fonts-liberation fonts-noto-color-emoji fonts-dejavu-core xvfb x11vnc \
      && rm -rf /var/lib/apt/lists/*; \
      mkdir -p /opt/novnc && curl -fsSL "https://github.com/novnc/noVNC/archive/refs/tags/v${NOVNC_VERSION}.tar.gz" \
        | tar -xz -C /opt/novnc --strip-components=1 "noVNC-${NOVNC_VERSION}/core" "noVNC-${NOVNC_VERSION}/vendor" \
          "noVNC-${NOVNC_VERSION}/LICENSE.txt"; \
      npm install -g --no-fund --no-audit @playwright/mcp@latest && npm cache clean --force; \
      playwright-mcp --help | grep -q -- --cdp-endpoint; \
    fi

COPY --chown=farm:farm pyproject.toml README.md /src/
COPY --chown=farm:farm clodfarm /src/clodfarm
RUN python3 -m venv /opt/clodfarm && /opt/clodfarm/bin/pip install --no-cache-dir /src && rm -rf /src

USER farm
WORKDIR /workspace
# Claude Code native build (https://docs.claude.com/en/docs/claude-code/setup). CI passes a new CLAUDE_FRESH on every
# build, so a cached layer never ships an old "latest".
ARG CLAUDE_FRESH=
RUN echo "claude code $CLAUDE_VERSION ${CLAUDE_FRESH}" \
    && curl -fsSL https://claude.ai/install.sh | bash -s -- "$CLAUDE_VERSION" && claude --version \
    && git config --global user.name "clodfarm" && git config --global user.email "clodfarm@localhost" \
    && git config --global init.defaultBranch main

VOLUME ["/home/farm/.claude", "/workspace"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["clodfarm", "run"]
