FROM mcr.microsoft.com/playwright:v1.62.0-noble

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends fluxbox novnc websockify x11vnc xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY worker/package*.json ./worker/
RUN cd worker && npm ci --omit=dev --no-audit --no-fund
COPY worker ./worker
COPY extension ./extension
RUN mkdir -p /data/auth /data/state && chown -R pwuser:pwuser /app /data
COPY worker/docker-entrypoint.sh /usr/local/bin/bid-copilot-entrypoint
COPY worker/remote-login-entrypoint.sh /usr/local/bin/bid-copilot-remote-login
RUN chmod 0755 /usr/local/bin/bid-copilot-entrypoint /usr/local/bin/bid-copilot-remote-login \
    && command -v runuser >/dev/null

ENV NODE_ENV=production BROWSER_DATA_DIR=/data
EXPOSE 8080 6080
ENTRYPOINT ["/usr/local/bin/bid-copilot-entrypoint"]
CMD ["node", "worker/src/index.mjs"]
